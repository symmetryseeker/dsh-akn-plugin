import {
  canonicalJson,
  finalizeProtocolObject,
  sha256,
  toObjectRef,
  type BenchmarkTask,
  type EvaluationAggregate,
  type EvaluationTrial,
  type JsonRecord,
  type RunMetrics,
  type RunObservation,
} from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'
import {
  continuousDifferenceInterval,
  metricSummary,
  passAtK,
  passPowerK,
  wilsonInterval,
} from './statistics.js'
import type { AggregateOptions, ComparisonPlan, TrialStatus } from './types.js'

const STATUSES: TrialStatus[] = [
  'success',
  'agent_failure',
  'policy_refusal',
  'infra_error',
  'grader_error',
  'aborted',
]

interface ResolvedTrial {
  trial: EvaluationTrial
  observation: RunObservation
  benchmark: BenchmarkTask
}

interface InternalCell {
  summary: EvaluationAggregate['cellSummaries'][number]
  rows: ResolvedTrial[]
  metricValues: Record<'quality' | 'cost_usd' | 'latency_ms', number[]>
}

function resolveObject<T>(store: LocalEvidenceStore, selector: string, type: string): T {
  const inspected = store.inspect(selector)
  if (inspected === undefined || inspected.summary.objectType !== type) {
    throw new Error(`${type} not found: ${selector}`)
  }
  return inspected.object as unknown as T
}

function resolveDigest<T>(store: LocalEvidenceStore, digest: `sha256:${string}`, type: string): T {
  const object = store.getByDigest(digest)
  if (object === undefined || object.objectType !== type) throw new Error(`${type} does not resolve: ${digest}`)
  return object as unknown as T
}

function validateResolved(row: ResolvedTrial, experimentId: string): void {
  const { trial, observation } = row
  if (trial.experimentId !== experimentId) throw new Error(`trial ${trial.trialId} belongs to another experiment`)
  if (observation.experiment === undefined) throw new Error(`observation ${observation.observationId} lacks experiment coordinates`)
  if (
    observation.experiment.experimentId !== experimentId ||
    observation.experiment.cellId !== trial.cellId ||
    observation.experiment.trialIndex !== trial.trialIndex ||
    observation.experiment.attemptIndex !== trial.attemptIndex
  ) throw new Error(`trial ${trial.trialId} and observation coordinates disagree`)
  if (observation.taskRef !== row.benchmark.benchmarkId) {
    throw new Error(`observation ${observation.observationId} does not target benchmark ${row.benchmark.benchmarkId}`)
  }
}

function statusCounts(rows: ResolvedTrial[]): Record<string, number> {
  return Object.fromEntries(STATUSES.map((status) => [
    status,
    rows.filter((row) => row.trial.status === status).length,
  ]))
}

function excludedCounts(rows: ResolvedTrial[], excluded: Set<TrialStatus>): Record<string, number> {
  return Object.fromEntries([...excluded].sort().map((status) => [
    status,
    rows.filter((row) => row.trial.status === status).length,
  ]))
}

function metrics(rows: ResolvedTrial[]): RunMetrics[] {
  return rows.map((row) => row.observation.metrics)
}

function successful(row: ResolvedTrial): boolean {
  if (row.trial.status !== 'success' || row.observation.outcome !== 'success') return false
  const required = row.benchmark.task.acceptance.filter((criterion) => criterion.required)
  return required.every((criterion) =>
    row.trial.graderResults.some((result) => result.criterionId === criterion.id && result.passed),
  )
}

function summarizeCell(
  cellId: string,
  rows: ResolvedTrial[],
  excluded: Set<TrialStatus>,
  reliabilityK: number,
  confidenceLevel: number,
): InternalCell {
  const treatments = new Set(rows.map((row) => row.observation.treatment))
  if (treatments.size !== 1) throw new Error(`cell ${cellId} mixes treatment labels`)
  const valid = rows.filter((row) => !excluded.has(row.trial.status))
  const successes = valid.filter(successful).length
  const rate = valid.length === 0 ? undefined : wilsonInterval(successes, valid.length, confidenceLevel)
  const trialRefs = rows.map((row) => toObjectRef(row.trial as unknown as JsonRecord))
  return {
    summary: {
      cellId,
      treatment: [...treatments][0]!,
      trialRefs,
      totalTrials: rows.length,
      validTrials: valid.length,
      successes,
      ...(rate === undefined ? {} : {
        passAt1: rate.estimate,
        passAtK: { k: reliabilityK, estimate: passAtK(rate.estimate, reliabilityK) },
        passPowerK: { k: reliabilityK, estimate: passPowerK(rate.estimate, reliabilityK) },
        perTrialSuccessRate: rate,
      }),
      metricSummary: metricSummary(metrics(valid), successes, valid.length),
      statusCounts: statusCounts(rows),
      excludedTrialCounts: excludedCounts(rows, excluded),
    },
    rows,
    metricValues: {
      quality: valid.flatMap((row) => row.observation.metrics.qualityScore === undefined ? [] : [row.observation.metrics.qualityScore]),
      cost_usd: valid.flatMap((row) => row.observation.metrics.totalCostUsd === undefined ? [] : [row.observation.metrics.totalCostUsd]),
      latency_ms: valid.flatMap((row) => row.observation.metrics.latencyMs === undefined ? [] : [row.observation.metrics.latencyMs]),
    },
  }
}

