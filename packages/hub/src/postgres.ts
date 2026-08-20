import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg'
import {
  canonicalJson,
  selectMvpExperienceCandidates,
  validateProtocolObject,
  type ExperienceRevision,
  type FeedbackEvent,
  type JsonRecord,
  type Revocation,
  type RunObservation,
  type Contention,
} from '@aen/protocol'
import type {
  HubExperienceCard,
  HubProjectionOptions,
  HubProjectionStatus,
  HubSearchQuery,
  HubTombstone,
  IngestedContribution,
} from './types.js'

const MIGRATION = `
CREATE TABLE IF NOT EXISTS hub_objects (
  digest text PRIMARY KEY,
  object_type text NOT NULL,
  ref_id text NOT NULL,
  revision integer,
  canonical_json jsonb NOT NULL,
  source_path text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hub_objects_identity_idx ON hub_objects(object_type, ref_id, revision DESC);

CREATE TABLE IF NOT EXISTS hub_experiences (
  digest text PRIMARY KEY REFERENCES hub_objects(digest) ON DELETE CASCADE,
  experience_id text NOT NULL,
  revision integer NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  task_families text[] NOT NULL,
  search_text text NOT NULL,
  evidence_level text NOT NULL,
  evidence_rank integer NOT NULL,
  risk_class text NOT NULL,
  risk_rank integer NOT NULL,
  license text NOT NULL,
  expires_at timestamptz,
  publisher jsonb NOT NULL,
  model_providers text[] NOT NULL,
  model_ids text[] NOT NULL,
  harness_digests text[] NOT NULL,
  UNIQUE(experience_id, revision)
);
CREATE INDEX IF NOT EXISTS hub_experiences_title_idx ON hub_experiences(title);

CREATE TABLE IF NOT EXISTS hub_revocations (
  revocation_digest text NOT NULL,
  affected_digest text NOT NULL,
  reason_code text NOT NULL,
  severity text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(revocation_digest, affected_digest)
);
CREATE INDEX IF NOT EXISTS hub_revocations_affected_idx ON hub_revocations(affected_digest);

CREATE TABLE IF NOT EXISTS hub_emergency_blocks (
  digest text PRIMARY KEY,
  reason_code text NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_tombstones (
  digest text PRIMARY KEY,
  object_type text NOT NULL,
  ref_id text NOT NULL,
  revision integer,
  reason_code text NOT NULL,
  blocked_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS hub_tombstones_identity_idx
  ON hub_tombstones(object_type, ref_id, revision DESC);

CREATE TABLE IF NOT EXISTS hub_experience_latest (
  experience_id text PRIMARY KEY,
  digest text UNIQUE NOT NULL REFERENCES hub_experiences(digest) ON DELETE CASCADE,
  revision integer NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_feedback (
  digest text PRIMARY KEY,
  experience_id text NOT NULL,
  revision integer NOT NULL,
  decision text NOT NULL,
  outcome text,
  reason_codes text[],
  canonical_json jsonb NOT NULL,
  source_path text NOT NULL,
  created_at timestamptz NOT NULL
);
`

interface LatestRow {
  digest: string
  experience_id: string
  revision: number
  title: string
  summary: string
  task_families: string[]
  evidence_level: string
  publisher: ExperienceRevision['publisher']
  canonical_json: ExperienceRevision
  blocked: boolean
  text_rank: number
}

interface RevisionRow {
  digest: string
  experience_id: string
  revision: number
}

const EVIDENCE_RANK: Record<string, number> = { H0: 0, H1: 1, H2: 2, H3: 3, H4: 4 }
const RISK_RANK: Record<string, number> = {
  read_only: 0,
  reversible_write: 1,
  external_write: 2,
  destructive: 3,
}

