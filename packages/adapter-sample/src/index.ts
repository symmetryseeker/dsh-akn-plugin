import { readFile } from 'node:fs/promises'
import {
  canonicalJson,
  finalizeProtocolObject,
  sha256,
  toObjectRef,
  type ArtifactDescriptor,
  type ArtifactRef,
  type Digest,
  type EvidenceGapReport,
  type EpisodeEvidence,
  type HarnessAdapter,
  type HarnessIdentity,
  type HarnessManifest,
  type JsonRecord,
  type JsonValue,
  type ManifestContext,
  type NormalizedEvent,
  type TaskEpisode,
  type TraceInput,
} from '@aen/protocol'

export const SAMPLE_SCHEMA_NAMESPACE = 'https://aen.dev/examples/sample-harness/events' as const
export const SAMPLE_MAPPING_PROFILE = 'https://aen.dev/mappings/sample-harness-events-v1' as const
export const SAMPLE_MAPPING_VERSION = '0.1.0' as const

const MAX_INPUT_BYTES = 1024 * 1024
const RISK_CLASSES = new Set(['read_only', 'reversible_write', 'external_write', 'destructive'])
const CANDIDATE_REASONS = new Set([
  'acceptance_passed',
  'failure_recovery',
  'controlled_comparison',
  'repeated_strategy',
  'user_pinned',
  'high_risk_recovery',
])

interface SampleHeader {
  type: 'sample/session'
  version: 1
  sessionId: string
  createdAt: string
  harness: { name: string; version: string }
}

interface SampleEvent {
  type: 'activity' | 'learning/candidate'
  seq: number
  time: string
  candidateReason?: string
  outcome?: 'success' | 'partial' | 'failure' | 'unknown'
  task?: TaskEpisode['task']
  data?: JsonValue
}

