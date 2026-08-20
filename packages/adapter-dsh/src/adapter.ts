import {
  canonicalJson,
  sha256,
  type ArtifactDescriptor,
  type ArtifactRef,
  type EpisodeEvidence,
  type HarnessAdapter,
  type HarnessIdentity,
  type HarnessManifest,
  type ManifestContext,
  type NormalizedEvent,
  type TaskEpisode,
  type TraceInput,
} from '@aen/protocol'
import { analyzeDshTrace } from './analyze.js'
import { buildRecoveryEvidence, buildTraceOnlyManifest } from './build.js'
import { buildLiveManifest } from './live.js'
import { loadDshTrace } from './load.js'
import { normalizeDshTrace } from './normalize.js'
import type { DshImportResult, DshLiveManifestSource, DshLoadedTrace } from './types.js'

const IDENTITY: HarnessIdentity = {
  name: 'DeepSeek Harness',
  version: 'session-format-0',
  adapterName: '@aen/adapter-dsh',
  adapterVersion: '0.1.0',
  capabilities: [
    'https://aen.dev/capabilities/dsh/session-jsonl-v0',
    'https://aen.dev/capabilities/dsh/session-export-zip',
    'https://aen.dev/capabilities/aen/high-value-episode-recovery-v1',
    'https://aen.dev/capabilities/aen/live-manifest-source-v1',
  ],
}

function traceFromNormalized(events: NormalizedEvent[]): DshLoadedTrace {
  const header = events.find((event) => event.kind === 'session')
  if (header === undefined || !header.eventId.endsWith(':header')) {
    throw new Error('normalized DSH stream has no session header')
  }
  const sessionDigest = header.eventId.slice(0, -':header'.length)
  if (!sessionDigest.startsWith('sha256:')) throw new Error('normalized DSH header has no session digest')
  return {
    header: header.data as unknown as DshLoadedTrace['header'],
    events: [],
    sessionDigest: sessionDigest as DshLoadedTrace['sessionDigest'],
    rawInputDigest: sessionDigest as DshLoadedTrace['rawInputDigest'],
    rawTraceDigest: sessionDigest as DshLoadedTrace['rawTraceDigest'],
    sourceName: 'normalized-event-stream',
  }
}

export class DeepSeekHarnessAdapter implements HarnessAdapter {
  readonly #liveSource: DshLiveManifestSource | undefined
  readonly #artifacts = new Map<string, ArtifactDescriptor>()

  constructor(options: { liveSource?: DshLiveManifestSource } = {}) {
    this.#liveSource = options.liveSource
  }

  async identify(): Promise<HarnessIdentity> {
    return structuredClone(IDENTITY)
  }

  async *importTrace(input: TraceInput): AsyncIterable<NormalizedEvent> {
    const trace = await loadDshTrace(input)
    yield* normalizeDshTrace(trace)
  }

  async *deriveEpisodes(events: AsyncIterable<NormalizedEvent>): AsyncIterable<EpisodeEvidence> {
    const collected: NormalizedEvent[] = []
    for await (const event of events) collected.push(event)
    const trace = traceFromNormalized(collected)
    const analysis = analyzeDshTrace(collected)
    const manifest = buildTraceOnlyManifest(trace, collected, analysis)
    for (const artifact of analysis.artifacts) this.#artifacts.set(artifact.artifactId, artifact)
    for (const evidence of buildRecoveryEvidence(trace, collected, analysis, manifest)) {
      yield { episode: evidence.episode, gapReport: evidence.gapReport }
    }
  }

  async snapshotManifest(context: ManifestContext): Promise<HarnessManifest> {
    if (this.#liveSource === undefined) {
      throw new Error('DeepSeek Harness live manifest source is not configured')
    }
    const result = buildLiveManifest(await this.#liveSource.snapshot(), context)
    for (const artifact of result.artifacts) this.#artifacts.set(artifact.artifactId, artifact)
    return result.manifest
  }

  async resolveArtifacts(refs: ArtifactRef[]): Promise<ArtifactDescriptor[]> {
    return refs.map((ref) => {
      const artifact = this.#artifacts.get(ref.refId)
      if (artifact === undefined || artifact.digest !== ref.digest) {
        throw new Error(`artifact is unavailable or digest-mismatched: ${ref.refId}`)
      }
      return artifact
    })
  }

  async importEvidence(input: TraceInput): Promise<DshImportResult> {
    const trace = await loadDshTrace(input)
    const normalizedEvents = normalizeDshTrace(trace)
    const analysis = analyzeDshTrace(normalizedEvents)
    const manifest = buildTraceOnlyManifest(trace, normalizedEvents, analysis)
    const episodes = buildRecoveryEvidence(trace, normalizedEvents, analysis, manifest)
    for (const artifact of analysis.artifacts) this.#artifacts.set(artifact.artifactId, artifact)
    return {
      sessionDigest: trace.sessionDigest,
      rawInputDigest: trace.rawInputDigest,
      rawTraceDigest: trace.rawTraceDigest,
      ...(trace.localLocator === undefined ? {} : { localLocator: trace.localLocator }),
      normalizedEvents,
      manifest,
      model: analysis.model,
      artifacts: analysis.artifacts,
      episodes,
    }
  }
}

export function digestConfigurationCell(result: Pick<DshImportResult, 'model' | 'manifest'>): string {
  return sha256(canonicalJson({ model: result.model, harnessManifestDigest: result.manifest.digest }))
}
