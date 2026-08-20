import { afterAll, describe, expect, it } from 'vitest'
import {
  finalizeProtocolObject,
  generateNodeKeyPair,
  type ExperienceRevision,
  type FeedbackEvent,
  type JsonRecord,
} from '@aen/protocol'
import { createRevocationContribution } from '@aen/promotion'
import { PostgresHubProjection, type IngestedContribution } from '../src/index.js'

const databaseUrl = process.env.AEN_TEST_DATABASE_URL
const actor = { actorId: 'https://github.com/aen-real-postgres-test', type: 'human' as const }
const evidence = {
  objectType: 'trace_evidence' as const,
  refId: 'urn:aen:evidence:postgres-test',
  digest: `sha256:${'0'.repeat(64)}` as const,
}

const experience = finalizeProtocolObject<ExperienceRevision>({
  protocolVersion: '0.1',
  objectType: 'experience_revision',
  experienceId: 'urn:aen:experience:real-postgres-fts',
  revision: 1,
  createdAt: '2026-08-20T00:00:00Z',
  relations: [],
  kind: 'failure_recovery',
  namespace: 'aen.real-postgres-test',
  publisher: actor,
  languages: ['en'],
  title: 'Deterministic recovery checkpoint',
  summary: 'A measured recovery pattern indexed through real PostgreSQL full text search.',
  intendedUses: ['recover a reversible failed operation'],
  outOfScopeUses: ['automatic destructive retry'],
  knownLimitations: ['integration fixture'],
  knownFailureModes: ['unchanged retry'],
  task: {
    taxonomy: ['failure-recovery'],
    intent: 'Recover a failed operation.',
    constraints: [],
    acceptance: [],
    riskClass: 'reversible_write',
  },
  claims: [{
    claimId: 'urn:aen:experience:real-postgres-fts#claim',
    type: 'strategy_works',
    statement: 'The recovery checkpoint was observed once.',
    mode: 'observational',
    evidenceLevel: 'H1',
    scope: { taskFamilies: ['failure-recovery'] },
    supportingEvidenceRefs: [evidence],
    contradictingEvidenceRefs: [],
    falsificationConditions: ['The checkpoint fails under the same configuration.'],
    assumptions: [],
  }],
  applicability: {
    taskFamilies: ['failure-recovery'],
    modelSelectors: [
      { path: 'model.provider', operator: 'equals', value: 'deepseek' },
      { path: 'model.modelId', operator: 'equals', value: 'deepseek-reasoner' },
    ],
    harnessSelectors: [
      {
        path: 'harness.configurationDigest',
        operator: 'digestEquals',
        value: `sha256:${'2'.repeat(64)}`,
      },
      {
        path: 'harness.manifestDigest',
        operator: 'digestEquals',
        value: `sha256:${'1'.repeat(64)}`,
      },
    ],
  },
  recipe: {
    strategy: 'Checkpoint, inspect the failure signal, make one reversible correction, and verify.',
    preconditions: [],
    steps: [{ stepId: 'checkpoint', instruction: 'Create a reversible checkpoint.', rationaleSummary: 'Preserve rollback.', riskClass: 'read_only' }],
    checkpoints: [],
    fallbacks: [],
    stopConditions: ['verification fails'],
  },
  evidenceRefs: [evidence],
  artifactRefs: [],
  metricSummary: {
    sampleSize: 10,
    successRate: 0.8,
    costUsd: { mean: 0.05 },
    latencyMs: { p95: 900 },
    method: 'real-postgres-integration',
  },
  governance: {
    visibility: 'public',
    owner: actor,
    license: 'CC-BY-4.0',
    dataClasses: ['public'],
    redistribution: 'public_mirrors',
    consentRef: 'git:commit:real-postgres-test',
    sourcePolicy: 'aen.test.real-postgres',
    redactionReport: {
      scannerVersions: { fixture: '1' },
      transformations: [],
      residualRisk: 'low',
      humanReviewed: true,
      reviewedAt: '2026-08-20T00:00:00Z',
    },
    safetyLabels: ['no-automatic-execution'],
  },
})

const contribution: IngestedContribution = {
  root: 'integration:real-postgres',
  inventory: {
    profile: 'aen-git-contribution-v0.1',
    createdAt: experience.createdAt,
    actor,
    targetDigest: experience.digest,
    objects: [],
  },
  target: experience,
  objects: [experience as unknown as JsonRecord],
  verifiedKeyIds: [],
}

describe.skipIf(databaseUrl === undefined)('real PostgreSQL projection', () => {
  const projection = new PostgresHubProjection({ connectionString: databaseUrl }, { textSearch: 'postgres_fts' })

  afterAll(async () => projection.close())

  it('runs migration, jsonb/array projection, FTS, exact feedback, and revocation precedence', async () => {
    await projection.migrate()
    await projection.rebuild([contribution])
    const cards = await projection.search({
      query: 'deterministic recovery',
      taskFamilies: ['failure-recovery'],
      modelProvider: 'deepseek',
      modelId: 'deepseek-reasoner',
      harnessConfigurationDigest: `sha256:${'2'.repeat(64)}`,
      allowedLicenses: ['CC-BY-4.0'],
      maxRiskClass: 'reversible_write',
      maxMeanCostUsd: 0.05,
      maxP95LatencyMs: 900,
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ digest: experience.digest, compatibility: 'exact' })
    await expect(projection.search({
      harnessManifestDigest: `sha256:${'1'.repeat(64)}`,
    })).resolves.toHaveLength(1)
    await expect(projection.search({ query: 'recovery', maxMeanCostUsd: 0.049 })).resolves.toEqual([])
    await expect(projection.search({ query: 'recovery', maxP95LatencyMs: 899 })).resolves.toEqual([])
    const feedback = finalizeProtocolObject<FeedbackEvent>({
      protocolVersion: '0.1',
      objectType: 'feedback',
      feedbackId: 'urn:aen:feedback:real-postgres',
      experienceRef: {
        experienceId: experience.experienceId,
        revision: experience.revision,
        digest: experience.digest,
      },
      decision: 'viewed',
      outcome: 'helpful',
      sharingScope: 'public_aggregate',
      createdAt: '2026-08-20T01:00:00Z',
    })
    await expect(projection.appendFeedback(feedback as unknown as JsonRecord, 'integration:real-postgres')).resolves.toBeUndefined()
    const key = generateNodeKeyPair(`${actor.actorId}#integration`)
    const revocation = createRevocationContribution(experience as unknown as JsonRecord, {
      actor,
      key,
      reasonCode: 'author_request',
      severity: 'urgent',
      createdAt: '2026-08-20T02:00:00Z',
    }).revocation
    await projection.applyRevocation(revocation)
    expect(await projection.search({ query: 'deterministic recovery' })).toEqual([])
    expect(await projection.getObject(experience.digest)).toMatchObject({
      tombstone: true,
      reasonCode: 'author_request',
    })
    expect((await projection.pool.query('SELECT canonical_json FROM hub_objects WHERE digest = $1', [experience.digest])).rows).toEqual([])
    expect(await projection.status()).toMatchObject({ experiences: 0, latestExperiences: 0, revocations: 1 })
    await projection.rebuild([contribution])
    expect(await projection.search({ query: 'deterministic recovery' })).toEqual([])
    expect(await projection.getObject(experience.digest)).toMatchObject({ tombstone: true })
    expect((await projection.pool.query('SELECT canonical_json FROM hub_objects WHERE digest = $1', [experience.digest])).rows).toEqual([])
  })
})
