import {
  canonicalJson,
  sha256,
  toObjectRef,
  type Digest,
  type EvidenceGapReport,
  type HarnessManifest,
  type JsonRecord,
  type NormalizedEvent,
  type RunObservation,
  type TaskEpisode,
  type TraceEvidenceBundle,
} from '@aen/protocol'
import { toolCallIdentity, toolResultIdentity, type DshTraceAnalysis } from './analyze.js'
import { dshConfigurationSystemPromptDigest } from './live.js'
import { DSH_MAPPING_PROFILE, DSH_MAPPING_VERSION, DSH_SCHEMA_NAMESPACE } from './normalize.js'
import { publishObject } from './object.js'
import type { DshEpisodeEvidence, DshLoadedTrace } from './types.js'
import type { DshEvaluationTrialEvidence, DshEvaluationTrialEvidenceInput } from './types.js'

const ADAPTER_NAME = '@aen/adapter-dsh'
const ADAPTER_VERSION = '0.1.0'

function shortDigest(value: Digest): string {
  return value.slice('sha256:'.length, 'sha256:'.length + 24)
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function buildTraceOnlyManifest(
  trace: DshLoadedTrace,
  events: NormalizedEvent[],
  analysis: DshTraceAnalysis,
): HarnessManifest {
  const ranges = events.filter((event) => event.seq >= 0).map((event) => event.seq)
  const fromSeq = ranges.length === 0 ? undefined : Math.min(...ranges)
  const toSeq = ranges.length === 0 ? undefined : Math.max(...ranges)
  const sessionHeader = events.find((event) => event.kind === 'session')
  const presetId =
    sessionHeader !== undefined && isRecord(sessionHeader.data) && typeof sessionHeader.data.agentPreset === 'string'
      ? sessionHeader.data.agentPreset
      : undefined
  const exactSystemPrompt = typeof analysis.effectiveHeader?.system === 'string'
    ? analysis.effectiveHeader.system
    : undefined
  const configurationSystemPromptDigest = exactSystemPrompt === undefined
    ? analysis.systemPromptDigest
    : dshConfigurationSystemPromptDigest(exactSystemPrompt, trace.header.cwd, analysis.model)
  const configurationDigest = sha256(canonicalJson({
    profile: 'aen.dsh.trace-only-configuration.v1',
    harnessVersion: trace.exporterVersion ?? 'unknown',
    presetId,
    systemPromptDigest: configurationSystemPromptDigest,
    toolSchemaSetDigest: analysis.toolSchemaSetDigest,
    skillCatalogDigest: analysis.skillCatalogDigest,
    policies: analysis.policyFacts,
  }))
  return publishObject<HarnessManifest>({
    protocolVersion: '0.1',
    objectType: 'harness_manifest',
    manifestId: `urn:aen:manifest:dsh:trace:${shortDigest(trace.sessionDigest)}`,
    configurationDigest,
    capturedAt: analysis.observedAt,
    adapter: { name: ADAPTER_NAME, version: ADAPTER_VERSION },
    harness: {
      name: 'DeepSeek Harness',
      version: trace.exporterVersion ?? 'unknown',
      ...(trace.exporterVersion === undefined ? {} : { distribution: 'DSH session export' }),
    },
    sessionScope: {
      sessionDigest: trace.sessionDigest,
      ...(fromSeq === undefined ? {} : { fromSeq }),
      ...(toSeq === undefined ? {} : { toSeq }),
    },
    ...(presetId === undefined ? {} : { preset: { id: presetId, trust: 'unknown' } }),
    modelSurface: {
      ...(analysis.systemPromptDigest === undefined
        ? {}
        : { systemPromptDigest: analysis.systemPromptDigest }),
      ...(analysis.toolSchemaSetDigest === undefined
        ? {}
        : { toolSchemaSetDigest: analysis.toolSchemaSetDigest }),
      ...(analysis.skillCatalogDigest === undefined
        ? {}
        : { skillCatalogDigest: analysis.skillCatalogDigest }),
      ...(analysis.requestConfigDigest === undefined
        ? {}
        : { requestConfigDigest: analysis.requestConfigDigest }),
    },
    artifacts: analysis.artifactRefs,
    policies: analysis.policyFacts,
    environment: analysis.environment,
    coverage: {
      mode: 'trace_only',
      ...analysis.coverage,
      limitations: [
        ...analysis.limitations,
        'The trace-only configuration digest excludes the separate Model and Environment axes and normalizes visible workspace/model-route prompt variables, but remains coverage-bound and is not interchangeable with a complete live configuration digest.',
        ...(trace.exporterVersion === undefined
          ? ['The session export did not declare a Harness/exporter version.']
          : []),
      ],
    },
    extensions: {
      'https://aen.dev/extensions/dsh/raw-trace-digest': trace.rawTraceDigest,
      'https://aen.dev/extensions/dsh/session-correlation-digest': sha256(trace.header.id),
    },
  })
}

interface RecoveryBoundary {
  toolName: string
  turn?: number
  failureCallSeq: number
  failureResultSeq: number
  successCallSeq: number
  successResultSeq: number
  failureEvent: NormalizedEvent
  successEvent: NormalizedEvent
}

function recoveryBoundaries(events: NormalizedEvent[]): RecoveryBoundary[] {
  const calls = new Map<string, ReturnType<typeof toolCallIdentity> & { seq: number }>()
  const failures: Array<{
    toolName: string
    turn?: number
    callSeq: number
    resultSeq: number
    event: NormalizedEvent
    consumed: boolean
  }> = []
  const boundaries: RecoveryBoundary[] = []
  for (const event of events) {
    const call = toolCallIdentity(event)
    if (call !== undefined) calls.set(call.callId, { ...call, seq: event.seq })
    const result = toolResultIdentity(event)
    if (result === undefined) continue
    const matchingCall = calls.get(result.callId)
    if (matchingCall === undefined) continue
    if (result.failed) {
      failures.push({
        toolName: matchingCall.name,
        ...(matchingCall.turn === undefined ? {} : { turn: matchingCall.turn }),
        callSeq: matchingCall.seq,
        resultSeq: event.seq,
        event,
        consumed: false,
      })
      continue
    }
    const failure = [...failures]
      .reverse()
      .find(
        (candidate) =>
          !candidate.consumed &&
          candidate.toolName === matchingCall.name &&
          (candidate.turn === undefined || matchingCall.turn === undefined || candidate.turn === matchingCall.turn) &&
          candidate.resultSeq < event.seq,
      )
    if (failure === undefined) continue
    failure.consumed = true
    boundaries.push({
      toolName: matchingCall.name,
      ...(matchingCall.turn === undefined ? {} : { turn: matchingCall.turn }),
      failureCallSeq: failure.callSeq,
      failureResultSeq: failure.resultSeq,
      successCallSeq: matchingCall.seq,
      successResultSeq: event.seq,
      failureEvent: failure.event,
      successEvent: event,
    })
  }
  return boundaries
}

function eventTime(event: NormalizedEvent, fallback: string): string {
  return event.time ?? fallback
}

function episodeBaseId(trace: DshLoadedTrace, boundary: RecoveryBoundary): string {
  return `urn:aen:episode:dsh:${shortDigest(
    sha256(canonicalJson({
      sessionDigest: trace.sessionDigest,
      fromSeq: boundary.failureCallSeq,
      toSeq: boundary.successResultSeq,
      trigger: 'failure_recovery',
    })),
  )}`
}

function gapReport(
  trace: DshLoadedTrace,
  analysis: DshTraceAnalysis,
  boundary: RecoveryBoundary,
  episodeId: string,
): EvidenceGapReport {
  const missing: Array<{
    field: string
    reason: 'not_recorded' | 'unsupported_adapter' | 'unavailable'
    consequence: string
    remediation?: string
  }> = [
    {
      field: 'harness.liveRegistrySnapshot',
      reason: 'unsupported_adapter',
      consequence: 'The trace cannot prove the complete Harness composition or registry state.',
      remediation: 'Capture a low-frequency DSH live manifest at the relevant configuration boundary.',
    },
    {
      field: 'task.riskClass',
      reason: 'not_recorded',
      consequence: 'The derived task is conservatively classified as destructive.',
      remediation: 'Review the tool semantics and set the task risk class manually.',
    },
    {
      field: 'evaluation.counterfactual',
      reason: 'unavailable',
      consequence: 'A failure followed by success is observational evidence and does not establish causality.',
      remediation: 'Run a controlled baseline/treatment comparison before making a causal claim.',
    },
  ]
  if (trace.exporterVersion === undefined) {
    missing.push({
      field: 'harness.version',
      reason: 'not_recorded',
      consequence: 'Compatibility with a particular DSH build cannot be established.',
    })
  }
  if (analysis.model.provider === 'unknown' || analysis.model.modelId === 'unknown') {
    missing.push({
      field: 'model.identity',
      reason: 'not_recorded',
      consequence: 'The episode cannot support model-specific claims.',
    })
  }
  if (analysis.skills.some((skill) => skill.states.some((state) => state !== 'catalog'))) {
    missing.push({
      field: 'skills.packageClosure',
      reason: 'not_recorded',
      consequence: 'Loaded instructions do not identify scripts, references, assets, license, or dependency closure.',
      remediation: 'Resolve the skill through a live snapshot and hash the allowed package closure.',
    })
  }
  return publishObject<EvidenceGapReport>({
    protocolVersion: '0.1',
    objectType: 'evidence_gap_report',
    reportId: `${episodeId}:gaps`,
    episodeId,
    missing,
    conflicts: [],
    maximumEvidenceLevel: 'H1',
    generatedAt: eventTime(boundary.successEvent, analysis.observedAt),
  })
}

function taskEpisode(
  trace: DshLoadedTrace,
  boundary: RecoveryBoundary,
  episodeId: string,
  gaps: EvidenceGapReport,
): TaskEpisode {
  return publishObject<TaskEpisode>({
    protocolVersion: '0.1',
    objectType: 'task_episode',
    episodeId,
    sessionDigest: trace.sessionDigest,
    eventRange: { fromSeq: boundary.failureCallSeq, toSeq: boundary.successResultSeq },
    task: {
      taxonomy: ['software-engineering', 'failure-recovery', `tool:${boundary.toolName}`],
      intent: `Recover from a failed ${boundary.toolName} tool call and verify a later successful call.`,
      constraints: [
        'Derived from durable DSH event boundaries without copying raw tool arguments or results.',
        'Causal interpretation requires a controlled comparison.',
      ],
      acceptance: [
        {
          id: 'recovery-success',
          description: `A later ${boundary.toolName} call completed without a recorded tool error.`,
          evaluatorRef: 'urn:aen:evaluator:dsh-recovery-detector:v1',
          required: true,
        },
      ],
      inputTraits: ['prior-tool-failure'],
      outputTraits: ['subsequent-tool-success'],
      riskClass: 'destructive',
    },
    boundaryReasons: [
      'high_value_trigger:failure_to_recovery',
      `failed_tool_result_seq:${boundary.failureResultSeq}`,
      `successful_retest_seq:${boundary.successResultSeq}`,
    ],
    outcome: 'success',
    evidenceGapReportRef: toObjectRef(gaps as unknown as JsonRecord),
  })
}

function traceEvidence(
  trace: DshLoadedTrace,
  boundary: RecoveryBoundary,
  episode: TaskEpisode,
): TraceEvidenceBundle {
  const excerpt = canonicalJson({
    trigger: 'failure_to_recovery',
    tool: boundary.toolName,
    failed: { callSeq: boundary.failureCallSeq, resultSeq: boundary.failureResultSeq },
    recovered: { callSeq: boundary.successCallSeq, resultSeq: boundary.successResultSeq },
  })
  return publishObject<TraceEvidenceBundle>({
    protocolVersion: '0.1',
    objectType: 'trace_evidence',
    evidenceId: `${episode.episodeId}:trace`,
    source: {
      harness: 'DeepSeek Harness',
      sessionDigest: trace.sessionDigest,
      schemaNamespace: DSH_SCHEMA_NAMESPACE,
      schemaVersion: '0',
      ...(trace.exporterVersion === undefined ? {} : { exporterVersion: trace.exporterVersion }),
      mappingProfile: DSH_MAPPING_PROFILE,
      mappingVersion: DSH_MAPPING_VERSION,
    },
    eventRange: episode.eventRange,
    episodeDigest: episode.digest,
    excerpts: [
      {
        mediaType: 'application/vnd.aen.dsh-recovery-summary+json',
        content: excerpt,
        sourceDigest: trace.rawTraceDigest,
        transformationIds: ['dsh.recovery.metadata-only.v1'],
      },
    ],
    commitments: { rawTraceDigest: trace.rawTraceDigest },
    ...(trace.localLocator === undefined ? {} : { localLocator: trace.localLocator }),
    disclosure: 'redacted_excerpt',
    redaction: {
      scannerVersions: { 'dsh-metadata-projection': '0.1.0' },
      transformations: [
        { ruleId: 'remove-tool-arguments', count: 2 },
        { ruleId: 'remove-tool-results', count: 2 },
        { ruleId: 'remove-local-paths', count: trace.localLocator === undefined ? 0 : 1 },
      ],
      residualRisk: 'low',
      humanReviewed: false,
    },
  })
}

function usageMetrics(events: NormalizedEvent[], fromSeq: number, toSeq: number): JsonRecord {
  let inputTokens = 0
  let outputTokens = 0
  let cachedTokens = 0
  let reasoningTokens = 0
  let hasUsage = false
  for (const event of events) {
    if (event.seq < fromSeq || event.seq > toSeq || event.sourceType !== 'assistant/message') continue
    if (!isRecord(event.data) || !isRecord(event.data.usage)) continue
    const usage = event.data.usage
    const add = (key: string): number =>
      typeof usage[key] === 'number' && Number.isFinite(usage[key]) && usage[key] >= 0
        ? Number(usage[key])
        : 0
    inputTokens += add('inputTokens')
    outputTokens += add('outputTokens')
    cachedTokens += add('cacheReadTokens') + add('cacheWriteTokens')
    reasoningTokens += add('reasoningTokens')
    hasUsage = true
  }
  return hasUsage ? { inputTokens, outputTokens, cachedTokens, reasoningTokens } : {}
}

function observation(
  events: NormalizedEvent[],
  boundary: RecoveryBoundary,
  episode: TaskEpisode,
  evidence: TraceEvidenceBundle,
  manifest: HarnessManifest,
  analysis: DshTraceAnalysis,
): RunObservation {
  const evidenceRef = toObjectRef(evidence as unknown as JsonRecord) as ReturnType<typeof toObjectRef> & {
    objectType: 'trace_evidence'
  }
  const rangedEvents = events.filter(
    (event) => event.seq >= boundary.failureCallSeq && event.seq <= boundary.successResultSeq,
  )
  const toolCalls = rangedEvents.filter((event) => event.sourceType === 'tool/call').length
  const toolFailures = rangedEvents.filter(
    (event) => toolResultIdentity(event)?.failed === true,
  ).length
  const startMs = boundary.failureEvent.time === undefined ? undefined : Date.parse(boundary.failureEvent.time)
  const endMs = boundary.successEvent.time === undefined ? undefined : Date.parse(boundary.successEvent.time)
  const latencyMs =
    startMs === undefined || endMs === undefined || !Number.isFinite(startMs) || !Number.isFinite(endMs)
      ? undefined
      : Math.max(0, endMs - startMs)
  const evaluator = {
    actorId: 'urn:aen:evaluator:dsh-recovery-detector:v1',
    type: 'service' as const,
    displayName: 'DSH failure-to-recovery detector',
  }
  return publishObject<RunObservation>({
    protocolVersion: '0.1',
    objectType: 'observation',
    observationId: `${episode.episodeId}:observation`,
    taskRef: episode.episodeId,
    evaluatorRef: evaluator.actorId,
    configurationCell: {
      model: analysis.model,
      harnessConfigurationDigest: manifest.configurationDigest,
      harnessManifestDigest: manifest.digest,
      environment: analysis.environment,
    },
    treatment: 'baseline',
    outcome: 'success',
    acceptanceResults: [
      {
        criterionId: 'recovery-success',
        passed: true,
        evidenceRefs: [evidenceRef],
      },
    ],
    metrics: {
      ...usageMetrics(events, boundary.failureCallSeq, boundary.successResultSeq),
      ...(latencyMs === undefined ? {} : { latencyMs }),
      toolCalls,
      toolFailures,
    },
    evidenceRefs: [evidenceRef],
    independence: { evaluatorActor: evaluator },
    createdAt: eventTime(boundary.successEvent, analysis.observedAt),
    extensions: {
      'https://aen.dev/extensions/aen/observation-kind': 'observed_recovery',
      'https://aen.dev/extensions/aen/causal-status': 'not_established',
    },
  })
}

export function buildRecoveryEvidence(
  trace: DshLoadedTrace,
  events: NormalizedEvent[],
  analysis: DshTraceAnalysis,
  manifest: HarnessManifest,
): DshEpisodeEvidence[] {
  return recoveryBoundaries(events).map((boundary) => {
    const episodeId = episodeBaseId(trace, boundary)
    const gaps = gapReport(trace, analysis, boundary, episodeId)
    const episode = taskEpisode(trace, boundary, episodeId, gaps)
    const evidence = traceEvidence(trace, boundary, episode)
    return {
      gapReport: gaps,
      episode,
      traceEvidence: evidence,
      observation: observation(events, boundary, episode, evidence, manifest, analysis),
    }
  })
}

/**
 * Build one explicit task boundary for a preregistered evaluation run. This is
 * intentionally different from mining every tool call: the scheduled trial is
 * itself the high-value boundary, while the raw DSH transcript remains local.
 */
export function buildEvaluationTrialEvidence(
  input: DshEvaluationTrialEvidenceInput,
): DshEvaluationTrialEvidence {
  const events = input.imported.normalizedEvents.filter((event) => event.seq >= 0)
  if (events.length === 0) throw new Error('DSH evaluation transcript contains no durable events')
  const fromSeq = Math.min(...events.map((event) => event.seq))
  const toSeq = Math.max(...events.map((event) => event.seq))
  const episodeId = `urn:aen:episode:dsh-evaluation:${shortDigest(sha256(canonicalJson({
    runId: input.runId,
    sessionDigest: input.imported.sessionDigest,
    fromSeq,
    toSeq,
  })))}`
  const gapReport = publishObject<EvidenceGapReport>({
    protocolVersion: '0.1',
    objectType: 'evidence_gap_report',
    reportId: `${episodeId}:gaps`,
    episodeId,
    missing: [
      {
        field: 'evaluation.counterfactual',
        reason: 'unavailable',
        consequence: 'One trial measures an outcome but cannot establish a causal effect by itself.',
        remediation: 'Use the frozen baseline/treatment matrix aggregate before making an H3 claim.',
      },
      {
        field: 'trace.rawContent',
        reason: 'redacted',
        consequence: 'The metadata projection contains commitments and task metadata, not prompts, tool arguments, or outputs.',
        remediation: 'Inspect the authorized local transcript when adjudication requires raw content.',
      },
    ],
    conflicts: [],
    maximumEvidenceLevel: 'H2',
    generatedAt: events.at(-1)?.time ?? new Date().toISOString(),
  })
  const episode = publishObject<TaskEpisode>({
    protocolVersion: '0.1',
    objectType: 'task_episode',
    episodeId,
    sessionDigest: input.imported.sessionDigest,
    eventRange: { fromSeq, toSeq },
    task: input.task,
    boundaryReasons: [
      'high_value_trigger:explicit_evaluation_trial',
      `live_manifest:${input.liveManifestDigest}`,
      `run_id:${input.runId}`,
    ],
    outcome: input.outcome,
    evidenceGapReportRef: toObjectRef(gapReport as unknown as JsonRecord),
  })
  const summary = canonicalJson({
    boundary: 'explicit_evaluation_trial',
    runId: input.runId,
    eventRange: { fromSeq, toSeq },
    eventCount: events.length,
    sourceTypes: [...new Set(events.map((event) => event.sourceType))].sort(),
    liveManifestDigest: input.liveManifestDigest,
  })
  const traceEvidence = publishObject<TraceEvidenceBundle>({
    protocolVersion: '0.1',
    objectType: 'trace_evidence',
    evidenceId: `${episodeId}:trace`,
    source: {
      harness: 'DeepSeek Harness',
      sessionDigest: input.imported.sessionDigest,
      schemaNamespace: DSH_SCHEMA_NAMESPACE,
      schemaVersion: '0',
      mappingProfile: DSH_MAPPING_PROFILE,
      mappingVersion: DSH_MAPPING_VERSION,
    },
    eventRange: { fromSeq, toSeq },
    episodeDigest: episode.digest,
    excerpts: [{
      mediaType: 'application/vnd.aen.dsh-evaluation-summary+json',
      content: summary,
      sourceDigest: input.imported.rawTraceDigest,
      transformationIds: ['dsh.evaluation.metadata-only.v1'],
    }],
    commitments: { rawTraceDigest: input.imported.rawTraceDigest },
    ...(input.imported.localLocator === undefined ? {} : { localLocator: input.imported.localLocator }),
    disclosure: 'metadata',
    redaction: {
      scannerVersions: { 'dsh-evaluation-metadata-projection': '0.1.0' },
      transformations: [
        { ruleId: 'remove-user-messages', count: events.filter((event) => event.sourceType === 'user/message').length },
        { ruleId: 'remove-assistant-content', count: events.filter((event) => event.sourceType.startsWith('assistant/')).length },
        { ruleId: 'remove-tool-arguments-and-results', count: events.filter((event) => event.kind === 'tool_call' || event.kind === 'tool_result').length },
        { ruleId: 'exclude-local-paths-from-excerpts', count: input.imported.localLocator === undefined ? 0 : 1 },
      ],
      residualRisk: 'low',
      humanReviewed: false,
    },
    extensions: {
      'https://aen.dev/extensions/aen/evaluation-run-id': input.runId,
      'https://aen.dev/extensions/aen/live-manifest-digest': input.liveManifestDigest,
    },
  })
  return { gapReport, episode, traceEvidence }
}
