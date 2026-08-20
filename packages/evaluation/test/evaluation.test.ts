import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  finalizeProtocolObject,
  toObjectRef,
  validateProtocolObject,
  type BenchmarkTask,
  type ExperienceRevision,
  type GraderDefinition,
  type HarnessManifest,
  type JsonRecord,
  type ModelFingerprint,
  type RunObservation,
} from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'
import {
  aggregateExperiment,
  assertCausalClaimAllowed,
  comparisonEvidenceDecision,
  parseEvaluationMatrixPlan,
  parsePilotPreregistration,
  runEvaluationMatrix,
  validatePilotPreregistration,
  type EvaluationDriver,
  type EvaluationDriverResult,
  type EvaluationRunInput,
  type MatrixCell,
  type MatrixCellPlan,
  type TrialStatus,
} from '../src/index.js'

const directories: string[] = []
const TIME = '2026-08-20T00:00:00Z'

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempStore(): LocalEvidenceStore {
  const directory = mkdtempSync(join(tmpdir(), 'aen-evaluation-'))
  directories.push(directory)
  return new LocalEvidenceStore(join(directory, 'evidence.sqlite'))
}

function model(modelId: string): ModelFingerprint {
  return {
    provider: 'fixture-provider',
    modelId,
    declaredVersion: '1',
    pricingSnapshotRef: {
      objectType: 'pricing_snapshot',
      refId: `urn:aen:pricing:${modelId}`,
      digest: `sha256:${(modelId === 'model-a' ? '3' : '4').repeat(64)}`,
    },
    rateLimitSnapshotRef: {
      objectType: 'rate_limit_snapshot',
      refId: `urn:aen:rate-limit:${modelId}`,
      digest: `sha256:${(modelId === 'model-a' ? '5' : '6').repeat(64)}`,
    },
    observedAt: TIME,
    mutability: 'versioned',
  }
}

function manifest(name: string): HarnessManifest {
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'harness_manifest',
    manifestId: `urn:aen:manifest:${name}`,
    configurationDigest: `sha256:${(name === 'x' ? '7' : '8').repeat(64)}`,
    capturedAt: TIME,
    adapter: { name: 'fixture', version: '1' },
    harness: { name: 'DeepSeek Harness', version: '0.1.0-rc.7', distribution: name },
    sessionScope: {},
    modelSurface: { toolSchemaSetDigest: `sha256:${(name === 'x' ? '1' : '2').repeat(64)}` },
    artifacts: [],
    policies: { retry: { profile: name } },
    environment: { capturedAt: TIME, disclosure: 'metadata', runtime: { node: process.version } },
    coverage: {
      mode: 'live_snapshot',
      models: 'complete',
      tools: 'complete',
      skills: 'complete',
      preset: 'complete',
      policies: 'complete',
      effectiveSurface: 'complete',
      limitations: [],
    },
  })
}

function grader(): GraderDefinition {
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'grader_definition',
    graderId: 'urn:aen:grader:fixture',
    revision: 1,
    type: 'code',
    target: 'outcome',
  })
}

function benchmark(family: string, graderObject: GraderDefinition): BenchmarkTask {
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'benchmark_task',
    benchmarkId: `urn:aen:benchmark:${family}`,
    revision: 1,
    suiteKind: 'capability',
    task: {
      taxonomy: [family],
      intent: `Complete ${family} fixture`,
      constraints: ['Use only the recorded fixture.'],
      acceptance: [{ id: 'accepted', description: 'Fixture grader passes.', required: true }],
      riskClass: 'read_only',
    },
    environment: { fixtureRefs: [], networkMode: 'recorded_fixture' },
    graderRefs: [toObjectRef(graderObject as unknown as JsonRecord)],
    resourceLimits: { timeoutMs: 30_000, maxModelCalls: 4, maxToolCalls: 8 },
    trialPlan: { repetitions: 20, randomization: 'interleaved_cells', primaryMetric: 'success_rate' },
    allowedSideEffects: [],
    validity: {
      status: 'validated',
      issueClarityReviewed: true,
      acceptanceAlignmentReviewed: true,
      solvabilityReviewed: true,
      reviewerRefs: [{ actorId: 'urn:aen:actor:fixture-reviewer', type: 'human' }],
      reviewedAt: TIME,
      contaminationRisk: 'low',
    },
  })
}

