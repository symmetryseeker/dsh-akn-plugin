import { createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { TSchema } from '@sinclair/typebox'
import {
  apiPayloadSchemas,
  createAttestation,
  computeObjectDigest,
  protocolObjectSchemas,
  toObjectRef,
  validateProtocolObject,
  type JsonRecord,
  type Digest,
  type NodeKeyPair,
} from './index.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SCHEMA_DIR = `${ROOT}schemas/aexp/0.1`
const VALID_DIR = `${ROOT}conformance/valid`
const INVALID_DIR = `${ROOT}conformance/invalid`
const GOLDEN_DIR = `${ROOT}conformance/golden-digests`
const KEY_DIR = `${ROOT}conformance/keys`

const FIXTURE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIPBPjFtOIOCSQkvhx35BTPNuZjU3yEg5IC0lz6K4k6hg
-----END PRIVATE KEY-----
`
const FIXTURE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEApjjU2/5GO3lRtrpaRkUqn8tiggrYUZIqI71HVXpFee0=
-----END PUBLIC KEY-----
`
const FIXTURE_KEY_ID = 'https://aen.dev/conformance/keys/fixture-ed25519'
const FIXTURE_ACTOR = { actorId: 'https://aen.dev/conformance/actors/fixture-node', type: 'node' as const }
const FIXTURE_TIME = '2026-08-19T00:00:00Z'
const ZERO_DIGEST: Digest = `sha256:${'0'.repeat(64)}`

function fixtureKey(): NodeKeyPair {
  return {
    keyid: FIXTURE_KEY_ID,
    privateKey: createPrivateKey(FIXTURE_PRIVATE_KEY),
    publicKey: createPublicKey(FIXTURE_PUBLIC_KEY),
  }
}

function valueFromSchema(schema: TSchema): unknown {
  if ('const' in schema) return schema.const
  if ('enum' in schema && Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if ('anyOf' in schema && Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return valueFromSchema(schema.anyOf[0] as TSchema)
  }
  if ('allOf' in schema && Array.isArray(schema.allOf)) {
    return Object.assign({}, ...schema.allOf.map((part) => valueFromSchema(part as TSchema)))
  }

  switch (schema.type) {
    case 'null':
      return null
    case 'boolean':
      return false
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 0
    case 'string': {
      if (schema.format === 'date-time') return FIXTURE_TIME
      if (schema.format === 'uri') return 'https://aen.dev/conformance/value'
      if (schema.contentEncoding === 'base64') return Buffer.from('fixture').toString('base64')
      if (schema.pattern === '^sha256:[0-9a-f]{64}$') return ZERO_DIGEST
      if (schema.pattern === '^[0-9a-f]{64}$') return '0'.repeat(64)
      return 'x'.repeat(Math.max(1, Number(schema.minLength ?? 1)))
    }
    case 'array': {
      const count = Math.max(0, Number(schema.minItems ?? 0))
      return Array.from({ length: count }, () => valueFromSchema(schema.items as TSchema))
    }
    case 'object': {
      const result: JsonRecord = {}
      const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
      const properties = (schema.properties ?? {}) as Record<string, TSchema>
      for (const [name, propertySchema] of Object.entries(properties)) {
        if (required.has(name)) result[name] = valueFromSchema(propertySchema)
      }
      return result
    }
    default:
      return null
  }
}

function signedAttestation(subject = { objectType: 'artifact', refId: 'fixture-subject', digest: ZERO_DIGEST }) {
  return createAttestation({
    attestationId: 'att_fixture',
    subject,
    issuer: FIXTURE_ACTOR,
    issuedAt: FIXTURE_TIME,
    role: 'conformance-fixture',
    scope: ['public'],
    key: fixtureKey(),
  })
}

function protocolFixture(objectType: keyof typeof protocolObjectSchemas): JsonRecord {
  if (objectType === 'attestation') return signedAttestation() as unknown as JsonRecord

  const generated = valueFromSchema(protocolObjectSchemas[objectType]) as JsonRecord
  delete generated.digest
  delete generated.attestation
  delete generated.attestations
  const complete: JsonRecord = { ...generated, digest: computeObjectDigest(generated) }

  if (objectType === 'promotion_record' || objectType === 'revocation') {
    complete.attestation = signedAttestation(toObjectRef(complete))
  }

  const validation = validateProtocolObject(complete)
  if (!validation.ok) {
    throw new Error(`Generated ${objectType} fixture is invalid: ${JSON.stringify(validation.issues)}`)
  }
  return complete
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function resetGeneratedDirectories(): Promise<void> {
  for (const directory of [SCHEMA_DIR, VALID_DIR, INVALID_DIR, GOLDEN_DIR, KEY_DIR]) {
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
  }
}

async function main(): Promise<void> {
  await resetGeneratedDirectories()
  const manifest: Array<{ name: string; id: unknown; kind: 'protocol_object' | 'api_payload' }> = []
  for (const [name, schema] of Object.entries(protocolObjectSchemas)) {
    await writeFile(`${SCHEMA_DIR}/${name}.schema.json`, pretty(schema), 'utf8')
    manifest.push({ name, id: schema.$id, kind: 'protocol_object' })
  }
  for (const [name, schema] of Object.entries(apiPayloadSchemas)) {
    await writeFile(`${SCHEMA_DIR}/${name}.schema.json`, pretty(schema), 'utf8')
    manifest.push({ name, id: schema.$id, kind: 'api_payload' })
  }
  await writeFile(`${SCHEMA_DIR}/manifest.json`, pretty({ protocolVersion: '0.1', schemas: manifest }), 'utf8')

  const golden: Record<string, string> = {}
  const fixtures = new Map<string, JsonRecord>()
  for (const objectType of Object.keys(protocolObjectSchemas) as Array<keyof typeof protocolObjectSchemas>) {
    const fixture = protocolFixture(objectType)
    fixtures.set(objectType, fixture)
    golden[objectType] = String(fixture.digest)
    await writeFile(`${VALID_DIR}/${objectType}.json`, pretty(fixture), 'utf8')

    const mismatched = structuredClone(fixture)
    mismatched.digest = ZERO_DIGEST
    if (mismatched.digest === fixture.digest) mismatched.digest = `sha256:${'1'.repeat(64)}`
    await writeFile(`${INVALID_DIR}/${objectType}-digest-mismatch.json`, pretty(mismatched), 'utf8')
  }

  const capabilityFixture = structuredClone(fixtures.get('task_episode')) as JsonRecord
  capabilityFixture.requiredCapabilities = ['https://aen.dev/capabilities/not-supported']
  capabilityFixture.digest = computeObjectDigest(capabilityFixture)
  await writeFile(`${INVALID_DIR}/required-capability-unsupported.json`, pretty(capabilityFixture), 'utf8')

  const tampered = structuredClone(fixtures.get('attestation')) as JsonRecord
  const envelope = tampered.envelope as JsonRecord
  envelope.payload = Buffer.from('{"tampered":true}', 'utf8').toString('base64')
  tampered.digest = computeObjectDigest(tampered)
  await writeFile(`${INVALID_DIR}/attestation-signature-tampered.json`, pretty(tampered), 'utf8')

  const legacyClaimEvidence = structuredClone(fixtures.get('experience_revision')) as JsonRecord
  const legacyClaim = (legacyClaimEvidence.claims as JsonRecord[])[0]!
  delete legacyClaim.supportingEvidenceRefs
  delete legacyClaim.contradictingEvidenceRefs
  legacyClaim.supportingObservationIds = ['unresolvable-id']
  legacyClaim.contradictingObservationIds = []
  legacyClaimEvidence.digest = computeObjectDigest(legacyClaimEvidence)
  await writeFile(
    `${INVALID_DIR}/experience-revision-unresolvable-legacy-claim-evidence.json`,
    pretty(legacyClaimEvidence),
    'utf8',
  )

  const inlineCaseRef = structuredClone(fixtures.get('experience_revision')) as JsonRecord
  const caseClaim = (inlineCaseRef.claims as JsonRecord[])[0]!
  caseClaim.supportingEvidenceRefs = [{
    objectType: 'case',
    refId: 'inline-case-without-protocol-object',
    digest: ZERO_DIGEST,
  }]
  inlineCaseRef.digest = computeObjectDigest(inlineCaseRef)
  await writeFile(
    `${INVALID_DIR}/experience-revision-inline-case-object-ref.json`,
    pretty(inlineCaseRef),
    'utf8',
  )

  await writeFile(`${GOLDEN_DIR}/aexp-0.1.json`, pretty(golden), 'utf8')
  await writeFile(`${KEY_DIR}/fixture-ed25519-public.pem`, FIXTURE_PUBLIC_KEY, 'utf8')
  await writeFile(
    `${KEY_DIR}/fixture-subject.json`,
    pretty({ objectType: 'artifact', refId: 'fixture-subject', digest: ZERO_DIGEST }),
    'utf8',
  )
  process.stdout.write(`Generated ${manifest.length} schemas and ${fixtures.size} protocol fixtures.\n`)
}

await main()