function identity(object: JsonRecord): { refId: string; revision?: number } {
  const ids: Record<string, string> = {
    attestation: 'attestationId', evidence_gap_report: 'reportId', task_episode: 'episodeId',
    trace_evidence: 'evidenceId', harness_manifest: 'manifestId', artifact: 'artifactId',
    observation: 'observationId', experience_revision: 'experienceId', promotion_record: 'promotionId',
    feedback: 'feedbackId', contention: 'contentionId', revocation: 'revocationId',
    grader_definition: 'graderId', benchmark_task: 'benchmarkId', evaluation_trial: 'trialId',
    evaluation_aggregate: 'aggregateId', task_capsule: 'capsuleId',
    experience_context_plan: 'planId', context_injection_observation: 'injectionId',
  }
  const field = ids[String(object.objectType)]
  const refId = field === undefined ? undefined : object[field]
  if (typeof refId !== 'string') throw new Error(`cannot project identity for ${String(object.objectType)}`)
  return { refId, ...(typeof object.revision === 'number' ? { revision: object.revision } : {}) }
}

function selectors(experience: ExperienceRevision, kind: 'modelSelectors' | 'harnessSelectors', path: string): string[] {
  return [...new Set((experience.applicability[kind] ?? [])
    .filter((selector) => selector.path === path)
    .flatMap((selector) => typeof selector.value === 'string' ? [selector.value] : selector.value ?? []))]
}

function harnessDigests(experience: ExperienceRevision): string[] {
  return [...new Set([
    ...selectors(experience, 'harnessSelectors', 'harness.configurationDigest'),
    ...selectors(experience, 'harnessSelectors', 'harness.manifestDigest'),
  ])]
}

function evidenceLevel(experience: ExperienceRevision): string {
  const levels = ['H0', 'H1', 'H2', 'H3', 'H4']
  return experience.claims.reduce((highest, claim) =>
    levels.indexOf(claim.evidenceLevel) > levels.indexOf(highest) ? claim.evidenceLevel : highest, 'H0')
}

async function refreshLatest(client: PoolClient): Promise<void> {
  await client.query('DELETE FROM hub_experience_latest')
  await client.query(`
    INSERT INTO hub_experience_latest(experience_id, digest, revision)
    SELECT DISTINCT ON (e.experience_id) e.experience_id, e.digest, e.revision
    FROM hub_experiences e
    LEFT JOIN hub_revocations r ON r.affected_digest = e.digest
    LEFT JOIN hub_emergency_blocks b ON b.digest = e.digest
    LEFT JOIN hub_tombstones t ON t.digest = e.digest
    WHERE r.affected_digest IS NULL AND b.digest IS NULL AND t.digest IS NULL
    ORDER BY e.experience_id, e.revision DESC, e.digest
  `)
}

async function insertObjects(client: PoolClient, contribution: IngestedContribution): Promise<void> {
  for (const object of contribution.objects) {
    const ref = identity(object)
    await client.query(`
      INSERT INTO hub_objects(digest, object_type, ref_id, revision, canonical_json, source_path)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      ON CONFLICT (digest) DO NOTHING
    `, [object.digest, object.objectType, ref.refId, ref.revision ?? null, canonicalJson(object), contribution.root])
    if (object.objectType === 'experience_revision') {
      const experience = object as unknown as ExperienceRevision
      await client.query(`
        INSERT INTO hub_experiences(
          digest, experience_id, revision, title, summary, task_families, search_text, evidence_level,
          evidence_rank, risk_class, risk_rank, license, expires_at,
          publisher, model_providers, model_ids, harness_digests
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)
        ON CONFLICT (digest) DO NOTHING
      `, [
        experience.digest,
        experience.experienceId,
        experience.revision,
        experience.title,
        experience.summary,
        experience.applicability.taskFamilies,
        `${experience.title} ${experience.summary} ${experience.applicability.taskFamilies.join(' ')}`,
        evidenceLevel(experience),
        EVIDENCE_RANK[evidenceLevel(experience)] ?? -1,
        experience.task.riskClass,
        RISK_RANK[experience.task.riskClass] ?? 99,
        experience.governance.license ?? '',
        experience.applicability.expiresAt ?? null,
        JSON.stringify(experience.publisher),
        selectors(experience, 'modelSelectors', 'model.provider'),
        selectors(experience, 'modelSelectors', 'model.modelId'),
        harnessDigests(experience),
      ])
    } else if (object.objectType === 'revocation') {
      await insertRevocation(client, object as unknown as Revocation)
    } else if (object.objectType === 'feedback') {
      await insertFeedback(client, object as unknown as FeedbackEvent, contribution.root)
    }
  }
}

