import {
  canonicalJson,
  createAttestation,
  finalizeProtocolObject,
  sha256,
  toObjectRef,
  validateProtocolObject,
  type Attestation,
  type ArtifactRef,
  type Contention,
  type ContextInjectionObservation,
  type HarnessManifest,
  type JsonRecord,
  type RunObservation,
} from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'
import { assertContributionGraphClosed, findUnreachableContributionObjects } from './closure.js'
import { projectPublicArtifact, projectPublicManifest } from './promote.js'
import { assertNoRestrictedContent } from './scanner.js'
import type { CreateObservationContributionOptions, ObjectContributionInput } from './types.js'

export interface ObservationContribution extends ObjectContributionInput {
  observation: RunObservation
  observationAttestation: Attestation
  contention?: Contention
  contentionAttestation?: Attestation
}

function storedObject(store: LocalEvidenceStore, digest: `sha256:${string}`, objectType: string): JsonRecord {
  const object = store.getByDigest(digest)
  if (object === undefined || object.objectType !== objectType) {
    throw new Error(`${objectType} dependency does not resolve locally: ${digest}`)
  }
  return object
}

function publicArtifactRef(object: ReturnType<typeof projectPublicArtifact>): ArtifactRef {
  return {
    ...toObjectRef(object as unknown as JsonRecord),
    objectType: 'artifact',
    kind: object.kind,
  } as ArtifactRef
}

function projectContextInjection(
  source: ContextInjectionObservation,
  experienceRef: NonNullable<RunObservation['experienceRef']>,
): ContextInjectionObservation {
  if (
    source.experienceRef.experienceId !== experienceRef.experienceId ||
    source.experienceRef.revision !== experienceRef.revision ||
    source.experienceRef.digest !== experienceRef.digest
  ) throw new Error('ContextInjectionObservation does not match the measured Experience ref')
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  draft.injectionId = `${source.injectionId}:public`
  draft.planId = `urn:aen:public-plan:${sha256(canonicalJson({
    sourcePlanId: source.planId,
    experienceDigest: experienceRef.digest,
  })).slice(7, 31)}`
  const projected = finalizeProtocolObject<ContextInjectionObservation>(draft)
  assertNoRestrictedContent(projected, 'public ContextInjectionObservation')
  return projected
}

function sign(
  object: JsonRecord,
  options: CreateObservationContributionOptions,
  role: string,
  issuedAt: string,
): Attestation {
  return createAttestation({
    attestationId: `urn:aen:attestation:${role}:${String(object.digest).slice(7, 31)}`,
    subject: toObjectRef(object),
    issuer: options.actor,
    issuedAt,
    role,
    scope: ['public'],
    key: options.key,
  })
}

function signedObservation(
  source: RunObservation,
  options: CreateObservationContributionOptions,
  reviewedAt: string,
): { observation: RunObservation; attestation: Attestation } {
  if (source.experienceRef === undefined) {
    throw new Error('public consumption Observation requires an exact Experience ref')
  }
  if (source.independence.evaluatorActor.actorId !== options.actor.actorId) {
    throw new Error('Observation evaluator actor must match the public contribution actor')
  }
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  delete draft.attestation
  draft.observationId = `${source.observationId}:public`
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
      transformations: [{ ruleId: 'standalone-observation-public-review', count: 1 }],
      residualRisk: 'low',
      humanReviewed: true,
      reviewedAt,
    },
    safetyLabels: ['measured-observation', 'untrusted-evidence', 'no-automatic-execution'],
  }
  draft.extensions = {
    ...((draft.extensions as JsonRecord | undefined) ?? {}),
    'https://aen.dev/extensions/aen/source-observation-digest': source.digest,
  }
  const unsigned = finalizeProtocolObject<RunObservation>(draft)
  assertNoRestrictedContent(unsigned, 'public RunObservation')
  const attestation = sign(unsigned as unknown as JsonRecord, options, 'public-observation', reviewedAt)
  const observation = { ...unsigned, attestation }
  const validation = validateProtocolObject(observation)
  if (!validation.ok) {
    throw new Error(`signed public Observation is invalid: ${validation.issues.map((issue) => issue.message).join('; ')}`)
  }
  return { observation: observation as RunObservation, attestation }
}

