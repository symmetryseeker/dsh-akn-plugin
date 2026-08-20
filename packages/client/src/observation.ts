import {
  finalizeProtocolObject,
  toObjectRef,
  type JsonRecord,
  type RunObservation,
} from '@aen/protocol'
import type { ConsumptionObservationInput } from './types.js'

export function createConsumptionObservation(input: ConsumptionObservationInput): RunObservation {
  const injected = input.injectionObservation
  if (
    injected.experienceRef.experienceId !== input.experienceRef.experienceId ||
    injected.experienceRef.revision !== input.experienceRef.revision ||
    injected.experienceRef.digest !== input.experienceRef.digest
  ) throw new Error('consumption observation Experience ref does not match injection observation')
  if (injected.injectedSections.length === 0) throw new Error('consumption observation requires actual injected sections')
  return finalizeProtocolObject<RunObservation>({
    protocolVersion: '0.1',
    objectType: 'observation',
    observationId: input.observationId,
    experienceRef: {
      experienceId: input.experienceRef.experienceId,
      revision: input.experienceRef.revision,
      digest: input.experienceRef.digest,
    },
    taskRef: input.taskRef,
    evaluatorRef: input.evaluatorRef,
    configurationCell: input.configurationCell,
    treatment: 'experience_applied',
    outcome: input.outcome,
    acceptanceResults: input.acceptanceResults,
    metrics: input.metrics,
    ...(input.failureType === undefined ? {} : { failureType: input.failureType }),
    evidenceRefs: input.evidenceRefs ?? [],
    contextInjectionRefs: [toObjectRef(injected as unknown as JsonRecord)],
    independence: input.independence,
    createdAt: input.createdAt ?? new Date().toISOString(),
    extensions: {
      'https://aen.dev/extensions/aen/applied-experience-digest': input.experienceRef.digest,
      'https://aen.dev/extensions/aen/measurement-boundary': 'post-context-injection',
    },
  })
}
