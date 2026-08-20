import {
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from 'node:crypto'
import type { ActorRef, Attestation, JsonValue, ObjectRef } from './components.js'
import { canonicalJson, computeObjectDigest, sha256, type JsonRecord } from './digest.js'
import { AexpError } from './errors.js'
import { validateInTotoStatement, validateProtocolObject } from './validation.js'

const PAYLOAD_TYPE = 'application/vnd.in-toto+json' as const
const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1' as const
const DEFAULT_PREDICATE_TYPE = 'https://aen.dev/attestations/object/v0.1'

export interface NodeKeyPair {
  keyid: string
  publicKey: KeyObject
  privateKey: KeyObject
}

export interface AttestationPredicate {
  issuer: ActorRef
  issuedAt: string
  role: string
  scope: JsonValue
}

export interface CreateAttestationInput {
  attestationId: string
  subject: ObjectRef
  issuer: ActorRef
  issuedAt: string
  role: string
  scope: JsonValue
  key: NodeKeyPair
  predicateType?: string
  expiresAt?: string
}

export interface VerifyAttestationOptions {
  expectedSubject?: ObjectRef
  resolveKey: (keyid: string) => KeyObject | undefined
  now?: Date
}

export interface AttestationVerification {
  ok: boolean
  errors: string[]
  statement?: JsonRecord
  verifiedKeyIds: string[]
}

export function generateNodeKeyPair(keyid: string): NodeKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { keyid, publicKey, privateKey }
}