function signedContention(
  observation: RunObservation,
  options: CreateObservationContributionOptions,
  openedAt: string,
): { contention: Contention; attestation: Attestation } | undefined {
  if (options.relation !== 'contradicting') return undefined
  if (options.claimId === undefined || options.claimId.length === 0) {
    throw new Error('contradicting Observation contribution requires claimId')
  }
  const experienceRef = observation.experienceRef
  if (experienceRef === undefined) throw new Error('Contention requires an exact Experience ref')
  const observationRef = {
    ...toObjectRef(observation as unknown as JsonRecord),
    objectType: 'observation' as const,
  }
  const unsigned = finalizeProtocolObject<Contention>({
    protocolVersion: '0.1',
    objectType: 'contention',
    contentionId: `urn:aen:contention:${sha256(canonicalJson({
      experienceRef,
      claimId: options.claimId,
      observationDigest: observation.digest,
    })).slice(7, 31)}`,
    claimRef: {
      experienceRef: {
        objectType: 'experience_revision',
        refId: experienceRef.experienceId,
        revision: experienceRef.revision,
        digest: experienceRef.digest,
      },
      claimId: options.claimId,
    },
    supporting: [],
    contradicting: [observationRef],
    ...(options.scopeDifference === undefined ? {} : { scopeDifference: options.scopeDifference }),
    openedAt,
  })
  assertNoRestrictedContent(unsigned, 'public Contention')
  const attestation = sign(unsigned as unknown as JsonRecord, options, 'public-contention', openedAt)
  const contention = { ...unsigned, attestations: [attestation] }
  const validation = validateProtocolObject(contention)
  if (!validation.ok) {
    throw new Error(`signed public Contention is invalid: ${validation.issues.map((issue) => issue.message).join('; ')}`)
  }
  return { contention: contention as Contention, attestation }
}

export function createObservationContribution(
  source: RunObservation,
  options: CreateObservationContributionOptions,
): ObservationContribution {
  const sourceValidation = validateProtocolObject(source)
  if (!sourceValidation.ok) throw new Error('Observation source must be a valid AEXP object')
  if (options.license.trim().length === 0) throw new Error('public Observation requires a license')
  if (options.consentRef.trim().length === 0) throw new Error('public Observation requires consentRef')
  const reviewedAt = options.reviewedAt ?? new Date().toISOString()
  const signed = signedObservation(source, options, reviewedAt)
  const dispute = signedContention(signed.observation, options, reviewedAt)
  const objects = [
    ...options.dependencyObjects,
    signed.observation as unknown as JsonRecord,
    ...(dispute === undefined ? [] : [dispute.contention as unknown as JsonRecord]),
  ]
  const unique = [...new Map(objects.map((object) => [String(object.digest), object])).values()]
  for (const dependency of options.dependencyObjects) {
    const validation = validateProtocolObject(dependency)
    if (!validation.ok) throw new Error(`public Observation dependency is invalid: ${String(dependency.digest)}`)
    assertNoRestrictedContent(dependency, `public Observation dependency ${String(dependency.digest)}`)
  }
  assertContributionGraphClosed(unique)
  const unreachable = findUnreachableContributionObjects(signed.observation.digest, unique, ['contention'])
  if (unreachable.length > 0) {
    throw new Error(`public Observation contribution contains unreferenced objects: ${unreachable.map((object) => String(object.digest)).join(', ')}`)
  }
  return {
    target: signed.observation as unknown as JsonRecord,
    objects: unique,
    actor: options.actor,
    createdAt: reviewedAt,
    observation: signed.observation,
    observationAttestation: signed.attestation,
    ...(dispute === undefined ? {} : {
      contention: dispute.contention,
      contentionAttestation: dispute.attestation,
    }),
  }
}