function configKeys(rows: ResolvedTrial[]): { models: Set<string>; harnesses: Set<string>; environments: Set<string> } {
  const models = new Set<string>()
  const harnesses = new Set<string>()
  const environments = new Set<string>()
  for (const row of rows) {
    const { observedAt: _observedAt, ...model } = row.observation.configurationCell.model
    const { capturedAt: _capturedAt, ...environment } = row.observation.configurationCell.environment
    models.add(canonicalJson(model))
    harnesses.add(row.observation.configurationCell.harnessConfigurationDigest)
    environments.add(canonicalJson(environment))
  }
  return { models, harnesses, environments }
}

function comparisonEligibility(
  plan: ComparisonPlan,
  baseline: InternalCell,
  treatment: InternalCell,
  minimum: number,
): string[] {
  const reasons: string[] = []
  if (baseline.summary.treatment !== 'baseline') reasons.push('BASELINE_CELL_NOT_BASELINE')
  if (baseline.summary.validTrials < minimum || treatment.summary.validTrials < minimum) {
    reasons.push('PREREGISTERED_MIN_VALID_TRIALS_NOT_MET')
  }
  if (plan.confounders.length > 0) reasons.push('BLOCKING_CONFOUNDERS_DECLARED')
  const allBenchmarks = [...baseline.rows, ...treatment.rows].map((row) => row.benchmark)
  const benchmarkDigests = new Set(allBenchmarks.map((benchmark) => benchmark.digest))
  if (benchmarkDigests.size !== 1) reasons.push('MULTIPLE_BENCHMARKS_MIXED')
  if (allBenchmarks.some((benchmark) => benchmark.validity.status !== 'validated')) {
    reasons.push('BENCHMARK_NOT_VALIDATED')
  }
  const baselineConfig = configKeys(baseline.rows)
  const treatmentConfig = configKeys(treatment.rows)
  const same = (left: Set<string>, right: Set<string>) =>
    left.size === 1 && right.size === 1 && [...left][0] === [...right][0]
  if (plan.comparisonKind === 'experience_uplift') {
    if (treatment.summary.treatment !== 'experience_applied') reasons.push('TREATMENT_CELL_NOT_EXPERIENCE_APPLIED')
    if (!same(baselineConfig.models, treatmentConfig.models)) reasons.push('MODEL_CHANGED_IN_EXPERIENCE_UPLIFT')
    if (!same(baselineConfig.harnesses, treatmentConfig.harnesses)) reasons.push('HARNESS_CHANGED_IN_EXPERIENCE_UPLIFT')
    if (!same(baselineConfig.environments, treatmentConfig.environments)) reasons.push('ENVIRONMENT_CHANGED_IN_EXPERIENCE_UPLIFT')
    if (baseline.rows.some((row) => row.observation.experienceRef !== undefined)) reasons.push('BASELINE_CONTAINS_EXPERIENCE')
    if (treatment.rows.some((row) => row.observation.experienceRef === undefined)) reasons.push('TREATMENT_MISSING_EXPERIENCE')
  } else if (plan.comparisonKind === 'model_effect') {
    if (same(baselineConfig.models, treatmentConfig.models)) reasons.push('MODEL_DID_NOT_CHANGE')
    if (!same(baselineConfig.harnesses, treatmentConfig.harnesses)) reasons.push('HARNESS_CHANGED_IN_MODEL_EFFECT')
    if (!same(baselineConfig.environments, treatmentConfig.environments)) reasons.push('ENVIRONMENT_CHANGED_IN_MODEL_EFFECT')
  } else if (plan.comparisonKind === 'harness_effect') {
    if (!same(baselineConfig.models, treatmentConfig.models)) reasons.push('MODEL_CHANGED_IN_HARNESS_EFFECT')
    if (same(baselineConfig.harnesses, treatmentConfig.harnesses)) reasons.push('HARNESS_DID_NOT_CHANGE')
    if (!same(baselineConfig.environments, treatmentConfig.environments)) reasons.push('ENVIRONMENT_CHANGED_IN_HARNESS_EFFECT')
  } else if (plan.comparisonKind === 'model_harness_interaction') {
    reasons.push('PAIRWISE_COMPARISON_CANNOT_ESTIMATE_FACTORIAL_INTERACTION')
  }
  if ([...baseline.rows, ...treatment.rows].some((row) =>
    row.observation.extensions?.['https://aen.dev/extensions/aen/evaluation-execution-mode'] === 'synthetic_test')) {
    reasons.push('SYNTHETIC_TEST_EVIDENCE')
  }
  return [...new Set(reasons)].sort()
}

