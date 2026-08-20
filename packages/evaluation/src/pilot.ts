import {
  canonicalJson,
  type BenchmarkTask,
  type ExperienceRevision,
  type HarnessManifest,
  type JsonRecord,
  type ModelFingerprint,
} from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'
import {
  assertEvaluationMatrixPlanSemantics,
  comparisonsForBenchmark,
  parseEvaluationMatrixPlan,
  resolveMatrixCellForBenchmark,
} from './plan.js'
import type { EvaluationMatrixPlan, MatrixCellPlan } from './types.js'

export interface PilotParticipant {
  participantId: string
  role: 'publisher' | 'consumer' | 'evaluator'
  localStoreBoundaryId: string
}

export interface PilotPreregistration {
  profile: 'aen-mvp-pilot-preregistration-v0.1'
  status: 'frozen'
  frozenAt: string
  reviewedCommit: string
  participants: PilotParticipant[]
  publicHub: {
    url: string
    tls: boolean
    monitoring: boolean
    backups: boolean
    keyRotation: boolean
    incidentResponse: boolean
  }
  execution: {
    driverMode: 'live'
    seedPolicy: string
    stoppingRule: 'fixed_repetitions'
  }
  budget: {
    owner: string
    currency: 'USD'
    maxTotalCostUsd: number
  }
  privacy: {
    rawTrace: 'local_only'
    publicContribution: 'reviewed_promotion_only'
    humanRedactionReview: boolean
  }
  matrix: EvaluationMatrixPlan
}

export interface PilotValidationReport {
  ok: boolean
  errors: string[]
  summary: {
    participants: number
    benchmarks: number
    taskFamilies: number
    models: number
    harnessConfigurations: number
    matrixCells: number
    preregisteredComparisons: number
  }
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as JsonRecord
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
  return value
}

