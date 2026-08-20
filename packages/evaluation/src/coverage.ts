import { canonicalJson, type BenchmarkTask, type EvaluationTrial, type RunObservation } from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'
import type { FactorialCoverageReport } from './types.js'

export function factorialCoverage(
  store: LocalEvidenceStore,
  trials: EvaluationTrial[],
): FactorialCoverageReport {
  const models = new Set<string>()
  const harnesses = new Set<string>()
  const taskFamilies = new Set<string>()
  const combinations = new Map<string, Set<string>>()
  for (const trial of trials) {
    const observation = store.getByDigest(trial.runObservationRef.digest) as unknown as RunObservation | undefined
    const benchmark = store.getByDigest(trial.benchmarkRef.digest) as unknown as BenchmarkTask | undefined
    if (observation === undefined || benchmark === undefined) continue
    const { observedAt: _observedAt, ...model } = observation.configurationCell.model
    const modelKey = canonicalJson(model)
    const harnessKey = observation.configurationCell.harnessConfigurationDigest
    models.add(modelKey)
    harnesses.add(harnessKey)
    const family = benchmark.task.taxonomy[0] ?? benchmark.benchmarkId
    taskFamilies.add(family)
    const values = combinations.get(family) ?? new Set<string>()
    values.add(`${modelKey}\n${harnessKey}`)
    combinations.set(family, values)
  }
  const expected = models.size * harnesses.size
  const missing: string[] = []
  for (const family of [...taskFamilies].sort()) {
    const actual = combinations.get(family)?.size ?? 0
    if (actual < expected) missing.push(`${family}: observed ${actual}/${expected} Model × Harness combinations`)
  }
  if (models.size < 2) missing.push(`only ${models.size} distinct Model configurations observed`)
  if (harnesses.size < 2) missing.push(`only ${harnesses.size} distinct Harness configurations observed`)
  if (taskFamilies.size < 2) missing.push(`only ${taskFamilies.size} task families observed`)
  return {
    taskFamilies: [...taskFamilies].sort(),
    modelConfigurations: [...models].sort(),
    harnessConfigurations: [...harnesses].sort(),
    expectedCombinationsPerTask: expected,
    observedCombinationsByTask: Object.fromEntries(
      [...combinations.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, [...value].sort()]),
    ),
    completeTwoByTwoByTwo: models.size >= 2 && harnesses.size >= 2 && taskFamilies.size >= 2 && missing.length === 0,
    missing,
  }
}
