import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { finalizeProtocolObject, withComputedDigest, type JsonRecord } from '@aen/protocol'
import { LocalEvidenceStore, fetchExperienceSections, searchLocalExperiences } from '../src/index.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempStore(): LocalEvidenceStore {
  const directory = mkdtempSync(join(tmpdir(), 'aen-local-store-'))
  directories.push(directory)
  return new LocalEvidenceStore(join(directory, 'evidence.sqlite'))
}

function gap(): JsonRecord {
  return withComputedDigest({
    protocolVersion: '0.1',
    objectType: 'evidence_gap_report',
    reportId: 'gap:test',
    episodeId: 'episode:test',
    missing: [],
    conflicts: [],
    maximumEvidenceLevel: 'H1',
    generatedAt: '2026-08-19T00:00:00Z',
  })
}

function episode(gapObject: JsonRecord): JsonRecord {
  return withComputedDigest({
    protocolVersion: '0.1',
    objectType: 'task_episode',
    episodeId: 'episode:test',
    sessionDigest: `sha256:${'1'.repeat(64)}`,
    eventRange: { fromSeq: 1, toSeq: 2 },
    task: {
      taxonomy: ['test'],
      intent: 'Test local storage',
      constraints: [],
      acceptance: [],
      riskClass: 'read_only',
    },
    boundaryReasons: ['test'],
    outcome: 'success',
    evidenceGapReportRef: {
      objectType: 'evidence_gap_report',
      refId: gapObject.reportId,
      digest: gapObject.digest,
    },
  })
}

function experience(): JsonRecord {
  const evidenceRef = {
    objectType: 'trace_evidence',
    refId: 'trace:test',
    digest: `sha256:${'2'.repeat(64)}`,
  }
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'experience_revision',
    experienceId: 'experience:test',
    revision: 1,
    createdAt: '2026-08-19T00:00:00Z',
    relations: [],
    kind: 'failure_recovery',
    namespace: 'local.test',
    publisher: { actorId: 'urn:aen:actor:test', type: 'human' },
    languages: ['en'],
    title: 'Recover a document conversion',
    summary: 'Inspect the failure, change the input, and verify the document output.',
    intendedUses: ['document conversion recovery'],
    outOfScopeUses: ['automatic retry of destructive operations'],
    knownLimitations: ['single observed episode'],
    knownFailureModes: ['retry without changing the failed condition'],
    task: {
      taxonomy: ['documents', 'failure-recovery'],
      intent: 'Recover a failed document conversion',
      constraints: [],
      acceptance: [],
      riskClass: 'reversible_write',
    },
    claims: [{
      claimId: 'experience:test#claim',
      type: 'strategy_works',
      statement: 'A recovery was observed once.',
      mode: 'observational',
      evidenceLevel: 'H1',
      scope: { taskFamilies: ['documents'] },
      supportingEvidenceRefs: [evidenceRef],
      contradictingEvidenceRefs: [],
      falsificationConditions: ['The same recovery fails under the same configuration.'],
      assumptions: [],
    }],
    applicability: { taskFamilies: ['documents'] },
    evidenceRefs: [evidenceRef],
    artifactRefs: [],
    governance: {
      visibility: 'private',
      owner: { actorId: 'urn:aen:actor:test', type: 'human' },
      dataClasses: ['internal'],
      redistribution: 'none',
      sourcePolicy: 'local-only-test',
      redactionReport: {
        scannerVersions: {},
        transformations: [],
        residualRisk: 'low',
        humanReviewed: false,
      },
      safetyLabels: ['review-required'],
    },
  })
}

