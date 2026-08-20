import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  canonicalJson,
  toObjectRef,
  validateProtocolObject,
  type Digest,
  type JsonRecord,
  type ObjectRef,
} from '@aen/protocol'

const SCHEMA_VERSION = 3

export type ExperienceReviewState =
  | 'draft'
  | 'approved_private'
  | 'rejected'
  | 'public_requested'

export interface ExperienceReviewRecord {
  objectDigest: Digest
  state: ExperienceReviewState
  reviewerActorId: string
  note?: string
  updatedAt: string
}

export interface ExperienceReviewEvent extends ExperienceReviewRecord {
  eventId: number
}

export interface LocalExperienceSearchHit {
  digest: Digest
  experienceId: string
  revision: number
  title: string
  summary: string
  state: ExperienceReviewState
  score: number
}

export interface LocalSessionRecord {
  sessionDigest: Digest
  sourceName: string
  importedAt: string
  rawInputDigest?: Digest
  localLocator?: string
}

export interface EvidenceObjectInput {
  object: JsonRecord
  role?: string
}

export interface EvidenceImportBatch {
  session?: LocalSessionRecord
  objects: EvidenceObjectInput[]
}

export interface StoredObjectSummary {
  digest: Digest
  objectType: string
  refId: string
  revision?: number
  storedAt: string
}

export interface LocalDeletionTombstone {
  digest: Digest
  objectType: string
  refId: string
  revision?: number
  reason: string
  deletedAt: string
}

export interface StoredEpisodeSummary extends StoredObjectSummary {
  episodeId: string
  outcome: string
  fromSeq: number
  toSeq: number
  sessionDigest: Digest
}

export interface ObjectLink {
  relation: string
  targetDigest: Digest
  targetType?: string
  targetId?: string
}

export interface InspectedObject {
  object: JsonRecord
  summary: StoredObjectSummary
  outgoing: ObjectLink[]
  incoming: Array<ObjectLink & { sourceDigest: Digest; sourceType: string; sourceId: string }>
  sessions: Array<{ sessionDigest: Digest; role: string }>
}

interface ObjectRow {
  digest: string
  object_type: string
  ref_id: string
  revision: number | null
  canonical_json: string
  stored_at: string
}

interface LinkRow {
  relation: string
  target_digest: string
  target_type: string | null
  target_id: string | null
}

interface IncomingLinkRow extends LinkRow {
  source_digest: string
  source_type: string
  source_id: string
}

interface ExperienceReviewRow {
  object_digest: string
  state: ExperienceReviewState
  reviewer_actor_id: string
  note: string | null
  updated_at: string
}

interface ExperienceReviewEventRow extends ExperienceReviewRow {
  event_id: number
}

