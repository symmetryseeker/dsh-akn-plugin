import {
  canonicalJson,
  finalizeProtocolObject,
  sha256,
  toObjectRef,
  type ArtifactDescriptor,
  type EvidenceGapReport,
  type ExperienceRevision,
  type HarnessManifest,
  type JsonRecord,
  type RunObservation,
  type TaskEpisode,
  type TraceEvidenceBundle,
} from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'
import { validateExperienceComposition } from './validation.js'
import type { DistillOptions, DistillResult } from './types.js'

const DEFAULT_PUBLISHER = {
  actorId: 'urn:aen:actor:local-reviewer',
  type: 'human' as const,
  displayName: 'Local AEN reviewer',
}

const SESSION_CORRELATION_EXTENSION =
  'https://aen.dev/extensions/dsh/session-correlation-digest'

function objectBySelector<T>(store: LocalEvidenceStore, selector: string, objectType: string): T {
  const inspected = store.inspect(selector)
  if (inspected === undefined || inspected.summary.objectType !== objectType) {
    throw new Error(`${objectType} not found: ${selector}`)
  }
  return inspected.object as unknown as T
}

function objectByDigest<T>(store: LocalEvidenceStore, digest: string, objectType: string): T {
  const object = store.getByDigest(digest as `sha256:${string}`)
  if (object === undefined || object.objectType !== objectType) {
    throw new Error(`${objectType} does not resolve: ${digest}`)
  }
  return object as unknown as T
}

function findForEpisode<T extends JsonRecord>(
  store: LocalEvidenceStore,
  objectType: string,
  predicate: (object: T) => boolean,
): T {
  for (const summary of store.listObjects(objectType)) {
    const object = store.getByDigest(summary.digest) as T | undefined
    if (object !== undefined && predicate(object)) return object
  }
  throw new Error(`${objectType} for episode was not found`)
}

function evidenceLevel(
  value: EvidenceGapReport['maximumEvidenceLevel'],
  completeLiveManifest: boolean,
): 'H0' | 'H1' | 'H2' {
  if (value === 'H0') return 'H0'
  return completeLiveManifest ? 'H2' : 'H1'
}

function correlationDigest(manifest: HarnessManifest): string | undefined {
  const value = manifest.extensions?.[SESSION_CORRELATION_EXTENSION]
  return typeof value === 'string' && value.startsWith('sha256:') ? value : undefined
}

function sameEffectiveSurface(trace: HarnessManifest, live: HarnessManifest): boolean {
  const keys: Array<keyof HarnessManifest['modelSurface']> = [
    'systemPromptDigest',
    'toolSchemaSetDigest',
    'requestConfigDigest',
  ]
  let compared = 0
  for (const key of keys) {
    const left = trace.modelSurface[key]
    const right = live.modelSurface[key]
    if (left === undefined || right === undefined) continue
    compared += 1
    if (left !== right) return false
  }
  return compared >= 2
}

function skillNames(store: LocalEvidenceStore, manifest: HarnessManifest): Set<string> {
  return new Set(manifest.artifacts.flatMap((ref) => {
    if (ref.kind !== 'skill') return []
    const artifact = store.getByDigest(ref.digest)
    return artifact?.objectType === 'artifact' && typeof artifact.name === 'string'
      ? [artifact.name]
      : []
  }))
}

