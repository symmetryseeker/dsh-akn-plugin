import { createHash } from 'node:crypto'
import canonicalize from 'canonicalize'
import type { Digest, ObjectRef } from './components.js'
import { AexpError } from './errors.js'
import type { ProtocolObjectType } from './schemas.js'

const TOP_LEVEL_DIGEST_EXCLUSIONS = new Set([
  'digest',
  'attestation',
  'attestations',
  'signatures',
])

export type JsonRecord = Record<string, unknown>

export function assertJsonRecord(value: unknown): asserts value is JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AexpError('AEXP_SCHEMA_UNSUPPORTED', 'AEXP object must be a JSON object')
  }
}

export function digestContent(object: JsonRecord): JsonRecord {
  const content: JsonRecord = {}
  for (const [key, value] of Object.entries(object)) {
    if (!TOP_LEVEL_DIGEST_EXCLUSIONS.has(key)) {
      content[key] = value
    }
  }
  return content
}

export function canonicalJson(value: unknown): string {
  const result = canonicalize(value)
  if (result === undefined) {
    throw new AexpError('AEXP_SCHEMA_UNSUPPORTED', 'Value cannot be represented as canonical JSON')
  }
  return result
}

export function sha256(value: string | Uint8Array): Digest {
  const hash = createHash('sha256').update(value).digest('hex')
  return `sha256:${hash}`
}

export function computeObjectDigest(object: JsonRecord): Digest {
  return sha256(canonicalJson(digestContent(object)))
}

export function withComputedDigest<T extends JsonRecord>(object: T): T & { digest: Digest } {
  return { ...object, digest: computeObjectDigest(object) }
}

const identityFields: Record<ProtocolObjectType, { id: string; revision?: string }> = {
  attestation: { id: 'attestationId' },
  evidence_gap_report: { id: 'reportId' },
  task_episode: { id: 'episodeId' },
  trace_evidence: { id: 'evidenceId' },
  harness_manifest: { id: 'manifestId' },
  artifact: { id: 'artifactId' },
  observation: { id: 'observationId' },
  experience_revision: { id: 'experienceId', revision: 'revision' },
  promotion_record: { id: 'promotionId' },
  feedback: { id: 'feedbackId' },
  contention: { id: 'contentionId' },
  revocation: { id: 'revocationId' },
  grader_definition: { id: 'graderId', revision: 'revision' },
  benchmark_task: { id: 'benchmarkId', revision: 'revision' },
  evaluation_trial: { id: 'trialId' },
  evaluation_aggregate: { id: 'aggregateId' },
  task_capsule: { id: 'capsuleId' },
  experience_context_plan: { id: 'planId' },
  context_injection_observation: { id: 'injectionId' },
}

export function toObjectRef(object: JsonRecord, origin?: string): ObjectRef {
  const objectType = object.objectType
  if (typeof objectType !== 'string' || !(objectType in identityFields)) {
    throw new AexpError('AEXP_SCHEMA_UNSUPPORTED', 'Unknown protocol objectType')
  }
  const identity = identityFields[objectType as ProtocolObjectType]
  const refId = object[identity.id]
  const digest = object.digest
  if (typeof refId !== 'string' || typeof digest !== 'string') {
    throw new AexpError('AEXP_SCHEMA_UNSUPPORTED', 'Protocol object is missing identity or digest')
  }
  const revision = identity.revision === undefined ? undefined : object[identity.revision]
  if (revision !== undefined && (!Number.isInteger(revision) || Number(revision) < 1)) {
    throw new AexpError('AEXP_SCHEMA_UNSUPPORTED', 'Protocol object revision is invalid')
  }
  return {
    objectType,
    refId,
    ...(revision === undefined ? {} : { revision: Number(revision) }),
    digest: digest as Digest,
    ...(origin === undefined ? {} : { origin }),
  }
}
