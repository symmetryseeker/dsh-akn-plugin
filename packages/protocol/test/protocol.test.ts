import { createPublicKey } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  computeObjectDigest,
  createAttestation,
  generateNodeKeyPair,
  prepareProtocolObject,
  toObjectRef,
  validatePreDigestObject,
  validateInTotoStatement,
  validateApiPayload,
  validateProtocolObject,
  verifyAttestation,
  withComputedDigest,
  type JsonRecord,
  type ObjectRef,
} from '../src/index.js'

const ROOT = new URL('../../../', import.meta.url)

async function readJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(new URL(path, ROOT), 'utf8')) as JsonRecord
}

describe('AEXP 0.1 protocol schemas', () => {
  it('validates non-negative hard cost and latency search budgets', () => {
    const request = {
      query: 'recover',
      policy: { maxMeanCostUsd: 0.10, maxP95LatencyMs: 5_000 },
      responseBudget: { maxCards: 3 },
    }
    expect(validateApiPayload('search_request', request)).toMatchObject({ ok: true, issues: [] })
    expect(validateApiPayload('search_request', {
      ...request,
      policy: { maxMeanCostUsd: -1, maxP95LatencyMs: 5_000 },
    }).ok).toBe(false)
  })

  it('round-trips every generated protocol object fixture', async () => {
    const directory = new URL('conformance/valid/', ROOT)
    const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(19)
    for (const file of files) {
      const object = await readJson(`conformance/valid/${file}`)
      const result = validateProtocolObject(object)
      expect(result.issues, file).toEqual([])
      expect(result.ok, file).toBe(true)
      expect(JSON.parse(JSON.stringify(result.value))).toEqual(object)
    }
  })

  it('rejects every generated digest mismatch', async () => {
    const directory = new URL('conformance/invalid/', ROOT)
    const files = (await readdir(directory)).filter((name) => name.endsWith('-digest-mismatch.json')).sort()
    expect(files).toHaveLength(19)
    for (const file of files) {
      const result = validateProtocolObject(await readJson(`conformance/invalid/${file}`))
      expect(result.ok, file).toBe(false)
      expect(result.issues.some((issue) => issue.code === 'digest.mismatch'), file).toBe(true)
    }
  })

  it('fails closed for an unknown required protocol capability', async () => {
    const object = await readJson('conformance/invalid/required-capability-unsupported.json')
    const denied = validateProtocolObject(object)
    expect(denied.ok).toBe(false)
    expect(denied.issues).toContainEqual(
      expect.objectContaining({ code: 'capability.unsupported' }),
    )

    const allowed = validateProtocolObject(object, {
      supportedCapabilities: new Set(['https://aen.dev/capabilities/not-supported']),
    })
    expect(allowed.ok).toBe(true)
  })

  it('preserves unknown optional data without confusing it with a required capability', async () => {
    const object = await readJson('conformance/valid/task_capsule.json')
    object['futureOptionalField'] = { retained: true }
    object.extensions = { 'org.aen.conformance': { opaque: ['value'] } }
    object.digest = computeObjectDigest(object)
    const result = validateProtocolObject(object)
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(object)
  })

  it('supports strict pre-digest validation without weakening the published schema', async () => {
    const object = await readJson('conformance/valid/task_capsule.json')
    delete object.digest
    expect(validatePreDigestObject(object).ok).toBe(true)
    expect(validateProtocolObject(object).ok).toBe(false)
  })
})

