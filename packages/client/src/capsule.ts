import {
  canonicalJson,
  finalizeProtocolObject,
  sha256,
  type TaskCapsule,
} from '@aen/protocol'
import { assertNoRestrictedContent } from '@aen/promotion'
import type { TaskCapsuleInput } from './types.js'

export function createTaskCapsule(input: TaskCapsuleInput): TaskCapsule {
  if (input.taxonomy.length === 0) throw new Error('Task Capsule taxonomy must not be empty')
  if (input.omittedSensitiveFields.length === 0) {
    throw new Error('Task Capsule must explicitly record omitted sensitive fields')
  }
  const now = input.now ?? new Date().toISOString()
  const ttlSeconds = input.ttlSeconds ?? 300
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
    throw new Error('Task Capsule ttlSeconds must be 1-3600')
  }
  const expiresAt = new Date(Date.parse(now) + ttlSeconds * 1000).toISOString()
  const capsule = finalizeProtocolObject<TaskCapsule>({
    protocolVersion: '0.1',
    objectType: 'task_capsule',
    capsuleId: `urn:aen:task-capsule:${sha256(canonicalJson({
      taxonomy: input.taxonomy,
      abstractIntent: input.abstractIntent,
      constraints: input.constraints,
      acceptanceTraits: input.acceptanceTraits,
      now,
    })).slice(7, 31)}`,
    taxonomy: input.taxonomy,
    ...(input.abstractIntent === undefined ? {} : { abstractIntent: input.abstractIntent }),
    constraints: input.constraints,
    acceptanceTraits: input.acceptanceTraits,
    riskClass: input.riskClass,
    ...(input.modelSelector === undefined ? {} : { modelSelector: input.modelSelector }),
    ...(input.harnessCapabilities === undefined ? {} : { harnessCapabilities: input.harnessCapabilities }),
    ...(input.environmentTraits === undefined ? {} : { environmentTraits: input.environmentTraits }),
    omittedSensitiveFields: input.omittedSensitiveFields,
    expiresAt,
  })
  assertNoRestrictedContent(capsule, 'Task Capsule')
  return capsule
}