async function insertRevocation(client: PoolClient, revocation: Revocation): Promise<void> {
  for (const affected of revocation.affectedDigests) {
    await client.query(`
      INSERT INTO hub_revocations(revocation_digest, affected_digest, reason_code, severity, created_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (revocation_digest, affected_digest) DO NOTHING
    `, [revocation.digest, affected, revocation.reasonCode, revocation.severity, revocation.createdAt])
  }
  await client.query(`
    INSERT INTO hub_tombstones(digest, object_type, ref_id, revision, reason_code, blocked_at)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (digest) DO UPDATE SET
      reason_code = EXCLUDED.reason_code,
      blocked_at = EXCLUDED.blocked_at
  `, [
    revocation.target.digest,
    revocation.target.objectType,
    revocation.target.refId,
    revocation.target.revision ?? null,
    revocation.reasonCode,
    revocation.createdAt,
  ])
}

async function purgeBlockedBodies(client: PoolClient): Promise<void> {
  const result = await client.query<{
    digest: string
    object_type: string
    ref_id: string
    revision: number | null
    reason_code: string
    blocked_at: string | Date
  }>(`
    SELECT DISTINCT ON (o.digest)
      o.digest, o.object_type, o.ref_id, o.revision,
      COALESCE(b.reason_code, r.reason_code, t.reason_code) AS reason_code,
      COALESCE(b.blocked_at, r.created_at, t.blocked_at) AS blocked_at
    FROM hub_objects o
    LEFT JOIN hub_emergency_blocks b ON b.digest = o.digest
    LEFT JOIN hub_revocations r ON r.affected_digest = o.digest
    LEFT JOIN hub_tombstones t ON t.digest = o.digest
    WHERE b.digest IS NOT NULL OR r.affected_digest IS NOT NULL OR t.digest IS NOT NULL
    ORDER BY o.digest, b.blocked_at DESC NULLS LAST, r.created_at DESC NULLS LAST, t.blocked_at DESC NULLS LAST
  `)
  for (const row of result.rows) {
    await client.query(`
      INSERT INTO hub_tombstones(digest, object_type, ref_id, revision, reason_code, blocked_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (digest) DO UPDATE SET
        object_type = EXCLUDED.object_type,
        ref_id = EXCLUDED.ref_id,
        revision = EXCLUDED.revision,
        reason_code = EXCLUDED.reason_code,
        blocked_at = EXCLUDED.blocked_at
    `, [row.digest, row.object_type, row.ref_id, row.revision, row.reason_code, row.blocked_at])
    await client.query('DELETE FROM hub_objects WHERE digest = $1', [row.digest])
  }
}

async function insertFeedback(client: PoolClient, feedback: FeedbackEvent, sourcePath: string): Promise<void> {
  await client.query(`
    INSERT INTO hub_feedback(
      digest, experience_id, revision, decision, outcome, reason_codes, canonical_json, source_path, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
    ON CONFLICT (digest) DO NOTHING
  `, [
    feedback.digest, feedback.experienceRef.experienceId, feedback.experienceRef.revision,
    feedback.decision, feedback.outcome ?? null, feedback.reasonCodes ?? null,
    canonicalJson(feedback), sourcePath, feedback.createdAt,
  ])
}

