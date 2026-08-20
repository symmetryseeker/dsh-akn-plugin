import {
  canonicalJson,
  sha256,
  type ExperienceCard,
  type FeedbackEvent,
  type JsonRecord,
  type SearchRequest,
  type ExperienceRevision,
} from '@aen/protocol'
import type { ExperienceRevisionRef, ExperienceSectionRead, ExperienceSource } from './types.js'

async function json(response: Response): Promise<unknown> {
  const value: unknown = await response.json()
  if (!response.ok) throw new Error(`AEN Hub ${response.status}: ${JSON.stringify(value)}`)
  return value
}

export class HubHttpExperienceSource implements ExperienceSource {
  readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<ExperienceCard[]> {
    signal?.throwIfAborted()
    const response = await fetch(`${this.baseUrl}/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: canonicalJson(request),
      ...(signal === undefined ? {} : { signal }),
    })
    const value = await json(response) as { cards?: unknown }
    if (!Array.isArray(value.cards)) throw new Error('AEN Hub search response omitted cards')
    return value.cards as ExperienceCard[]
  }

  async read(ref: ExperienceRevisionRef, sections: string[]): Promise<ExperienceSectionRead> {
    const params = new URLSearchParams({
      digest: ref.digest,
      include: sections.join(','),
    })
    const value = await json(await fetch(`${this.baseUrl}/v1/experiences/${encodeURIComponent(ref.experienceId)}/revisions/${ref.revision}?${params}`, {
      headers: { accept: 'application/json' },
    })) as { experienceRef?: ExperienceRevisionRef; sections?: JsonRecord }
    if (value.experienceRef === undefined || value.sections === undefined) throw new Error('AEN Hub section response is incomplete')
    return {
      experienceRef: value.experienceRef,
      sections: value.sections,
      provenance: {
        source: 'public_hub',
        untrusted: true,
        contentDigest: sha256(canonicalJson(value.sections)),
      },
    }
  }

  async feedback(event: FeedbackEvent): Promise<void> {
    await json(await fetch(`${this.baseUrl}/v1/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: canonicalJson(event),
    }))
  }

  async resolveRevision(experienceId: string, revision: number): Promise<ExperienceRevisionRef> {
    const value = await json(await fetch(`${this.baseUrl}/v1/experiences/${encodeURIComponent(experienceId)}/revisions/${revision}`)) as ExperienceRevision
    return { experienceId: value.experienceId, revision: value.revision, digest: value.digest }
  }

  async readObject(digest: string): Promise<JsonRecord> {
    return await json(await fetch(`${this.baseUrl}/v1/objects/${encodeURIComponent(digest)}`)) as JsonRecord
  }
}
