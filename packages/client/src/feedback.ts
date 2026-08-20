import {
  canonicalJson,
  finalizeProtocolObject,
  sha256,
  type FeedbackEvent,
} from '@aen/protocol'
import type { FeedbackInput } from './types.js'

export function createFeedbackEvent(input: FeedbackInput): FeedbackEvent {
  if (input.decision === 'adopted') {
    if (input.injectionObservation === undefined) {
      throw new Error('adopted feedback requires a ContextInjectionObservation')
    }
    if (
      input.injectionObservation.experienceRef.experienceId !== input.experienceRef.experienceId ||
      input.injectionObservation.experienceRef.revision !== input.experienceRef.revision ||
      input.injectionObservation.experienceRef.digest !== input.experienceRef.digest
    ) throw new Error('feedback Experience ref does not match the injection observation')
    if (input.injectionObservation.injectedSections.length === 0) {
      throw new Error('adopted feedback requires at least one actually injected section')
    }
  }
  const createdAt = input.now ?? new Date().toISOString()
  return finalizeProtocolObject<FeedbackEvent>({
    protocolVersion: '0.1',
    objectType: 'feedback',
    feedbackId: `urn:aen:feedback:${sha256(canonicalJson({
      experienceRef: input.experienceRef,
      decision: input.decision,
      outcome: input.outcome,
      injection: input.injectionObservation?.digest,
      createdAt,
    })).slice(7, 31)}`,
    experienceRef: {
      experienceId: input.experienceRef.experienceId,
      revision: input.experienceRef.revision,
      digest: input.experienceRef.digest,
    },
    decision: input.decision,
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    reasonCodes: [
      ...(input.reasonCodes ?? []),
      ...(input.injectionObservation === undefined ? [] : [`context_injection:${input.injectionObservation.digest}`]),
    ],
    sharingScope: input.sharingScope ?? 'local',
    createdAt,
  })
}
