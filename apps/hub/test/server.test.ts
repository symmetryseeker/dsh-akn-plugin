import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { PostgresHubProjection } from '@aen/hub'
import { createHubServer } from '../src/server.js'
import { APP_JS, INDEX_HTML } from '../src/web.js'

const servers: ReturnType<typeof createHubServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

function projection(): PostgresHubProjection {
  return {
    search: async () => [{
      experienceId: 'urn:aen:experience:test',
      revision: 2,
      digest: `sha256:${'1'.repeat(64)}`,
      title: 'Recover after a failed tool call',
      summary: 'A signed observational recovery boundary.',
      taskFamilies: ['software-engineering', 'failure-recovery'],
      maxEvidenceLevel: 'H1',
      compatibility: 'exact',
      intendedUseSummary: ['recover safely'],
      outOfScopeSummary: [],
      knownFailureSummary: [],
      positiveCaseSummary: 'recovered',
      negativeCaseSummary: 'failed',
      safetyLabels: ['untrusted'],
      sourceSummary: 'signed publisher',
      availableSections: ['card'],
      scoreExplanation: ['exact compatibility'],
      blocked: false,
    }],
    getExperience: async () => undefined,
    getObject: async () => undefined,
    exportObjects: async () => [],
    appendFeedback: async () => undefined,
    emergencyBlock: async () => undefined,
    applyRevocation: async () => undefined,
    listContentions: async () => [],
    resolveExperienceRevision: async () => undefined,
    getExperienceRevision: async () => undefined,
    listExperienceRevisions: async () => [],
    status: async () => ({ objects: 0, experiences: 0, latestExperiences: 0, revocations: 0 }),
  } as unknown as PostgresHubProjection
}

async function origin(server: ReturnType<typeof createHubServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

describe('Reference Hub Web/API', () => {
  it('serves a meaningful read-only search surface with strict browser policy', async () => {
    expect(() => new Function(APP_JS)).not.toThrow()
    expect(INDEX_HTML).toContain('MODEL × HARNESS EXPERIENCE')
    expect(INDEX_HTML).toContain('AEXP 0.1 Draft · Pilot Hub')
    expect(INDEX_HTML).toContain('Minimum evidence')
    expect(INDEX_HTML).toContain('Harness configuration digest')
    expect(INDEX_HTML).toContain('Exact Manifest snapshot digest')
    expect(INDEX_HTML).toContain('Max mean cost (USD)')
    expect(INDEX_HTML).toContain('Max p95 latency (ms)')
    expect(APP_JS).toContain('Evidence boundary — what this proves / does not prove')
    expect(APP_JS).toContain('Model × Harness surface coverage')
    expect(APP_JS).toContain("['harness-config','harnessConfigurationDigest']")
    expect(APP_JS).toContain("['harness-snapshot','harnessManifestDigest']")
    const server = createHubServer(projection())
    servers.push(server)
    const base = await origin(server)
    const page = await fetch(base)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    const html = await page.text()
    expect(html).toContain('Reuse the lesson.')
    expect(html).toContain('AEN Draft/Pilot Reference Implementation')
    const result = await fetch(`${base}/v1/experiences?q=recovery`)
    expect(await result.json()).toMatchObject({ cards: [{ maxEvidenceLevel: 'H1', blocked: false }] })
  })

  it('protects emergency moderation endpoints with an explicit bearer token', async () => {
    const server = createHubServer(projection(), { adminToken: 'test-admin-token' })
    servers.push(server)
    const base = await origin(server)
    const denied = await fetch(`${base}/admin/emergency-block`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ digest: `sha256:${'1'.repeat(64)}`, reasonCode: 'secret_leak' }),
    })
    expect(denied.status).toBe(401)
    const accepted = await fetch(`${base}/admin/emergency-block`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-admin-token' },
      body: JSON.stringify({ digest: `sha256:${'1'.repeat(64)}`, reasonCode: 'secret_leak' }),
    })
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({ blocked: true, reasonCode: 'secret_leak' })
  })

  it('rejects an oversized request body before invoking the projection', async () => {
    const fake = projection()
    let appended = false
    fake.appendFeedback = async () => { appended = true }
    const server = createHubServer(fake, { maxBodyBytes: 64 })
    servers.push(server)
    const base = await origin(server)
    const response = await fetch(`${base}/v1/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(128) }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('exceeds 64 bytes') })
    expect(appended).toBe(false)
  })

  it('serves the canonical MVP read paths and forwards SearchRequest hard-policy fields', async () => {
    const fake = projection()
    let received: unknown
    fake.search = async (query) => { received = query; return [] }
    fake.getExperience = async () => ({
      protocolVersion: '0.1', objectType: 'experience_revision', experienceId: 'urn:aen:experience:test',
      revision: 2, digest: `sha256:${'1'.repeat(64)}`,
    })
    fake.listExperienceRevisions = async () => [{
      protocolVersion: '0.1', objectType: 'experience_revision', experienceId: 'urn:aen:experience:test',
      revision: 2, digest: `sha256:${'1'.repeat(64)}`,
    }]
    fake.getObject = async (digest) => ({
      protocolVersion: '0.1', objectType: 'harness_manifest', manifestId: 'urn:aen:manifest:test', digest,
    })
    const server = createHubServer(fake)
    servers.push(server)
    const base = await origin(server)
    const health = await (await fetch(`${base}/health`)).json() as { protocol: string; projection: unknown }
    expect(health).toMatchObject({ protocol: 'AEXP 0.1 Draft', projection: { objects: 0 } })
    expect((await fetch(`${base}/v1/experiences/${encodeURIComponent('urn:aen:experience:test')}`)).status).toBe(200)
    expect((await fetch(`${base}/v1/experiences/${encodeURIComponent('urn:aen:experience:test')}/revisions`)).status).toBe(200)
    expect((await fetch(`${base}/v1/manifests/${encodeURIComponent(`sha256:${'2'.repeat(64)}`)}`)).status).toBe(200)
    const response = await fetch(`${base}/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'recovery',
        task: { taxonomy: ['failure-recovery'], riskClass: 'reversible_write' },
        context: {
          model: {
            provider: 'deepseek', modelId: 'deepseek-reasoner',
            observedAt: '2026-08-20T00:00:00Z', mutability: 'versioned',
          },
          harnessConfigurationDigest: `sha256:${'3'.repeat(64)}`,
          harnessManifestDigest: `sha256:${'4'.repeat(64)}`,
        },
        policy: {
          allowedLicenses: ['CC-BY-4.0'], minEvidenceLevel: 'H1', maxRiskClass: 'reversible_write',
          maxMeanCostUsd: 0.10, maxP95LatencyMs: 5_000,
        },
        responseBudget: { maxCards: 3 },
      }),
    })
    expect(response.status).toBe(200)
    expect(received).toMatchObject({
      query: 'recovery', taskFamilies: ['failure-recovery'], allowedLicenses: ['CC-BY-4.0'],
      modelProvider: 'deepseek', modelId: 'deepseek-reasoner',
      harnessConfigurationDigest: `sha256:${'3'.repeat(64)}`,
      harnessManifestDigest: `sha256:${'4'.repeat(64)}`,
      minEvidenceLevel: 'H1', maxRiskClass: 'reversible_write',
      maxMeanCostUsd: 0.10, maxP95LatencyMs: 5_000, limit: 3,
    })
  })
})