interface ExperienceSearchRow {
  digest: string
  ref_id: string
  revision: number
  canonical_json: string
  state: ExperienceReviewState | null
  score: number
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertProtocolObject(value: JsonRecord): ObjectRef {
  const validation = validateProtocolObject(value)
  if (!validation.ok) {
    throw new Error(
      `cannot store invalid AEXP object: ${validation.issues
        .map((issue) => `${issue.code} ${issue.path}: ${issue.message}`)
        .join('; ')}`,
    )
  }
  return toObjectRef(value)
}

function summary(row: ObjectRow): StoredObjectSummary {
  return {
    digest: row.digest as Digest,
    objectType: row.object_type,
    refId: row.ref_id,
    ...(row.revision === null ? {} : { revision: row.revision }),
    storedAt: row.stored_at,
  }
}

function objectRefs(value: JsonRecord): Array<{ relation: string; ref: ObjectRef }> {
  const refs: Array<{ relation: string; ref: ObjectRef }> = []
  const stack: Array<{ value: unknown; path: string }> = [{ value, path: '' }]
  const visited = new WeakSet<object>()
  while (stack.length > 0) {
    const item = stack.pop()
    if (item === undefined || item.value === null || typeof item.value !== 'object') continue
    if (visited.has(item.value)) continue
    visited.add(item.value)
    if (isRecord(item.value)) {
      if (
        typeof item.value.objectType === 'string' &&
        typeof item.value.refId === 'string' &&
        typeof item.value.digest === 'string' &&
        item.value.digest.startsWith('sha256:')
      ) {
        refs.push({ relation: item.path || 'object_ref', ref: item.value as unknown as ObjectRef })
        continue
      }
      for (const [key, child] of Object.entries(item.value)) {
        stack.push({ value: child, path: item.path === '' ? key : `${item.path}.${key}` })
      }
    } else if (Array.isArray(item.value)) {
      item.value.forEach((child, index) =>
        stack.push({ value: child, path: `${item.path}[${index}]` }),
      )
    }
  }
  return refs
}

function searchableExperience(object: JsonRecord): {
  title: string
  summary: string
  task: string
  recipe: string
  cases: string
} | undefined {
  if (object.objectType !== 'experience_revision') return undefined
  if (typeof object.title !== 'string' || typeof object.summary !== 'string') return undefined
  return {
    title: object.title,
    summary: object.summary,
    task: canonicalJson(object.task ?? {}),
    recipe: canonicalJson(object.recipe ?? {}),
    cases: canonicalJson(object.cases ?? []),
  }
}

function ftsQuery(value: string): string | undefined {
  const tokens = value.normalize('NFC').match(/[\p{L}\p{N}_-]+/gu) ?? []
  if (tokens.length === 0) return undefined
  return tokens.slice(0, 16).map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ')
}

function scalarDigestLinks(value: JsonRecord): ObjectLink[] {
  const links: ObjectLink[] = []
  if (value.objectType === 'trace_evidence' && typeof value.episodeDigest === 'string') {
    links.push({
      relation: 'episodeDigest',
      targetDigest: value.episodeDigest as Digest,
      targetType: 'task_episode',
    })
  }
  if (value.objectType === 'observation' && isRecord(value.configurationCell)) {
    const digest = value.configurationCell.harnessManifestDigest
    if (typeof digest === 'string') {
      links.push({
        relation: 'configurationCell.harnessManifestDigest',
        targetDigest: digest as Digest,
        targetType: 'harness_manifest',
      })
    }
  }
  return links
}

export class LocalEvidenceStore {
  readonly path: string
  readonly #db: DatabaseSync

  constructor(path: string) {
    this.path = resolve(path)
    mkdirSync(dirname(this.path), { recursive: true })
    this.#db = new DatabaseSync(this.path)
    this.#db.exec('PRAGMA foreign_keys = ON')
    this.#db.exec('PRAGMA journal_mode = WAL')
    this.#db.exec('PRAGMA secure_delete = ON')
    this.#migrate()
  }

  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.#db.exec('COMMIT')
      return value
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  #migrate(): void {
    const versionRow = this.#db.prepare('PRAGMA user_version').get() as
      | { user_version: number }
      | undefined
    let version = versionRow?.user_version ?? 0
    if (version > SCHEMA_VERSION) {
      throw new Error(`local evidence store schema ${version} is newer than supported ${SCHEMA_VERSION}`)
    }
    if (version === 0) {
      this.#db.exec(`
        CREATE TABLE objects (
          digest TEXT PRIMARY KEY,
          object_type TEXT NOT NULL,
          ref_id TEXT NOT NULL,
          revision INTEGER,
          canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json)),
          stored_at TEXT NOT NULL,
          UNIQUE (object_type, ref_id, revision)
        );
        CREATE INDEX objects_type_idx ON objects(object_type, stored_at);
        CREATE INDEX objects_identity_idx ON objects(ref_id, object_type);

        CREATE TABLE object_links (
          source_digest TEXT NOT NULL REFERENCES objects(digest) ON DELETE CASCADE,
          relation TEXT NOT NULL,
          target_digest TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          PRIMARY KEY (source_digest, relation, target_digest)
        );
        CREATE INDEX object_links_target_idx ON object_links(target_digest);

        CREATE TABLE sessions (
          session_digest TEXT PRIMARY KEY,
          source_name TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          raw_input_digest TEXT,
          local_locator TEXT
        );

        CREATE TABLE session_objects (
          session_digest TEXT NOT NULL REFERENCES sessions(session_digest) ON DELETE CASCADE,
          object_digest TEXT NOT NULL REFERENCES objects(digest) ON DELETE CASCADE,
          role TEXT NOT NULL,
          PRIMARY KEY (session_digest, object_digest, role)
        );
        CREATE INDEX session_objects_object_idx ON session_objects(object_digest);