function metricValues(cell: InternalCell, metric: ComparisonPlan['primaryMetric']): number[] {
  if (metric === 'success_rate') return []
  return cell.metricValues[metric]
}

function buildComparison(
  plan: ComparisonPlan,
  baseline: InternalCell,
  treatment: InternalCell,
  confidenceLevel: number,
  minimum: number,
): EvaluationAggregate['comparisons'][number] {
  const reasons = comparisonEligibility(plan, baseline, treatment, minimum)
  let baselineEstimate: number
  let treatmentEstimate: number
  let difference: number
  let lower: number | undefined
  let upper: number | undefined
  let method: string
  if (plan.primaryMetric === 'success_rate') {
    const baselineRate = baseline.summary.perTrialSuccessRate
    const treatmentRate = treatment.summary.perTrialSuccessRate
    if (baselineRate === undefined || treatmentRate === undefined) {
      baselineEstimate = 0
      treatmentEstimate = 0
      difference = 0
      method = 'Newcombe-Wilson interval unavailable'
      reasons.push('PRIMARY_METRIC_UNAVAILABLE')
    } else {
      baselineEstimate = baselineRate.estimate
      treatmentEstimate = treatmentRate.estimate
      difference = treatmentEstimate - baselineEstimate
      lower = treatmentRate.lower === undefined || baselineRate.upper === undefined
        ? undefined
        : treatmentRate.lower - baselineRate.upper
      upper = treatmentRate.upper === undefined || baselineRate.lower === undefined
        ? undefined
        : treatmentRate.upper - baselineRate.lower
      method = `Newcombe-style difference from Wilson score intervals (${confidenceLevel})`
    }
  } else {
    const interval = continuousDifferenceInterval(
      metricValues(baseline, plan.primaryMetric),
      metricValues(treatment, plan.primaryMetric),
      confidenceLevel,
    )
    if (interval === undefined) {
      baselineEstimate = 0
      treatmentEstimate = 0
      difference = 0
      method = 'continuous metric interval unavailable'
      reasons.push('PRIMARY_METRIC_UNAVAILABLE')
    } else {
      baselineEstimate = interval.baseline
      treatmentEstimate = interval.treatment
      difference = interval.difference
      lower = interval.lower
      upper = interval.upper
      method = interval.method
    }
  }
  const eligibility = reasons.length === 0 ? 'eligible' : 'ineligible'
  const higherIsBetter = plan.primaryMetric === 'success_rate' || plan.primaryMetric === 'quality'
  const conclusion = eligibility === 'ineligible' || lower === undefined || upper === undefined
    ? 'inconclusive'
    : higherIsBetter
      ? lower > 0 ? 'improved' : upper < 0 ? 'harmed' : 'no_significant_difference'
      : upper < 0 ? 'improved' : lower > 0 ? 'harmed' : 'no_significant_difference'
  return {
    comparisonId: plan.comparisonId,
    comparisonKind: plan.comparisonKind,
    baselineCellId: plan.baselineCellId,
    treatmentCellId: plan.treatmentCellId,
    primaryMetric: plan.primaryMetric,
    baselineEstimate,
    treatmentEstimate,
    absoluteDifference: difference,
    ...(baselineEstimate === 0 ? {} : { relativeDifference: difference / Math.abs(baselineEstimate) }),
    uncertainty: {
      method,
      confidenceLevel,
      ...(lower === undefined ? {} : { lower }),
      ...(upper === undefined ? {} : { upper }),
    },
    conclusion,
    counterfactualEligibility: { status: eligibility, reasonCodes: [...new Set(reasons)].sort() },
    confounders: plan.confounders,
  }
}

