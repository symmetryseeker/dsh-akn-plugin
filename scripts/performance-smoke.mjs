import { spawnSync } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { cpus, freemem, platform, release, tmpdir, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { finalizeProtocolObject } from '../packages/protocol/dist/index.js'
import { LocalEvidenceStore, searchLocalExperiences } from '../packages/local-store/dist/index.js'
import { PostgresHubProjection } from '../packages/hub/dist/index.js'
import { createHubServer } from '../apps/hub/dist/server.js'

const DATASET_SIZE = Number(process.env.AEN_BENCH_DATASET_SIZE ?? 1_000)
const LOCAL_SAMPLES = Number(process.env.AEN_BENCH_LOCAL_SAMPLES ?? 200)
const HUB_SAMPLES = Number(process.env.AEN_BENCH_HUB_SAMPLES ?? 100)
const WARMUP_SAMPLES = Number(process.env.AEN_BENCH_WARMUP_SAMPLES ?? 20)
for (const [name, value] of Object.entries({ DATASET_SIZE, LOCAL_SAMPLES, HUB_SAMPLES, WARMUP_SAMPLES })) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
}

function postgresBin() {
  if (process.env.AEN_POSTGRES_BIN !== undefined) return resolve(process.env.AEN_POSTGRES_BIN)
  if (process.platform === 'darwin') return '/opt/homebrew/opt/postgresql@17/bin'
  const detected = spawnSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf8' }).stdout.trim()
  if (detected.length === 0) throw new Error('PostgreSQL initdb was not found; set AEN_POSTGRES_BIN')
  return dirname(detected)
}

function cleanEnvironment() {
  const environment = { ...process.env }
  for (const name of ['ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'all_proxy', 'https_proxy', 'http_proxy']) {
    delete environment[name]
  }
  return environment
}

function run(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', env: cleanEnvironment(), timeout: 120_000 })
  if (result.status !== 0) {
    throw new Error([
      `command failed (${result.status ?? 'signal'}): ${executable} ${args.join(' ')}`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close();reject(new Error('failed to allocate loopback port'));return
      }
      server.close((error) => error === undefined ? resolvePort(address.port) : reject(error))
    })
  })
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function distribution(values) {
  return {
    samples: values.length,
    minimumMs: Number(Math.min(...values).toFixed(3)),
    p50Ms: Number(percentile(values, 0.50).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    p99Ms: Number(percentile(values, 0.99).toFixed(3)),
    maximumMs: Number(Math.max(...values).toFixed(3)),
  }
}

function experience(index) {
  const evidence = {
    objectType: 'trace_evidence',
    refId: `urn:aen:evidence:performance:${index}`,
    digest: `sha256:${index.toString(16).padStart(64, '0')}`,
  }
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'experience_revision',
    experienceId: `urn:aen:experience:performance:${index}`,
    revision: 1,
    createdAt: '2026-08-20T00:00:00Z',
    relations: [],
    kind: index % 10 === 0 ? 'negative_result' : 'failure_recovery',
    namespace: 'aen.performance-smoke',
    publisher: { actorId: 'urn:aen:actor:performance-smoke', type: 'node' },
    languages: ['en'],
    title: `Deterministic recovery checkpoint ${index}`,
    summary: `Measured deterministic recovery pattern ${index} for a reversible software operation.`,
    intendedUses: ['reversible software failure recovery'],
    outOfScopeUses: ['destructive automatic retry'],
    knownLimitations: ['synthetic load-shape fixture; not product evidence'],
    knownFailureModes: ['retry without changing the failed condition'],
    task: {
      taxonomy: ['failure-recovery', 'software-engineering'],
      intent: 'Recover a reversible failed software operation.',
      constraints: [],
      acceptance: [],
      riskClass: 'reversible_write',
    },
    claims: [{
      claimId: `urn:aen:experience:performance:${index}#claim`,
      type: 'strategy_works',
      statement: 'This synthetic fixture exists only to exercise deterministic retrieval load.',
      mode: 'observational',
      evidenceLevel: 'H1',
      scope: { taskFamilies: ['failure-recovery'] },
      supportingEvidenceRefs: [evidence],
      contradictingEvidenceRefs: [],
      falsificationConditions: ['The retrieval fixture cannot be found.'],
      assumptions: [],
    }],
    applicability: {
      taskFamilies: ['failure-recovery', 'software-engineering'],
      modelSelectors: [
        { path: 'model.provider', operator: 'equals', value: 'deepseek' },
        { path: 'model.modelId', operator: 'equals', value: 'deepseek-reasoner' },
      ],
      harnessSelectors: [{
        path: 'harness.configurationDigest',
        operator: 'digestEquals',
        value: `sha256:${'f'.repeat(64)}`,
      }],
    },
    evidenceRefs: [evidence],
    artifactRefs: [],
    metricSummary: {
      sampleSize: 10,
      successRate: index % 10 === 0 ? 0.4 : 0.8,
      quality: { mean: 0.5 + (index % 40) / 100 },
      costUsd: { mean: 0.01 + (index % 20) / 1_000 },
      latencyMs: { p95: 500 + (index % 50) },
      negativeTransferRate: index % 10 === 0 ? 0.2 : 0,
      method: 'synthetic-performance-smoke',
    },
    governance: {
      visibility: 'public',
      owner: { actorId: 'urn:aen:actor:performance-smoke', type: 'node' },
      license: 'CC-BY-4.0',
      dataClasses: ['public'],
      redistribution: 'public_mirrors',
      consentRef: 'urn:aen:consent:performance-smoke',
      sourcePolicy: 'synthetic-performance-smoke',
      redactionReport: {
        scannerVersions: { synthetic: '1' },
        transformations: [],
        residualRisk: 'low',
        humanReviewed: true,
        reviewedAt: '2026-08-20T00:00:00Z',
      },
      safetyLabels: ['synthetic-load-fixture', 'no-automatic-execution'],
    },
  })
}