function literal<T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} must be ${expected}`)
  return expected
}

function parseParticipants(value: unknown): PilotParticipant[] {
  if (!Array.isArray(value)) throw new Error('participants must be an array')
  return value.map((raw, index) => {
    const participant = record(raw, `participants[${index}]`)
    const role = string(participant.role, `participants[${index}].role`)
    if (!['publisher', 'consumer', 'evaluator'].includes(role)) throw new Error(`participants[${index}].role is invalid`)
    return {
      participantId: string(participant.participantId, `participants[${index}].participantId`),
      role: role as PilotParticipant['role'],
      localStoreBoundaryId: string(participant.localStoreBoundaryId, `participants[${index}].localStoreBoundaryId`),
    }
  })
}

export function parsePilotPreregistration(value: unknown): PilotPreregistration {
  const input = record(value, 'pilot preregistration')
  const hub = record(input.publicHub, 'publicHub')
  const execution = record(input.execution, 'execution')
  const budget = record(input.budget, 'budget')
  const privacy = record(input.privacy, 'privacy')
  if (typeof budget.maxTotalCostUsd !== 'number') throw new Error('budget.maxTotalCostUsd must be a number')
  return {
    profile: literal(input.profile, 'aen-mvp-pilot-preregistration-v0.1', 'profile'),
    status: literal(input.status, 'frozen', 'status'),
    frozenAt: string(input.frozenAt, 'frozenAt'),
    reviewedCommit: string(input.reviewedCommit, 'reviewedCommit'),
    participants: parseParticipants(input.participants),
    publicHub: {
      url: string(hub.url, 'publicHub.url'),
      tls: boolean(hub.tls, 'publicHub.tls'),
      monitoring: boolean(hub.monitoring, 'publicHub.monitoring'),
      backups: boolean(hub.backups, 'publicHub.backups'),
      keyRotation: boolean(hub.keyRotation, 'publicHub.keyRotation'),
      incidentResponse: boolean(hub.incidentResponse, 'publicHub.incidentResponse'),
    },
    execution: {
      driverMode: literal(execution.driverMode, 'live', 'execution.driverMode'),
      seedPolicy: string(execution.seedPolicy, 'execution.seedPolicy'),
      stoppingRule: literal(execution.stoppingRule, 'fixed_repetitions', 'execution.stoppingRule'),
    },
    budget: {
      owner: string(budget.owner, 'budget.owner'),
      currency: literal(budget.currency, 'USD', 'budget.currency'),
      maxTotalCostUsd: budget.maxTotalCostUsd,
    },
    privacy: {
      rawTrace: literal(privacy.rawTrace, 'local_only', 'privacy.rawTrace'),
      publicContribution: literal(
        privacy.publicContribution,
        'reviewed_promotion_only',
        'privacy.publicContribution',
      ),
      humanRedactionReview: boolean(privacy.humanRedactionReview, 'privacy.humanRedactionReview'),
    },
    matrix: parseEvaluationMatrixPlan(input.matrix),
  }
}

function modelKey(model: ModelFingerprint): string {
  const { observedAt: _observedAt, ...stable } = model
  return canonicalJson(stable)
}

function placeholders(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') {
    return /(^|[^a-z])(tbd|todo|placeholder|changeme)([^a-z]|$)/i.test(value) ? [path] : []
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => placeholders(item, `${path}[${index}]`))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => placeholders(item, `${path}.${key}`))
  }
  return []
}

function manifestComplete(manifest: HarnessManifest): boolean {
  return manifest.coverage.mode === 'live_snapshot' &&
    manifest.coverage.models === 'complete' &&
    manifest.coverage.tools === 'complete' &&
    manifest.coverage.skills === 'complete' &&
    manifest.coverage.policies === 'complete' &&
    manifest.coverage.effectiveSurface === 'complete'
}

function combinationKey(cell: MatrixCellPlan): string {
  return `${modelKey(cell.model)}\n${cell.harnessConfigurationDigest}`
}

export function validatePilotPreregistration(
  store: LocalEvidenceStore,
  preregistration: PilotPreregistration,
): PilotValidationReport {
  const errors: string[] = []
  try {
    assertEvaluationMatrixPlanSemantics(preregistration.matrix)
  } catch (error) {
    errors.push(`MATRIX_INVALID: ${error instanceof Error ? error.message : String(error)}`)
  }

  for (const path of placeholders(preregistration)) errors.push(`PLACEHOLDER_PRESENT: ${path}`)
  if (!Number.isFinite(Date.parse(preregistration.frozenAt))) errors.push('FROZEN_AT_INVALID')
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(preregistration.reviewedCommit)) errors.push('REVIEWED_COMMIT_INVALID')
  if (preregistration.participants.length < 3) errors.push('PARTICIPANTS_LT_3')
  if (new Set(preregistration.participants.map((participant) => participant.participantId)).size !== preregistration.participants.length) {
    errors.push('PARTICIPANT_IDS_NOT_UNIQUE')
  }
  if (new Set(preregistration.participants.map((participant) => participant.localStoreBoundaryId)).size !== preregistration.participants.length) {
    errors.push('LOCAL_STORE_BOUNDARIES_NOT_ISOLATED')
  }
  for (const role of ['publisher', 'consumer', 'evaluator'] as const) {
    if (!preregistration.participants.some((participant) => participant.role === role)) errors.push(`PARTICIPANT_ROLE_MISSING: ${role}`)
  }

  try {
    const url = new URL(preregistration.publicHub.url)
    if (url.protocol !== 'https:') errors.push('PUBLIC_HUB_NOT_HTTPS')
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) errors.push('PUBLIC_HUB_NOT_PUBLICLY_REACHABLE')
  } catch {
    errors.push('PUBLIC_HUB_URL_INVALID')
  }
  if (![
    preregistration.publicHub.tls,
    preregistration.publicHub.monitoring,
    preregistration.publicHub.backups,
    preregistration.publicHub.keyRotation,
    preregistration.publicHub.incidentResponse,
  ].every(Boolean)) errors.push('PUBLIC_HUB_CONTROLS_INCOMPLETE')
  if (!(preregistration.budget.maxTotalCostUsd > 0 && Number.isFinite(preregistration.budget.maxTotalCostUsd))) {
    errors.push('BUDGET_LIMIT_INVALID')
  }
  if (!preregistration.privacy.humanRedactionReview) errors.push('HUMAN_REDACTION_REVIEW_DISABLED')

  const { matrix } = preregistration
  if (matrix.benchmarkSelectors.length !== 2) errors.push('PILOT_REQUIRES_EXACTLY_2_BENCHMARKS')
  const models = new Map<string, ModelFingerprint>()
  const harnessDigests = new Set<MatrixCellPlan['harnessConfigurationDigest']>()
  const representativeManifests = new Map<MatrixCellPlan['harnessConfigurationDigest'], MatrixCellPlan['harnessManifestDigest']>()
  for (const cell of matrix.cells) {
    models.set(modelKey(cell.model), cell.model)
    harnessDigests.add(cell.harnessConfigurationDigest)
    const existing = representativeManifests.get(cell.harnessConfigurationDigest)
    if (existing !== undefined && existing !== cell.harnessManifestDigest) {
      errors.push(`HARNESS_CONFIGURATION_HAS_MULTIPLE_REPRESENTATIVE_MANIFESTS: ${cell.harnessConfigurationDigest}`)
    }
    representativeManifests.set(cell.harnessConfigurationDigest, cell.harnessManifestDigest)
  }
  if (models.size !== 2) errors.push('PILOT_REQUIRES_EXACTLY_2_MODELS')
  if (harnessDigests.size !== 2) errors.push('PILOT_REQUIRES_EXACTLY_2_HARNESS_CONFIGURATIONS')
  for (const model of models.values()) {
    if (model.pricingSnapshotRef === undefined) errors.push(`MODEL_PRICING_SNAPSHOT_MISSING: ${model.provider}/${model.modelId}`)
    if (model.rateLimitSnapshotRef === undefined) errors.push(`MODEL_RATE_LIMIT_SNAPSHOT_MISSING: ${model.provider}/${model.modelId}`)
  }

  for (const [configurationDigest, manifestDigest] of representativeManifests) {
    const manifest = store.getByDigest(manifestDigest) as HarnessManifest | undefined
    if (manifest?.objectType !== 'harness_manifest') errors.push(`HARNESS_MANIFEST_MISSING: ${manifestDigest}`)
    else if (manifest.configurationDigest !== configurationDigest) errors.push(`HARNESS_MANIFEST_CONFIGURATION_MISMATCH: ${manifestDigest}`)
    else if (!manifestComplete(manifest)) errors.push(`HARNESS_MANIFEST_COVERAGE_INCOMPLETE: ${manifestDigest}`)
  }

  const taskFamilies = new Set<string>()
  const benchmarks = new Map<string, BenchmarkTask>()
  for (const selector of matrix.benchmarkSelectors) {
    const inspected = store.inspect(selector)
    if (inspected?.summary.objectType !== 'benchmark_task') {
      errors.push(`BENCHMARK_MISSING: ${selector}`)
      continue
    }
    const benchmark = inspected.object as unknown as BenchmarkTask
    benchmarks.set(selector, benchmark)
    taskFamilies.add(benchmark.task.taxonomy[0] ?? benchmark.benchmarkId)
    if (benchmark.validity.status !== 'validated') errors.push(`BENCHMARK_NOT_VALIDATED: ${selector}`)
  }
  if (taskFamilies.size !== 2) errors.push('PILOT_REQUIRES_2_DISTINCT_TASK_FAMILIES')

  const expectedCombinations = new Set<string>()
  for (const model of models.keys()) for (const harness of harnessDigests) expectedCombinations.add(`${model}\n${harness}`)
  const cellsByCombination = new Map<string, MatrixCellPlan[]>()
  for (const cell of matrix.cells) {
    const key = combinationKey(cell)
    cellsByCombination.set(key, [...(cellsByCombination.get(key) ?? []), cell])
  }
  if (matrix.cells.length !== 8) errors.push('PILOT_REQUIRES_EXACTLY_8_BASELINE_TREATMENT_CELLS')
  for (const key of expectedCombinations) {
    const cells = cellsByCombination.get(key) ?? []
    if (cells.filter((cell) => cell.treatment === 'baseline').length !== 1) errors.push(`BASELINE_CELL_MISSING_OR_DUPLICATED: ${key}`)
    if (cells.filter((cell) => cell.treatment === 'experience_applied').length !== 1) errors.push(`TREATMENT_CELL_MISSING_OR_DUPLICATED: ${key}`)
    if (cells.some((cell) => !['baseline', 'experience_applied'].includes(cell.treatment))) errors.push(`UNDECLARED_ALTERNATIVE_CELL: ${key}`)
  }
  for (const key of cellsByCombination.keys()) {
    if (!expectedCombinations.has(key)) errors.push(`UNEXPECTED_CONFIGURATION_CELL: ${key}`)
  }

  let comparisonCount = 0
  for (const selector of matrix.benchmarkSelectors) {
    const comparisons = comparisonsForBenchmark(matrix, selector)
    comparisonCount += comparisons.length
    if (matrix.comparisonsByBenchmark === undefined) errors.push(`TASK_SCOPED_COMPARISONS_MISSING: ${selector}`)
    if (comparisons.length !== expectedCombinations.size) errors.push(`UPLIFT_COMPARISON_COVERAGE_INCOMPLETE: ${selector}`)
    const benchmark = benchmarks.get(selector)
    const family = benchmark?.task.taxonomy[0] ?? benchmark?.benchmarkId
    const covered = new Set<string>()
    for (const comparison of comparisons) {
      if (comparison.comparisonKind !== 'experience_uplift') errors.push(`NON_UPLIFT_PRIMARY_COMPARISON: ${selector}/${comparison.comparisonId}`)
      if (benchmark !== undefined && comparison.primaryMetric !== benchmark.trialPlan.primaryMetric) {
        errors.push(`PRIMARY_METRIC_DISAGREES_WITH_BENCHMARK: ${selector}/${comparison.comparisonId}`)
      }
      const baseline = matrix.cells.find((cell) => cell.cellId === comparison.baselineCellId)
      const treatment = matrix.cells.find((cell) => cell.cellId === comparison.treatmentCellId)
      if (baseline !== undefined && treatment !== undefined) covered.add(combinationKey(baseline))
      if (treatment !== undefined) {
        const resolved = resolveMatrixCellForBenchmark(treatment, selector)
        const ref = resolved.experienceRef
        const experience = ref === undefined ? undefined : store.getByDigest(ref.digest) as ExperienceRevision | undefined
        if (ref === undefined || experience?.objectType !== 'experience_revision') {
          errors.push(`TASK_SCOPED_EXPERIENCE_MISSING: ${selector}/${treatment.cellId}`)
        } else {
          if (
            experience.experienceId !== ref.experienceId ||
            experience.revision !== ref.revision
          ) errors.push(`TASK_SCOPED_EXPERIENCE_REF_MISMATCH: ${selector}/${treatment.cellId}`)
          if (experience.governance.visibility !== 'public') errors.push(`TREATMENT_EXPERIENCE_NOT_PUBLIC: ${selector}/${ref.digest}`)
          if (family !== undefined && !experience.applicability.taskFamilies?.includes(family)) {
            errors.push(`TREATMENT_EXPERIENCE_TASK_SCOPE_MISMATCH: ${selector}/${ref.digest}`)
          }
        }
      }
    }
    for (const key of expectedCombinations) {
      if (!covered.has(key)) errors.push(`UPLIFT_COMPARISON_COMBINATION_MISSING: ${selector}/${key}`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      participants: preregistration.participants.length,
      benchmarks: benchmarks.size,
      taskFamilies: taskFamilies.size,
      models: models.size,
      harnessConfigurations: harnessDigests.size,
      matrixCells: matrix.cells.length,
      preregisteredComparisons: comparisonCount,
    },
  }
}