export interface SampleImportResult {
  events: NormalizedEvent[]
  manifest: HarnessManifest
  episodes: TaskEpisode[]
  gapReports: EvidenceGapReport[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO timestamp`)
  }
  return value
}

function parseHeader(value: unknown): SampleHeader {
  if (!isRecord(value) || value.type !== 'sample/session' || value.version !== 1) {
    throw new Error('sample trace must start with a sample/session version 1 header')
  }
  if (typeof value.sessionId !== 'string' || value.sessionId.length === 0) {
    throw new Error('sample sessionId is required')
  }
  if (!isRecord(value.harness) || typeof value.harness.name !== 'string' || typeof value.harness.version !== 'string') {
    throw new Error('sample harness name and version are required')
  }
  return {
    type: 'sample/session',
    version: 1,
    sessionId: value.sessionId,
    createdAt: requireTimestamp(value.createdAt, 'createdAt'),
    harness: { name: value.harness.name, version: value.harness.version },
  }
}

function parseTask(value: unknown): TaskEpisode['task'] {
  if (!isRecord(value)) throw new Error('learning candidate task is required')
  const taxonomy = value.taxonomy
  const constraints = value.constraints
  const acceptance = value.acceptance
  if (!Array.isArray(taxonomy) || taxonomy.length === 0 || !taxonomy.every((item) => typeof item === 'string')) {
    throw new Error('candidate task.taxonomy must contain strings')
  }
  if (typeof value.intent !== 'string' || value.intent.length === 0) {
    throw new Error('candidate task.intent is required')
  }
  if (!Array.isArray(constraints) || !constraints.every((item) => typeof item === 'string')) {
    throw new Error('candidate task.constraints must contain strings')
  }
  if (!Array.isArray(acceptance) || !acceptance.every((item) => {
    return isRecord(item) && typeof item.id === 'string' && typeof item.description === 'string' && typeof item.required === 'boolean'
  })) {
    throw new Error('candidate task.acceptance is invalid')
  }
  if (typeof value.riskClass !== 'string' || !RISK_CLASSES.has(value.riskClass)) {
    throw new Error('candidate task.riskClass is invalid')
  }
  return value as unknown as TaskEpisode['task']
}

function parseEvent(value: unknown, expectedSeq: number): SampleEvent {
  if (!isRecord(value) || (value.type !== 'activity' && value.type !== 'learning/candidate')) {
    throw new Error(`sample event ${expectedSeq} has an unsupported type`)
  }
  if (value.seq !== expectedSeq) throw new Error('sample event sequence must be contiguous from zero')
  const event: SampleEvent = {
    type: value.type,
    seq: expectedSeq,
    time: requireTimestamp(value.time, `event ${expectedSeq} time`),
    ...(value.data === undefined ? {} : { data: value.data as JsonValue }),
  }
  if (value.type === 'learning/candidate') {
    if (typeof value.candidateReason !== 'string' || !CANDIDATE_REASONS.has(value.candidateReason)) {
      throw new Error(`event ${expectedSeq} candidateReason is not a high-value trigger`)
    }
    if (!['success', 'partial', 'failure', 'unknown'].includes(String(value.outcome))) {
      throw new Error(`event ${expectedSeq} outcome is invalid`)
    }
    event.candidateReason = value.candidateReason
    event.outcome = value.outcome as NonNullable<SampleEvent['outcome']>
    event.task = parseTask(value.task)
  }
  return event
}

async function inputBytes(input: TraceInput): Promise<Uint8Array> {
  if (input.bytes !== undefined && input.localPath !== undefined) {
    throw new Error('provide either bytes or localPath, not both')
  }
  const bytes = input.bytes ?? (input.localPath === undefined ? undefined : await readFile(input.localPath))
  if (bytes === undefined) throw new Error('sample trace bytes or localPath are required')
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error(`sample trace exceeds ${MAX_INPUT_BYTES} bytes`)
  const actual = sha256(bytes)
  if (input.expectedDigest !== undefined && input.expectedDigest !== actual) {
    throw new Error('sample trace digest mismatch')
  }
  return bytes
}

function parseLines(bytes: Uint8Array): { header: SampleHeader; rows: SampleEvent[]; digest: Digest } {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0)
  if (lines.length === 0) throw new Error('sample trace is empty')
  const values = lines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown
    } catch {
      throw new Error(`sample trace line ${index + 1} is not valid JSON`)
    }
  })
  return {
    header: parseHeader(values[0]),
    rows: values.slice(1).map((value, index) => parseEvent(value, index)),
    digest: sha256(bytes),
  }
}

function publish<T>(draft: JsonRecord): T {
  return finalizeProtocolObject<T>(draft)
}

function sessionDigestFrom(events: NormalizedEvent[]): Digest {
  const header = events.find((event) => event.kind === 'session')
  if (header === undefined || !header.eventId.endsWith(':header')) throw new Error('sample session header is missing')
  const digest = header.eventId.slice(0, -':header'.length)
  if (!digest.startsWith('sha256:')) throw new Error('sample session digest is invalid')
  return digest as Digest
}

export class SampleHarnessAdapter implements HarnessAdapter {
  readonly #gapReports = new Map<string, EvidenceGapReport>()
  #lastHeader?: SampleHeader
  #lastSessionDigest?: Digest

  async identify(): Promise<HarnessIdentity> {
    return {
      name: 'AEN Sample Harness',
      version: 'event-format-1',
      adapterName: '@aen/adapter-sample',
      adapterVersion: '0.1.0',
      capabilities: [
        'https://aen.dev/capabilities/sample/events-v1',
        'https://aen.dev/capabilities/aen/explicit-high-value-candidates-v1',
      ],
    }
  }

  async *importTrace(input: TraceInput): AsyncIterable<NormalizedEvent> {
    if (input.schemaNamespace !== SAMPLE_SCHEMA_NAMESPACE || input.schemaVersion !== '1') {
      throw new Error('sample adapter supports only the sample event namespace version 1')
    }
    const parsed = parseLines(await inputBytes(input))
    this.#lastHeader = parsed.header
    this.#lastSessionDigest = parsed.digest
    yield {
      eventId: `${parsed.digest}:header`,
      seq: -1,
      time: parsed.header.createdAt,
      kind: 'session',
      sourceType: parsed.header.type,
      sourceSchemaNamespace: SAMPLE_SCHEMA_NAMESPACE,
      sourceSchemaVersion: '1',
      mappingProfile: SAMPLE_MAPPING_PROFILE,
      mappingVersion: SAMPLE_MAPPING_VERSION,
      data: parsed.header as unknown as JsonValue,
      provenance: { sourcePath: '/1', inferred: false },
    }
    for (const [index, row] of parsed.rows.entries()) {
      yield {
        eventId: `${parsed.digest}:seq:${row.seq}`,
        seq: row.seq,
        time: row.time,
        kind: 'other',
        sourceType: row.type,
        sourceSchemaNamespace: SAMPLE_SCHEMA_NAMESPACE,
        sourceSchemaVersion: '1',
        mappingProfile: SAMPLE_MAPPING_PROFILE,
        mappingVersion: SAMPLE_MAPPING_VERSION,
        data: row as unknown as JsonValue,
        provenance: { sourcePath: `/${index + 2}`, inferred: false },
      }
    }
  }

  async *deriveEpisodes(events: AsyncIterable<NormalizedEvent>): AsyncIterable<EpisodeEvidence> {
    const collected: NormalizedEvent[] = []
    for await (const event of events) collected.push(event)
    const sessionDigest = sessionDigestFrom(collected)
    for (const event of collected) {
      if (event.sourceType !== 'learning/candidate' || !isRecord(event.data)) continue
      const row = parseEvent(event.data, event.seq)
      if (row.task === undefined || row.candidateReason === undefined || row.outcome === undefined) continue
      const base = `urn:aen:sample:${sha256(canonicalJson({ sessionDigest, seq: event.seq })).slice(7, 31)}`
      const report = publish<EvidenceGapReport>({
        protocolVersion: '0.1',
        objectType: 'evidence_gap_report',
        reportId: `${base}:gaps`,
        episodeId: `${base}:episode`,
        missing: [
          {
            field: 'traceEvidence',
            reason: 'unsupported_adapter',
            consequence: 'The sample format marks a candidate boundary but does not carry execution trace evidence.',
            remediation: 'A production adapter should emit a redacted TraceEvidenceBundle from an authoritative Harness export.',
          },
          {
            field: 'harness.effectiveSurface',
            reason: 'not_recorded',
            consequence: 'The sample trace cannot establish effective tools, skills, prompts, or policies.',
            remediation: 'Add a low-frequency native Manifest snapshot at a Harness configuration boundary.',
          },
        ],
        conflicts: [],
        maximumEvidenceLevel: 'H0',
        generatedAt: event.time ?? this.#lastHeader?.createdAt ?? '1970-01-01T00:00:00.000Z',
      })
      this.#gapReports.set(report.reportId, report)
      const episode = publish<TaskEpisode>({
        protocolVersion: '0.1',
        objectType: 'task_episode',
        episodeId: `${base}:episode`,
        sessionDigest,
        eventRange: { fromSeq: event.seq, toSeq: event.seq },
        task: row.task,
        boundaryReasons: [`high_value_trigger:${row.candidateReason}`],
        outcome: row.outcome,
        evidenceGapReportRef: toObjectRef(report as unknown as JsonRecord),
      })
      yield { episode, gapReport: report }
    }
  }

  async snapshotManifest(context: ManifestContext): Promise<HarnessManifest> {
    if (this.#lastHeader === undefined || this.#lastSessionDigest === undefined) {
      throw new Error('import a sample trace before requesting its trace-only Manifest')
    }
    return publish<HarnessManifest>({
      protocolVersion: '0.1',
      objectType: 'harness_manifest',
      manifestId: `urn:aen:sample:manifest:${this.#lastSessionDigest.slice(7, 31)}`,
      configurationDigest: sha256(canonicalJson({ harness: this.#lastHeader.harness, adapter: '@aen/adapter-sample' })),
      capturedAt: this.#lastHeader.createdAt,
      adapter: { name: '@aen/adapter-sample', version: '0.1.0' },
      harness: this.#lastHeader.harness,
      sessionScope: {
        sessionDigest: context.sessionDigest ?? this.#lastSessionDigest,
        ...(context.fromSeq === undefined ? {} : { fromSeq: context.fromSeq }),
        ...(context.toSeq === undefined ? {} : { toSeq: context.toSeq }),
      },
      modelSurface: {},
      artifacts: [],
      policies: {},
      environment: { capturedAt: this.#lastHeader.createdAt, disclosure: 'metadata' },
      coverage: {
        mode: 'trace_only',
        models: 'none',
        tools: 'none',
        skills: 'none',
        preset: 'none',
        policies: 'none',
        effectiveSurface: 'none',
        limitations: [
          'The sample adapter is an authoring example, not a production Harness integration.',
          'The event stream cannot prove Model identity or Harness effective surface.',
        ],
      },
    })
  }

  async resolveArtifacts(refs: ArtifactRef[]): Promise<ArtifactDescriptor[]> {
    if (refs.length !== 0) throw new Error('the sample adapter does not resolve artifacts')
    return []
  }

  getGapReports(): EvidenceGapReport[] {
    return [...this.#gapReports.values()].map((report) => structuredClone(report))
  }

  async importEvidence(input: TraceInput): Promise<SampleImportResult> {
    const events: NormalizedEvent[] = []
    for await (const event of this.importTrace(input)) events.push(event)
    const episodes: TaskEpisode[] = []
    async function* stream(): AsyncIterable<NormalizedEvent> { yield* events }
    for await (const evidence of this.deriveEpisodes(stream())) episodes.push(evidence.episode)
    const manifest = await this.snapshotManifest({ sessionDigest: sessionDigestFrom(events) })
    return { events, manifest, episodes, gapReports: this.getGapReports() }
  }
}
