import {
  canonicalJson,
  createAttestation,
  prepareProtocolObject,
  sha256,
  toObjectRef,
  validateProtocolObject,
  type Attestation,
  type JsonRecord,
  type Revocation,
} from '@aen/protocol'
import type { CreateRevocationOptions } from './types.js'

export interface RevocationContribution {
  revocation: Revocation
  attestation: Attestation
  contributionObjects: JsonRecord[]
}

export function createRevocationContribution(
  target: JsonRecord,
  options: CreateRevocationOptions,
): RevocationContribution {
  const targetValidation = validateProtocolObject(target)
  if (!targetValidation.ok) throw new Error('revocation target must be a valid AEXP object')
  const targetRef = toObjectRef(target)
  const createdAt = options.createdAt ?? new Date().toISOString()
  const affectedDigests = options.affectedDigests ?? [targetRef.digest]
  if (!affectedDigests.includes(targetRef.digest)) {
    throw new Error('affectedDigests must include the target digest')
  }
  const unsigned = prepareProtocolObject<Revocation>({
    protocolVersion: '0.1',
    objectType: 'revocation',
    revocationId: `urn:aen:revocation:${sha256(canonicalJson({
      target: targetRef,
      reasonCode: options.reasonCode,
      actor: options.actor.actorId,
      createdAt,
    })).slice(7, 31)}`,
    target: targetRef,
    reasonCode: options.reasonCode,
    scope: options.scope ?? 'revision',
    severity: options.severity ?? (options.reasonCode === 'secret_leak' ? 'critical' : 'urgent'),
    affectedDigests,
    createdAt,
    actor: options.actor,
  })
  const attestation = createAttestation({
    attestationId: `urn:aen:attestation:revocation:${unsigned.digest.slice(7, 31)}`,
    subject: toObjectRef(unsigned as unknown as JsonRecord),
    issuer: options.actor,
    issuedAt: createdAt,
    role: 'public-revocation',
    scope: ['public'],
    key: options.key,
  })
  const revocation = { ...unsigned, attestation }
  const validation = validateProtocolObject(revocation)
  if (!validation.ok) {
    throw new Error(`signed revocation is invalid: ${validation.issues.map((issue) => issue.message).join('; ')}`)
  }
  return {
    revocation: revocation as Revocation,
    attestation,
    contributionObjects: [revocation as unknown as JsonRecord],
  }
}
