import { canonicalJson, type JsonRecord } from '@aen/protocol'
import type {
  ComparisonKind,
  ComparisonPlan,
  EvaluationMatrixPlan,
  MatrixCell,
  MatrixCellPlan,
  TrialStatus,
} from './types.js'

const TREATMENTS = new Set(['baseline', 'experience_applied', 'alternative'])
const STATUSES = new Set<TrialStatus>([
  'success', 'agent_failure', 'policy_refusal', 'infra_error', 'grader_error', 'aborted',
])
const EXCLUDABLE_STATUSES = new Set<TrialStatus>(['infra_error', 'grader_error', 'aborted'])
const COMPARISON_KINDS = new Set<ComparisonKind>([
  'experience_uplift', 'model_effect', 'harness_effect', 'model_harness_interaction', 'alternative',
])
const METRICS = new Set(['success_rate', 'quality', 'cost_usd', 'latency_ms'])
const DIGEST = /^sha256:[0-9a-f]{64}$/

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as JsonRecord
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive integer`)
  return Number(value)
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array`)
  return value as string[]
}

function experienceRef(value: unknown, label: string): NonNullable<MatrixCell['experienceRef']> {
  const ref = record(value, label)
  const digest = string(ref.digest, `${label}.digest`)
  if (!DIGEST.test(digest)) throw new Error(`${label}.digest is invalid`)
  return {
    experienceId: string(ref.experienceId, `${label}.experienceId`),
    revision: positiveInteger(ref.revision, `${label}.revision`),
    digest: digest as `sha256:${string}`,
  }
}

function parseComparisons(value: unknown, label: string): ComparisonPlan[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((raw, index) => {
    const comparison = record(raw, `${label}[${index}]`)
    const kind = string(comparison.comparisonKind, `${label}[${index}].comparisonKind`)
    const metric = string(comparison.primaryMetric, `${label}[${index}].primaryMetric`)
    if (!COMPARISON_KINDS.has(kind as ComparisonKind)) throw new Error(`${label}[${index}].comparisonKind is invalid`)
    if (!METRICS.has(metric)) throw new Error(`${label}[${index}].primaryMetric is invalid`)
    return {
      comparisonId: string(comparison.comparisonId, `${label}[${index}].comparisonId`),
      comparisonKind: kind as ComparisonKind,
      baselineCellId: string(comparison.baselineCellId, `${label}[${index}].baselineCellId`),
      treatmentCellId: string(comparison.treatmentCellId, `${label}[${index}].treatmentCellId`),
      primaryMetric: metric as ComparisonPlan['primaryMetric'],
      confounders: stringArray(comparison.confounders, `${label}[${index}].confounders`),
    }
  })
}

function parseExperienceMap(
  value: unknown,
  label: string,
): Record<string, NonNullable<MatrixCell['experienceRef']>> {
  const input = record(value, label)
  return Object.fromEntries(Object.entries(input).map(([selector, ref]) => [
    string(selector, `${label} key`),
    experienceRef(ref, `${label}.${selector}`),
  ]))
}

function parseComparisonMap(value: unknown, label: string): Record<string, ComparisonPlan[]> {
  const input = record(value, label)
  return Object.fromEntries(Object.entries(input).map(([selector, comparisons]) => [
    string(selector, `${label} key`),
    parseComparisons(comparisons, `${label}.${selector}`),
  ]))
}

function sameKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function modelIdentity(cell: MatrixCellPlan): string {
  const { observedAt: _observedAt, ...identity } = cell.model
  return canonicalJson(identity)
}

function assertComparisonSet(
  comparisons: ComparisonPlan[],
  cells: Map<string, MatrixCellPlan>,
  label: string,
): void {
  const ids = new Set<string>()
  for (const comparison of comparisons) {
    if (ids.has(comparison.comparisonId)) throw new Error(`${label} has duplicate comparisonId: ${comparison.comparisonId}`)
    ids.add(comparison.comparisonId)
    const baseline = cells.get(comparison.baselineCellId)
    const treatment = cells.get(comparison.treatmentCellId)
    if (baseline === undefined || treatment === undefined) {
      throw new Error(`${label}.${comparison.comparisonId} references an unknown cell`)
    }
    if (baseline.cellId === treatment.cellId) throw new Error(`${label}.${comparison.comparisonId} compares one cell to itself`)
    if (comparison.comparisonKind === 'experience_uplift') {
      if (baseline.treatment !== 'baseline' || treatment.treatment !== 'experience_applied') {
        throw new Error(`${label}.${comparison.comparisonId} must compare baseline to experience_applied`)
      }
      if (
        modelIdentity(baseline) !== modelIdentity(treatment) ||
        baseline.harnessConfigurationDigest !== treatment.harnessConfigurationDigest
      ) throw new Error(`${label}.${comparison.comparisonId} changes Model or Harness in an experience uplift comparison`)
    }
  }
}