function correlatedCompleteLiveManifest(
  store: LocalEvidenceStore,
  trace: HarnessManifest,
  episode: TaskEpisode,
): HarnessManifest | undefined {
  const correlation = correlationDigest(trace)
  if (correlation === undefined) return undefined
  const observedSkills = skillNames(store, trace)
  const candidates = store.listObjects('harness_manifest')
    .map((summary) => store.getByDigest(summary.digest) as unknown as HarnessManifest | undefined)
    .filter((manifest): manifest is HarnessManifest =>
      manifest !== undefined && manifest.coverage.mode === 'live_snapshot' &&
      correlationDigest(manifest) === correlation &&
      manifest.coverage.models === 'complete' &&
      manifest.coverage.tools === 'complete' &&
      manifest.coverage.skills === 'complete' &&
      manifest.coverage.effectiveSurface === 'complete' &&
      typeof manifest.sessionScope.toSeq === 'number' &&
      manifest.sessionScope.toSeq <= episode.eventRange.fromSeq &&
      sameEffectiveSurface(trace, manifest) &&
      [...observedSkills].every((name) => skillNames(store, manifest).has(name)))
  return candidates.sort((left, right) =>
    (right.sessionScope.toSeq ?? -1) - (left.sessionScope.toSeq ?? -1))[0]
}

function toolName(episode: TaskEpisode): string {
  const tagged = episode.task.taxonomy.find((entry) => entry.startsWith('tool:'))
  return tagged?.slice('tool:'.length) || 'tool'
}

