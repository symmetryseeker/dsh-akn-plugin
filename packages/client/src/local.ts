import {
  LocalEvidenceStore,
  fetchExperienceSections as fetchLocalSections,
  searchLocalExperiences as searchLocal,
} from '@aen/local-store'
import {
  canonicalJson,
  sha256,
  type ExperienceCard,
  type ExperienceRevision,
  type FeedbackEvent,
  type JsonRecord,
  type SearchRequest,
} from '@aen/protocol'
import type {
  ExperienceRevisionRef,
  ExperienceSectionRead,
  ExperienceSource,
} from './types.js'

export {
  fetchExperienceSections,
  searchLocalExperiences,
} from '@aen/local-store'

function asExperience(value: JsonRecord): ExperienceRevision {
  if (value.objectType !== 'experience_revision') throw new Error('object is not an ExperienceRevision')
  return value as unknown as ExperienceRevision
}

/** Local-only Experience source used by Clients, MCP, and Harness plugins. */
export class LocalStoreExperienceSource implements ExperienceSource {
  readonly store: LocalEvidenceStore

  constructor(store: LocalEvidenceStore) {
    this.store = store
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<ExperienceCard[]> {
    signal?.throwIfAborted()
    return searchLocal(this.store, request).cards
  }

  async read(ref: ExperienceRevisionRef, sections: string[]): Promise<ExperienceSectionRead> {
    const object = this.store.getByDigest(ref.digest)
    if (object === undefined) throw new Error(`experience revision not found: ${ref.digest}`)
    const experience = asExperience(object)
    if (
      experience.experienceId !== ref.experienceId ||
      experience.revision !== ref.revision ||
      experience.digest !== ref.digest
    ) throw new Error('local Experience ref identity does not match its digest')
    const fetched = fetchLocalSections(this.store, ref.digest, sections)
    return {
      ...fetched,
      provenance: {
        source: 'local',
        untrusted: true,
        contentDigest: sha256(canonicalJson(fetched.sections)),
      },
    }
  }

  async feedback(event: FeedbackEvent): Promise<void> {
    this.store.putBatch({
      objects: [{ object: event as unknown as JsonRecord, role: 'local_consumer_feedback' }],
    })
  }

  async resolveRevision(experienceId: string, revision: number): Promise<ExperienceRevisionRef> {
    const summary = this.store.listObjects('experience_revision').find((candidate) =>
      candidate.refId === experienceId && candidate.revision === revision,
    )
    if (summary === undefined) throw new Error(`experience revision not found: ${experienceId}@${revision}`)
    const object = this.store.getByDigest(summary.digest)
    if (object === undefined) throw new Error(`experience revision body not found: ${summary.digest}`)
    const experience = asExperience(object)
    return { experienceId: experience.experienceId, revision: experience.revision, digest: experience.digest }
  }

  async readObject(digest: string): Promise<JsonRecord> {
    const object = this.store.getByDigest(digest as `sha256:${string}`)
    if (object === undefined) throw new Error(`local object not found: ${digest}`)
    return object
  }
}
