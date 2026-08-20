import type {
  AcceptanceResult,
  BenchmarkTask,
  EvaluationAggregate,
  EvaluationTrial,
  ExperienceRevision,
  HarnessManifest,
  ModelFingerprint,
  RunObservation,
  TraceEvidenceBundle,
} from '@aen/protocol'

export type TrialStatus = EvaluationTrial['status']
export type ComparisonKind = EvaluationAggregate['comparisons'][number]['comparisonKind']
export type ExecutionEvidenceMode = 'live' | 'recorded_run' | 'synthetic_test'

export interface MatrixCell {
  cellId: string
  treatment: RunObservation['treatment']
  model: ModelFingerprint
  /** Stable Harness configuration identity frozen before trials start. */
  harnessConfigurationDigest: `sha256:${string}`
  /** Representative reviewed Manifest snapshot for the frozen configuration. */
  harnessManifestDigest: `sha256:${string}`
  experienceRef?: Pick<ExperienceRevision, 'experienceId' | 'revision' | 'digest'>
}

/**
 * A plan cell may select a different immutable Experience revision for each
 * Benchmark. The single `experienceRef` form is retained only for a
 * single-Benchmark plan; drivers always receive a resolved `MatrixCell`.
 */
export interface MatrixCellPlan extends Omit<MatrixCell, 'experienceRef'> {
  experienceRef?: MatrixCell['experienceRef']
  experienceRefsByBenchmark?: Record<string, NonNullable<MatrixCell['experienceRef']>>
}

export interface ComparisonPlan {
  comparisonId: string
  comparisonKind: ComparisonKind
  baselineCellId: string
  treatmentCellId: string
  primaryMetric: 'success_rate' | 'quality' | 'cost_usd' | 'latency_ms'
  confounders: string[]
}

export interface EvaluationMatrixPlan {
  experimentId: string
  benchmarkSelectors: string[]
  cells: MatrixCellPlan[]
  repetitions: number
  reliabilityK: number
  confidenceLevel: number
  minValidTrialsPerCell: number
  excludedStatuses: TrialStatus[]
  comparisons: ComparisonPlan[]
  /** Required for task-specific comparisons in a multi-Benchmark plan. */
  comparisonsByBenchmark?: Record<string, ComparisonPlan[]>
}

export interface EvaluationRunInput {
  experimentId: string
  benchmark: BenchmarkTask
  cell: MatrixCell
  trialIndex: number
  attemptIndex: number
}

export interface EvaluationDriverResult {
  observation: RunObservation
  status: TrialStatus
  graderResults: AcceptanceResult[]
  transcript?: TraceEvidenceBundle
}

export interface EvaluationDriver {
  readonly name: string
  readonly executionMode: ExecutionEvidenceMode
  run(input: EvaluationRunInput): Promise<EvaluationDriverResult>
}

export interface FactorialCoverageReport {
  taskFamilies: string[]
  modelConfigurations: string[]
  harnessConfigurations: string[]
  expectedCombinationsPerTask: number
  observedCombinationsByTask: Record<string, string[]>
  completeTwoByTwoByTwo: boolean
  missing: string[]
}

export interface EvaluationRunResult {
  trials: EvaluationTrial[]
  observations: RunObservation[]
  /** Per-Benchmark aggregates are the only aggregates eligible for causal comparisons. */
  benchmarkAggregates: EvaluationAggregate[]
  /** Single-Benchmark aggregate, or a comparison-free portfolio summary for multiple tasks. */
  aggregate: EvaluationAggregate
  coverage: FactorialCoverageReport
}

export interface AggregateOptions {
  experimentId: string
  trialSelectors: string[]
  reliabilityK: number
  confidenceLevel: number
  minValidTrialsPerCell: number
  excludedStatuses: TrialStatus[]
  comparisons: ComparisonPlan[]
}

export interface ComparisonEvidenceDecision {
  maximumEvidenceLevel: 'H2' | 'H3'
  mode: 'observational' | 'causal'
  reasonCodes: string[]
  conclusion?: EvaluationAggregate['comparisons'][number]['conclusion']
}

export interface ResolvedCellConfiguration {
  model: ModelFingerprint
  manifest: HarnessManifest
}