export function distillEpisode(
  store: LocalEvidenceStore,
  selector: string,
  options: DistillOptions = {},
): DistillResult {
  const episode = objectBySelector<TaskEpisode>(store, selector, 'task_episode')
  if (!episode.boundaryReasons.some((reason) => reason.startsWith('high_value_trigger:'))) {
    throw new Error('episode is not a high-value candidate trigger')
  }
  const gap = objectByDigest<EvidenceGapReport>(
    store,
    episode.evidenceGapReportRef.digest,
    'evidence_gap_report',
  )
  const trace = findForEpisode<TraceEvidenceBundle & JsonRecord>(
    store,
    'trace_evidence',
    (object) => object.episodeDigest === episode.digest,
  )
  const observation = findForEpisode<RunObservation & JsonRecord>(
    store,
    'observation',
    (object) => object.taskRef === episode.episodeId,
  )
  const traceManifest = objectByDigest<HarnessManifest>(
    store,
    observation.configurationCell.harnessManifestDigest,
    'harness_manifest',
  )
  const liveManifest = correlatedCompleteLiveManifest(store, traceManifest, episode)
  const manifest = liveManifest ?? traceManifest
  const resolvedArtifacts: ArtifactDescriptor[] = []
  for (const ref of manifest.artifacts) {
    resolvedArtifacts.push(objectByDigest<ArtifactDescriptor>(store, ref.digest, 'artifact'))
  }

  const publisher = options.publisher ?? DEFAULT_PUBLISHER
  const experienceId = `urn:aen:experience:dsh:recovery:${sha256(canonicalJson({ episode: episode.digest })).slice(7, 31)}`
  const traceRef = toObjectRef(trace) as ExperienceRevision['evidenceRefs'][number]
  const observationRef = toObjectRef(observation) as ExperienceRevision['evidenceRefs'][number]
  const episodeRef = toObjectRef(episode as unknown as JsonRecord)
  const manifestRef = toObjectRef(manifest as unknown as JsonRecord)
  const applicability: ExperienceRevision['applicability'] = {
    taskFamilies: episode.task.taxonomy,
    modelSelectors: [
      { path: 'model.provider', operator: 'equals', value: observation.configurationCell.model.provider },
      { path: 'model.modelId', operator: 'equals', value: observation.configurationCell.model.modelId },
    ],
    harnessSelectors: [
      { path: 'harness.configurationDigest', operator: 'digestEquals', value: manifest.configurationDigest },
    ],
    excludedConditions: [
      'The failed operation cannot be retried safely.',
      'The Harness or effective Model surface changed without a new observation.',
    ],
    revalidateOn: [
      { kind: 'model_change' },
      { kind: 'harness_change' },
      { kind: 'artifact_change' },
      { kind: 'environment_change' },
      { kind: 'contention' },
    ],
  }
  const tool = toolName(episode)
  const level = evidenceLevel(gap.maximumEvidenceLevel, liveManifest !== undefined)
  const resolvedTraceOnlyGaps = liveManifest === undefined
    ? new Set<string>()
    : new Set(['harness.liveRegistrySnapshot', 'skills.packageClosure'])
  const limitations = [
    ...manifest.coverage.limitations,
    ...gap.missing
      .filter((item) => !resolvedTraceOnlyGaps.has(item.field))
      .map((item) => `${item.field}: ${item.consequence}`),
    ...(liveManifest === undefined ? [] : [
      'A same-session Live Manifest resolved the trace-only Harness/Skill identity gaps at H2; it does not establish that the Skill or Harness configuration caused the outcome.',
    ]),
    'No contradicting observation was available at distillation time.',
    'The trace proves outcome order but does not expose the exact intervention between failure and recovery.',
  ]
  const experience = finalizeProtocolObject<ExperienceRevision>({
    protocolVersion: '0.1',
    objectType: 'experience_revision',
    experienceId,
    revision: 1,
    createdAt: observation.createdAt,
    relations: [
      { type: 'derived_from', target: episodeRef, evidenceRefs: [traceRef, observationRef] },
      ...(liveManifest === undefined ? [] : [{
        type: 'derived_from' as const,
        target: manifestRef,
        evidenceRefs: [traceRef, observationRef],
      }]),
    ],
    kind: 'failure_recovery',
    namespace: options.namespace ?? 'local.aen.dsh.failure-recovery',
    publisher,
    languages: ['en'],
    title: `Recover after a failed ${tool} call and verify the retry`,
    summary: `One DSH episode recorded a failed ${tool} result followed by a later successful ${tool} result in the same Model × Harness configuration. The exact corrective intervention was not captured.`,
    intendedUses: [
      `Guide human-reviewed recovery after a failed ${tool} call.`,
      'Preserve the failure signal, make an explicit corrective change, and verify the acceptance condition.',
    ],
    outOfScopeUses: [
      'Automatic retries without checking side-effect and permission risk.',
      'Claims that the recipe caused success or generalizes to another Model or Harness configuration.',
    ],
    knownLimitations: [...new Set(limitations)],
    knownFailureModes: [
      'Repeating the same call without changing the failed condition.',
      'Treating a later successful call as proof of causality.',
      'Applying the pattern to destructive or non-idempotent operations without review.',
    ],
    task: episode.task,
    claims: [{
      claimId: `${experienceId}#observed-recovery`,
      type: 'strategy_works',
      statement: `In this recorded Configuration Cell, a failed ${tool} result was followed by a later successful ${tool} result; the trace does not establish which intervention caused recovery.`,
      mode: 'observational',
      evidenceLevel: level,
      scope: applicability,
      supportingEvidenceRefs: [observationRef, traceRef],
      contradictingEvidenceRefs: [],
      artifactRefs: manifest.artifacts,
      falsificationConditions: [
        'A replay under the same configuration does not reproduce the failure-to-success sequence.',
        'The successful result is found to belong to a different task, tool identity, or configuration.',
        'The trace mapping or evaluator boundary is invalidated.',
      ],
      assumptions: [
        'The DSH durable session order is authoritative for this episode.',
        'The recovery detector correctly paired calls with results.',
      ],
    }],
    applicability,
    recipe: {
      strategy: `Treat the first ${tool} failure as a diagnostic checkpoint, not as proof that an unchanged retry will work.`,
      preconditions: [
        { checkId: 'failure-recorded', description: 'A concrete failed result is available for local diagnosis.', required: true },
        { checkId: 'retry-safe', description: 'Retry is permitted and safe for the operation risk class.', required: true },
      ],
      steps: [
        {
          stepId: 'preserve-failure-signal',
          instruction: 'Inspect the local failure evidence and preserve the error category before changing anything.',
          rationaleSummary: 'The shared Experience intentionally omits raw arguments and results; diagnosis stays local.',
          riskClass: 'read_only',
          evidenceRefs: [traceRef],
        },
        {
          stepId: 'make-corrective-change',
          instruction: 'Identify and record one corrective change that addresses the observed failure before retrying.',
          rationaleSummary: 'The source trace did not capture this intervention, so it remains a human-reviewed step rather than an evidence-backed fact.',
          riskClass: episode.task.riskClass,
        },
        {
          stepId: 'retry-within-policy',
          instruction: `Retry ${tool} only within the task budget, permissions, and side-effect policy.`,
          riskClass: episode.task.riskClass,
          evidenceRefs: [traceRef],
        },
        {
          stepId: 'verify-acceptance',
          instruction: 'Verify the task acceptance condition independently of the absence of a tool error.',
          riskClass: 'read_only',
          evidenceRefs: [observationRef],
        },
      ],
      checkpoints: episode.task.acceptance.map((criterion) => ({
        checkId: criterion.id,
        description: criterion.description,
        required: criterion.required,
      })),
      fallbacks: [
        { when: 'The failure repeats or no corrective change can be justified.', action: 'Stop retrying and request human diagnosis with local evidence.', riskClass: 'read_only' },
        { when: 'The retry would be destructive or exceed policy.', action: 'Do not execute; choose a reversible diagnostic path.', riskClass: 'read_only' },
      ],
      stopConditions: [
        'Permission or approval is denied.',
        'The operation is destructive and lacks explicit authorization.',
        'The same failure repeats without new evidence.',
      ],
    },
    cases: [{
      positive: {
        caseId: `${experienceId}#positive`,
        contextSummary: `A prior ${tool} result failed in the recorded episode.`,
        actionSummary: `A later ${tool} call was attempted after an intervention that the trace did not capture.`,
        outcomeSummary: `The later ${tool} result carried no recorded tool error.`,
        traceEvidenceRefs: [traceRef],
        redaction: trace.redaction,
      },
      negative: {
        caseId: `${experienceId}#negative`,
        contextSummary: `The earlier ${tool} call in the same episode.`,
        actionSummary: 'The call reached a recorded failed tool result.',
        outcomeSummary: 'The task had not yet reached the recovery acceptance boundary.',
        failureSignals: [`recorded ${tool} tool error`],
        traceEvidenceRefs: [traceRef],
        redaction: trace.redaction,
      },
      difference: 'The evidence establishes only failed-versus-later-successful outcome order; it does not reveal the corrective intervention or prove causality.',
    }],
    evidenceRefs: [traceRef, observationRef],
    artifactRefs: manifest.artifacts,
    governance: {
      visibility: 'private',
      owner: publisher,
      dataClasses: ['internal'],
      redistribution: 'none',
      sourcePolicy: 'aen.local-distillation.v1',
      redactionReport: trace.redaction,
      safetyLabels: ['human-review-required', 'no-automatic-execution', 'observational-only'],
    },
    extensions: {
      'https://aen.dev/extensions/aen/source-episode-digest': episode.digest,
      'https://aen.dev/extensions/aen/evidence-gap-digest': gap.digest,
      'https://aen.dev/extensions/aen/distiller': 'deterministic-constrained-v1',
    },
  })
  validateExperienceComposition(store, experience)
  store.putBatch({ objects: [{ object: experience as unknown as JsonRecord, role: 'private_experience_draft' }] })
  const review = store.getExperienceReview(experience.digest) ?? store.recordExperienceReview({
    selector: experience.digest,
    state: 'draft',
    reviewerActorId: publisher.actorId,
    note: 'Deterministic private draft; no public Promotion has been performed.',
    updatedAt: observation.createdAt,
  })
  return {
    experience,
    review,
    inputRefs: {
      episode: episodeRef,
      traceEvidence: traceRef,
      observation: observationRef,
      manifest: toObjectRef(manifest as unknown as JsonRecord),
      gapReport: toObjectRef(gap as unknown as JsonRecord),
    },
  }
}