function experience(name = 'fixture', taskFamily = 'fixture'): ExperienceRevision {
  const evidence = {
    objectType: 'trace_evidence',
    refId: 'urn:aen:evidence:fixture',
    digest: `sha256:${'0'.repeat(64)}`,
  }
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'experience_revision',
    experienceId: `urn:aen:experience:${name}`,
    revision: 1,
    createdAt: TIME,
    relations: [],
    kind: 'execution_strategy',
    namespace: 'fixture',
    publisher: { actorId: 'urn:aen:actor:fixture', type: 'human' },
    languages: ['en'],
    title: `${name} fixture strategy`,
    summary: 'A fixture Experience used only by evaluation tests.',
    intendedUses: ['fixture evaluation'],
    outOfScopeUses: [],
    knownLimitations: [],
    knownFailureModes: [],
    task: {
      taxonomy: [taskFamily],
      intent: 'Complete fixture',
      constraints: [],
      acceptance: [],
      riskClass: 'read_only',
    },
    claims: [{
      claimId: 'urn:aen:experience:fixture#claim',
      type: 'strategy_works',
      statement: 'Fixture observational claim.',
      mode: 'observational',
      evidenceLevel: 'H1',
      scope: { taskFamilies: ['fixture'] },
      supportingEvidenceRefs: [evidence],
      contradictingEvidenceRefs: [],
      falsificationConditions: ['Treatment does not improve the fixture.'],
      assumptions: [],
    }],
    applicability: { taskFamilies: [taskFamily] },
    evidenceRefs: [evidence],
    artifactRefs: [],
    governance: {
      visibility: 'public',
      owner: { actorId: 'urn:aen:actor:fixture', type: 'human' },
      license: 'Apache-2.0',
      dataClasses: [],
      redistribution: 'public_mirrors',
      sourcePolicy: 'fixture',
      redactionReport: { scannerVersions: {}, transformations: [], residualRisk: 'low', humanReviewed: true },
      safetyLabels: [],
    },
  })
}

function putFoundations(store: LocalEvidenceStore) {
  const graderObject = grader()
  const manifestX = manifest('x')
  const manifestY = manifest('y')
  const benchmarkA = benchmark('software-engineering', graderObject)
  const benchmarkB = benchmark('document-analysis', graderObject)
  const experienceObject = experience('software', 'software-engineering')
  const experienceObjectB = experience('document', 'document-analysis')
  store.putBatch({ objects: [
    { object: graderObject as unknown as JsonRecord },
    { object: manifestX as unknown as JsonRecord },
    { object: manifestY as unknown as JsonRecord },
    { object: benchmarkA as unknown as JsonRecord },
    { object: benchmarkB as unknown as JsonRecord },
    { object: experienceObject as unknown as JsonRecord },
    { object: experienceObjectB as unknown as JsonRecord },
  ] })
  return { graderObject, manifestX, manifestY, benchmarkA, benchmarkB, experienceObject, experienceObjectB }
}

class FixtureDriver implements EvaluationDriver {
  constructor(
    readonly executionMode: 'live' | 'recorded_run' | 'synthetic_test',
    readonly outcome: (input: EvaluationRunInput) => TrialStatus,
  ) {}

  readonly name = 'fixture-driver'

