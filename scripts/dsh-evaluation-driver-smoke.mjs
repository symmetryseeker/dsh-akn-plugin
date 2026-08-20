import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { DeepSeekHarnessAdapter } from '../packages/adapter-dsh/dist/index.js'
import { LocalEvidenceStore } from '../packages/local-store/dist/index.js'
import { canonicalJson, finalizeProtocolObject, sha256, toObjectRef } from '../packages/protocol/dist/index.js'
import { runEvaluationMatrix } from '../packages/evaluation/dist/index.js'
import {
  createDshEvaluationDriver,
  parseDshEvaluationDriverConfig,
} from '../packages/dsh-plugin/dist/evaluation-driver.js'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshRoot = resolve(process.env.DSH_SOURCE ?? join(repositoryRoot, 'deepseek-harness'))
const dshExecutable = join(dshRoot, 'apps', 'cli', 'lib', 'bin.js')
const aenCliExecutable = join(repositoryRoot, 'apps', 'cli', 'dist', 'main.js')
const mockModule = join(dshRoot, 'packages', 'test-support', 'llm-mock-server', 'lib', 'index.js')
const pluginRoot = join(repositoryRoot, 'packages', 'dsh-plugin')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const temporaryRoot = await mkdtemp(join(tmpdir(), 'aen-dsh-evaluation-smoke-'))
const packRoot = join(temporaryRoot, 'pack')
const dshHome = join(temporaryRoot, 'dsh-home')
const probeTraceRoot = join(temporaryRoot, 'probe-traces')
const evaluationTraceRoot = join(temporaryRoot, 'evaluation-traces')
const storePath = join(temporaryRoot, 'evidence.sqlite')
const probePatchPath = join(temporaryRoot, 'probe.patch.yml')
const emptyHarnessPatchPath = join(temporaryRoot, 'frozen-harness.patch.yml')
const fixtureSourceRoot = join(temporaryRoot, 'frozen-fixture')
const matrixPath = join(temporaryRoot, 'matrix.json')
const driverConfigPath = join(temporaryRoot, 'dsh-driver.json')
const graderModulePath = join(temporaryRoot, 'trusted-grader.mjs')
const apiKey = 'aen-local-smoke-key'
const fixtureText = 'AEN digest-bound evaluation fixture.\n'
const originalApiKey = process.env.DEEPSEEK_API_KEY
const originalBaseUrl = process.env.DEEPSEEK_BASE_URL

const environment = { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' }
for (const key of [
  'ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'all_proxy', 'https_proxy', 'http_proxy', 'NODE_USE_ENV_PROXY',
]) delete environment[key]

async function command(executable, args, cwd, extraEnvironment = {}) {
  return execFileAsync(executable, args, {
    cwd,
    env: { ...environment, ...extraEnvironment },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  })
}

async function sessionFiles(root) {
  const files = []
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.pop()
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) queue.push(path)
      else if (entry.isFile() && entry.name === 'session.jsonl') files.push(path)
    }
  }
  return files.sort()
}

function sessionCorrelation(imported) {
  const header = imported.normalizedEvents.find((event) => event.kind === 'session')?.data
  if (header === null || typeof header !== 'object' || Array.isArray(header) || typeof header.id !== 'string') {
    throw new Error('probe transcript omitted its DSH session id')
  }
  return sha256(header.id)
}

