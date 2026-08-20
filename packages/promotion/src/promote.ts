import {
  canonicalJson,
  computeObjectDigest,
  createAttestation,
  finalizeProtocolObject,
  sha256,
  toObjectRef,
  validateProtocolObject,
  type ArtifactDescriptor,
  type ArtifactRef,
  type Attestation,
  type BenchmarkTask,
  type EvidenceGapReport,
  type EvaluationAggregate,
  type EvaluationTrial,
  type ExperienceRevision,
  type GraderDefinition,
  type HarnessManifest,
  type JsonRecord,
  type ObjectRef,
  type PromotionRecord,
  type RunObservation,
  type TaskEpisode,
  type TraceEvidenceBundle,
} from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'
import { assertNoHazardousInstructions, assertNoRestrictedContent } from './scanner.js'
import { assertContributionGraphClosed } from './closure.js'
import type { PromoteOptions, PromotionResult } from './types.js'

type EvidenceRef = ExperienceRevision['evidenceRefs'][number]

const MVP_PUBLIC_ARTIFACT_KEYS = new Set([
  'protocolVersion', 'objectType', 'artifactId', 'kind', 'name', 'version', 'provider',
  'formatProfile', 'formatVersion', 'snapshotCompleteness', 'digest', 'interfaceDigest',
  'contentDigest', 'treeDigest', 'dependencySetDigest', 'presentationDigest', 'description',
  'invocation', 'source', 'licenseExpression', 'redistributable', 'requestedPermissions',
  'disclosure', 'requiredCapabilities', 'extensions',
])

/** Enforce the MVP metadata/digest/license-only public Artifact profile. */
export function assertMvpPublicArtifactDisclosure(artifact: JsonRecord): void {
  const unknown = Object.keys(artifact).filter((key) => !MVP_PUBLIC_ARTIFACT_KEYS.has(key))
  if (unknown.length > 0) {
    throw new Error(`public artifact ${String(artifact.digest)} contains non-metadata fields: ${unknown.join(', ')}`)
  }
  const source = artifact.source as JsonRecord | undefined
  const unknownSourceKeys = source === undefined ? [] : Object.keys(source).filter((key) => !['type', 'revision'].includes(key))
  if (unknownSourceKeys.length > 0) {
    throw new Error(`public artifact ${String(artifact.digest)} source contains non-metadata fields: ${unknownSourceKeys.join(', ')}`)
  }
  if (source?.uri !== undefined) throw new Error(`public artifact ${String(artifact.digest)} contains a source URI`)
  const invocation = artifact.invocation as JsonRecord | undefined
  const unknownInvocationKeys = invocation === undefined
    ? []
    : Object.keys(invocation).filter((key) => !['modelInvocable', 'userInvocable'].includes(key))
  if (unknownInvocationKeys.length > 0) {
    throw new Error(`public artifact ${String(artifact.digest)} invocation contains non-metadata fields: ${unknownInvocationKeys.join(', ')}`)
  }
  if (artifact.disclosure !== 'digest_only' && artifact.disclosure !== 'metadata') {
    throw new Error(`public artifact ${String(artifact.digest)} exceeds metadata disclosure`)
  }
  if (artifact.extensions !== undefined) {
    const encoded = canonicalJson(artifact.extensions)
    if (Buffer.byteLength(encoded, 'utf8') > 32 * 1024) {
      throw new Error(`public artifact ${String(artifact.digest)} extensions exceed metadata limit`)
    }
    const stack: Array<{ value: unknown; key: string }> = [{ value: artifact.extensions, key: 'extensions' }]
    let nodes = 0
    while (stack.length > 0) {
      const item = stack.pop()
      if (item === undefined) break
      nodes += 1
      if (nodes > 512) throw new Error(`public artifact ${String(artifact.digest)} extensions exceed metadata node limit`)
      if (/(?:^|[-_.:/])(body|blob|bytes|content|data|payload|archive|executable|entrypoint|attachment|resource|uri)(?:$|[-_.:/])/i.test(item.key)) {
        throw new Error(`public artifact ${String(artifact.digest)} extension contains body/distribution field: ${item.key}`)
      }
      if (typeof item.value === 'string' && Buffer.byteLength(item.value, 'utf8') > 4 * 1024) {
        throw new Error(`public artifact ${String(artifact.digest)} extension string exceeds metadata limit`)
      }
      if (Array.isArray(item.value)) {
        item.value.forEach((value, index) => stack.push({ value, key: String(index) }))
      } else if (item.value !== null && typeof item.value === 'object') {
        Object.entries(item.value as JsonRecord).forEach(([key, value]) => stack.push({ value, key }))
      }
    }
  }
}