describe('LocalEvidenceStore', () => {
  it('stores immutable protocol objects, relations, and local session metadata', () => {
    const store = tempStore()
    const gapObject = gap()
    const episodeObject = episode(gapObject)
    store.putBatch({
      session: {
        sessionDigest: `sha256:${'1'.repeat(64)}`,
        sourceName: 'fixture.jsonl',
        importedAt: '2026-08-19T00:00:00Z',
        localLocator: '/local/only/fixture.jsonl',
      },
      objects: [
        { object: gapObject, role: 'gap' },
        { object: episodeObject, role: 'episode' },
      ],
    })
    expect(store.listEpisodes()).toHaveLength(1)
    const inspected = store.inspect('episode:test')
    expect(inspected?.outgoing).toContainEqual(
      expect.objectContaining({ relation: 'evidenceGapReportRef', targetDigest: gapObject.digest }),
    )
    expect(inspected?.sessions).toEqual([
      { sessionDigest: `sha256:${'1'.repeat(64)}`, role: 'episode' },
    ])
    expect(store.getByDigest(gapObject.digest as `sha256:${string}`)).toEqual(gapObject)
    store.close()
  })

  it('rejects invalid digest/object content', () => {
    const store = tempStore()
    const invalid = gap()
    invalid.maximumEvidenceLevel = 'H4'
    expect(() => store.putBatch({ objects: [{ object: invalid }] })).toThrow('invalid AEXP object')
    store.close()
  })

  it('indexes private experiences and keeps an append-only local review audit', () => {
    const store = tempStore()
    const object = experience()
    store.putBatch({ objects: [{ object }] })
    expect(store.searchExperiences('document recovery')).toEqual([
      expect.objectContaining({ experienceId: 'experience:test', state: 'draft' }),
    ])
    store.recordExperienceReview({
      selector: 'experience:test',
      state: 'approved_private',
      reviewerActorId: 'urn:aen:actor:reviewer',
      note: 'Keep local until comparative evidence exists.',
      updatedAt: '2026-08-19T01:00:00Z',
    })
    expect(store.getExperienceReview('experience:test')).toMatchObject({
      state: 'approved_private',
      reviewerActorId: 'urn:aen:actor:reviewer',
    })
    expect(store.listExperienceReviewEvents('experience:test')).toHaveLength(1)
    expect(store.searchExperiences('document recovery')[0]?.state).toBe('approved_private')
    expect(fetchExperienceSections(store, 'experience:test', ['card']).sections.card).toMatchObject({
      title: 'Recover a document conversion',
      safetyLabels: ['review-required'],
    })
    store.close()
  })

  it('treats cost and latency budgets as hard filters and fails closed on unknown metrics', () => {
    const store = tempStore()
    const unknown = experience()
    const measured = withComputedDigest({
      ...experience(),
      experienceId: 'experience:measured',
      title: 'Measured document recovery',
      metricSummary: {
        sampleSize: 12,
        successRate: 0.75,
        costUsd: { mean: 0.05 },
        latencyMs: { p95: 900 },
        method: 'local-budget-test',
      },
    })
    store.putBatch({ objects: [{ object: unknown }, { object: measured }] })
    const accepted = searchLocalExperiences(store, {
      query: 'document recovery',
      policy: { maxMeanCostUsd: 0.05, maxP95LatencyMs: 900 },
      limit: 3,
    })
    expect(accepted.cards.map((card) => card.experienceId)).toEqual(['experience:measured'])
    expect(searchLocalExperiences(store, {
      query: 'document recovery',
      policy: { maxMeanCostUsd: 0.049 },
      limit: 3,
    }).cards).toEqual([])
    store.close()
  })

  it('uses the stable Harness configuration selector across run-local Manifest snapshots', () => {
    const store = tempStore()
    const configurationDigest = `sha256:${'7'.repeat(64)}`
    const scoped = withComputedDigest({
      ...experience(),
      applicability: {
        taskFamilies: ['documents'],
        harnessSelectors: [{
          path: 'harness.configurationDigest',
          operator: 'digestEquals',
          value: configurationDigest,
        }],
      },
    })
    store.putBatch({ objects: [{ object: scoped }] })
    expect(searchLocalExperiences(store, {
      query: 'document recovery',
      context: {
        harnessConfigurationDigest: configurationDigest,
        harnessManifestDigest: `sha256:${'8'.repeat(64)}`,
      },
      limit: 1,
    }).cards[0]?.compatibility).toBe('exact')
    expect(searchLocalExperiences(store, {
      query: 'document recovery',
      context: { harnessConfigurationDigest: `sha256:${'9'.repeat(64)}` },
      limit: 1,
    }).cards).toEqual([])
    store.close()
  })

  it('securely deletes private body, index, links, and review data while retaining only a tombstone', () => {
    const store = tempStore()
    const object = experience()
    store.putBatch({ objects: [{ object }] })
    store.recordExperienceReview({
      selector: String(object.digest),
      state: 'approved_private',
      reviewerActorId: 'urn:aen:actor:privacy-reviewer',
      updatedAt: '2026-08-20T10:00:00Z',
    })
    const tombstone = store.deleteObjectBody({
      digest: object.digest as `sha256:${string}`,
      reason: 'author_request',
      deletedAt: '2026-08-20T11:00:00Z',
    })
    expect(tombstone).toMatchObject({
      digest: object.digest,
      objectType: 'experience_revision',
      refId: 'experience:test',
      reason: 'author_request',
    })
    expect(store.getByDigest(object.digest as `sha256:${string}`)).toBeUndefined()
    expect(store.inspect('experience:test')).toBeUndefined()
    expect(store.searchExperiences('document recovery')).toEqual([])
    expect(store.listExperienceReviewEvents('experience:test')).toEqual([])
    expect(store.listLocalDeletionTombstones()).toEqual([tombstone])
    expect(JSON.stringify(store.listLocalDeletionTombstones())).not.toContain('Recover a document conversion')
    store.close()
  })
})