async function validateContributionReferences(
  client: PoolClient,
  contribution: IngestedContribution,
): Promise<void> {
  const experiences = contribution.objects
    .filter((object) => object.objectType === 'experience_revision') as unknown as ExperienceRevision[]
  for (const experience of experiences) {
    if (experience.supersedes === undefined) continue
    const predecessor = await client.query<{ canonical_json: ExperienceRevision }>(`
      SELECT o.canonical_json
      FROM hub_experiences e JOIN hub_objects o ON o.digest = e.digest
      WHERE e.experience_id = $1 AND e.revision = $2 AND e.digest = $3
    `, [experience.supersedes.experienceId, experience.supersedes.revision, experience.supersedes.digest])
    if (predecessor.rows[0]?.canonical_json.governance.visibility !== 'public') {
      throw new Error('public Experience supersedes ref is absent, private, or digest-mismatched')
    }
  }
  const observations = contribution.objects
    .filter((object) => object.objectType === 'observation') as unknown as RunObservation[]
  for (const observation of observations) {
    if (observation.experienceRef === undefined) continue
    const resolved = await client.query<{ canonical_json: ExperienceRevision }>(`
      SELECT o.canonical_json
      FROM hub_experiences e JOIN hub_objects o ON o.digest = e.digest
      WHERE e.experience_id = $1 AND e.revision = $2 AND e.digest = $3
    `, [
      observation.experienceRef.experienceId,
      observation.experienceRef.revision,
      observation.experienceRef.digest,
    ])
    if (resolved.rows[0] === undefined) {
      throw new Error('public Observation Experience ref is absent or digest-mismatched')
    }
  }
  const contentions = contribution.objects
    .filter((object) => object.objectType === 'contention') as unknown as Contention[]
  for (const contention of contentions) {
    const ref = contention.claimRef.experienceRef
    if (ref.revision === undefined) throw new Error('Contention Experience ref requires an exact revision')
    const resolved = await client.query<{ canonical_json: ExperienceRevision }>(`
      SELECT o.canonical_json
      FROM hub_experiences e JOIN hub_objects o ON o.digest = e.digest
      WHERE e.experience_id = $1 AND e.revision = $2 AND e.digest = $3
    `, [ref.refId, ref.revision, ref.digest])
    const experience = resolved.rows[0]?.canonical_json
    if (experience === undefined) throw new Error('Contention Experience ref is absent or digest-mismatched')
    if (!experience.claims.some((claim) => claim.claimId === contention.claimRef.claimId)) {
      throw new Error('Contention claimId does not exist in the exact Experience revision')
    }
    for (const evidence of [...contention.supporting, ...contention.contradicting]) {
      const object = await client.query<{ object_type: string }>(
        'SELECT object_type FROM hub_objects WHERE digest = $1 AND ref_id = $2',
        [evidence.digest, evidence.refId],
      )
      if (object.rows[0]?.object_type !== evidence.objectType) {
        throw new Error('Contention evidence ref is absent or identity-mismatched')
      }
    }
  }
}

export class PostgresHubProjection {
  readonly pool: {
    query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>
    connect(): Promise<PoolClient>
    end(): Promise<void>
  }
  readonly #textSearch: 'postgres_fts' | 'portable_test'

  constructor(
    config: PoolConfig | Pool | PostgresHubProjection['pool'],
    options: HubProjectionOptions = {},
  ) {
    this.pool = 'query' in config && 'connect' in config ? config : new Pool(config)
    this.#textSearch = options.textSearch ?? 'postgres_fts'
  }