export function dssePreAuthEncoding(payloadType: string, payload: Uint8Array): Buffer {
  const typeBytes = Buffer.from(payloadType, 'utf8')
  const payloadBytes = Buffer.from(payload)
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${typeBytes.byteLength} `, 'utf8'),
    typeBytes,
    Buffer.from(` ${payloadBytes.byteLength} `, 'utf8'),
    payloadBytes,
  ])
}

function subjectName(subject: ObjectRef): string {
  const revision = subject.revision === undefined ? '' : `@${subject.revision}`
  return `${subject.objectType}:${subject.refId}${revision}`
}

function digestHex(digest: string): string {
  return digest.slice('sha256:'.length)
}

export function createAttestation(input: CreateAttestationInput): Attestation {
  const predicate: AttestationPredicate = {
    issuer: input.issuer,
    issuedAt: input.issuedAt,
    role: input.role,
    scope: input.scope,
  }
  const statement = {
    _type: STATEMENT_TYPE,
    subject: [
      {
        name: subjectName(input.subject),
        digest: { sha256: digestHex(input.subject.digest) },
      },
    ],
    predicateType: input.predicateType ?? DEFAULT_PREDICATE_TYPE,
    predicate,
  }
  const payload = Buffer.from(canonicalJson(statement), 'utf8')
  const signature = signBytes(null, dssePreAuthEncoding(PAYLOAD_TYPE, payload), input.key.privateKey)
  const candidate = {
    protocolVersion: '0.1' as const,
    objectType: 'attestation' as const,
    attestationId: input.attestationId,
    statementDigest: sha256(payload),
    envelope: {
      payloadType: PAYLOAD_TYPE,
      payload: payload.toString('base64'),
      signatures: [
        {
          keyid: input.key.keyid,
          sig: signature.toString('base64'),
          algorithm: 'Ed25519' as const,
        },
      ],
    },
    issuer: input.issuer,
    issuedAt: input.issuedAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  }
  const attestation = { ...candidate, digest: computeObjectDigest(candidate) }
  const validation = validateProtocolObject(attestation)
  if (!validation.ok) {
    throw new AexpError('AEXP_SCHEMA_UNSUPPORTED', 'Generated attestation is invalid', validation.issues)
  }
  return attestation as Attestation
}

function decodeCanonicalPayload(payload: string, errors: string[]): { bytes: Buffer; statement?: JsonRecord } {
  const bytes = Buffer.from(payload, 'base64')
  if (bytes.toString('base64') !== payload) {
    errors.push('DSSE payload is not canonical base64')
    return { bytes }
  }
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push('in-toto payload is not an object')
      return { bytes }
    }
    if (canonicalJson(parsed) !== bytes.toString('utf8')) {
      errors.push('in-toto payload is not RFC 8785 canonical JSON')
    }
    return { bytes, statement: parsed as JsonRecord }
  } catch {
    errors.push('DSSE payload is not valid JSON')
    return { bytes }
  }
}

export function verifyAttestation(
  attestation: unknown,
  options: VerifyAttestationOptions,
): AttestationVerification {
  const errors: string[] = []
  const verifiedKeyIds: string[] = []
  const validation = validateProtocolObject(attestation)
  if (!validation.ok) {
    errors.push(...validation.issues.map((issue) => `${issue.path}: ${issue.message}`))
    return { ok: false, errors, verifiedKeyIds }
  }
  const value = attestation as Attestation
  const { bytes, statement } = decodeCanonicalPayload(value.envelope.payload, errors)
  if (value.envelope.payloadType !== PAYLOAD_TYPE) errors.push('unsupported DSSE payload type')
  if (value.statementDigest !== sha256(bytes)) errors.push('statement digest mismatch')

  const pae = dssePreAuthEncoding(value.envelope.payloadType, bytes)
  for (const signature of value.envelope.signatures) {
    if (signature.algorithm !== undefined && signature.algorithm !== 'Ed25519') continue
    const key = options.resolveKey(signature.keyid)
    if (key === undefined) continue
    const decoded = Buffer.from(signature.sig, 'base64')
    if (decoded.toString('base64') !== signature.sig) continue
    if (verifyBytes(null, pae, key, decoded)) verifiedKeyIds.push(signature.keyid)
  }
  if (verifiedKeyIds.length === 0) errors.push('no authorized Ed25519 signature verified')

  if (statement !== undefined) {
    const statementValidation = validateInTotoStatement(statement)
    if (!statementValidation.ok) {
      errors.push(
        ...statementValidation.issues.map(
          (issue) => `invalid in-toto statement ${issue.path}: ${issue.message}`,
        ),
      )
    }
    if (statement._type !== STATEMENT_TYPE) errors.push('in-toto statement type mismatch')
    const predicate = statement.predicate
    if (predicate === null || typeof predicate !== 'object' || Array.isArray(predicate)) {
      errors.push('attestation predicate is invalid')
    } else {
      const predicateRecord = predicate as JsonRecord
      if (canonicalJson(predicateRecord.issuer) !== canonicalJson(value.issuer)) {
        errors.push('outer issuer does not match signed predicate')
      }
      if (predicateRecord.issuedAt !== value.issuedAt) {
        errors.push('outer issuedAt does not match signed predicate')
      }
    }
    if (options.expectedSubject !== undefined) {
      const subjects = statement.subject
      const expected = options.expectedSubject
      const matches =
        Array.isArray(subjects) &&
        subjects.some((subject) => {
          if (subject === null || typeof subject !== 'object' || Array.isArray(subject)) return false
          const subjectRecord = subject as JsonRecord
          const digest = subjectRecord.digest
          const digestRecord =
            digest !== null && typeof digest === 'object' && !Array.isArray(digest)
              ? (digest as JsonRecord)
              : undefined
          return (
            subjectRecord.name === subjectName(expected) &&
            digestRecord !== undefined &&
            digestRecord.sha256 === digestHex(expected.digest)
          )
        })
      if (!matches) errors.push('expected subject is not bound by the statement')
    }
  }

  if (value.expiresAt !== undefined && (options.now ?? new Date()) >= new Date(value.expiresAt)) {
    errors.push('attestation is expired')
  }
  return {
    ok: errors.length === 0,
    errors,
    ...(statement === undefined ? {} : { statement }),
    verifiedKeyIds,
  }
}