  async run(input: EvaluationRunInput): Promise<EvaluationDriverResult> {
    const status = this.outcome(input)
    const passed = status === 'success'
    const observation = finalizeProtocolObject<RunObservation>({
      protocolVersion: '0.1',
      objectType: 'observation',
      observationId: `urn:aen:observation:${input.experimentId}:${input.benchmark.benchmarkId}:${input.cell.cellId}:${input.trialIndex}`,
      ...(input.cell.experienceRef === undefined ? {} : {
        experienceRef: {
          experienceId: input.cell.experienceRef.experienceId,
          revision: input.cell.experienceRef.revision,
          digest: input.cell.experienceRef.digest,
        },
      }),
      taskRef: input.benchmark.benchmarkId,
      evaluatorRef: 'urn:aen:grader:fixture',
          configurationCell: {
            model: input.cell.model,
            harnessConfigurationDigest: input.cell.harnessConfigurationDigest,
            harnessManifestDigest: input.cell.harnessManifestDigest,
        environment: { capturedAt: TIME, disclosure: 'metadata', runtime: { fixture: '1' } },
      },
      experiment: {
        experimentId: input.experimentId,
        cellId: input.cell.cellId,
        trialIndex: input.trialIndex,
        attemptIndex: input.attemptIndex,
        randomization: 'interleaved_cells',
        seedPolicy: 'fixture-index',
      },
      treatment: input.cell.treatment,
      outcome: passed ? 'success' : status === 'aborted' || status === 'infra_error' || status === 'grader_error' ? 'aborted' : 'failure',
      acceptanceResults: [{ criterionId: 'accepted', passed, evidenceRefs: [] }],
      metrics: {
        qualityScore: passed ? 1 : 0,
        totalCostUsd: input.cell.model.modelId === 'model-a' ? 0.01 : 0.02,
        latencyMs: input.cell.harnessManifestDigest.endsWith('1') ? 100 : 120,
        inputTokens: 100,
        outputTokens: 20,
      },
      ...(passed ? {} : { failureType: status }),
      evidenceRefs: [],
      independence: {
        evaluatorActor: { actorId: 'urn:aen:grader:fixture', type: 'service' },
        modelFamily: input.cell.model.modelId,
      },
      createdAt: TIME,
      extensions: {
        'https://aen.dev/extensions/aen/evaluation-execution-mode': this.executionMode,
      },
    })
    return {
      observation,
      status,
      graderResults: observation.acceptanceResults,
    }
  }
}