export function aggregateExperiment(
  store: LocalEvidenceStore,
  options: AggregateOptions,
): EvaluationAggregate {
  if (!Number.isSafeInteger(options.reliabilityK) || options.reliabilityK < 1) throw new Error('reliabilityK must be positive')
  if (!Number.isSafeInteger(options.minValidTrialsPerCell) || options.minValidTrialsPerCell < 1) {
    throw new Error('minValidTrialsPerCell must be positive')
  }
  const excluded = new Set(options.excludedStatuses)
  for (const status of excluded) {
    if (!['infra_error', 'grader_error', 'aborted'].includes(status)) {
      throw new Error(`status ${status} cannot be excluded from task outcome statistics`)
    }
  }
  const rows = options.trialSelectors.map((selector) => {
    const trial = resolveObject<EvaluationTrial>(store, selector, 'evaluation_trial')
    const observation = resolveDigest<RunObservation>(store, trial.runObservationRef.digest, 'observation')
    const benchmark = resolveDigest<BenchmarkTask>(store, trial.benchmarkRef.digest, 'benchmark_task')
    const row = { trial, observation, benchmark }
    validateResolved(row, options.experimentId)
    return row
  }).sort((left, right) =>
    left.trial.cellId.localeCompare(right.trial.cellId) ||
    left.trial.trialIndex - right.trial.trialIndex ||
    left.trial.attemptIndex - right.trial.attemptIndex)
  if (rows.length === 0) throw new Error('aggregate requires at least one trial')
  const grouped = new Map<string, ResolvedTrial[]>()
  for (const row of rows) {
    const values = grouped.get(row.trial.cellId) ?? []
    values.push(row)
    grouped.set(row.trial.cellId, values)
  }
  const cells = new Map<string, InternalCell>()
  for (const [cellId, cellRows] of grouped) {
    cells.set(cellId, summarizeCell(
      cellId,
      cellRows,
      excluded,
      options.reliabilityK,
      options.confidenceLevel,
    ))
  }
  const comparisons = options.comparisons.map((plan) => buildComparison(
    plan,
    cells.get(plan.baselineCellId) ?? (() => { throw new Error(`baseline cell not found: ${plan.baselineCellId}`) })(),
    cells.get(plan.treatmentCellId) ?? (() => { throw new Error(`treatment cell not found: ${plan.treatmentCellId}`) })(),
    options.confidenceLevel,
    options.minValidTrialsPerCell,
  ))
  const valid = rows.filter((row) => !excluded.has(row.trial.status))
  const successes = valid.filter(successful).length
  const overallRate = valid.length === 0 ? undefined : wilsonInterval(successes, valid.length, options.confidenceLevel)
  const benchmarkRefs = [...new Map(rows.map((row) => {
    const ref = toObjectRef(row.benchmark as unknown as JsonRecord)
    return [ref.digest, ref]
  })).values()].sort((left, right) => left.digest.localeCompare(right.digest))
  const trialRefs = rows.map((row) => toObjectRef(row.trial as unknown as JsonRecord))
  const aggregate = finalizeProtocolObject<EvaluationAggregate>({
    protocolVersion: '0.1',
    objectType: 'evaluation_aggregate',
    aggregateId: `urn:aen:evaluation:aggregate:${sha256(canonicalJson({
      experimentId: options.experimentId,
      trials: trialRefs.map((ref) => ref.digest),
      comparisons: options.comparisons,
    })).slice(7, 31)}`,
    experimentId: options.experimentId,
    benchmarkRefs,
    trialRefs,
    totalTrials: rows.length,
    validTrials: valid.length,
    ...(overallRate === undefined ? {} : {
      passAt1: overallRate.estimate,
      passAtK: { k: options.reliabilityK, estimate: passAtK(overallRate.estimate, options.reliabilityK) },
      passPowerK: { k: options.reliabilityK, estimate: passPowerK(overallRate.estimate, options.reliabilityK) },
      perTrialSuccessRate: overallRate,
    }),
    metricSummary: metricSummary(metrics(valid), successes, valid.length),
    statusCounts: statusCounts(rows),
    excludedTrialCounts: excludedCounts(rows, excluded),
    cellSummaries: [...cells.values()].map((cell) => cell.summary),
    comparisons,
    extensions: {
      'https://aen.dev/extensions/aen/evaluation-aggregator': 'cell-aware-v1',
      'https://aen.dev/extensions/aen/confidence-level': options.confidenceLevel,
      'https://aen.dev/extensions/aen/min-valid-trials-per-cell': options.minValidTrialsPerCell,
    },
  })
  store.putBatch({ objects: [{ object: aggregate as unknown as JsonRecord, role: 'evaluation_aggregate' }] })
  return aggregate
}
