import {
  HubHttpExperienceSource,
  LocalStoreExperienceSource,
  type ExperienceRevisionRef,
} from '@aen/client'
import { LocalEvidenceStore } from '@aen/local-store'
import type { FeedbackEvent, JsonRecord, SearchRequest } from '@aen/protocol'
import type { McpExperienceBackend } from './server.js'

type RemoteBackend = Pick<
  HubHttpExperienceSource,
  'search' | 'read' | 'resolveRevision' | 'readObject'
>

export interface LocalFallbackBackendOptions {
  hubUrl?: string
  remote?: RemoteBackend
  warn?: (message: string) => void
}

/**
 * The public Hub is an optional discovery accelerator. Immutable reads fall
 * back only to an exact local ref/digest, and feedback is always local.
 */
export function createLocalFallbackBackend(
  store: LocalEvidenceStore,
  options: LocalFallbackBackendOptions = {},
): McpExperienceBackend {
  const local = new LocalStoreExperienceSource(store)
  const remote = options.remote ?? (
    options.hubUrl === undefined || options.hubUrl.length === 0
      ? undefined
      : new HubHttpExperienceSource(options.hubUrl)
  )
  const warn = options.warn ?? (() => {})

  async function fallback<T>(
    operation: string,
    remoteCall: (() => Promise<T>) | undefined,
    localCall: () => Promise<T>,
  ): Promise<T> {
    if (remoteCall === undefined) return localCall()
    try {
      return await remoteCall()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warn(`AEN Hub ${operation} unavailable; using exact local store fallback: ${message}`)
      return localCall()
    }
  }

  return {
    search: async (request: SearchRequest) => fallback(
      'search',
      remote === undefined ? undefined : () => remote.search(request),
      () => local.search({
        ...request,
        policy: { ...request.policy, visibility: ['private', 'team', 'public'] },
      }),
    ),
    read: async (ref: ExperienceRevisionRef, sections: string[]) => fallback(
      'read',
      remote === undefined ? undefined : () => remote.read(ref, sections),
      () => local.read(ref, sections),
    ),
    resolveRevision: async (experienceId: string, revision: number) => fallback(
      'revision resolution',
      remote === undefined ? undefined : () => remote.resolveRevision(experienceId, revision),
      () => local.resolveRevision(experienceId, revision),
    ),
    readObject: async (digest: string): Promise<JsonRecord> => fallback(
      'object read',
      remote === undefined ? undefined : () => remote.readObject(digest),
      () => local.readObject(digest),
    ),
    feedback: async (event: FeedbackEvent) => local.feedback(event),
  }
}