function object(store: LocalEvidenceStore, digest: `sha256:${string}`, type: string): JsonRecord {
  const value = store.getByDigest(digest)
  if (value === undefined || value.objectType !== type) throw new Error(`${type} does not resolve: ${digest}`)
  return value
}

function publicId(value: string): string {
  return `${value}:public`
}

function publicSessionDigest(source: TaskEpisode, createdAt: string): `sha256:${string}` {
  return sha256(canonicalJson({
    scope: 'aen.public-session-pseudonym.v1',
    episodeDigest: source.digest,
    createdAt,
  }))
}

function attachAttestation<T extends JsonRecord>(
  value: T,
  attestation: Attestation,
  field: 'attestation' | 'attestations',
): T {
  const result = {
    ...value,
    ...(field === 'attestation' ? { attestation } : { attestations: [attestation] }),
  }
  const validation = validateProtocolObject(result)
  if (!validation.ok) throw new Error(`signed object is invalid: ${validation.issues.map((issue) => issue.message).join('; ')}`)
  return result as T
}

function signObject(
  objectValue: JsonRecord,
  options: PromoteOptions,
  role: string,
  issuedAt: string,
): Attestation {
  const ref = toObjectRef(objectValue)
  return createAttestation({
    attestationId: `urn:aen:attestation:${sha256(canonicalJson({ role, digest: ref.digest })).slice(7, 31)}`,
    subject: ref,
    issuer: options.actor,
    issuedAt,
    role,
    scope: ['public'],
    key: options.key,
  })
}

function publicGap(
  source: EvidenceGapReport,
  publicEpisodeId: string,
  createdAt: string,
): EvidenceGapReport {
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  draft.reportId = publicId(source.reportId)
  draft.episodeId = publicEpisodeId
  draft.generatedAt = createdAt
  const result = finalizeProtocolObject<EvidenceGapReport>(draft)
  assertNoRestrictedContent(result, 'public EvidenceGapReport')
  return result
}

function publicEpisode(
  source: TaskEpisode,
  gap: EvidenceGapReport,
  createdAt: string,
): TaskEpisode {
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  draft.episodeId = publicId(source.episodeId)
  draft.sessionDigest = publicSessionDigest(source, createdAt)
  draft.evidenceGapReportRef = toObjectRef(gap as unknown as JsonRecord)
  const result = finalizeProtocolObject<TaskEpisode>(draft)
  assertNoRestrictedContent(result, 'public TaskEpisode')
  return result
}

function publicTrace(
  source: TraceEvidenceBundle,
  episode: TaskEpisode,
  createdAt: string,
): TraceEvidenceBundle {
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  delete draft.localLocator
  draft.evidenceId = publicId(source.evidenceId)
  draft.episodeDigest = episode.digest
  ;(draft.source as JsonRecord).sessionDigest = episode.sessionDigest
  const redaction = draft.redaction as JsonRecord
  redaction.humanReviewed = true
  redaction.reviewedAt = createdAt
  const transformations = redaction.transformations as JsonRecord[]
  const existing = transformations.find((entry) => entry.ruleId === 'remove-local-locator')
  if (existing === undefined) transformations.push({ ruleId: 'remove-local-locator', count: source.localLocator === undefined ? 0 : 1 })
  const result = finalizeProtocolObject<TraceEvidenceBundle>(draft)
  assertNoRestrictedContent(result, 'public TraceEvidenceBundle')
  return result
}

export function projectPublicArtifact(source: ArtifactDescriptor): ArtifactDescriptor {
  if (source.redistributable && source.licenseExpression === undefined) {
    throw new Error(`redistributable artifact lacks license: ${source.artifactId}`)
  }
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  draft.artifactId = publicId(source.artifactId)

  // Artifact bodies and externally resolvable attachments are never implicitly promoted.
  delete draft.sbomRef
  delete draft.vulnerabilityAttestationRefs
  delete draft.buildProvenanceRef
  delete draft.securityScanRefs
  delete draft.attachmentRefs
  delete draft.distribution
  delete draft.entrypoint
  delete draft.resources
  if (draft.source !== undefined) {
    const sourceMetadata = draft.source as JsonRecord
    delete sourceMetadata.uri
  }
  draft.disclosure = 'metadata'
  const result = finalizeProtocolObject<ArtifactDescriptor>(draft)
  assertNoRestrictedContent(result, `public artifact ${source.artifactId}`)
  assertMvpPublicArtifactDisclosure(result as unknown as JsonRecord)
  return result
}

function artifactRef(artifact: ArtifactDescriptor): ArtifactRef {
  return {
    ...toObjectRef(artifact as unknown as JsonRecord),
    objectType: 'artifact',
    kind: artifact.kind,
  } as ArtifactRef
}