describe('RFC 8785 digest profile', () => {
  it('is stable across key insertion order', () => {
    expect(computeObjectDigest({ b: 2, a: 1 })).toBe(computeObjectDigest({ a: 1, b: 2 }))
  })

  it('excludes only top-level signature fields and preserves nested business fields', () => {
    const base = { objectType: 'example', value: { digest: 'business-value' } }
    const digest = computeObjectDigest(base)
    expect(computeObjectDigest({ ...base, attestation: { untrusted: true } })).toBe(digest)
    expect(computeObjectDigest({ objectType: 'example', value: { digest: 'changed' } })).not.toBe(digest)
  })

  it('maps newly clarified evaluation identities to ObjectRef', async () => {
    const trial = await readJson('conformance/valid/evaluation_trial.json')
    expect(toObjectRef(trial)).toEqual({
      objectType: 'evaluation_trial',
      refId: trial.trialId,
      digest: trial.digest,
    })
  })

  it('rejects non-JSON programmatic values before Schema evaluation', async () => {
    const object = await readJson('conformance/valid/task_capsule.json')
    object.extensions = { 'org.aen.conformance': { invalid: BigInt(1) } as never }
    const result = validateProtocolObject(object, { verifyDigest: false })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'object.not_json' }))
  })

  it('rejects cyclic programmatic input without hanging', async () => {
    const cyclic = await readJson('conformance/valid/task_capsule.json')
    cyclic.self = cyclic
    const result = validateProtocolObject(cyclic)
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'object.not_json' }))
  })

  it('accepts a shared sibling reference that serializes as ordinary JSON', async () => {
    const object = await readJson('conformance/valid/task_capsule.json')
    const shared = { value: 'same-object' }
    object.extensions = { first: shared, second: shared }
    delete object.digest
    const result = validateProtocolObject(withComputedDigest(object))
    expect(result).toMatchObject({ ok: true, issues: [] })
  })

  it('enforces byte, depth, and array-item resource limits', async () => {
    const object = await readJson('conformance/valid/task_capsule.json')
    expect(validateProtocolObject(object, { limits: { maxBytes: 1 } }).issues).toContainEqual(
      expect.objectContaining({ code: 'object.too_large' }),
    )
    expect(validateProtocolObject(object, { limits: { maxDepth: 1 } }).issues).toContainEqual(
      expect.objectContaining({ code: 'object.too_deep' }),
    )
    expect(validateProtocolObject(object, { limits: { maxArrayItems: 0 } }).issues).toContainEqual(
      expect.objectContaining({ code: 'object.too_many_items' }),
    )
  })

  it('fails closed under deterministic hostile JSON mutations within a bounded validation time', async () => {
    const fixture = await readJson('conformance/valid/task_capsule.json')
    let state = 0xa3e1_9d27
    const random = (): number => {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      return state >>> 0
    }
    const cases: unknown[] = []
    for (let index = 0; index < 250; index += 1) {
      const value = structuredClone(fixture)
      const mode = random() % 7
      if (mode === 0) {
        const root: JsonRecord = {}
        let cursor = root
        for (let depth = 0; depth < 35 + (random() % 50); depth += 1) {
          const child: JsonRecord = {}
          cursor.child = child
          cursor = child
        }
        value.extensions = { fuzz: root }
      } else if (mode === 1) {
        value.extensions = { fuzz: 'x'.repeat(8_193 + (random() % 8_192)) }
      } else if (mode === 2) {
        value.taxonomy = Array.from({ length: 129 + (random() % 256) }, (_, item) => `family-${item}`)
      } else if (mode === 3) {
        value.extensions = { fuzz: [Number.NaN, Number.POSITIVE_INFINITY, BigInt(index)] as never }
      } else if (mode === 4) {
        value.requiredCapabilities = Array.from({ length: 129 + (random() % 100) }, (_, item) => `https://invalid.example/capability/${item}`)
      } else if (mode === 5) {
        const cyclic: JsonRecord = {}
        cyclic.self = cyclic
        value.extensions = { fuzz: cyclic }
      } else {
        value.digest = `sha256:${(random() % 16).toString(16).repeat(64)}`
      }
      cases.push(value)
    }
    const started = performance.now()
    const results = cases.map((value) => validateProtocolObject(value, {
      limits: { maxBytes: 8_192, maxDepth: 32, maxArrayItems: 128 },
    }))
    const elapsedMs = performance.now() - started
    expect(results).toHaveLength(250)
    expect(results.every((result) => !result.ok && result.issues.length > 0)).toBe(true)
    expect(elapsedMs).toBeLessThan(3_000)
  })
})

