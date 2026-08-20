import {
  canonicalJson,
  finalizeProtocolObject,
  sha256,
  toObjectRef,
  validateProtocolObject,
  type BenchmarkTask,
  type EvaluationTrial,
  type JsonRecord,
  type RunObservation,
} from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'
import { aggregateExperiment } from './aggregate.js'
import { factorialCoverage } from './coverage.js'
import {
  assertEvaluationMatrixPlanSemantics,
  comparisonsForBenchmark,
  resolveMatrixCellForBenchmark,
} from './plan.js'
import type {
  EvaluationDriver,
  EvaluationDriverResult,
  EvaluationMatrixPlan,
  EvaluationRunResult,
  MatrixCell,
} from './types.js'

function benchmark(store: LocalEvidenceStore, selector: string): BenchmarkTask {
  const inspected = store.inspect(selector)
  if (inspected === undefined || inspected.summary.objectType !== 'benchmark_task') {
    throw new Error(`benchmark_task not found: ${selector}`)
  }
  return inspected.object as unknown as BenchmarkTask
}

function sameModel(left: RunObservation['configurationCell']['model'], right: MatrixCell['model']): boolean {
  const { observedAt: _leftObserved, ...leftStable } = left
  const { observedAt: _rightObserved, ...rightStable } = right
  return canonicalJson(leftStable) === canonicalJson(rightStable)
}

function validateDriverResult(
  result: EvaluationDriverResult,
  input: { experimentId: string; benchmark: BenchmarkTask; cell: MatrixCell; trialIndex: number; attemptIndex: number },
  executionMode: EvaluationDriver['executionMode'],
): void {
  const validation = validateProtocolObject(result.observation)
  if (!validation.ok) throw new Error(`driver returned invalid RunObservation: ${validation.issues.map((issue) => issue.message).join('; ')}`)
  const observation = result.observation
  if (
    observation.experiment?.experimentId !== input.experimentId ||
    observation.experiment.cellId !== input.cell.cellId ||
    observation.experiment.trialIndex !== input.trialIndex ||
    observation.experiment.attemptIndex !== input.attemptIndex
  ) throw new Error('driver observation coordinates do not match the scheduled trial')
  if (observation.taskRef !== input.benchmark.benchmarkId) throw new Error('driver observation targets another benchmark')
  if (observation.treatment !== input.cell.treatment) throw new Error('driver observation treatment label disagrees with the cell')
  if (!sameModel(observation.configurationCell.model, input.cell.model)) throw new Error('driver changed the scheduled Model configuration')
  if (observation.configurationCell.harnessConfigurationDigest !== input.cell.harnessConfigurationDigest) {
    throw new Error('driver changed the scheduled Harness configuration')
  }
  if (input.cell.treatment === 'baseline' && observation.experienceRef !== undefined) {
    throw new Error('baseline observation unexpectedly references an Experience')
  }
  if (input.cell.experienceRef !== undefined && (
    observation.experienceRef?.experienceId !== input.cell.experienceRef.experienceId ||
    observation.experienceRef.revision !== input.cell.experienceRef.revision ||
    observation.experienceRef.digest !== input.cell.experienceRef.digest
  )) throw new Error('treatment observation does not reference the scheduled Experience')
  if (observation.extensions?.['https://aen.dev/extensions/aen/evaluation-execution-mode'] !== executionMode) {
    throw new Error('driver observation must declare the driver execution evidence mode')
  }
}