function replaceArtifactRefs(
  refs: readonly ArtifactRef[],
  replacements: Map<string, ArtifactRef>,
): ArtifactRef[] {
  return refs.map((ref) => replacements.get(ref.digest) ?? ref)
}

export function projectPublicManifest(
  source: HarnessManifest,
  artifactReplacements: Map<string, ArtifactRef>,
): HarnessManifest {
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  delete draft.attestation
  draft.manifestId = publicId(source.manifestId)
  draft.sessionScope = {}
  if (draft.extensions !== undefined) {
    const extensions = draft.extensions as JsonRecord
    delete extensions['https://aen.dev/extensions/dsh/session-correlation-digest']
    delete extensions['https://aen.dev/extensions/dsh/raw-trace-digest']
    if (Object.keys(extensions).length === 0) delete draft.extensions
  }
  draft.artifacts = replaceArtifactRefs(source.artifacts, artifactReplacements)
  const coverage = draft.coverage as JsonRecord
  coverage.limitations = [
    ...(Array.isArray(coverage.limitations) ? coverage.limitations : []),
    'This public metadata projection preserves the source Harness configuration commitment but omits private/session data and cannot independently recompute configurationDigest.',
  ]
  const result = finalizeProtocolObject<HarnessManifest>(draft)
  assertNoRestrictedContent(result, `public manifest ${source.manifestId}`)
  return result
}

function projectPublicGrader(source: GraderDefinition): GraderDefinition {
  if (source.rubricRef !== undefined || source.implementationRef !== undefined || source.calibrationSetRef !== undefined) {
    throw new Error(`public MVP GraderDefinition requires rubric/implementation/calibration refs to be promoted explicitly first: ${source.graderId}`)
  }
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  draft.graderId = publicId(source.graderId)
  const model = draft.modelFingerprint as JsonRecord | undefined
  if (model !== undefined) {
    delete model.pricingSnapshotRef
    delete model.rateLimitSnapshotRef
  }
  const result = finalizeProtocolObject<GraderDefinition>(draft)
  assertNoRestrictedContent(result, `public GraderDefinition ${source.graderId}`)
  return result
}

function projectPublicBenchmark(
  source: BenchmarkTask,
  graderReplacements: Map<string, ObjectRef>,
): BenchmarkTask {
  if (
    source.environment.fixtureRefs.length > 0 ||
    source.environment.setupCommandRef !== undefined ||
    (source.environment.externalServiceSnapshotRefs?.length ?? 0) > 0 ||
    source.validity.replacementRef !== undefined
  ) {
    throw new Error(`public MVP BenchmarkTask requires fixture/setup/replacement refs to be promoted explicitly first: ${source.benchmarkId}`)
  }
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  draft.benchmarkId = publicId(source.benchmarkId)
  draft.graderRefs = source.graderRefs.map((ref) => {
    const replacement = graderReplacements.get(ref.digest)
    if (replacement === undefined) throw new Error(`public GraderDefinition replacement missing: ${ref.digest}`)
    return replacement
  })
  const result = finalizeProtocolObject<BenchmarkTask>(draft)
  assertNoRestrictedContent(result, `public BenchmarkTask ${source.benchmarkId}`)
  return result
}

function replaceEvidenceRefs(
  refs: readonly EvidenceRef[],
  replacements: Map<string, EvidenceRef>,
): EvidenceRef[] {
  return refs.map((ref) => replacements.get(ref.digest) ?? ref)
}

function replaceHarnessSelectors(
  applicability: ExperienceRevision['applicability'],
  replacements: Map<string, HarnessManifest>,
): ExperienceRevision['applicability'] {
  return {
    ...applicability,
    ...(applicability.harnessSelectors === undefined ? {} : {
      harnessSelectors: applicability.harnessSelectors.map((selector) => ({
        ...selector,
        ...(selector.value === undefined ? {} : {
          value: typeof selector.value === 'string'
            ? replacements.get(selector.value)?.digest ?? selector.value
            : selector.value.map((value) => replacements.get(value)?.digest ?? value),
        }),
      })),
    }),
  }
}