describe('cell-aware comparative evaluation', () => {
  it('proves 2 Model × 2 Harness × 2 task-family matrix coverage without calling it real evidence', async () => {
    const store = tempStore()
    const foundations = putFoundations(store)
    const cells: MatrixCell[] = [
      { cellId: 'a-x', treatment: 'alternative', model: model('model-a'), harnessConfigurationDigest: foundations.manifestX.configurationDigest, harnessManifestDigest: foundations.manifestX.digest },
      { cellId: 'a-y', treatment: 'alternative', model: model('model-a'), harnessConfigurationDigest: foundations.manifestY.configurationDigest, harnessManifestDigest: foundations.manifestY.digest },
      { cellId: 'b-x', treatment: 'alternative', model: model('model-b'), harnessConfigurationDigest: foundations.manifestX.configurationDigest, harnessManifestDigest: foundations.manifestX.digest },
      { cellId: 'b-y', treatment: 'alternative', model: model('model-b'), harnessConfigurationDigest: foundations.manifestY.configurationDigest, harnessManifestDigest: foundations.manifestY.digest },
    ]
    const result = await runEvaluationMatrix(store, {
      experimentId: 'urn:aen:experiment:factorial-fixture',
      benchmarkSelectors: [foundations.benchmarkA.digest, foundations.benchmarkB.digest],
      cells,
      repetitions: 1,
      reliabilityK: 1,
      confidenceLevel: 0.95,
      minValidTrialsPerCell: 1,
      excludedStatuses: ['infra_error', 'grader_error', 'aborted'],
      comparisons: [],
    }, new FixtureDriver('synthetic_test', () => 'success'))
    expect(result.trials).toHaveLength(8)
    expect(result.coverage.completeTwoByTwoByTwo).toBe(true)
    expect(result.coverage.taskFamilies).toEqual(['document-analysis', 'software-engineering'])
    expect(result.benchmarkAggregates).toHaveLength(2)
    expect(result.benchmarkAggregates.every((aggregate) => aggregate.benchmarkRefs.length === 1)).toBe(true)
    expect(result.aggregate.benchmarkRefs).toHaveLength(2)
    expect(result.aggregate.comparisons).toEqual([])
    expect(validateProtocolObject(result.aggregate)).toMatchObject({ ok: true, issues: [] })
    expect(comparisonEvidenceDecision(result.aggregate, 'missing')).toMatchObject({
      maximumEvidenceLevel: 'H2',
      mode: 'observational',
    })
    expect(() => assertCausalClaimAllowed(result.aggregate, 'missing')).toThrow('NO_COUNTERFACTUAL_COMPARISON')
    store.close()
  })

  it('derives an eligible H3 experience-uplift comparison only with a controlled recorded run', async () => {
    const store = tempStore()
    const foundations = putFoundations(store)
    const baseline: MatrixCell = {
      cellId: 'baseline',
      treatment: 'baseline',
      model: model('model-a'),
      harnessConfigurationDigest: foundations.manifestX.configurationDigest,
      harnessManifestDigest: foundations.manifestX.digest,
    }
    const treatment: MatrixCell = {
      cellId: 'treatment',
      treatment: 'experience_applied',
      model: model('model-a'),
      harnessConfigurationDigest: foundations.manifestX.configurationDigest,
      harnessManifestDigest: foundations.manifestX.digest,
      experienceRef: {
        experienceId: foundations.experienceObject.experienceId,
        revision: foundations.experienceObject.revision,
        digest: foundations.experienceObject.digest,
      },
    }
    const result = await runEvaluationMatrix(store, {
      experimentId: 'urn:aen:experiment:uplift-fixture',
      benchmarkSelectors: [foundations.benchmarkA.digest],
      cells: [baseline, treatment],
      repetitions: 20,
      reliabilityK: 3,
      confidenceLevel: 0.95,
      minValidTrialsPerCell: 20,
      excludedStatuses: ['infra_error', 'grader_error', 'aborted'],
      comparisons: [{
        comparisonId: 'experience-uplift',
        comparisonKind: 'experience_uplift',
        baselineCellId: 'baseline',
        treatmentCellId: 'treatment',
        primaryMetric: 'success_rate',
        confounders: [],
      }],
    }, new FixtureDriver('recorded_run', (input) => input.cell.cellId === 'treatment' ? 'success' : 'agent_failure'))
    const comparison = result.aggregate.comparisons[0]
    expect(comparison).toMatchObject({
      conclusion: 'improved',
      counterfactualEligibility: { status: 'eligible', reasonCodes: [] },
      baselineEstimate: 0,
      treatmentEstimate: 1,
    })
    expect(result.aggregate.cellSummaries.find((cell) => cell.cellId === 'baseline')).toMatchObject({
      passAtK: { k: 3, estimate: 0 },
      passPowerK: { k: 3, estimate: 0 },
      statusCounts: { agent_failure: 20 },
    })
    expect(comparisonEvidenceDecision(result.aggregate, 'experience-uplift')).toMatchObject({
      maximumEvidenceLevel: 'H3',
      mode: 'causal',
      conclusion: 'improved',
    })
    expect(() => assertCausalClaimAllowed(result.aggregate, 'experience-uplift')).not.toThrow()
    expect(result.benchmarkAggregates).toEqual([result.aggregate])
    store.close()
  })

  it('never derives one causal comparison by mixing two task families', async () => {
    const store = tempStore()
    const foundations = putFoundations(store)
    const baseline: MatrixCell = {
      cellId: 'baseline',
      treatment: 'baseline',
      model: model('model-a'),
      harnessConfigurationDigest: foundations.manifestX.configurationDigest,
      harnessManifestDigest: foundations.manifestX.digest,
    }
    const treatment: MatrixCell = {
      cellId: 'treatment',
      treatment: 'experience_applied',
      model: model('model-a'),
      harnessConfigurationDigest: foundations.manifestX.configurationDigest,
      harnessManifestDigest: foundations.manifestX.digest,
      experienceRef: {
        experienceId: foundations.experienceObject.experienceId,
        revision: foundations.experienceObject.revision,
        digest: foundations.experienceObject.digest,
      },
    }
    const plan = {
      experimentId: 'urn:aen:experiment:benchmark-sliced-fixture',
      benchmarkSelectors: [foundations.benchmarkA.digest, foundations.benchmarkB.digest],
      cells: [baseline, {
        ...treatment,
        experienceRef: undefined,
        experienceRefsByBenchmark: {
          [foundations.benchmarkA.digest]: {
            experienceId: foundations.experienceObject.experienceId,
            revision: foundations.experienceObject.revision,
            digest: foundations.experienceObject.digest,
          },
          [foundations.benchmarkB.digest]: {
            experienceId: foundations.experienceObjectB.experienceId,
            revision: foundations.experienceObjectB.revision,
            digest: foundations.experienceObjectB.digest,
          },
        },
      }],
      repetitions: 2,
      reliabilityK: 1,
      confidenceLevel: 0.95,
      minValidTrialsPerCell: 2,
      excludedStatuses: ['infra_error', 'grader_error', 'aborted'] as TrialStatus[],
      comparisons: [],
      comparisonsByBenchmark: Object.fromEntries([
        foundations.benchmarkA.digest,
        foundations.benchmarkB.digest,
      ].map((selector) => [selector, [{
        comparisonId: 'experience-uplift',
        comparisonKind: 'experience_uplift' as const,
        baselineCellId: 'baseline',
        treatmentCellId: 'treatment',
        primaryMetric: 'success_rate' as const,
        confounders: [],
      }]])),
    }
    const result = await runEvaluationMatrix(
      store,
      plan,
      new FixtureDriver('recorded_run', (input) => input.cell.cellId === 'treatment' ? 'success' : 'agent_failure'),
    )

    expect(result.aggregate.benchmarkRefs).toHaveLength(2)
    expect(result.aggregate.comparisons).toEqual([])
    expect(result.observations
      .filter((observation) => observation.taskRef === foundations.benchmarkA.benchmarkId && observation.treatment === 'experience_applied')
      .every((observation) => observation.experienceRef?.digest === foundations.experienceObject.digest)).toBe(true)
    expect(result.observations
      .filter((observation) => observation.taskRef === foundations.benchmarkB.benchmarkId && observation.treatment === 'experience_applied')
      .every((observation) => observation.experienceRef?.digest === foundations.experienceObjectB.digest)).toBe(true)
    expect(result.benchmarkAggregates).toHaveLength(2)
    for (const aggregate of result.benchmarkAggregates) {
      expect(aggregate.benchmarkRefs).toHaveLength(1)
      expect(comparisonEvidenceDecision(aggregate, 'experience-uplift')).toMatchObject({
        maximumEvidenceLevel: 'H3',
        mode: 'causal',
      })
    }

    const mixed = aggregateExperiment(store, {
      experimentId: plan.experimentId,
      trialSelectors: result.trials.map((trial) => trial.digest),
      reliabilityK: plan.reliabilityK,
      confidenceLevel: plan.confidenceLevel,
      minValidTrialsPerCell: plan.minValidTrialsPerCell,
      excludedStatuses: plan.excludedStatuses,
      comparisons: plan.comparisonsByBenchmark[foundations.benchmarkA.digest]!,
    })
    expect(mixed.comparisons[0]?.counterfactualEligibility).toMatchObject({
      status: 'ineligible',
      reasonCodes: expect.arrayContaining(['MULTIPLE_BENCHMARKS_MIXED']),
    })
    expect(() => assertCausalClaimAllowed(mixed, 'experience-uplift')).toThrow('MULTIPLE_BENCHMARKS_MIXED')
    store.close()
  })

  it('retains every status category while excluding only preregistered non-outcome errors', async () => {
    const store = tempStore()
    const foundations = putFoundations(store)
    const statuses: TrialStatus[] = ['success', 'agent_failure', 'policy_refusal', 'infra_error', 'grader_error', 'aborted']
    const result = await runEvaluationMatrix(store, {
      experimentId: 'urn:aen:experiment:status-fixture',
      benchmarkSelectors: [foundations.benchmarkA.digest],
      cells: [{
        cellId: 'status-cell',
        treatment: 'alternative',
        model: model('model-a'),
        harnessConfigurationDigest: foundations.manifestX.configurationDigest,
        harnessManifestDigest: foundations.manifestX.digest,
      }],
      repetitions: statuses.length,
      reliabilityK: 2,
      confidenceLevel: 0.95,
      minValidTrialsPerCell: 1,
      excludedStatuses: ['infra_error', 'grader_error', 'aborted'],
      comparisons: [],
    }, new FixtureDriver('synthetic_test', (input) => statuses[input.trialIndex]!))
    expect(result.aggregate.statusCounts).toEqual({
      success: 1,
      agent_failure: 1,
      policy_refusal: 1,
      infra_error: 1,
      grader_error: 1,
      aborted: 1,
    })
    expect(result.aggregate.excludedTrialCounts).toEqual({ aborted: 1, grader_error: 1, infra_error: 1 })
    expect(result.aggregate.validTrials).toBe(3)
    expect(result.aggregate.perTrialSuccessRate?.estimate).toBeCloseTo(1 / 3)
    store.close()
  })

  it('rejects plans that exclude agent outcomes or reuse one Experience across multiple task families', () => {
    const base = {
      experimentId: 'urn:aen:experiment:invalid-plan',
      benchmarkSelectors: [`sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`],
      cells: [{
        cellId: 'treatment',
        treatment: 'experience_applied',
        model: model('model-a'),
        harnessConfigurationDigest: `sha256:${'9'.repeat(64)}`,
        harnessManifestDigest: `sha256:${'1'.repeat(64)}`,
        experienceRef: {
          experienceId: 'urn:aen:experience:wrong-scope',
          revision: 1,
          digest: `sha256:${'2'.repeat(64)}`,
        },
      }],
      repetitions: 2,
      reliabilityK: 1,
      confidenceLevel: 0.95,
      minValidTrialsPerCell: 1,
      excludedStatuses: ['infra_error', 'grader_error', 'aborted'],
      comparisons: [],
    }
    expect(() => parseEvaluationMatrixPlan(base)).toThrow('requires experienceRefsByBenchmark')
    expect(() => parseEvaluationMatrixPlan({
      ...base,
      benchmarkSelectors: [base.benchmarkSelectors[0]],
      excludedStatuses: ['agent_failure'],
    })).toThrow('agent outcomes must remain outcomes')
  })

  it('validates a frozen cross-user 2×2×2 Pilot without treating placeholders as evidence', () => {
    const store = tempStore()
    const foundations = putFoundations(store)
    const benchmarkSelectors = [foundations.benchmarkA.digest, foundations.benchmarkB.digest]
    const models = [model('model-a'), model('model-b')]
    const manifests = [foundations.manifestX, foundations.manifestY]
    const cells: MatrixCellPlan[] = []
    const comparisons = Object.fromEntries(benchmarkSelectors.map((selector) => [selector, [] as Array<{
      comparisonId: string
      comparisonKind: 'experience_uplift'
      baselineCellId: string
      treatmentCellId: string
      primaryMetric: 'success_rate'
      confounders: string[]
    }>]))
    for (const [modelIndex, modelObject] of models.entries()) {
      for (const [manifestIndex, manifestObject] of manifests.entries()) {
        const suffix = `${modelIndex}-${manifestIndex}`
        const baselineCellId = `baseline-${suffix}`
        const treatmentCellId = `treatment-${suffix}`
        cells.push({
          cellId: baselineCellId,
          treatment: 'baseline',
          model: modelObject,
          harnessConfigurationDigest: manifestObject.configurationDigest,
          harnessManifestDigest: manifestObject.digest,
        }, {
          cellId: treatmentCellId,
          treatment: 'experience_applied',
          model: modelObject,
          harnessConfigurationDigest: manifestObject.configurationDigest,
          harnessManifestDigest: manifestObject.digest,
          experienceRefsByBenchmark: {
            [foundations.benchmarkA.digest]: {
              experienceId: foundations.experienceObject.experienceId,
              revision: foundations.experienceObject.revision,
              digest: foundations.experienceObject.digest,
            },
            [foundations.benchmarkB.digest]: {
              experienceId: foundations.experienceObjectB.experienceId,
              revision: foundations.experienceObjectB.revision,
              digest: foundations.experienceObjectB.digest,
            },
          },
        })
        for (const selector of benchmarkSelectors) {
          comparisons[selector]!.push({
            comparisonId: `uplift-${suffix}`,
            comparisonKind: 'experience_uplift',
            baselineCellId,
            treatmentCellId,
            primaryMetric: 'success_rate',
            confounders: [],
          })
        }
      }
    }
    const preregistration = parsePilotPreregistration({
      profile: 'aen-mvp-pilot-preregistration-v0.1',
      status: 'frozen',
      frozenAt: TIME,
      reviewedCommit: 'a'.repeat(40),
      participants: [
        { participantId: 'urn:aen:participant:alice', role: 'publisher', localStoreBoundaryId: 'device-alice' },
        { participantId: 'urn:aen:participant:bob', role: 'consumer', localStoreBoundaryId: 'device-bob' },
        { participantId: 'urn:aen:participant:carol', role: 'evaluator', localStoreBoundaryId: 'device-carol' },
      ],
      publicHub: {
        url: 'https://pilot.aen.example',
        tls: true,
        monitoring: true,
        backups: true,
        keyRotation: true,
        incidentResponse: true,
      },
      execution: { driverMode: 'live', seedPolicy: 'commit+trial-index', stoppingRule: 'fixed_repetitions' },
      budget: { owner: 'urn:aen:actor:pilot-owner', currency: 'USD', maxTotalCostUsd: 100 },
      privacy: {
        rawTrace: 'local_only',
        publicContribution: 'reviewed_promotion_only',
        humanRedactionReview: true,
      },
      matrix: {
        experimentId: 'urn:aen:experiment:live-pilot',
        benchmarkSelectors,
        cells,
        repetitions: 2,
        reliabilityK: 1,
        confidenceLevel: 0.95,
        minValidTrialsPerCell: 2,
        excludedStatuses: ['infra_error', 'grader_error', 'aborted'],
        comparisons: [],
        comparisonsByBenchmark: comparisons,
      },
    })
    expect(validatePilotPreregistration(store, preregistration)).toEqual({
      ok: true,
      errors: [],
      summary: {
        participants: 3,
        benchmarks: 2,
        taskFamilies: 2,
        models: 2,
        harnessConfigurations: 2,
        matrixCells: 8,
        preregisteredComparisons: 8,
      },
    })
    const invalid = {
      ...preregistration,
      reviewedCommit: 'TBD',
      participants: preregistration.participants.map((participant) => ({
        ...participant,
        localStoreBoundaryId: 'shared-device',
      })),
    }
    expect(validatePilotPreregistration(store, invalid)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        'PLACEHOLDER_PRESENT: $.reviewedCommit',
        'REVIEWED_COMMIT_INVALID',
        'LOCAL_STORE_BOUNDARIES_NOT_ISOLATED',
      ]),
    })
    store.close()
  })
})