  async migrate(): Promise<void> {
    await this.pool.query(MIGRATION)
    if (this.#textSearch === 'postgres_fts') {
      await this.pool.query("CREATE INDEX IF NOT EXISTS hub_experiences_fts_idx ON hub_experiences USING GIN (to_tsvector('simple', search_text))")
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async ingest(contribution: IngestedContribution): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await insertObjects(client, contribution)
      await validateContributionReferences(client, contribution)
      await purgeBlockedBodies(client)
      await refreshLatest(client)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async rebuild(contributions: readonly IngestedContribution[]): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM hub_experience_latest')
      await client.query('DELETE FROM hub_feedback')
      await client.query('DELETE FROM hub_revocations')
      await client.query('DELETE FROM hub_experiences')
      await client.query('DELETE FROM hub_objects')
      for (const contribution of contributions) await insertObjects(client, contribution)
      for (const contribution of contributions) await validateContributionReferences(client, contribution)
      await purgeBlockedBodies(client)
      await refreshLatest(client)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async search(query: HubSearchQuery = {}): Promise<HubExperienceCard[]> {
    const limit = Math.min(Math.max(query.limit ?? 3, 1), 20)
    const values: unknown[] = []
    const conditions: string[] = []
    let rankExpression = '0'
    if (query.query !== undefined && query.query.trim().length > 0) {
      if (this.#textSearch === 'postgres_fts') {
        values.push(query.query.trim())
        const parameter = `$${values.length}`
        conditions.push(`to_tsvector('simple', e.search_text) @@ websearch_to_tsquery('simple', ${parameter})`)
        rankExpression = `ts_rank(to_tsvector('simple', e.search_text), websearch_to_tsquery('simple', ${parameter}))`
      } else {
        values.push(`%${query.query}%`)
        conditions.push(`e.search_text ILIKE $${values.length}`)
      }
    }
    if (query.taskFamilies !== undefined && query.taskFamilies.length > 0) {
      const familyConditions = query.taskFamilies.map((family) => {
        values.push(family)
        return `$${values.length} = ANY(e.task_families)`
      })
      conditions.push(`(${familyConditions.join(' OR ')})`)
    }
    if (query.modelProvider !== undefined) {
      values.push(query.modelProvider)
      conditions.push(`$${values.length} = ANY(e.model_providers)`)
    }
    if (query.modelId !== undefined) {
      values.push(query.modelId)
      conditions.push(`$${values.length} = ANY(e.model_ids)`)
    }
    if (query.harnessManifestDigest !== undefined) {
      values.push(query.harnessManifestDigest)
      conditions.push(`$${values.length} = ANY(e.harness_digests)`)
    }
    if (query.harnessConfigurationDigest !== undefined) {
      values.push(query.harnessConfigurationDigest)
      conditions.push(`$${values.length} = ANY(e.harness_digests)`)
    }
    if (query.allowedLicenses !== undefined) {
      if (query.allowedLicenses.length === 0) return []
      values.push(query.allowedLicenses)
      conditions.push(`e.license = ANY($${values.length})`)
    }
    if (query.minEvidenceLevel !== undefined) {
      values.push(EVIDENCE_RANK[query.minEvidenceLevel])
      conditions.push(`e.evidence_rank >= $${values.length}`)
    }
    if (query.maxRiskClass !== undefined) {
      values.push(RISK_RANK[query.maxRiskClass])
      conditions.push(`e.risk_rank <= $${values.length}`)
    }
    if (query.maxMeanCostUsd !== undefined) {
      if (!Number.isFinite(query.maxMeanCostUsd) || query.maxMeanCostUsd < 0) throw new Error('maxMeanCostUsd must be non-negative')
      values.push(query.maxMeanCostUsd)
      conditions.push(`(o.canonical_json #>> '{metricSummary,costUsd,mean}') IS NOT NULL AND (o.canonical_json #>> '{metricSummary,costUsd,mean}')::double precision <= $${values.length}`)
    }
    if (query.maxP95LatencyMs !== undefined) {
      if (!Number.isFinite(query.maxP95LatencyMs) || query.maxP95LatencyMs < 0) throw new Error('maxP95LatencyMs must be non-negative')
      values.push(query.maxP95LatencyMs)
      conditions.push(`(o.canonical_json #>> '{metricSummary,latencyMs,p95}') IS NOT NULL AND (o.canonical_json #>> '{metricSummary,latencyMs,p95}')::double precision <= $${values.length}`)
    }
    if (this.#textSearch === 'postgres_fts') {
      conditions.push('(e.expires_at IS NULL OR e.expires_at > CURRENT_TIMESTAMP)')
    }
    const candidateLimit = Math.min(100, Math.max(limit * 20, 20))
    values.push(candidateLimit)
    const result = await this.pool.query<LatestRow>(`
      SELECT e.digest, e.experience_id, e.revision, e.title, e.summary, e.task_families,
             e.evidence_level, e.publisher, o.canonical_json, false AS blocked,
             ${rankExpression} AS text_rank
      FROM hub_experience_latest l
      JOIN hub_experiences e ON e.digest = l.digest
      JOIN hub_objects o ON o.digest = e.digest
      ${conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`}
      ORDER BY text_rank DESC, e.evidence_rank DESC, e.revision DESC, e.experience_id
      LIMIT $${values.length}
    `, values)
    const rows = this.#textSearch === 'portable_test'
      ? result.rows.filter((row) => {
          const expiresAt = row.canonical_json.applicability.expiresAt
          return expiresAt === undefined || Date.parse(expiresAt) > Date.now()
        })
      : result.rows
    const harnessDigest = query.harnessConfigurationDigest ?? query.harnessManifestDigest
    const hasCompatibilityContext = query.modelProvider !== undefined || query.modelId !== undefined || harnessDigest !== undefined
    const compatibility = query.modelProvider !== undefined && query.modelId !== undefined &&
        harnessDigest !== undefined && query.modelMutability !== 'provider_mutable'
      ? 'exact' as const
      : hasCompatibilityContext ? 'compatible' as const : 'unknown' as const
    const ranked = selectMvpExperienceCandidates(rows.map((row, recallRank) => ({
      experience: row.canonical_json,
      compatibility,
      recallRank,
    })), limit)
    const rowsByDigest = new Map(rows.map((row) => [row.digest, row]))
    return ranked.map((selection) => {
      const row = rowsByDigest.get(selection.experience.digest)
      if (row === undefined) throw new Error(`ranked Hub row disappeared: ${selection.experience.digest}`)
      const experience = row.canonical_json
      const availableSections = ['card', 'claims', 'applicability', 'task', 'governance']
      if (experience.recipe !== undefined) availableSections.push('recipe')
      if (experience.cases !== undefined) availableSections.push('cases')
      if (experience.evidenceRefs.length > 0) availableSections.push('evidence')
      const estimatedSectionTokens = Object.fromEntries(availableSections.map((section) => {
        const value = section === 'card' ? { title: experience.title, summary: experience.summary }
          : section === 'evidence' ? experience.evidenceRefs
            : (experience as unknown as JsonRecord)[section]
        return [section, Math.ceil(JSON.stringify(value ?? null).length / 4)]
      }))
      return {
        experienceId: row.experience_id,
        revision: row.revision,
        digest: row.digest as `sha256:${string}`,
        title: row.title,
        summary: row.summary,
        intendedUseSummary: experience.intendedUses,
        outOfScopeSummary: experience.outOfScopeUses,
        knownFailureSummary: experience.knownFailureModes,
        taskFamilies: row.task_families,
        compatibility,
        maxEvidenceLevel: row.evidence_level as HubExperienceCard['maxEvidenceLevel'],
        ...(experience.metricSummary === undefined ? {} : { metricSummary: experience.metricSummary }),
        ...(experience.cases?.[0] === undefined ? {} : {
          positiveCaseSummary: experience.cases[0].positive.outcomeSummary,
          negativeCaseSummary: experience.cases[0].negative.outcomeSummary,
        }),
        safetyLabels: experience.governance.safetyLabels,
        sourceSummary: `${row.publisher.actorId}; ${experience.governance.license ?? 'no-license'}`,
        availableSections,
        estimatedSectionTokens,
        scoreExplanation: [
          'Passed public visibility, revocation, license, signature, redaction, and reference gates.',
          `Model × Harness compatibility: ${compatibility}.`,
          ...(query.modelMutability === 'provider_mutable' ? ['Provider-mutable model identity prevents an exact compatibility claim.'] : []),
          `Maximum claim evidence: ${row.evidence_level}.`,
          ...selection.scoreExplanation,
        ],
        blocked: row.blocked,
      }
    })
  }

  async getObject(digest: string): Promise<JsonRecord | HubTombstone | undefined> {
    const blocked = await this.pool.query<{ reason_code: string; blocked_at: string | Date }>(`
      SELECT reason_code, blocked_at FROM hub_emergency_blocks WHERE digest = $1
      UNION ALL
      SELECT reason_code, created_at AS blocked_at FROM hub_revocations WHERE affected_digest = $1
      LIMIT 1
    `, [digest])
    if (blocked.rows[0] !== undefined) {
      return {
        tombstone: true,
        digest,
        reasonCode: blocked.rows[0].reason_code,
        blockedAt: blocked.rows[0].blocked_at instanceof Date
          ? blocked.rows[0].blocked_at.toISOString()
          : blocked.rows[0].blocked_at,
      }
    }
    const tombstone = await this.pool.query<{ reason_code: string; blocked_at: string | Date }>(`
      SELECT reason_code, blocked_at FROM hub_tombstones WHERE digest = $1
    `, [digest])
    if (tombstone.rows[0] !== undefined) {
      const row = tombstone.rows[0]
      return {
        tombstone: true,
        digest,
        reasonCode: row.reason_code,
        blockedAt: row.blocked_at instanceof Date ? row.blocked_at.toISOString() : row.blocked_at,
      }
    }
    const result = await this.pool.query<{ canonical_json: JsonRecord }>(
      'SELECT canonical_json FROM hub_objects WHERE digest = $1',
      [digest],
    )
    return result.rows[0]?.canonical_json
  }

  async getExperience(experienceId: string): Promise<JsonRecord | HubTombstone | undefined> {
    const result = await this.pool.query<{ digest: string }>(
      'SELECT digest FROM hub_experience_latest WHERE experience_id = $1',
      [experienceId],
    )
    const digest = result.rows[0]?.digest
    if (digest !== undefined) return this.getObject(digest)
    const withdrawn = await this.pool.query<{ digest: string }>(`
      SELECT digest FROM hub_tombstones
      WHERE object_type = 'experience_revision' AND ref_id = $1
      ORDER BY revision DESC NULLS LAST, blocked_at DESC LIMIT 1
    `, [experienceId])
    return withdrawn.rows[0] === undefined ? undefined : this.getObject(withdrawn.rows[0].digest)
  }

  async getExperienceRevision(
    experienceId: string,
    revision: number,
    digest: string,
  ): Promise<JsonRecord | HubTombstone | undefined> {
    const result = await this.pool.query<{ digest: string }>(`
      SELECT digest FROM hub_experiences
      WHERE experience_id = $1 AND revision = $2 AND digest = $3
    `, [experienceId, revision, digest])
    if (result.rows[0] !== undefined) return this.getObject(digest)
    const withdrawn = await this.pool.query<{ digest: string }>(`
      SELECT digest FROM hub_tombstones
      WHERE object_type = 'experience_revision' AND ref_id = $1 AND revision = $2 AND digest = $3
    `, [experienceId, revision, digest])
    return withdrawn.rows[0] === undefined ? undefined : this.getObject(digest)
  }

  async resolveExperienceRevision(
    experienceId: string,
    revision: number,
  ): Promise<JsonRecord | HubTombstone | undefined> {
    const result = await this.pool.query<{ digest: string }>(`
      SELECT digest FROM hub_experiences WHERE experience_id = $1 AND revision = $2
    `, [experienceId, revision])
    const digest = result.rows[0]?.digest
    if (digest !== undefined) return this.getObject(digest)
    const withdrawn = await this.pool.query<{ digest: string }>(`
      SELECT digest FROM hub_tombstones
      WHERE object_type = 'experience_revision' AND ref_id = $1 AND revision = $2
      ORDER BY blocked_at DESC, digest LIMIT 1
    `, [experienceId, revision])
    return withdrawn.rows[0] === undefined ? undefined : this.getObject(withdrawn.rows[0].digest)
  }

  async listExperienceRevisions(experienceId: string): Promise<Array<JsonRecord | HubTombstone>> {
    const result = await this.pool.query<RevisionRow>(`
      SELECT digest, experience_id, revision FROM hub_experiences
      WHERE experience_id = $1 ORDER BY revision DESC, digest
    `, [experienceId])
    const withdrawn = await this.pool.query<RevisionRow>(`
      SELECT digest, ref_id AS experience_id, revision FROM hub_tombstones
      WHERE object_type = 'experience_revision' AND ref_id = $1
      ORDER BY revision DESC NULLS LAST, digest
    `, [experienceId])
    const values: Array<JsonRecord | HubTombstone> = []
    const rows = [...result.rows, ...withdrawn.rows]
      .sort((left, right) => right.revision - left.revision || left.digest.localeCompare(right.digest))
    for (const row of rows) {
      const object = await this.getObject(row.digest)
      if (object !== undefined) values.push(object)
    }
    return values
  }

  async status(): Promise<HubProjectionStatus> {
    const result = await this.pool.query<{
      objects: string | number
      experiences: string | number
      latest_experiences: string | number
      revocations: string | number
      last_ingested_at: string | Date | null
    }>(`
      SELECT
        (SELECT COUNT(*) FROM hub_objects) AS objects,
        (SELECT COUNT(*) FROM hub_experiences) AS experiences,
        (SELECT COUNT(*) FROM hub_experience_latest) AS latest_experiences,
        (SELECT COUNT(*) FROM hub_revocations) AS revocations,
        (SELECT MAX(ingested_at) FROM hub_objects) AS last_ingested_at
    `)
    const row = result.rows[0]
    if (row === undefined) return { objects: 0, experiences: 0, latestExperiences: 0, revocations: 0 }
    const time = row.last_ingested_at
    return {
      objects: Number(row.objects),
      experiences: Number(row.experiences),
      latestExperiences: Number(row.latest_experiences),
      revocations: Number(row.revocations),
      ...(time === null ? {} : { lastIngestedAt: time instanceof Date ? time.toISOString() : time }),
    }
  }

  async exportObjects(): Promise<JsonRecord[]> {
    const result = await this.pool.query<{ canonical_json: JsonRecord }>(`
      SELECT o.canonical_json
      FROM hub_objects o
      LEFT JOIN hub_revocations r ON r.affected_digest = o.digest
      LEFT JOIN hub_emergency_blocks b ON b.digest = o.digest
      LEFT JOIN hub_tombstones t ON t.digest = o.digest
      WHERE r.affected_digest IS NULL AND b.digest IS NULL AND t.digest IS NULL
      ORDER BY o.object_type, o.ref_id, o.revision NULLS FIRST, o.digest
    `)
    return result.rows.map((row) => row.canonical_json)
  }

  async listContentions(experienceId: string): Promise<Contention[]> {
    const result = await this.pool.query<{ canonical_json: JsonRecord }>(`
      SELECT canonical_json FROM hub_objects WHERE object_type = 'contention' ORDER BY ingested_at, digest
    `)
    return result.rows
      .map((row) => row.canonical_json as unknown as Contention)
      .filter((contention) => contention.claimRef.experienceRef.refId === experienceId)
  }

  async appendFeedback(feedback: JsonRecord, sourcePath = 'api:feedback'): Promise<void> {
    const validation = validateProtocolObject(feedback)
    if (!validation.ok || feedback.objectType !== 'feedback') {
      throw new Error(`invalid feedback: ${validation.issues.map((issue) => issue.message).join('; ')}`)
    }
    const value = feedback as unknown as FeedbackEvent
    if (value.sharingScope !== 'public_aggregate') throw new Error('Hub accepts only public_aggregate feedback')
    if (value.sessionDigest !== undefined) throw new Error('public feedback must not disclose sessionDigest')
    const target = await this.pool.query<{ digest: string }>(`
      SELECT e.digest FROM hub_experiences e
      LEFT JOIN hub_revocations r ON r.affected_digest = e.digest
      LEFT JOIN hub_emergency_blocks b ON b.digest = e.digest
      LEFT JOIN hub_tombstones t ON t.digest = e.digest
      WHERE e.experience_id = $1 AND e.revision = $2 AND e.digest = $3
        AND r.affected_digest IS NULL AND b.digest IS NULL AND t.digest IS NULL
    `, [value.experienceRef.experienceId, value.experienceRef.revision, value.experienceRef.digest])
    if (target.rows[0] === undefined) throw new Error('feedback Experience ref is absent, digest-mismatched, or revoked')
    const client = await this.pool.connect()
    try {
      await insertFeedback(client, value, sourcePath)
    } finally {
      client.release()
    }
  }

  async applyRevocation(revocation: Revocation): Promise<void> {
    const validation = validateProtocolObject(revocation)
    if (!validation.ok) throw new Error(`invalid revocation: ${validation.issues.map((issue) => issue.message).join('; ')}`)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await insertRevocation(client, revocation)
      await purgeBlockedBodies(client)
      await refreshLatest(client)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async emergencyBlock(digest: string, reasonCode: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`
        INSERT INTO hub_emergency_blocks(digest, reason_code) VALUES ($1,$2)
        ON CONFLICT (digest) DO UPDATE SET reason_code = EXCLUDED.reason_code, blocked_at = now()
      `, [digest, reasonCode])
      await purgeBlockedBodies(client)
      await refreshLatest(client)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