/**
 * Promote one locally measured consumption Observation without publishing raw
 * trace. The referenced Manifest/artifacts and injection record are projected
 * into public-safe immutable objects; arbitrary evidence requires a later,
 * explicit evidence promotion profile.
 */
export function createObservationContributionFromStore(
  store: LocalEvidenceStore,
  selector: string,
  options: Omit<CreateObservationContributionOptions, 'dependencyObjects'>,
): ObservationContribution {
  const inspected = store.inspect(selector)
  if (inspected === undefined || inspected.summary.objectType !== 'observation') {
    throw new Error(`RunObservation not found: ${selector}`)
  }
  const source = inspected.object as unknown as RunObservation
  if (source.experienceRef === undefined) throw new Error('consumption Observation has no Experience ref')
  if (source.treatment === 'experience_applied' && (source.contextInjectionRefs?.length ?? 0) === 0) {
    throw new Error('experience_applied Observation requires a ContextInjectionObservation before public contribution')
  }
  if (source.evidenceRefs.length > 0 || source.acceptanceResults.some((result) => result.evidenceRefs.length > 0)) {
    throw new Error('standalone Observation promotion currently requires evidenceRefs to be empty; promote evidence explicitly first')
  }
  const manifestSource = storedObject(
    store,
    source.configurationCell.harnessManifestDigest,
    'harness_manifest',
  ) as unknown as HarnessManifest
  const artifactSources = manifestSource.artifacts.map((ref) =>
    storedObject(store, ref.digest, 'artifact'))
  const artifacts = artifactSources.map((object) => projectPublicArtifact(object as unknown as Parameters<typeof projectPublicArtifact>[0]))
  const artifactReplacements = new Map<string, ArtifactRef>()
  manifestSource.artifacts.forEach((ref, index) => {
    const projected = artifacts[index]
    if (projected !== undefined) artifactReplacements.set(ref.digest, publicArtifactRef(projected))
  })
  const manifest = projectPublicManifest(manifestSource, artifactReplacements)

  const injections = (source.contextInjectionRefs ?? []).map((ref) => {
    const object = storedObject(store, ref.digest, 'context_injection_observation')
    return projectContextInjection(object as unknown as ContextInjectionObservation, source.experienceRef!)
  })
  const injectionReplacements = new Map(
    (source.contextInjectionRefs ?? []).map((ref, index) => [ref.digest, injections[index]!] as const),
  )
  const draft = structuredClone(source) as unknown as JsonRecord
  delete draft.digest
  delete draft.attestation
  delete draft.governance
  draft.taskRef = `urn:aen:public-task:${source.digest.slice(7, 31)}`
  draft.evaluatorRef = `urn:aen:public-evaluator:${sha256(options.actor.actorId).slice(7, 31)}`
  const cell = draft.configurationCell as JsonRecord
  cell.harnessManifestDigest = manifest.digest
  const model = cell.model as JsonRecord
  delete model.pricingSnapshotRef
  delete model.rateLimitSnapshotRef
  const environment = cell.environment as JsonRecord
  delete environment.region
  delete environment.workspaceTraits
  environment.disclosure = 'metadata'
  draft.contextInjectionRefs = (source.contextInjectionRefs ?? []).map((ref) => {
    const replacement = injectionReplacements.get(ref.digest)
    if (replacement === undefined) throw new Error(`ContextInjectionObservation replacement missing: ${ref.digest}`)
    return toObjectRef(replacement as unknown as JsonRecord)
  })
  draft.extensions = {
    ...((draft.extensions as JsonRecord | undefined) ?? {}),
    'https://aen.dev/extensions/aen/local-source-observation-digest': source.digest,
    'https://aen.dev/extensions/aen/public-projection': 'standalone-observation-v1',
  }
  const projectedSource = finalizeProtocolObject<RunObservation>(draft)
  assertNoRestrictedContent(projectedSource, 'projected standalone RunObservation')
  return createObservationContribution(projectedSource, {
    ...options,
    dependencyObjects: [
      ...artifacts as unknown as JsonRecord[],
      manifest as unknown as JsonRecord,
      ...injections as unknown as JsonRecord[],
    ],
  })
}
