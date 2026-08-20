import type { ArtifactDescriptor, EvidenceGapReport, HarnessManifest, TaskEpisode } from './schemas.js'
import type { ArtifactRef, Digest, JsonValue } from './components.js'

export interface HarnessIdentity {
  name: string
  version: string
  adapterName: string
  adapterVersion: string
  capabilities: string[]
}

export interface TraceInput {
  mediaType: string
  sourceName: string
  schemaNamespace: string
  schemaVersion?: string
  exporterVersion?: string
  bytes?: Uint8Array
  localPath?: string
  expectedDigest?: Digest
}

export interface NormalizedEvent {
  eventId: string
  seq: number
  time?: string
  kind:
    | 'session'
    | 'turn'
    | 'step'
    | 'request'
    | 'message'
    | 'tool_call'
    | 'tool_result'
    | 'policy'
    | 'compaction'
    | 'other'
  sourceType: string
  sourceSchemaNamespace: string
  sourceSchemaVersion?: string
  mappingProfile: string
  mappingVersion: string
  data: JsonValue
  provenance: { sourcePath: string; inferred: boolean; inferenceRuleId?: string }
}

export interface ManifestContext {
  sessionDigest?: Digest
  cwdScopeDigest?: Digest
  fromSeq?: number
  toSeq?: number
}

export interface HarnessAdapter {
  identify(): Promise<HarnessIdentity>
  importTrace(input: TraceInput): AsyncIterable<NormalizedEvent>
  deriveEpisodes(events: AsyncIterable<NormalizedEvent>): AsyncIterable<EpisodeEvidence>
  snapshotManifest?(context: ManifestContext): Promise<HarnessManifest>
  resolveArtifacts?(refs: ArtifactRef[]): Promise<ArtifactDescriptor[]>
}

export interface EpisodeEvidence {
  episode: TaskEpisode
  gapReport: EvidenceGapReport
}