describe('in-toto Statement v1 + DSSE Ed25519 profile', () => {
  it('constructs a required-attestation object only through prepare, sign, and final validation', async () => {
    const source = await readJson('conformance/valid/revocation.json')
    delete source.digest
    delete source.attestation
    const prepared = prepareProtocolObject<JsonRecord>(source)
    expect(validateProtocolObject(prepared).ok).toBe(false)
    const key = generateNodeKeyPair('https://aen.dev/test/revocation-key')
    const actor = prepared.actor as { actorId: string; type: 'human' }
    const attestation = createAttestation({
      attestationId: 'urn:aen:attestation:prepared-revocation',
      subject: toObjectRef(prepared),
      issuer: actor,
      issuedAt: String(prepared.createdAt),
      role: 'public-revocation',
      scope: ['public'],
      key,
    })
    expect(validateProtocolObject({ ...prepared, attestation })).toMatchObject({ ok: true, issues: [] })
  })

  it('validates the decoded in-toto payload as a Statement v1 object', () => {
    expect(
      validateInTotoStatement({
        _type: 'https://in-toto.io/Statement/v1',
        subject: [{ name: 'artifact:x', digest: { sha256: '0'.repeat(64) } }],
        predicate: {},
      }).ok,
    ).toBe(false)
  })

  it('verifies the golden attestation and rejects a signed-payload mutation', async () => {
    const publicKey = createPublicKey(await readFile(new URL('conformance/keys/fixture-ed25519-public.pem', ROOT), 'utf8'))
    const subject = await readJson('conformance/keys/fixture-subject.json')
    const resolveKey = (keyid: string) =>
      keyid === 'https://aen.dev/conformance/keys/fixture-ed25519' ? publicKey : undefined

    const valid = await readJson('conformance/valid/attestation.json')
    expect(
      verifyAttestation(valid, { expectedSubject: subject as unknown as ObjectRef, resolveKey }),
    ).toMatchObject({ ok: true, errors: [] })

    const tampered = await readJson('conformance/invalid/attestation-signature-tampered.json')
    expect(validateProtocolObject(tampered).ok).toBe(true)
    const verification = verifyAttestation(tampered, {
      expectedSubject: subject as unknown as ObjectRef,
      resolveKey,
    })
    expect(verification.ok).toBe(false)
    expect(verification.errors).toContain('no authorized Ed25519 signature verified')
  })

  it('rejects an outer issuer projection that differs from the signed predicate', async () => {
    const publicKey = createPublicKey(await readFile(new URL('conformance/keys/fixture-ed25519-public.pem', ROOT), 'utf8'))
    const valid = await readJson('conformance/valid/attestation.json')
    valid.issuer = { actorId: 'https://attacker.example/node', type: 'node' }
    valid.digest = computeObjectDigest(valid)
    const verification = verifyAttestation(valid, { resolveKey: () => publicKey })
    expect(verification.ok).toBe(false)
    expect(verification.errors).toContain('outer issuer does not match signed predicate')
  })

  it('binds the signature to the target object digest rather than its mutable ID', async () => {
    const artifact = await readJson('conformance/valid/artifact.json')
    const originalRef = toObjectRef(artifact)
    const key = generateNodeKeyPair('https://aen.dev/test/key')
    const attestation = createAttestation({
      attestationId: 'att_target_binding',
      subject: originalRef,
      issuer: { actorId: 'https://aen.dev/test/node', type: 'node' },
      issuedAt: '2026-08-19T00:00:00Z',
      role: 'publisher',
      scope: ['public'],
      key,
    })
    expect(
      verifyAttestation(attestation, {
        expectedSubject: originalRef,
        resolveKey: () => key.publicKey,
      }).ok,
    ).toBe(true)

    artifact.name = 'mutated artifact'
    artifact.digest = computeObjectDigest(artifact)
    expect(
      verifyAttestation(attestation, {
        expectedSubject: toObjectRef(artifact),
        resolveKey: () => key.publicKey,
      }).ok,
    ).toBe(false)
  })
})
