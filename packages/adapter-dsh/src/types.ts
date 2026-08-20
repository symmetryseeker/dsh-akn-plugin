import type {
  ArtifactDescriptor,
  BenchmarkTask,
  Digest,
  EnvironmentFingerprint,
  EvidenceGapReport,
  HarnessManifest,
  JsonValue,
  ModelFingerprint,
  NormalizedEvent,
  RunObservation,
  TaskEpisode,
  TraceEvidenceBundle,
} from '@aen/protocol'

export interface DshSessionHeader {
  type: 'session'
  version: 0
  id: string
  createdAt: number
  cwd?: string
  parentSession?: string
  seedLength?: number
  origin?: 'subagent'
  delegationDepth: number
  agentPreset?: string
}

export interface DshSessionEvent {
  type: string
  seq: number
  time: number
  data: JsonValue
  ignorable?: true
  sourceEventSeqs?: number[]
  surfaceOp?: JsonValue
}

export interface DshDecodedEvent {
  event: DshSessionEvent
  sourceLine: number
  inferred: boolean
  inferenceRuleId?: string
}

export interface DshLoadedTrace {
  header: DshSessionHeader
  events: DshDecodedEvent[]
  sessionDigest: Digest
  rawInputDigest: Digest
  rawTraceDigest: Digest
  localLocator?: string
  sourceName: string
  exporterVersion?: string
}

export interface DshEpisodeEvidence {
  gapReport: EvidenceGapReport
  episode: TaskEpisode
  traceEvidence: TraceEvidenceBundle
  observation: RunObservation
}

/** Metadata-only evidence boundary for one intentionally scheduled evaluation trial. */
export interface DshEvaluationTrialEvidence {
  gapReport: EvidenceGapReport
  episode: TaskEpisode
  traceEvidence: TraceEvidenceBundle
}

export interface DshEvaluationTrialEvidenceInput {
  runId: string
  task: BenchmarkTask['task']
  outcome: TaskEpisode['outcome']
  imported: DshImportResult
  liveManifestDigest: Digest
}

export interface DshImportResult {
  sessionDigest: Digest
  rawInputDigest: Digest
  rawTraceDigest: Digest
  localLocator?: string
  normalizedEvents: NormalizedEvent[]
  manifest: HarnessManifest
  model: ModelFingerprint
  artifacts: ArtifactDescriptor[]
  episodes: DshEpisodeEvidence[]
}

export interface DshLiveSkillSnapshot {
  name: string
  description: string
  provider?: string
  source?: string
  resourceBaseKind?: 'directory' | 'url' | 'opaque'
  invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
  content?: string
  entrypoint?: string
  resources?: Array<{ logicalName: string; mediaType?: string; digest: Digest }>
  closure: 'interface_only' | 'partial_snapshot' | 'complete_package'
  licenseExpression?: string
  redistributable: boolean
}

export interface DshLiveSnapshot {
  capturedAt: string
  harness: { version: string; commit?: string; distribution?: string }
  model: ModelFingerprint
  sessionDigest?: Digest
  sessionCorrelationDigest?: Digest
  sequenceRange?: { fromSeq?: number; toSeq?: number }
  preset?: { id: string; composition: JsonValue; trust?: 'system' | 'user' | 'unknown' }
  systemPrompt?: string
  /** Digest of the prompt template after an authoritative source removes run-local workspace/model facts. */
  configurationSystemPromptDigest?: Digest
  toolSchemas: JsonValue[]
  skills: DshLiveSkillSnapshot[]
  skillRegistryComplete: boolean
  policies: {
    sandbox?: JsonValue
    approval?: JsonValue
    filesystem?: JsonValue
    network?: JsonValue
    compaction?: JsonValue
    retry?: JsonValue
    subagents?: JsonValue
    memory?: JsonValue
    contextSelection?: JsonValue
    toolTimeout?: JsonValue
  }
  environment: EnvironmentFingerprint
  limitations?: string[]
}

export interface DshLiveManifestSource {
  snapshot(): Promise<DshLiveSnapshot>
}