/** Runtime defense for callers that construct typed plans without the JSON parser. */
export function assertEvaluationMatrixPlanSemantics(plan: EvaluationMatrixPlan): void {
  if (plan.benchmarkSelectors.length === 0) throw new Error('benchmarkSelectors must be non-empty')
  if (new Set(plan.benchmarkSelectors).size !== plan.benchmarkSelectors.length) throw new Error('benchmarkSelectors must be unique')
  if (!Number.isSafeInteger(plan.repetitions) || plan.repetitions < 1) throw new Error('repetitions must be positive')
  if (!Number.isSafeInteger(plan.reliabilityK) || plan.reliabilityK < 1) throw new Error('reliabilityK must be positive')
  if (!Number.isSafeInteger(plan.minValidTrialsPerCell) || plan.minValidTrialsPerCell < 1) throw new Error('minValidTrialsPerCell must be positive')
  if (!(plan.confidenceLevel > 0 && plan.confidenceLevel < 1)) throw new Error('confidenceLevel must be between 0 and 1')
  if (plan.minValidTrialsPerCell > plan.repetitions) throw new Error('minValidTrialsPerCell cannot exceed repetitions')
  if (plan.reliabilityK > plan.repetitions) throw new Error('reliabilityK cannot exceed repetitions')
  if (plan.excludedStatuses.some((status) => !STATUSES.has(status))) throw new Error('excludedStatuses contains an invalid status')
  if (plan.excludedStatuses.some((status) => !EXCLUDABLE_STATUSES.has(status))) {
    throw new Error('only infra_error, grader_error, and aborted may be excluded; agent outcomes must remain outcomes')
  }

  const cells = new Map<string, MatrixCellPlan>()
  for (const cell of plan.cells) {
    if (cells.has(cell.cellId)) throw new Error(`duplicate matrix cell: ${cell.cellId}`)
    cells.set(cell.cellId, cell)
    if (!DIGEST.test(cell.harnessManifestDigest)) throw new Error(`Harness Manifest digest is invalid for cell ${cell.cellId}`)
    if (!DIGEST.test(cell.harnessConfigurationDigest)) throw new Error(`Harness configuration digest is invalid for cell ${cell.cellId}`)
    if (cell.experienceRef !== undefined && cell.experienceRefsByBenchmark !== undefined) {
      throw new Error(`cell ${cell.cellId} cannot combine experienceRef and experienceRefsByBenchmark`)
    }
    if (cell.experienceRefsByBenchmark !== undefined && !sameKeys(cell.experienceRefsByBenchmark, plan.benchmarkSelectors)) {
      throw new Error(`cell ${cell.cellId} experienceRefsByBenchmark must exactly cover benchmarkSelectors`)
    }
    if (cell.treatment === 'baseline' && (cell.experienceRef !== undefined || cell.experienceRefsByBenchmark !== undefined)) {
      throw new Error(`baseline cell ${cell.cellId} must not reference an Experience`)
    }
    if (cell.treatment === 'experience_applied') {
      if (plan.benchmarkSelectors.length === 1) {
        if ((cell.experienceRef === undefined) === (cell.experienceRefsByBenchmark === undefined)) {
          throw new Error(`experience_applied cell ${cell.cellId} must select exactly one Experience source`)
        }
      } else if (cell.experienceRef !== undefined || cell.experienceRefsByBenchmark === undefined) {
        throw new Error(`multi-Benchmark experience_applied cell ${cell.cellId} requires experienceRefsByBenchmark`)
      }
    }
  }
  if (cells.size === 0) throw new Error('cells must be non-empty')

  if (plan.comparisonsByBenchmark !== undefined) {
    if (plan.comparisons.length > 0) throw new Error('comparisons and comparisonsByBenchmark cannot both be populated')
    if (!sameKeys(plan.comparisonsByBenchmark, plan.benchmarkSelectors)) {
      throw new Error('comparisonsByBenchmark must exactly cover benchmarkSelectors')
    }
    for (const [selector, comparisons] of Object.entries(plan.comparisonsByBenchmark)) {
      assertComparisonSet(comparisons, cells, `comparisonsByBenchmark.${selector}`)
    }
  } else {
    if (plan.benchmarkSelectors.length > 1 && plan.comparisons.length > 0) {
      throw new Error('multi-Benchmark causal analysis requires comparisonsByBenchmark')
    }
    assertComparisonSet(plan.comparisons, cells, 'comparisons')
  }
}