export async function runEvaluationMatrix(
  store: LocalEvidenceStore,
  plan: EvaluationMatrixPlan,
  driver: EvaluationDriver,
): Promise<EvaluationRunResult> {
  assertEvaluationMatrixPlanSemantics(plan)
  const benchmarks = plan.benchmarkSelectors.map((selector) => ({ selector, task: benchmark(store, selector) }))
  if (new Set(benchmarks.map(({ task }) => task.digest)).size !== benchmarks.length) {
    throw new Error('benchmarkSelectors resolve to duplicate BenchmarkTask revisions')
  }
  for (const cell of plan.cells) {
    const manifest = store.getByDigest(cell.harnessManifestDigest)
    if (manifest?.objectType !== 'harness_manifest') throw new Error(`HarnessManifest missing for cell ${cell.cellId}`)
    if (manifest.configurationDigest !== cell.harnessConfigurationDigest) {
      throw new Error(`representative HarnessManifest configuration mismatch for cell ${cell.cellId}`)
    }
    for (const { selector } of benchmarks) {
      const resolved = resolveMatrixCellForBenchmark(cell, selector)
      if (resolved.experienceRef !== undefined) {
        const experience = store.getByDigest(resolved.experienceRef.digest)
        if (
          experience?.objectType !== 'experience_revision' ||
          experience.experienceId !== resolved.experienceRef.experienceId ||
          experience.revision !== resolved.experienceRef.revision
        ) throw new Error(`ExperienceRevision missing or mismatched for cell ${cell.cellId} and benchmark ${selector}`)
      }
    }
  }
  const trials: EvaluationTrial[] = []
  const observations: RunObservation[] = []
  for (const { selector, task } of benchmarks) {
    for (const plannedCell of plan.cells) {
      const cell = resolveMatrixCellForBenchmark(plannedCell, selector)
      for (let trialIndex = 0; trialIndex < plan.repetitions; trialIndex += 1) {
        const input = {
          experimentId: plan.experimentId,
          benchmark: task,
          cell,
          trialIndex,
          attemptIndex: 0,
        }
        const result = await driver.run(input)
        validateDriverResult(result, input, driver.executionMode)
        const observation = result.observation
        store.putBatch({ objects: [
          ...(result.transcript === undefined ? [] : [{ object: result.transcript as unknown as JsonRecord, role: 'evaluation_transcript' }]),
          { object: observation as unknown as JsonRecord, role: 'evaluation_observation' },
        ] })
        const trial = finalizeProtocolObject<EvaluationTrial>({
          protocolVersion: '0.1',
          objectType: 'evaluation_trial',
          trialId: `urn:aen:evaluation:trial:${sha256(canonicalJson({
            experimentId: plan.experimentId,
            benchmark: task.digest,
            cell: cell.cellId,
            trialIndex,
            attemptIndex: 0,
          })).slice(7, 31)}`,
          experimentId: plan.experimentId,
          benchmarkRef: toObjectRef(task as unknown as JsonRecord),
          cellId: cell.cellId,
          runObservationRef: toObjectRef(observation as unknown as JsonRecord),
          ...(result.transcript === undefined ? {} : {
            transcriptRef: toObjectRef(result.transcript as unknown as JsonRecord),
          }),
          attemptIndex: 0,
          trialIndex,
          status: result.status,
          graderResults: result.graderResults,
          extensions: {
            'https://aen.dev/extensions/aen/evaluation-driver': driver.name,
            'https://aen.dev/extensions/aen/evaluation-execution-mode': driver.executionMode,
          },
        })
        store.putBatch({ objects: [{ object: trial as unknown as JsonRecord, role: 'evaluation_trial' }] })
        trials.push(trial)
        observations.push(observation)
      }
    }
  }
  const aggregateOptions = {
    experimentId: plan.experimentId,
    reliabilityK: plan.reliabilityK,
    confidenceLevel: plan.confidenceLevel,
    minValidTrialsPerCell: plan.minValidTrialsPerCell,
    excludedStatuses: plan.excludedStatuses,
  }
  const benchmarkAggregates = benchmarks.map(({ selector, task }) => aggregateExperiment(store, {
    ...aggregateOptions,
    trialSelectors: trials
      .filter((trial) => trial.benchmarkRef.digest === task.digest)
      .map((trial) => trial.digest),
    comparisons: comparisonsForBenchmark(plan, selector),
  }))
  const aggregate = benchmarkAggregates.length === 1
    ? benchmarkAggregates[0]!
    : aggregateExperiment(store, {
        ...aggregateOptions,
        trialSelectors: trials.map((trial) => trial.digest),
        // A cross-task portfolio is descriptive only. Per-Benchmark aggregates
        // above retain the preregistered comparisons and H3 eligibility gates.
        comparisons: [],
      })
  return {
    trials,
    observations,
    benchmarkAggregates,
    aggregate,
    coverage: factorialCoverage(store, trials),
  }
}