function publicObservation(
  source: RunObservation,
  evidenceReplacements: Map<string, EvidenceRef>,
  episodeIdReplacements: Map<string, string>,
  manifestReplacements: Map<string, HarnessManifest>,
  options: PromoteOptions,
  createdAt: string,
  preserveExperienceRef: boolean,
): { observation: RunObservation; attestation: Attestation } {
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  delete draft.attestation
  if (!preserveExperienceRef) delete draft.experienceRef
  draft.observationId = publicId(source.observationId)
  draft.taskRef = episodeIdReplacements.get(source.taskRef) ?? source.taskRef
  draft.evidenceRefs = replaceEvidenceRefs(source.evidenceRefs, evidenceReplacements)
  draft.acceptanceResults = source.acceptanceResults.map((result) => ({
    ...result,
    evidenceRefs: replaceEvidenceRefs(result.evidenceRefs, evidenceReplacements),
  }))
  const configurationCell = draft.configurationCell as JsonRecord
  const model = configurationCell.model as JsonRecord
  delete model.pricingSnapshotRef
  delete model.rateLimitSnapshotRef
  const manifest = manifestReplacements.get(source.configurationCell.harnessManifestDigest)
  if (manifest === undefined) throw new Error(`public manifest replacement missing: ${source.configurationCell.harnessManifestDigest}`)
  configurationCell.harnessManifestDigest = manifest.digest
  draft.governance = {
    visibility: 'public',
    owner: options.actor,
    license: options.license,
    dataClasses: ['public'],
    redistribution: 'public_mirrors',
    consentRef: options.consentRef,
    sourcePolicy: options.policyDecisionRef,
    redactionReport: {
      scannerVersions: { 'aen-public-scanner': '0.1.0' },
      transformations: [{ ruleId: 'public-observation-projection', count: 1 }],
      residualRisk: 'low',
      humanReviewed: true,
      reviewedAt: createdAt,
    },
    safetyLabels: ['measured-observation', 'untrusted-evidence', 'no-automatic-execution'],
  }
  const unsigned = finalizeProtocolObject<RunObservation>(draft)
  assertNoRestrictedContent(unsigned, 'public RunObservation')
  const attestation = signObject(unsigned as unknown as JsonRecord, options, 'public-observation', createdAt)
  return {
    observation: attachAttestation(unsigned as unknown as JsonRecord, attestation, 'attestation') as unknown as RunObservation,
    attestation,
  }
}

function sanitizedExtensions(source: ExperienceRevision): JsonRecord | undefined {
  if (source.extensions === undefined) return undefined
  const extensions = structuredClone(source.extensions) as JsonRecord
  delete extensions['https://aen.dev/extensions/aen/source-episode-digest']
  delete extensions['https://aen.dev/extensions/aen/evidence-gap-digest']
  return Object.keys(extensions).length === 0 ? undefined : extensions
}

function rewriteExperience(
  source: ExperienceRevision,
  evidenceReplacements: Map<string, EvidenceRef>,
  relationReplacements: Map<string, ObjectRef>,
  artifactReplacements: Map<string, ArtifactRef>,
  manifestReplacements: Map<string, HarnessManifest>,
  options: PromoteOptions,
  createdAt: string,
  publicSupersedes: ExperienceRevision['supersedes'] | undefined,
): ExperienceRevision {
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  delete draft.attestations
  // The private source link stays in PromotionRecord. Exposing it here would leak a private digest.
  if (publicSupersedes === undefined) delete draft.supersedes
  else draft.supersedes = publicSupersedes
  draft.revision = source.revision + 1
  draft.createdAt = createdAt
  draft.publisher = options.actor
  const extensions = sanitizedExtensions(source)
  if (extensions === undefined) delete draft.extensions
  else draft.extensions = extensions
  draft.relations = source.relations.map((relation) => ({
    ...relation,
    target: relationReplacements.get(relation.target.digest) ?? relation.target,
    ...(relation.evidenceRefs === undefined ? {} : {
      evidenceRefs: replaceEvidenceRefs(relation.evidenceRefs, evidenceReplacements),
    }),
  }))
  draft.claims = source.claims.map((claim) => ({
    ...claim,
    scope: replaceHarnessSelectors(claim.scope, manifestReplacements),
    supportingEvidenceRefs: replaceEvidenceRefs(claim.supportingEvidenceRefs, evidenceReplacements),
    contradictingEvidenceRefs: replaceEvidenceRefs(claim.contradictingEvidenceRefs, evidenceReplacements),
    ...(claim.artifactRefs === undefined ? {} : {
      artifactRefs: replaceArtifactRefs(claim.artifactRefs, artifactReplacements),
    }),
  }))
  draft.evidenceRefs = replaceEvidenceRefs(source.evidenceRefs, evidenceReplacements)
  draft.artifactRefs = replaceArtifactRefs(source.artifactRefs, artifactReplacements)
  if (source.recipe !== undefined) {
    draft.recipe = {
      ...source.recipe,
      steps: source.recipe.steps.map((step) => ({
        ...step,
        ...(step.evidenceRefs === undefined ? {} : {
          evidenceRefs: replaceEvidenceRefs(step.evidenceRefs, evidenceReplacements),
        }),
      })),
    }
  }
  if (source.cases !== undefined) {
    draft.cases = source.cases.map((pair) => ({
      ...pair,
      positive: {
        ...pair.positive,
        traceEvidenceRefs: replaceEvidenceRefs(pair.positive.traceEvidenceRefs, evidenceReplacements),
        redaction: { ...pair.positive.redaction, humanReviewed: true, reviewedAt: createdAt },
      },
      negative: {
        ...pair.negative,
        traceEvidenceRefs: replaceEvidenceRefs(pair.negative.traceEvidenceRefs, evidenceReplacements),
        redaction: { ...pair.negative.redaction, humanReviewed: true, reviewedAt: createdAt },
      },
    }))
  }
  draft.applicability = replaceHarnessSelectors(source.applicability, manifestReplacements)
  draft.governance = {
    ...source.governance,
    visibility: 'public',
    owner: options.actor,
    license: options.license,
    dataClasses: ['public'],
    redistribution: 'public_mirrors',
    consentRef: options.consentRef,
    sourcePolicy: 'aen.public-promotion.v1',
    redactionReport: {
      ...source.governance.redactionReport,
      humanReviewed: true,
      reviewedAt: createdAt,
      transformations: [
        ...source.governance.redactionReport.transformations,
        { ruleId: 'promotion-remove-local-references', count: 1 },
        { ruleId: 'promotion-rewrite-evidence-digests', count: evidenceReplacements.size },
        { ruleId: 'promotion-rewrite-artifact-digests', count: artifactReplacements.size },
        { ruleId: 'promotion-rewrite-manifest-digests', count: manifestReplacements.size },
      ],
    },
    safetyLabels: [...new Set([...source.governance.safetyLabels, 'public-reviewed', 'no-automatic-execution'])],
  }
  return finalizeProtocolObject<ExperienceRevision>(draft)
}