let mock
let store
try {
  await stat(dshExecutable)
  await stat(aenCliExecutable)
  await stat(mockModule)
  await mkdir(packRoot, { recursive: true })
  await mkdir(dshHome, { recursive: true })
  await mkdir(probeTraceRoot, { recursive: true })
  await mkdir(fixtureSourceRoot, { recursive: true })
  await writeFile(join(fixtureSourceRoot, 'task-input.txt'), fixtureText)
  const { startMockLlmServer } = await import(pathToFileURL(mockModule).href)
  mock = await startMockLlmServer({
    sequence: ['success', 'success'],
    repeatLast: true,
    apiKey,
    successText: 'AEN official headless evaluation smoke completed.',
  })
  // The production driver deliberately inherits credentials from the caller;
  // it never accepts or persists secrets in its JSON configuration.
  process.env.DEEPSEEK_API_KEY = apiKey
  process.env.DEEPSEEK_BASE_URL = mock.baseURL
  const packed = await command(pnpm, ['pack', '--pack-destination', packRoot], pluginRoot)
  const tarballLine = `${packed.stdout}${packed.stderr}`.split(/\r?\n/u).findLast((line) => line.endsWith('.tgz'))
  if (tarballLine === undefined) throw new Error('pnpm pack did not report the AEN plugin tarball')
  const tarball = resolve(tarballLine.trim())
  await command(pnpm, ['dsh', 'plugin', '--profile', 'headless', 'add', tarball], dshRoot)

  await writeFile(probePatchPath, [
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${JSON.stringify(probeTraceRoot)}`,
    '    packChunks: false',
    '    compression: none',
    '    preparedSessionCacheSize: 5',
    '    writeBatchMaxDelayMs: 1',
    '- id: aen',
    '  config:',
    '    enabled: true',
    `    storePath: ${JSON.stringify(storePath)}`,
    '    harnessVersion: 0.1.0-rc.7',
    '    snapshotDelayMs: 0',
    '',
  ].join('\n'))
  await writeFile(emptyHarnessPatchPath, '[]\n')

  const probe = await command(
    dshExecutable,
    ['--profile', 'headless', '--patch', probePatchPath, 'Return a short readiness confirmation.'],
    temporaryRoot,
    { DEEPSEEK_API_KEY: apiKey, DEEPSEEK_BASE_URL: mock.baseURL },
  )
  if (!probe.stdout.includes('AEN official headless evaluation smoke completed.')) {
    throw new Error(`official DSH headless probe returned unexpected output: ${probe.stdout}`)
  }
  const probeFiles = await sessionFiles(probeTraceRoot)
  if (probeFiles.length !== 1) throw new Error(`probe produced ${probeFiles.length} transcripts instead of one`)
  const probeTranscript = probeFiles[0]
  const importedProbe = await new DeepSeekHarnessAdapter().importEvidence({
    mediaType: 'application/x-ndjson',
    sourceName: probeTranscript,
    schemaNamespace: 'https://github.com/deepseek-ai/DeepSeek-Harness/session-log',
    schemaVersion: '0',
    exporterVersion: '0.1.0-rc.7',
    localPath: probeTranscript,
  })

  store = new LocalEvidenceStore(storePath)
  const correlation = sessionCorrelation(importedProbe)
  const manifests = store.listObjects('harness_manifest')
    .map((summary) => store.getByDigest(summary.digest))
    .filter((manifest) => manifest?.objectType === 'harness_manifest' && manifest.sessionScope?.sessionDigest === correlation)
  if (manifests.length !== 1) throw new Error(`probe correlated ${manifests.length} live Manifests instead of one`)
  const representativeManifest = manifests[0]
  const graderDefinition = finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'grader_definition',
    graderId: 'urn:aen:grader:dsh-headless-smoke',
    revision: 1,
    type: 'human',
    target: 'outcome',
  })
  const fixtureTreeDigest = sha256(canonicalJson([{
    path: 'task-input.txt',
    digest: sha256(fixtureText),
  }]))
  const fixtureArtifact = finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'artifact',
    artifactId: 'urn:aen:artifact:dsh-headless-smoke-fixture',
    kind: 'benchmark',
    name: 'DSH headless smoke fixture',
    snapshotCompleteness: 'complete_package',
    treeDigest: fixtureTreeDigest,
    source: { type: 'filesystem' },
    redistributable: false,
    distribution: { transport: 'local_only' },
    disclosure: 'digest_only',
  })
  const benchmark = finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'benchmark_task',
    benchmarkId: 'urn:aen:benchmark:dsh-headless-smoke',
    revision: 1,
    suiteKind: 'capability',
    task: {
      taxonomy: ['dsh-headless-smoke'],
      intent: 'Return a short readiness confirmation.',
      constraints: ['Do not modify the workspace.'],
      acceptance: [
        { id: 'expected-output', description: 'The expected mock response is returned.', required: true },
        { id: 'fixture-bound', description: 'The digest-bound fixture is copied into the isolated workspace.', required: true },
      ],
      riskClass: 'read_only',
    },
    environment: { fixtureRefs: [toObjectRef(fixtureArtifact)], networkMode: 'allowlisted' },
    graderRefs: [toObjectRef(graderDefinition)],
    resourceLimits: { timeoutMs: 20_000, maxCostUsd: 0.01, maxModelCalls: 2, maxToolCalls: 0 },
    trialPlan: { repetitions: 1, randomization: 'none', primaryMetric: 'success_rate' },
    allowedSideEffects: [],
    validity: {
      status: 'validated',
      issueClarityReviewed: true,
      acceptanceAlignmentReviewed: true,
      solvabilityReviewed: true,
      reviewerRefs: [{ actorId: 'urn:aen:actor:dsh-smoke-reviewer', type: 'human' }],
      reviewedAt: '2026-08-20T00:00:00Z',
      contaminationRisk: 'low',
    },
  })
  store.putBatch({ objects: [
    { object: graderDefinition },
    { object: fixtureArtifact },
    { object: benchmark },
  ] })
  const grader = {
    name: 'dsh-headless-smoke-grader',
    evaluator: { actorId: 'urn:aen:evaluator:dsh-headless-smoke', type: 'service' },
    graderRefDigests: [graderDefinition.digest],
    async grade(input) {
      const outputPassed = input.stdout.includes('AEN official headless evaluation smoke completed.')
      const fixturePassed = await readFile(join(input.workspace, 'task-input.txt'), 'utf8') === fixtureText
      const passed = outputPassed && fixturePassed
      return {
        graderRefDigest: graderDefinition.digest,
        status: passed ? 'success' : 'agent_failure',
        criteria: [
          { criterionId: 'expected-output', passed: outputPassed },
          { criterionId: 'fixture-bound', passed: fixturePassed },
        ],
        qualityScore: passed ? 1 : 0,
        totalCostUsd: 0.001,
        ...(passed ? {} : { failureType: 'unexpected_mock_output' }),
      }
    },
  }
  const driverConfig = parseDshEvaluationDriverConfig({
    dshExecutable,
    dshHome,
    profile: 'headless',
    harnessVersion: '0.1.0-rc.7',
    traceRoot: evaluationTraceRoot,
    fixturesByBenchmarkDigest: {
      [benchmark.digest]: {
        mode: 'copy',
        sourceDir: fixtureSourceRoot,
        fixtureDigests: [fixtureArtifact.digest],
      },
    },
    patchesByHarnessConfigurationDigest: {
      [representativeManifest.configurationDigest]: [emptyHarnessPatchPath],
    },
    contextBudget: { estimatedMaxTokens: 2048, maxBytes: 32_768 },
    maxOutputBytes: 1_048_576,
  })
  const driver = await createDshEvaluationDriver({ config: driverConfig, store, storePath, grader })
  const result = await runEvaluationMatrix(store, {
    experimentId: 'urn:aen:experiment:dsh-headless-smoke',
    benchmarkSelectors: [benchmark.digest],
    cells: [{
      cellId: 'baseline',
      treatment: 'baseline',
      model: importedProbe.model,
      harnessConfigurationDigest: representativeManifest.configurationDigest,
      harnessManifestDigest: representativeManifest.digest,
    }],
    repetitions: 1,
    reliabilityK: 1,
    confidenceLevel: 0.95,
    minValidTrialsPerCell: 1,
    excludedStatuses: ['infra_error', 'grader_error', 'aborted'],
    comparisons: [],
  }, driver)
  const observation = result.observations[0]
  if (result.trials[0]?.status !== 'success') {
    throw new Error(`live DSH trial failed: ${observation?.failureType ?? 'unknown failure'}`)
  }
  if (observation.configurationCell.harnessManifestDigest === representativeManifest.digest) {
    throw new Error('live trial reused the representative snapshot instead of recording its run-local Manifest')
  }
  if (observation.configurationCell.harnessConfigurationDigest !== representativeManifest.configurationDigest) {
    throw new Error('live trial changed the frozen Harness configuration identity')
  }
  if (result.trials[0]?.transcriptRef === undefined) throw new Error('live trial omitted its metadata-only transcript evidence')
  await writeFile(driverConfigPath, `${JSON.stringify(driverConfig, null, 2)}\n`)
  await writeFile(matrixPath, `${JSON.stringify({
    experimentId: 'urn:aen:experiment:dsh-headless-cli-smoke',
    benchmarkSelectors: [benchmark.digest],
    cells: [{
      cellId: 'baseline-cli',
      treatment: 'baseline',
      model: importedProbe.model,
      harnessConfigurationDigest: representativeManifest.configurationDigest,
      harnessManifestDigest: representativeManifest.digest,
    }],
    repetitions: 1,
    reliabilityK: 1,
    confidenceLevel: 0.95,
    minValidTrialsPerCell: 1,
    excludedStatuses: ['infra_error', 'grader_error', 'aborted'],
    comparisons: [],
  }, null, 2)}\n`)
  await writeFile(graderModulePath, `import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const fixtureText = ${JSON.stringify(fixtureText)};
export const grader = {
  name: 'dsh-headless-cli-smoke-grader',
  evaluator: { actorId: 'urn:aen:evaluator:dsh-headless-cli-smoke', type: 'service' },
  graderRefDigests: [${JSON.stringify(graderDefinition.digest)}],
  async grade(input) {
    const outputPassed = input.stdout.includes('AEN official headless evaluation smoke completed.');
    const fixturePassed = await readFile(join(input.workspace, 'task-input.txt'), 'utf8') === fixtureText;
    const passed = outputPassed && fixturePassed;
    return {
      graderRefDigest: ${JSON.stringify(graderDefinition.digest)},
      status: passed ? 'success' : 'agent_failure',
      criteria: [
        { criterionId: 'expected-output', passed: outputPassed },
        { criterionId: 'fixture-bound', passed: fixturePassed },
      ],
      qualityScore: passed ? 1 : 0,
      totalCostUsd: 0.001,
      ...(passed ? {} : { failureType: 'cli_smoke_failure' }),
    };
  },
};
`)
  store.close()
  store = undefined
  const cli = await command(
    process.execPath,
    [
      aenCliExecutable,
      'evaluate', benchmark.digest,
      '--matrix', matrixPath,
      '--dsh-driver-config', driverConfigPath,
      '--grader', graderModulePath,
      '--store', storePath,
    ],
    repositoryRoot,
    { DEEPSEEK_API_KEY: apiKey, DEEPSEEK_BASE_URL: mock.baseURL },
  )
  const cliResult = JSON.parse(cli.stdout)
  if (cliResult.driver?.name !== '@aen/dsh-plugin/evaluation-driver' || cliResult.driver?.executionMode !== 'live') {
    throw new Error('aen evaluate did not select the built-in official DSH driver')
  }
  if (cliResult.trialCount !== 1 || cliResult.aggregate?.statusCounts?.success !== 1) {
    throw new Error(`aen evaluate CLI trial failed: ${cli.stdout}`)
  }
  const traces = await sessionFiles(evaluationTraceRoot)
  if (traces.length !== 2) throw new Error(`library + CLI runs retained ${traces.length} transcripts instead of two`)
  process.stdout.write(`${JSON.stringify({
    ok: true,
    execution: 'official_dsh_headless_with_mock_model',
    pluginInstallMode: 'dsh_plugin_tarball_bundle',
    trialStatus: result.trials[0].status,
    representativeManifestDigest: representativeManifest.digest,
    runManifestDigest: observation.configurationCell.harnessManifestDigest,
    stableHarnessConfigurationDigest: observation.configurationCell.harnessConfigurationDigest,
    manifestSnapshotsDiffer: true,
    transcriptEvidence: result.trials[0].transcriptRef.digest,
    fixtureTreeDigest,
    fixtureTreeDigestBound: true,
    cliEvaluateEntrypointVerified: true,
    rawTraceStayedLocal: true,
    realModelClaim: false,
    causalUpliftClaim: false,
  }, undefined, 2)}\n`)
} finally {
  if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalApiKey
  if (originalBaseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL
  else process.env.DEEPSEEK_BASE_URL = originalBaseUrl
  store?.close()
  await mock?.close()
  if (process.env.AEN_KEEP_DSH_EVALUATION_SMOKE !== '1') {
    await rm(temporaryRoot, { recursive: true, force: true })
  } else {
    process.stderr.write(`AEN_KEEP_DSH_EVALUATION_SMOKE=1 kept ${temporaryRoot}\n`)
  }
}