async function measure(operation, warmups, samples) {
  for (let index = 0; index < warmups; index += 1) await operation()
  const values = []
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now()
    await operation()
    values.push(performance.now() - started)
  }
  return distribution(values)
}

const prefix = join(tmpdir(), 'aen-performance-smoke-')
const temporary = await mkdtemp(prefix)
if (!temporary.startsWith(prefix)) throw new Error(`unsafe temporary directory: ${temporary}`)
const experiences = Array.from({ length: DATASET_SIZE }, (_, index) => experience(index + 1))
const searchRequest = {
  query: 'deterministic recovery',
  task: { taxonomy: ['failure-recovery'] },
  context: {
    model: { provider: 'deepseek', modelId: 'deepseek-reasoner', mutability: 'immutable' },
    harnessConfigurationDigest: `sha256:${'f'.repeat(64)}`,
  },
  policy: {
    visibility: ['public'],
    allowedLicenses: ['CC-BY-4.0'],
    maxRiskClass: 'reversible_write',
    minEvidenceLevel: 'H1',
    maxMeanCostUsd: 0.03,
    maxP95LatencyMs: 550,
  },
  responseBudget: { maxCards: 3 },
}
const pgBin = postgresBin()
const pgData = join(temporary, 'postgres')
let postgresRunning = false
let localStore
let projection
let hubServer

try {
  localStore = new LocalEvidenceStore(join(temporary, 'local.sqlite'))
  localStore.putBatch({ objects: experiences.map((object) => ({ object })) })
  const local = await measure(() => {
    const value = searchLocalExperiences(localStore, searchRequest, new Date('2026-08-20T12:00:00Z'))
    if (value.cards.length !== 3) throw new Error(`local benchmark expected 3 cards, got ${value.cards.length}`)
  }, WARMUP_SAMPLES, LOCAL_SAMPLES)

  const pgPort = await freePort()
  run(join(pgBin, 'initdb'), ['-D', pgData, '--auth=trust', '--no-locale', '--encoding=UTF8'])
  run(join(pgBin, 'pg_ctl'), [
    '-D', pgData,
    '-l', join(temporary, 'postgres.log'),
    '-o', `-h 127.0.0.1 -p ${pgPort}`,
    '-w', 'start',
  ])
  postgresRunning = true
  projection = new PostgresHubProjection(
    { connectionString: `postgresql://127.0.0.1:${pgPort}/postgres` },
    { textSearch: 'postgres_fts' },
  )
  await projection.migrate()
  await projection.rebuild(experiences.map((object) => ({
    root: `synthetic:${object.experienceId}`,
    inventory: {
      profile: 'aen-git-contribution-v0.1',
      createdAt: object.createdAt,
      actor: object.publisher,
      targetDigest: object.digest,
      objects: [],
    },
    target: object,
    objects: [object],
    verifiedKeyIds: [],
  })))
  const hubPort = await freePort()
  hubServer = createHubServer(projection)
  await new Promise((resolveListen) => hubServer.listen(hubPort, '127.0.0.1', resolveListen))
  const params = new URLSearchParams({
    q: 'deterministic recovery',
    taskFamily: 'failure-recovery',
    modelProvider: 'deepseek',
    modelId: 'deepseek-reasoner',
    harnessConfigurationDigest: `sha256:${'f'.repeat(64)}`,
    license: 'CC-BY-4.0',
    minEvidenceLevel: 'H1',
    maxRiskClass: 'reversible_write',
    maxMeanCostUsd: '0.03',
    maxP95LatencyMs: '550',
    limit: '3',
  })
  const endpoint = `http://127.0.0.1:${hubPort}/v1/experiences?${params}`
  const hub = await measure(async () => {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) throw new Error(`Hub benchmark returned HTTP ${response.status}`)
    const value = await response.json()
    if (value.cards.length !== 3) throw new Error(`Hub benchmark expected 3 cards, got ${value.cards.length}`)
  }, WARMUP_SAMPLES, HUB_SAMPLES)

  const report = {
    profile: 'aen-mvp-performance-smoke-v0.1',
    generatedAt: new Date().toISOString(),
    syntheticDataWarning: 'Synthetic deterministic load-shape data; this proves latency on the declared machine/load only, not product utility or 100k/1M capacity.',
    hardware: {
      platform: platform(),
      release: release(),
      cpuModel: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryBytesAtReport: freemem(),
      node: process.version,
      postgres: '17',
    },
    load: {
      experienceCount: DATASET_SIZE,
      observationCount: 0,
      concurrency: 1,
      warmupSamples: WARMUP_SAMPLES,
      localSamples: LOCAL_SAMPLES,
      hubSamples: HUB_SAMPLES,
      resultCardLimit: 3,
      query: 'deterministic recovery with exact Model × Harness and policy filters',
    },
    localSearch: { objectiveP95Ms: 100, ...local, pass: local.p95Ms < 100 },
    hubFirstCards: { objectiveP95Ms: 800, ...hub, pass: hub.p95Ms < 800 },
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.localSearch.pass || !report.hubFirstCards.pass) process.exitCode = 1
} finally {
  if (hubServer !== undefined) await new Promise((resolveClose) => hubServer.close(resolveClose))
  if (projection !== undefined) await projection.close()
  localStore?.close()
  if (postgresRunning) run(join(pgBin, 'pg_ctl'), ['-D', pgData, '-m', 'fast', '-w', 'stop'])
  await rm(temporary, { recursive: true, force: true })
}