function finalizePromotion(
  draft: JsonRecord,
  options: PromoteOptions,
  createdAt: string,
): { promotion: PromotionRecord; attestation: Attestation } {
  const withDigest = { ...draft, digest: computeObjectDigest(draft) }
  const attestation = signObject(withDigest, options, 'public-promotion', createdAt)
  const promotion = { ...withDigest, attestation } as unknown as PromotionRecord
  const validation = validateProtocolObject(promotion)
  if (!validation.ok) throw new Error(`PromotionRecord is invalid: ${validation.issues.map((issue) => issue.message).join('; ')}`)
  return { promotion, attestation }
}

function uniqueByDigest(objects: JsonRecord[]): JsonRecord[] {
  return [...new Map(objects.map((value) => [String(value.digest), value])).values()]
}

export function promoteExperience(
  store: LocalEvidenceStore,
  selector: string,
  options: PromoteOptions,
): PromotionResult {
  const inspected = store.inspect(selector)
  if (inspected === undefined || inspected.summary.objectType !== 'experience_revision') {
    throw new Error(`private ExperienceRevision not found: ${selector}`)
  }
  const source = inspected.object as unknown as ExperienceRevision
  if (source.governance.visibility !== 'private') throw new Error('source ExperienceRevision must be private')
  if (store.getExperienceReview(source.digest)?.state !== 'public_requested') {
    throw new Error('Promotion requires an explicit public_requested review decision')
  }
  if (options.license.trim().length === 0) throw new Error('public Experience requires an explicit license')
  if (options.consentRef.trim().length === 0) throw new Error('public Experience requires explicit consentRef')
  if (options.policyDecisionRef.trim().length === 0) throw new Error('public Experience requires policyDecisionRef')
  const createdAt = options.createdAt ?? new Date().toISOString()
  const publicSupersedes = source.supersedes === undefined
    ? undefined
    : (() => {
        const predecessor = store.getByDigest(source.supersedes!.digest)
        return predecessor?.objectType === 'experience_revision' &&
          (predecessor.governance as JsonRecord | undefined)?.visibility === 'public'
          ? source.supersedes
          : undefined
      })()

  const aggregateSources = uniqueByDigest(source.relations
    .filter((relation) => relation.type === 'evaluated_on' && relation.target.objectType === 'evaluation_aggregate')
    .map((relation) => object(store, relation.target.digest, 'evaluation_aggregate'))) as unknown as EvaluationAggregate[]
  const trialSources = uniqueByDigest(aggregateSources.flatMap((aggregate) => aggregate.trialRefs)
    .map((ref) => object(store, ref.digest, 'evaluation_trial'))) as unknown as EvaluationTrial[]
  const transcriptRefs = trialSources.flatMap((trial) => trial.transcriptRef === undefined ? [] : [trial.transcriptRef])
  if (transcriptRefs.length > 0) {
    throw new Error('public MVP evaluation promotion requires transcriptRefs to be promoted explicitly first')
  }
  const benchmarkSources = uniqueByDigest([
    ...aggregateSources.flatMap((aggregate) => aggregate.benchmarkRefs),
    ...trialSources.map((trial) => trial.benchmarkRef),
  ].map((ref) => object(store, ref.digest, 'benchmark_task'))) as unknown as BenchmarkTask[]
  const graderSources = uniqueByDigest(benchmarkSources.flatMap((benchmark) => benchmark.graderRefs)
    .map((ref) => object(store, ref.digest, 'grader_definition'))) as unknown as GraderDefinition[]
  const evaluationObservationSources = uniqueByDigest(trialSources
    .map((trial) => object(store, trial.runObservationRef.digest, 'observation'))) as unknown as RunObservation[]

  const traceSources = uniqueByDigest(source.evidenceRefs
    .filter((ref) => ref.objectType === 'trace_evidence')
    .map((ref) => object(store, ref.digest, 'trace_evidence'))) as unknown as TraceEvidenceBundle[]
  const episodeSources = uniqueByDigest(traceSources.map((trace) =>
    object(store, trace.episodeDigest, 'task_episode'))) as unknown as TaskEpisode[]
  const gapSources = episodeSources.map((episode) =>
    object(store, episode.evidenceGapReportRef.digest, 'evidence_gap_report') as unknown as EvidenceGapReport)

  const publicGaps = gapSources.map((gap, index) =>
    publicGap(gap, publicId(episodeSources[index]!.episodeId), createdAt))
  const publicEpisodes = episodeSources.map((episode, index) =>
    publicEpisode(episode, publicGaps[index]!, createdAt))
  const episodeBySourceDigest = new Map(episodeSources.map((episode, index) =>
    [episode.digest, publicEpisodes[index]!] as const))
  const publicTraceEvidence = traceSources.map((trace) => {
    const episode = episodeBySourceDigest.get(trace.episodeDigest)
    if (episode === undefined) throw new Error(`public TaskEpisode replacement missing: ${trace.episodeDigest}`)
    return publicTrace(trace, episode, createdAt)
  })

  const evidenceReplacements = new Map<string, EvidenceRef>()
  traceSources.forEach((trace, index) => {
    evidenceReplacements.set(trace.digest, toObjectRef(publicTraceEvidence[index] as unknown as JsonRecord) as EvidenceRef)
  })
  const relationReplacements = new Map<string, ObjectRef>()
  episodeSources.forEach((episode, index) => {
    relationReplacements.set(episode.digest, toObjectRef(publicEpisodes[index] as unknown as JsonRecord))
  })

  const observationSources = uniqueByDigest([
    ...source.evidenceRefs
      .filter((ref) => ref.objectType === 'observation')
      .map((ref) => object(store, ref.digest, 'observation')),
    ...evaluationObservationSources as unknown as JsonRecord[],
  ]) as unknown as RunObservation[]
  const selectorManifestDigests = source.applicability.harnessSelectors
    ?.filter((selector) =>
      selector.path === 'harness.manifestDigest' && selector.operator === 'digestEquals')
    .flatMap((selector) => typeof selector.value === 'string' ? [selector.value] : selector.value ?? []) ?? []
  const relationManifestDigests = source.relations
    .filter((relation) => relation.target.objectType === 'harness_manifest')
    .map((relation) => relation.target.digest)
  const manifestSources = uniqueByDigest([
    ...observationSources.map((observation) =>
      object(store, observation.configurationCell.harnessManifestDigest, 'harness_manifest')),
    ...selectorManifestDigests.map((digest) => object(store, digest as `sha256:${string}`, 'harness_manifest')),
    ...relationManifestDigests.map((digest) => object(store, digest, 'harness_manifest')),
  ]) as unknown as HarnessManifest[]
  const artifactSources = uniqueByDigest([
    ...source.artifactRefs,
    ...manifestSources.flatMap((manifest) => manifest.artifacts),
  ].map((ref) => object(store, ref.digest, 'artifact'))) as unknown as ArtifactDescriptor[]
  const artifacts = artifactSources.map(projectPublicArtifact)
  const artifactReplacements = new Map<string, ArtifactRef>()
  artifactSources.forEach((artifact, index) => artifactReplacements.set(artifact.digest, artifactRef(artifacts[index]!)))
  const manifests = manifestSources.map((manifest) => projectPublicManifest(manifest, artifactReplacements))
  const manifestReplacements = new Map<string, HarnessManifest>()
  manifestSources.forEach((manifest, index) => manifestReplacements.set(manifest.digest, manifests[index]!))
  manifestSources.forEach((manifest, index) => {
    relationReplacements.set(manifest.digest, toObjectRef(manifests[index] as unknown as JsonRecord))
  })
  const graders = graderSources.map(projectPublicGrader)
  const graderReplacements = new Map<string, ObjectRef>()
  graderSources.forEach((grader, index) => {
    graderReplacements.set(grader.digest, toObjectRef(graders[index] as unknown as JsonRecord))
  })
  const benchmarks = benchmarkSources.map((benchmark) => projectPublicBenchmark(benchmark, graderReplacements))
  const benchmarkReplacements = new Map<string, ObjectRef>()
  benchmarkSources.forEach((benchmark, index) => {
    benchmarkReplacements.set(benchmark.digest, toObjectRef(benchmarks[index] as unknown as JsonRecord))
  })
  const episodeIdReplacements = new Map(episodeSources.map((episode, index) =>
    [episode.episodeId, publicEpisodes[index]!.episodeId] as const))
  benchmarkSources.forEach((benchmark, index) => {
    episodeIdReplacements.set(benchmark.benchmarkId, benchmarks[index]!.benchmarkId)
  })
  const signedObservations = observationSources.map((observation) =>
    publicObservation(
      observation,
      evidenceReplacements,
      episodeIdReplacements,
      manifestReplacements,
      options,
      createdAt,
      observation.experienceRef !== undefined && (() => {
        const referenced = store.getByDigest(observation.experienceRef!.digest)
        return referenced?.objectType === 'experience_revision' &&
          (referenced.governance as JsonRecord | undefined)?.visibility === 'public'
      })(),
    ))
  observationSources.forEach((observation, index) => {
    evidenceReplacements.set(observation.digest, toObjectRef(signedObservations[index]!.observation as unknown as JsonRecord) as EvidenceRef)
  })

  const evaluationTrials = trialSources.map((trial) => {
    const benchmarkRef = benchmarkReplacements.get(trial.benchmarkRef.digest)
    const observationRef = evidenceReplacements.get(trial.runObservationRef.digest)
    if (benchmarkRef === undefined) throw new Error(`public BenchmarkTask replacement missing: ${trial.benchmarkRef.digest}`)
    if (observationRef === undefined) throw new Error(`public evaluation Observation replacement missing: ${trial.runObservationRef.digest}`)
    const draft = structuredClone(trial) as unknown as JsonRecord
    delete draft.digest
    draft.trialId = publicId(trial.trialId)
    draft.benchmarkRef = benchmarkRef
    draft.runObservationRef = observationRef
    delete draft.transcriptRef
    draft.graderResults = trial.graderResults.map((result) => ({
      ...result,
      evidenceRefs: replaceEvidenceRefs(result.evidenceRefs, evidenceReplacements),
    }))
    const projected = finalizeProtocolObject<EvaluationTrial>(draft)
    assertNoRestrictedContent(projected, `public EvaluationTrial ${trial.trialId}`)
    return projected
  })
  const trialReplacements = new Map<string, ObjectRef>()
  trialSources.forEach((trial, index) => {
    trialReplacements.set(trial.digest, toObjectRef(evaluationTrials[index] as unknown as JsonRecord))
  })
  const evaluationAggregates = aggregateSources.map((aggregate) => {
    const draft = structuredClone(aggregate) as unknown as JsonRecord
    delete draft.digest
    draft.aggregateId = publicId(aggregate.aggregateId)
    draft.benchmarkRefs = aggregate.benchmarkRefs.map((ref) => {
      const replacement = benchmarkReplacements.get(ref.digest)
      if (replacement === undefined) throw new Error(`public BenchmarkTask replacement missing: ${ref.digest}`)
      return replacement
    })
    draft.trialRefs = aggregate.trialRefs.map((ref) => {
      const replacement = trialReplacements.get(ref.digest)
      if (replacement === undefined) throw new Error(`public EvaluationTrial replacement missing: ${ref.digest}`)
      return replacement
    })
    draft.cellSummaries = aggregate.cellSummaries.map((cell) => ({
      ...cell,
      trialRefs: cell.trialRefs.map((ref) => {
        const replacement = trialReplacements.get(ref.digest)
        if (replacement === undefined) throw new Error(`public EvaluationTrial replacement missing: ${ref.digest}`)
        return replacement
      }),
    }))
    const projected = finalizeProtocolObject<EvaluationAggregate>(draft)
    assertNoRestrictedContent(projected, `public EvaluationAggregate ${aggregate.aggregateId}`)
    return projected
  })
  aggregateSources.forEach((aggregate, index) => {
    relationReplacements.set(aggregate.digest, toObjectRef(evaluationAggregates[index] as unknown as JsonRecord))
  })

  const targetUnsigned = rewriteExperience(
    source,
    evidenceReplacements,
    relationReplacements,
    artifactReplacements,
    manifestReplacements,
    options,
    createdAt,
    publicSupersedes,
  )
  assertNoHazardousInstructions(targetUnsigned, 'public Experience')
  assertNoRestrictedContent(targetUnsigned, 'public ExperienceRevision')
  const targetAttestation = signObject(targetUnsigned as unknown as JsonRecord, options, 'public-experience', createdAt)
  const target = attachAttestation(
    targetUnsigned as unknown as JsonRecord,
    targetAttestation,
    'attestations',
  ) as unknown as ExperienceRevision

  const promotionId = `urn:aen:promotion:${sha256(canonicalJson({ source: source.digest, target: target.digest })).slice(7, 31)}`
  const { promotion, attestation: promotionAttestation } = finalizePromotion({
    protocolVersion: '0.1',
    objectType: 'promotion_record',
    promotionId,
    sourceRef: toObjectRef(source as unknown as JsonRecord),
    targetRef: toObjectRef(target as unknown as JsonRecord),
    from: 'private',
    to: 'public',
    transformations: [
      {
        transformationId: `${promotionId}:governance`,
        ruleId: 'private-to-public-governance',
        action: 'change_disclosure',
        sourcePath: '/governance',
        targetPath: '/governance',
        beforeDigest: sha256(canonicalJson(source.governance)),
        afterDigest: sha256(canonicalJson(target.governance)),
      },
      {
        transformationId: `${promotionId}:evidence`,
        ruleId: 'rewrite-public-evidence-graph',
        action: 'replace_ref',
        sourcePath: '/evidenceRefs',
        targetPath: '/evidenceRefs',
        beforeDigest: sha256(canonicalJson(source.evidenceRefs)),
        afterDigest: sha256(canonicalJson(target.evidenceRefs)),
      },
      {
        transformationId: `${promotionId}:local-relations`,
        ruleId: 'rewrite-private-episode-relations',
        action: 'replace_ref',
        sourcePath: '/relations',
        targetPath: '/relations',
        beforeDigest: sha256(canonicalJson(source.relations)),
        afterDigest: sha256(canonicalJson(target.relations)),
      },
      {
        transformationId: `${promotionId}:artifact-metadata`,
        ruleId: 'strip-unpromoted-artifact-locators-and-attachments',
        action: 'redact',
        sourcePath: '/artifactRefs',
        targetPath: '/artifactRefs',
        beforeDigest: sha256(canonicalJson(source.artifactRefs)),
        afterDigest: sha256(canonicalJson(target.artifactRefs)),
      },
    ],
    policyDecisionRef: options.policyDecisionRef,
    consentRef: options.consentRef,
    actor: options.actor,
    createdAt,
  }, options, createdAt)

  const attestations = [targetAttestation, ...signedObservations.map((item) => item.attestation)]
  // PromotionRecord stays local by default because it discloses the private source reference.
  const contributionObjects = uniqueByDigest([
    target as unknown as JsonRecord,
    ...publicGaps as unknown as JsonRecord[],
    ...publicEpisodes as unknown as JsonRecord[],
    ...publicTraceEvidence as unknown as JsonRecord[],
    ...signedObservations.map((item) => item.observation as unknown as JsonRecord),
    ...manifests as unknown as JsonRecord[],
    ...artifacts as unknown as JsonRecord[],
    ...graders as unknown as JsonRecord[],
    ...benchmarks as unknown as JsonRecord[],
    ...evaluationTrials as unknown as JsonRecord[],
    ...evaluationAggregates as unknown as JsonRecord[],
    ...attestations as unknown as JsonRecord[],
  ])
  for (const value of contributionObjects) {
    const validation = validateProtocolObject(value)
    if (!validation.ok) throw new Error(`contribution object invalid: ${String(value.objectType)} ${validation.issues.map((issue) => issue.message).join('; ')}`)
    assertNoRestrictedContent(value, `contribution object ${String(value.objectType)}`)
  }
  assertContributionGraphClosed(contributionObjects)
  store.putBatch({ objects: [
    ...contributionObjects.map((value) => ({ object: value, role: 'public_promotion_output' })),
    { object: promotion as unknown as JsonRecord, role: 'local_promotion_audit' },
    { object: promotionAttestation as unknown as JsonRecord, role: 'local_promotion_audit' },
  ] })
  return {
    source,
    target,
    promotion,
    publicGaps,
    publicEpisodes,
    publicTraceEvidence,
    publicObservations: signedObservations.map((item) => item.observation),
    manifests,
    artifacts,
    graders,
    benchmarks,
    evaluationTrials,
    evaluationAggregates,
    attestations: [...attestations, promotionAttestation],
    contributionObjects,
  }
}