        PRAGMA user_version = 1;
      `)
      version = 1
    }
    if (version === 1) {
      this.#db.exec(`
        CREATE TABLE experience_reviews (
          object_digest TEXT PRIMARY KEY REFERENCES objects(digest) ON DELETE CASCADE,
          state TEXT NOT NULL CHECK (state IN ('draft', 'approved_private', 'rejected', 'public_requested')),
          reviewer_actor_id TEXT NOT NULL,
          note TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE experience_review_events (
          event_id INTEGER PRIMARY KEY AUTOINCREMENT,
          object_digest TEXT NOT NULL REFERENCES objects(digest) ON DELETE CASCADE,
          state TEXT NOT NULL CHECK (state IN ('draft', 'approved_private', 'rejected', 'public_requested')),
          reviewer_actor_id TEXT NOT NULL,
          note TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX experience_review_events_object_idx
          ON experience_review_events(object_digest, event_id);

        CREATE VIRTUAL TABLE experience_fts USING fts5(
          digest UNINDEXED,
          title,
          summary,
          task,
          recipe,
          cases,
          tokenize = 'unicode61'
        );

        PRAGMA user_version = 2;
      `)
      const existing = this.#db
        .prepare("SELECT digest, canonical_json FROM objects WHERE object_type = 'experience_revision'")
        .all() as Array<{ digest: string; canonical_json: string }>
      const insert = this.#db.prepare(`
        INSERT INTO experience_fts(digest, title, summary, task, recipe, cases)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const row of existing) {
        const fields = searchableExperience(JSON.parse(row.canonical_json) as JsonRecord)
        if (fields !== undefined) {
          insert.run(row.digest, fields.title, fields.summary, fields.task, fields.recipe, fields.cases)
        }
      }
      version = 2
    }
    if (version === 2) {
      this.#db.exec(`
        CREATE TABLE local_deletion_tombstones (
          digest TEXT PRIMARY KEY,
          object_type TEXT NOT NULL,
          ref_id TEXT NOT NULL,
          revision INTEGER,
          reason TEXT NOT NULL,
          deleted_at TEXT NOT NULL
        );
        CREATE INDEX local_deletion_tombstones_identity_idx
          ON local_deletion_tombstones(ref_id, object_type, revision);

        PRAGMA user_version = 3;
      `)
    }
  }

  close(): void {
    this.#db.close()
  }

  putBatch(batch: EvidenceImportBatch): StoredObjectSummary[] {
    const insertObject = this.#db.prepare(`
      INSERT INTO objects(digest, object_type, ref_id, revision, canonical_json, stored_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(digest) DO NOTHING
    `)
    const existingObject = this.#db.prepare('SELECT canonical_json FROM objects WHERE digest = ?')
    const insertLink = this.#db.prepare(`
      INSERT OR IGNORE INTO object_links(source_digest, relation, target_digest, target_type, target_id)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertSession = this.#db.prepare(`
      INSERT INTO sessions(session_digest, source_name, imported_at, raw_input_digest, local_locator)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_digest) DO UPDATE SET
        source_name = excluded.source_name,
        imported_at = excluded.imported_at,
        raw_input_digest = COALESCE(excluded.raw_input_digest, sessions.raw_input_digest),
        local_locator = COALESCE(excluded.local_locator, sessions.local_locator)
    `)
    const linkSession = this.#db.prepare(`
      INSERT OR IGNORE INTO session_objects(session_digest, object_digest, role) VALUES (?, ?, ?)
    `)
    const deleteSearch = this.#db.prepare('DELETE FROM experience_fts WHERE digest = ?')
    const insertSearch = this.#db.prepare(`
      INSERT INTO experience_fts(digest, title, summary, task, recipe, cases)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    return this.#transaction(() => {
      if (batch.session !== undefined) {
        insertSession.run(
          batch.session.sessionDigest,
          batch.session.sourceName,
          batch.session.importedAt,
          batch.session.rawInputDigest ?? null,
          batch.session.localLocator ?? null,
        )
      }
      const stored: StoredObjectSummary[] = []
      for (const entry of batch.objects) {
        const ref = assertProtocolObject(entry.object)
        const json = canonicalJson(entry.object)
        const now = new Date().toISOString()
        insertObject.run(ref.digest, ref.objectType, ref.refId, ref.revision ?? null, json, now)
        const existing = existingObject.get(ref.digest) as { canonical_json: string } | undefined
        if (existing?.canonical_json !== json) {
          throw new Error(`digest collision or non-canonical object mismatch: ${ref.digest}`)
        }
        for (const { relation, ref: target } of objectRefs(entry.object)) {
          if (target.digest === ref.digest) continue
          insertLink.run(ref.digest, relation, target.digest, target.objectType, target.refId)
        }
        for (const target of scalarDigestLinks(entry.object)) {
          insertLink.run(
            ref.digest,
            target.relation,
            target.targetDigest,
            target.targetType ?? null,
            target.targetId ?? null,
          )
        }
        if (batch.session !== undefined) {
          linkSession.run(batch.session.sessionDigest, ref.digest, entry.role ?? ref.objectType)
        }
        const search = searchableExperience(entry.object)
        if (search !== undefined) {
          deleteSearch.run(ref.digest)
          insertSearch.run(ref.digest, search.title, search.summary, search.task, search.recipe, search.cases)
        }
        stored.push({
          digest: ref.digest,
          objectType: ref.objectType,
          refId: ref.refId,
          ...(ref.revision === undefined ? {} : { revision: ref.revision }),
          storedAt: now,
        })
      }
      return stored
    })
  }

  getByDigest(digest: Digest): JsonRecord | undefined {
    const row = this.#db
      .prepare('SELECT canonical_json FROM objects WHERE digest = ?')
      .get(digest) as { canonical_json: string } | undefined
    return row === undefined ? undefined : (JSON.parse(row.canonical_json) as JsonRecord)
  }

  deleteObjectBody(input: {
    digest: Digest
    reason: string
    deletedAt?: string
  }): LocalDeletionTombstone {
    if (input.reason.trim().length === 0) throw new Error('local deletion reason must not be empty')
    const row = this.#db.prepare('SELECT * FROM objects WHERE digest = ?').get(input.digest) as ObjectRow | undefined
    if (row === undefined) throw new Error(`local object not found: ${input.digest}`)
    const tombstone: LocalDeletionTombstone = {
      digest: row.digest as Digest,
      objectType: row.object_type,
      refId: row.ref_id,
      ...(row.revision === null ? {} : { revision: row.revision }),
      reason: input.reason.trim(),
      deletedAt: input.deletedAt ?? new Date().toISOString(),
    }
    this.#transaction(() => {
      this.#db.prepare(`
        INSERT INTO local_deletion_tombstones(digest, object_type, ref_id, revision, reason, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(digest) DO UPDATE SET reason = excluded.reason, deleted_at = excluded.deleted_at
      `).run(
        tombstone.digest,
        tombstone.objectType,
        tombstone.refId,
        tombstone.revision ?? null,
        tombstone.reason,
        tombstone.deletedAt,
      )
      this.#db.prepare('DELETE FROM experience_fts WHERE digest = ?').run(tombstone.digest)
      this.#db.prepare('DELETE FROM object_links WHERE target_digest = ?').run(tombstone.digest)
      this.#db.prepare('DELETE FROM objects WHERE digest = ?').run(tombstone.digest)
      this.#db.prepare(`
        DELETE FROM sessions WHERE NOT EXISTS (
          SELECT 1 FROM session_objects WHERE session_objects.session_digest = sessions.session_digest
        )
      `).run()
    })
    // Explicit privacy deletion is a cold path: overwrite deleted cells,
    // truncate the WAL, then rebuild the DB so free pages do not retain body bytes.
    this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.#db.exec('VACUUM')
    return tombstone
  }

  listLocalDeletionTombstones(): LocalDeletionTombstone[] {
    const rows = this.#db.prepare(`
      SELECT digest, object_type, ref_id, revision, reason, deleted_at
      FROM local_deletion_tombstones ORDER BY deleted_at, digest
    `).all() as Array<{
      digest: string
      object_type: string
      ref_id: string
      revision: number | null
      reason: string
      deleted_at: string
    }>
    return rows.map((row) => ({
      digest: row.digest as Digest,
      objectType: row.object_type,
      refId: row.ref_id,
      ...(row.revision === null ? {} : { revision: row.revision }),
      reason: row.reason,
      deletedAt: row.deleted_at,
    }))
  }

  listObjects(objectType?: string): StoredObjectSummary[] {
    const rows = (objectType === undefined
      ? this.#db.prepare('SELECT * FROM objects ORDER BY stored_at DESC, object_type, ref_id').all()
      : this.#db
          .prepare('SELECT * FROM objects WHERE object_type = ? ORDER BY stored_at DESC, ref_id')
          .all(objectType)) as unknown as ObjectRow[]
    return rows.map(summary)
  }

  listEpisodes(): StoredEpisodeSummary[] {
    const rows = this.#db.prepare(`
      SELECT digest, object_type, ref_id, revision, canonical_json, stored_at
      FROM objects WHERE object_type = 'task_episode'
      ORDER BY stored_at DESC, ref_id
    `).all() as unknown as ObjectRow[]
    return rows.map((row) => {
      const object = JSON.parse(row.canonical_json) as JsonRecord
      const range = object.eventRange as JsonRecord
      return {
        ...summary(row),
        episodeId: String(object.episodeId),
        outcome: String(object.outcome),
        fromSeq: Number(range.fromSeq),
        toSeq: Number(range.toSeq),
        sessionDigest: object.sessionDigest as Digest,
      }
    })
  }

  recordExperienceReview(input: {
    selector: string
    state: ExperienceReviewState
    reviewerActorId: string
    note?: string
    updatedAt?: string
  }): ExperienceReviewRecord {
    const inspected = this.inspect(input.selector)
    if (inspected === undefined || inspected.summary.objectType !== 'experience_revision') {
      throw new Error(`experience revision not found: ${input.selector}`)
    }
    if (input.reviewerActorId.length === 0) throw new Error('reviewerActorId must not be empty')
    const updatedAt = input.updatedAt ?? new Date().toISOString()
    this.#transaction(() => {
      this.#db.prepare(`
        INSERT INTO experience_review_events(object_digest, state, reviewer_actor_id, note, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        inspected.summary.digest,
        input.state,
        input.reviewerActorId,
        input.note ?? null,
        updatedAt,
      )
      this.#db.prepare(`
        INSERT INTO experience_reviews(object_digest, state, reviewer_actor_id, note, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(object_digest) DO UPDATE SET
          state = excluded.state,
          reviewer_actor_id = excluded.reviewer_actor_id,
          note = excluded.note,
          updated_at = excluded.updated_at
      `).run(
        inspected.summary.digest,
        input.state,
        input.reviewerActorId,
        input.note ?? null,
        updatedAt,
      )
    })
    return {
      objectDigest: inspected.summary.digest,
      state: input.state,
      reviewerActorId: input.reviewerActorId,
      ...(input.note === undefined ? {} : { note: input.note }),
      updatedAt,
    }
  }

  getExperienceReview(selector: string): ExperienceReviewRecord | undefined {
    const inspected = this.inspect(selector)
    if (inspected === undefined || inspected.summary.objectType !== 'experience_revision') return undefined
    const row = this.#db.prepare(`
      SELECT object_digest, state, reviewer_actor_id, note, updated_at
      FROM experience_reviews WHERE object_digest = ?
    `).get(inspected.summary.digest) as ExperienceReviewRow | undefined
    if (row === undefined) return undefined
    return {
      objectDigest: row.object_digest as Digest,
      state: row.state,
      reviewerActorId: row.reviewer_actor_id,
      ...(row.note === null ? {} : { note: row.note }),
      updatedAt: row.updated_at,
    }
  }

  listExperienceReviewEvents(selector: string): ExperienceReviewEvent[] {
    const inspected = this.inspect(selector)
    if (inspected === undefined || inspected.summary.objectType !== 'experience_revision') return []
    const rows = this.#db.prepare(`
      SELECT event_id, object_digest, state, reviewer_actor_id, note, updated_at
      FROM experience_review_events WHERE object_digest = ? ORDER BY event_id
    `).all(inspected.summary.digest) as unknown as ExperienceReviewEventRow[]
    return rows.map((row) => ({
      eventId: row.event_id,
      objectDigest: row.object_digest as Digest,
      state: row.state,
      reviewerActorId: row.reviewer_actor_id,
      ...(row.note === null ? {} : { note: row.note }),
      updatedAt: row.updated_at,
    }))
  }

  searchExperiences(query: string, limit = 3): LocalExperienceSearchHit[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('experience search limit must be an integer between 1 and 100')
    }
    const match = ftsQuery(query)
    const rows = (match === undefined
      ? this.#db.prepare(`
          SELECT o.digest, o.ref_id, o.revision, o.canonical_json,
                 r.state, 0 AS score
          FROM objects o
          JOIN (
            SELECT ref_id, MAX(revision) AS revision
            FROM objects WHERE object_type = 'experience_revision'
            GROUP BY ref_id
          ) latest ON latest.ref_id = o.ref_id AND latest.revision = o.revision
          LEFT JOIN experience_reviews r ON r.object_digest = o.digest
          WHERE o.object_type = 'experience_revision'
            AND COALESCE(r.state, 'draft') <> 'rejected'
          ORDER BY o.stored_at DESC LIMIT ?
        `).all(limit)
      : this.#db.prepare(`
          SELECT o.digest, o.ref_id, o.revision, o.canonical_json,
                 r.state, bm25(experience_fts) AS score
          FROM experience_fts
          JOIN objects o ON o.digest = experience_fts.digest
          JOIN (
            SELECT ref_id, MAX(revision) AS revision
            FROM objects WHERE object_type = 'experience_revision'
            GROUP BY ref_id
          ) latest ON latest.ref_id = o.ref_id AND latest.revision = o.revision
          LEFT JOIN experience_reviews r ON r.object_digest = o.digest
          WHERE experience_fts MATCH ?
            AND COALESCE(r.state, 'draft') <> 'rejected'
          ORDER BY score, o.revision DESC LIMIT ?
        `).all(match, limit)) as unknown as ExperienceSearchRow[]
    return rows.map((row) => {
      const object = JSON.parse(row.canonical_json) as JsonRecord
      return {
        digest: row.digest as Digest,
        experienceId: row.ref_id,
        revision: row.revision,
        title: String(object.title),
        summary: String(object.summary),
        state: row.state ?? 'draft',
        score: row.score,
      }
    })
  }

  inspect(selector: string): InspectedObject | undefined {
    const row = (selector.startsWith('sha256:')
      ? this.#db.prepare('SELECT * FROM objects WHERE digest = ?').get(selector)
      : this.#db
          .prepare('SELECT * FROM objects WHERE ref_id = ? ORDER BY revision DESC LIMIT 1')
          .get(selector)) as ObjectRow | undefined
    if (row === undefined) return undefined
    const outgoingRows = this.#db
      .prepare('SELECT relation, target_digest, target_type, target_id FROM object_links WHERE source_digest = ? ORDER BY relation, target_digest')
      .all(row.digest) as unknown as LinkRow[]
    const incomingRows = this.#db.prepare(`
      SELECT l.relation, l.target_digest, l.target_type, l.target_id,
             l.source_digest, o.object_type AS source_type, o.ref_id AS source_id
      FROM object_links l JOIN objects o ON o.digest = l.source_digest
      WHERE l.target_digest = ? ORDER BY o.object_type, o.ref_id, l.relation
    `).all(row.digest) as unknown as IncomingLinkRow[]
    const sessions = this.#db.prepare(`
      SELECT session_digest, role FROM session_objects WHERE object_digest = ? ORDER BY session_digest, role
    `).all(row.digest) as Array<{ session_digest: string; role: string }>
    return {
      object: JSON.parse(row.canonical_json) as JsonRecord,
      summary: summary(row),
      outgoing: outgoingRows.map((link) => ({
        relation: link.relation,
        targetDigest: link.target_digest as Digest,
        ...(link.target_type === null ? {} : { targetType: link.target_type }),
        ...(link.target_id === null ? {} : { targetId: link.target_id }),
      })),
      incoming: incomingRows.map((link) => ({
        relation: link.relation,
        targetDigest: link.target_digest as Digest,
        ...(link.target_type === null ? {} : { targetType: link.target_type }),
        ...(link.target_id === null ? {} : { targetId: link.target_id }),
        sourceDigest: link.source_digest as Digest,
        sourceType: link.source_type,
        sourceId: link.source_id,
      })),
      sessions: sessions.map((session) => ({
        sessionDigest: session.session_digest as Digest,
        role: session.role,
      })),
    }
  }
}

export * from './retrieval.js'