export function resolveMatrixCellForBenchmark(
  cell: MatrixCellPlan,
  benchmarkSelector: string,
): MatrixCell {
  const selected = cell.experienceRefsByBenchmark?.[benchmarkSelector] ?? cell.experienceRef
  return {
    cellId: cell.cellId,
    treatment: cell.treatment,
    model: cell.model,
    harnessConfigurationDigest: cell.harnessConfigurationDigest,
    harnessManifestDigest: cell.harnessManifestDigest,
    ...(selected === undefined ? {} : { experienceRef: selected }),
  }
}

export function comparisonsForBenchmark(
  plan: EvaluationMatrixPlan,
  benchmarkSelector: string,
): ComparisonPlan[] {
  return plan.comparisonsByBenchmark?.[benchmarkSelector] ?? plan.comparisons
}

export function parseEvaluationMatrixPlan(value: unknown): EvaluationMatrixPlan {
  const input = record(value, 'matrix plan')
  const confidenceLevel = input.confidenceLevel
  if (typeof confidenceLevel !== 'number' || !(confidenceLevel > 0 && confidenceLevel < 1)) {
    throw new Error('confidenceLevel must be between 0 and 1')
  }
  if (!Array.isArray(input.cells) || input.cells.length === 0) throw new Error('cells must be a non-empty array')
  const cells = input.cells.map((raw, index) => {
    const cell = record(raw, `cells[${index}]`)
    const treatment = string(cell.treatment, `cells[${index}].treatment`)
    if (!TREATMENTS.has(treatment)) throw new Error(`cells[${index}].treatment is invalid`)
    const model = record(cell.model, `cells[${index}].model`)
    string(model.provider, `cells[${index}].model.provider`)
    string(model.modelId, `cells[${index}].model.modelId`)
    string(model.observedAt, `cells[${index}].model.observedAt`)
    string(model.mutability, `cells[${index}].model.mutability`)
    const digest = string(cell.harnessManifestDigest, `cells[${index}].harnessManifestDigest`)
    if (!DIGEST.test(digest)) throw new Error(`cells[${index}].harnessManifestDigest is invalid`)
    const configurationDigest = string(cell.harnessConfigurationDigest, `cells[${index}].harnessConfigurationDigest`)
    if (!DIGEST.test(configurationDigest)) throw new Error(`cells[${index}].harnessConfigurationDigest is invalid`)
    return {
      cellId: string(cell.cellId, `cells[${index}].cellId`),
      treatment: treatment as MatrixCellPlan['treatment'],
      model: model as MatrixCellPlan['model'],
      harnessConfigurationDigest: configurationDigest as `sha256:${string}`,
      harnessManifestDigest: digest as `sha256:${string}`,
      ...(cell.experienceRef === undefined ? {} : {
        experienceRef: experienceRef(cell.experienceRef, `cells[${index}].experienceRef`),
      }),
      ...(cell.experienceRefsByBenchmark === undefined ? {} : {
        experienceRefsByBenchmark: parseExperienceMap(
          cell.experienceRefsByBenchmark,
          `cells[${index}].experienceRefsByBenchmark`,
        ),
      }),
    }
  })
  const excluded = stringArray(input.excludedStatuses, 'excludedStatuses')
  if (excluded.some((status) => !STATUSES.has(status as TrialStatus))) throw new Error('excludedStatuses contains an invalid status')
  const plan: EvaluationMatrixPlan = {
    experimentId: string(input.experimentId, 'experimentId'),
    benchmarkSelectors: stringArray(input.benchmarkSelectors, 'benchmarkSelectors'),
    cells,
    repetitions: positiveInteger(input.repetitions, 'repetitions'),
    reliabilityK: positiveInteger(input.reliabilityK, 'reliabilityK'),
    confidenceLevel,
    minValidTrialsPerCell: positiveInteger(input.minValidTrialsPerCell, 'minValidTrialsPerCell'),
    excludedStatuses: excluded as TrialStatus[],
    comparisons: parseComparisons(input.comparisons, 'comparisons'),
    ...(input.comparisonsByBenchmark === undefined ? {} : {
      comparisonsByBenchmark: parseComparisonMap(input.comparisonsByBenchmark, 'comparisonsByBenchmark'),
    }),
  }
  assertEvaluationMatrixPlanSemantics(plan)
  return plan
}
