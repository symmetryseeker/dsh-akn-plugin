/**
 * run-smoke.mjs — SWE-bench 2×2×2 端到端冒烟
 * ============================================
 * 建立 SWE-bench 风格 BenchmarkTask + HarnessManifest + 通用验证经验，
 * 跑 baseline vs experience_applied 的 2×2×2，打印 uplift aggregate。
 *
 * 用法:
 *   node benchmarks/swebench/run-smoke.mjs [storePath]
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, finalizeProtocolObject, sha256 } from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'
import { parseEvaluationMatrixPlan, runEvaluationMatrix } from '@aen/evaluation'
import { buildBenchmark } from './adapter.mjs'
import { driver } from './driver.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempDir = process.argv[2] === undefined ? mkdtempSync(join(tmpdir(), 'swebench-smoke-')) : undefined
const storePath = resolve(process.argv[2] ?? join(tempDir, 'evidence.sqlite'))
if (tempDir !== undefined) process.on('exit', () => rmSync(tempDir, { recursive: true, force: true }))

const TIME = '2026-08-22T00:00:00Z'

function buildHarnessManifest() {
  const manifestId = 'urn:aen:manifest:swebench-synthetic'
  const draft = {
    protocolVersion: '0.1',
    objectType: 'harness_manifest',
    manifestId,
    capturedAt: TIME,
    adapter: { name: 'swebench-adapter', version: '0.1.0' },
    harness: { name: 'swebench-synthetic', version: '0.1.0' },
    sessionScope: {},
    modelSurface: {},
    artifacts: [],
    policies: {},
    environment: { capturedAt: TIME, disclosure: 'metadata', runtime: { driver: 'swebench-reference' } },
    coverage: {
      mode: 'live_snapshot',
      models: 'none',
      tools: 'none',
      skills: 'none',
      preset: 'none',
      policies: 'none',
      effectiveSurface: 'none',
      limitations: ['Synthetic smoke fixture.'],
    },
  }
  const configurationDigest = sha256(canonicalJson({
    adapter: draft.adapter,
    harness: draft.harness,
    modelSurface: draft.modelSurface,
    policies: draft.policies,
  }))
  return finalizeProtocolObject({ ...draft, configurationDigest })
}

function buildTraceEvidence() {
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'trace_evidence',
    evidenceId: 'urn:aen:trace:swebench:smoke',
    source: {
      harness: 'swebench-synthetic',
      sessionDigest: sha256(canonicalJson({ scope: 'swebench-smoke' })),
      schemaNamespace: 'https://aen.dev/adapters/swebench/v1',
      schemaVersion: '0.1',
      mappingProfile: 'swebench-smoke',
      mappingVersion: '0.1',
    },
    eventRange: { fromSeq: 0, toSeq: 1 },
    episodeDigest: sha256(canonicalJson({ scope: 'swebench-episode' })),
    excerpts: [],
    disclosure: 'metadata',
    redaction: {
      scannerVersions: { 'swebench-redactor': '0.1.0' },
      transformations: [],
      residualRisk: 'low',
      humanReviewed: false,
    },
  })
}

function buildExperience(traceRef) {
  const experienceId = 'urn:aen:experience:math:universal:monte-carlo-foc-bar'
  const claimId = `${experienceId}#observed`
  const applicability = {
    taskFamilies: ['math', 'numerical-verification', 'monte-carlo', 'foc'],
    modelSelectors: [
      { path: 'model.provider', operator: 'equals', value: 'sympy' },
      { path: 'model.modelId', operator: 'equals', value: 'symbolic-engine' },
    ],
    excludedConditions: ['A different engine without re-verification.'],
    revalidateOn: [{ kind: 'environment_change' }],
    generality: 'universal',
  }
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'experience_revision',
    experienceId,
    revision: 1,
    createdAt: TIME,
    relations: [],
    kind: 'safety_constraint',
    namespace: 'local.aen.math.universal-techniques',
    publisher: { actorId: 'https://github.com/symmetryseeker', type: 'human', displayName: 'symmetryseeker' },
    languages: ['en'],
    title: 'Accept a Monte Carlo FOC check only with a fixed seed, tolerance, and ≥95% pass rate',
    summary: 'Reproducible verification requires fixed seed, stated tolerance, and a ≥95% pass-rate bar; single samples are non-conclusive.',
    intendedUses: ['Setting the acceptance bar for numerical verification of stationary points.', 'Making verification reproducible across runs.'],
    outOfScopeUses: ['Claims of counterfactual improvement without a baseline/treatment comparison.'],
    knownLimitations: ['Single derivation-run observational evidence (H0).'],
    knownFailureModes: ['Varying the seed changes the verdict.', 'Accepting a single favorable sample as proof.'],
    task: {
      taxonomy: ['math', 'numerical-verification', 'monte-carlo', 'foc'],
      intent: 'Verify a stationary-point FOC with reproducible Monte Carlo sampling',
      constraints: ['No external services.'],
      acceptance: [
        { id: 'fixed-seed', description: 'The seed is fixed', required: true },
        { id: 'pass-bar', description: 'Pass rate ≥ 95%', required: true },
      ],
      riskClass: 'read_only',
    },
    claims: [{
      claimId,
      type: 'safety_constraint',
      statement: 'A reproducible Monte Carlo FOC zero-crossing check requires a fixed seed, a stated tolerance, and a ≥95% pass-rate acceptance bar; single samples are non-conclusive.',
      mode: 'observational',
      evidenceLevel: 'H0',
      scope: applicability,
      supportingEvidenceRefs: [traceRef],
      contradictingEvidenceRefs: [],
      falsificationConditions: ['A single sample flips the verdict.'],
      assumptions: ['The Monte Carlo grid is representative.'],
    }],
    applicability,
    evidenceRefs: [traceRef],
    artifactRefs: [],
    governance: {
      visibility: 'private',
      owner: { actorId: 'https://github.com/symmetryseeker', type: 'human' },
      dataClasses: ['internal'],
      redistribution: 'none',
      sourcePolicy: 'aen.math-seed.v1',
      redactionReport: {
        scannerVersions: { 'maf-redactor': '0.1.0' },
        transformations: [{ ruleId: 'redact-locators', count: 0 }],
        residualRisk: 'low',
        humanReviewed: false,
      },
      safetyLabels: ['human-review-required', 'no-automatic-execution', 'observational-only'],
    },
  })
}

function buildMatrix(benchmark, manifest, experience) {
  const model = {
    provider: 'deepseek',
    modelId: 'deepseek-v4-synthetic',
    observedAt: TIME,
    mutability: 'versioned',
  }
  return {
    experimentId: 'swebench-2x2x2-smoke',
    benchmarkSelectors: [benchmark.benchmarkId],
    cells: [
      {
        cellId: 'baseline',
        treatment: 'baseline',
        model,
        harnessConfigurationDigest: manifest.configurationDigest,
        harnessManifestDigest: manifest.digest,
      },
      {
        cellId: 'applied',
        treatment: 'experience_applied',
        model,
        harnessConfigurationDigest: manifest.configurationDigest,
        harnessManifestDigest: manifest.digest,
        experienceRef: {
          experienceId: experience.experienceId,
          revision: experience.revision,
          digest: experience.digest,
        },
      },
    ],
    repetitions: 5,
    reliabilityK: 3,
    confidenceLevel: 0.95,
    minValidTrialsPerCell: 3,
    excludedStatuses: ['infra_error', 'grader_error'],
    comparisons: [{
      comparisonId: 'uplift-baseline-to-applied',
      comparisonKind: 'experience_uplift',
      baselineCellId: 'baseline',
      treatmentCellId: 'applied',
      primaryMetric: 'success_rate',
      confounders: [],
    }],
  }
}

const instance = {
  instance_id: 'pytest-dev__pytest-5226',
  repo: 'pytest-dev/pytest',
  base_commit: 'e2b1e5e',
  problem_statement: 'When a fixture raises an exception during setup, the error message should include the fixture name.',
  test_patch: '',
  FAIL_TO_PASS: ['test_fixture_error_reports_name'],
  PASS_TO_PASS: [],
}

const { benchmark, grader } = buildBenchmark(instance)
const manifest = buildHarnessManifest()
const trace = buildTraceEvidence()
const traceRef = { objectType: 'trace_evidence', refId: trace.evidenceId, digest: trace.digest }
const experience = buildExperience(traceRef)
const store = new LocalEvidenceStore(storePath)
store.putBatch({ objects: [
  { object: grader, role: 'grader_definition' },
  { object: manifest, role: 'harness_manifest' },
  { object: trace, role: 'trace_evidence' },
  { object: experience, role: 'experience_revision' },
  { object: benchmark, role: 'benchmark_task' },
] })

const matrixValue = buildMatrix(benchmark, manifest, experience)
const plan = parseEvaluationMatrixPlan(matrixValue)
const result = await runEvaluationMatrix(store, plan, driver)

const uplift = result.benchmarkAggregates[0]?.comparisons.find((c) => c.comparisonId === 'uplift-baseline-to-applied')
const baseline = result.benchmarkAggregates[0]?.cellSummaries.find((c) => c.cellId === 'baseline')
const applied = result.benchmarkAggregates[0]?.cellSummaries.find((c) => c.cellId === 'applied')

console.log(JSON.stringify({
  ok: true,
  storePath,
  benchmark: benchmark.benchmarkId,
  suiteKind: benchmark.suiteKind,
  driver: { name: driver.name, executionMode: driver.executionMode },
  trials: result.trials.length,
  coverage: result.coverage,
  cells: {
    baseline: baseline ? { totalTrials: baseline.totalTrials, validTrials: baseline.validTrials, successes: baseline.successes, passAt1: baseline.passAt1 } : null,
    applied: applied ? { totalTrials: applied.totalTrials, validTrials: applied.validTrials, successes: applied.successes, passAt1: applied.passAt1 } : null,
  },
  uplift: uplift ? {
    baselineEstimate: uplift.baselineEstimate,
    treatmentEstimate: uplift.treatmentEstimate,
    absoluteDifference: uplift.absoluteDifference,
    conclusion: uplift.conclusion,
    counterfactualEligibility: uplift.counterfactualEligibility,
  } : null,
}, null, 2))
store.close()
