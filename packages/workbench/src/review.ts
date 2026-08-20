import {
  finalizeProtocolObject,
  toObjectRef,
  type ArtifactDescriptor,
  type EvidenceGapReport,
  type ExperienceRevision,
  type HarnessManifest,
  type JsonRecord,
  type RunObservation,
  type TaskEpisode,
} from '@aen/protocol'
import { LocalEvidenceStore, type ExperienceReviewState } from '@aen/local-store'
import { asExperience, validateExperienceComposition } from './validation.js'
import type { ReviewDecision, ReviewPacket } from './types.js'

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

function experienceObject(store: LocalEvidenceStore, selector: string): ExperienceRevision {
  const inspected = store.inspect(selector)
  if (inspected === undefined || inspected.summary.objectType !== 'experience_revision') {
    throw new Error(`experience revision not found: ${selector}`)
  }
  return asExperience(inspected.object)
}

function stateFor(store: LocalEvidenceStore, experience: ExperienceRevision): ExperienceReviewState {
  return store.getExperienceReview(experience.digest)?.state ?? 'draft'
}

export function buildReviewPacket(store: LocalEvidenceStore, selector: string): ReviewPacket {
  const experience = experienceObject(store, selector)
  const episodeRelation = required(
    experience.relations.find((relation) => relation.type === 'derived_from' && relation.target.objectType === 'task_episode'),
    'experience has no derived TaskEpisode relation',
  )
  const episode = required(
    store.getByDigest(episodeRelation.target.digest) as unknown as TaskEpisode | undefined,
    'derived TaskEpisode is missing',
  )
  const gap = required(
    store.getByDigest(episode.evidenceGapReportRef.digest) as unknown as EvidenceGapReport | undefined,
    'EvidenceGapReport is missing',
  )
  const observationRef = required(
    experience.evidenceRefs.find((ref) => ref.objectType === 'observation'),
    'RunObservation evidence is missing',
  )
  const observation = required(
    store.getByDigest(observationRef.digest) as unknown as RunObservation | undefined,
    'RunObservation object is missing',
  )
  const manifestRelation = experience.relations.find((relation) =>
    relation.type === 'derived_from' && relation.target.objectType === 'harness_manifest')
  const manifestDigest = manifestRelation?.target.digest ?? observation.configurationCell.harnessManifestDigest
  const manifest = required(
    store.getByDigest(manifestDigest) as unknown as HarnessManifest | undefined,
    'HarnessManifest is missing',
  )
  const traceRef = experience.evidenceRefs.find((ref) => ref.objectType === 'trace_evidence')
  const trace = traceRef === undefined ? undefined : store.getByDigest(traceRef.digest)
  const artifacts = experience.artifactRefs.map((ref) =>
    required(store.getByDigest(ref.digest) as unknown as ArtifactDescriptor | undefined, `artifact missing: ${ref.digest}`),
  )
  const transformations = trace?.redaction !== undefined && typeof trace.redaction === 'object'
    ? ((trace.redaction as JsonRecord).transformations as Array<{ ruleId?: unknown }> | undefined) ?? []
    : []
  return {
    experience: {
      experienceId: experience.experienceId,
      revision: experience.revision,
      digest: experience.digest,
      title: experience.title,
      summary: experience.summary,
      currentState: stateFor(store, experience),
    },
    claims: experience.claims.map((claim) => ({
      claimId: claim.claimId,
      statement: claim.statement,
      mode: claim.mode,
      evidenceLevel: claim.evidenceLevel,
      supportingEvidence: claim.supportingEvidenceRefs,
      contradictingEvidence: claim.contradictingEvidenceRefs,
      falsificationConditions: claim.falsificationConditions,
    })),
    configuration: {
      model: observation.configurationCell.model,
      manifest: {
        manifestId: manifest.manifestId,
        digest: manifest.digest,
        harness: manifest.harness,
        coverage: manifest.coverage,
      },
    },
    redaction: {
      hiddenOrRemoved: [
        ...transformations.map((entry) => String(entry.ruleId ?? 'unspecified-redaction')),
        ...(trace?.localLocator === undefined ? [] : ['localLocator remains private and is excluded from the ExperienceRevision']),
        'raw prompts, tool arguments, tool results, and hidden reasoning are not copied into the ExperienceRevision',
      ],
      residualRisk: experience.governance.redactionReport.residualRisk,
      humanReviewed: experience.governance.redactionReport.humanReviewed,
    },
    evidenceGap: gap,
    publication: {
      targetGenerated: false,
      note: 'No public target exists. request-public only records intent; M4 Promotion must create a separately redacted revision and digest.',
    },
    governance: experience.governance,
    artifacts: artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      name: artifact.name,
      ...(artifact.licenseExpression === undefined ? {} : { license: artifact.licenseExpression }),
      redistributable: artifact.redistributable,
      ...(artifact.snapshotCompleteness === undefined ? {} : { snapshotCompleteness: artifact.snapshotCompleteness }),
    })),
    knownRisks: [...experience.knownFailureModes, ...experience.governance.safetyLabels],
  }
}

export function reviewExperience(
  store: LocalEvidenceStore,
  selector: string,
  decision: ReviewDecision,
  reviewerActorId: string,
  note?: string,
) {
  const states: Record<ReviewDecision, ExperienceReviewState> = {
    'keep-private': 'approved_private',
    reject: 'rejected',
    'request-public': 'public_requested',
    'reset-draft': 'draft',
  }
  const state = states[decision]
  return store.recordExperienceReview({ selector, state, reviewerActorId, ...(note === undefined ? {} : { note }) })
}

export function createEditTemplate(
  store: LocalEvidenceStore,
  selector: string,
  createdAt = new Date().toISOString(),
): JsonRecord {
  const current = experienceObject(store, selector)
  const template = structuredClone(current) as unknown as JsonRecord
  delete template.digest
  delete template.attestations
  if (current.governance.visibility === 'public') {
    const governance = template.governance as JsonRecord
    governance.visibility = 'private'
    governance.redistribution = 'none'
    governance.dataClasses = ['internal']
    governance.sourcePolicy = 'aen.local-follow-up-draft.v1'
    delete governance.license
    delete governance.consentRef
    delete governance.acl
  }
  template.revision = current.revision + 1
  template.createdAt = createdAt
  template.supersedes = {
    experienceId: current.experienceId,
    revision: current.revision,
    digest: current.digest,
  }
  return template
}

export function importEditedRevision(
  store: LocalEvidenceStore,
  currentSelector: string,
  draft: JsonRecord,
  reviewerActorId: string,
): ExperienceRevision {
  const current = experienceObject(store, currentSelector)
  if ('digest' in draft) throw new Error('edited revision must omit digest; the workbench computes it')
  if (draft.objectType !== 'experience_revision' || draft.experienceId !== current.experienceId) {
    throw new Error('edited revision must keep the same experienceId and objectType')
  }
  if (draft.revision !== current.revision + 1) throw new Error('edited revision must increment revision by one')
  const supersedesValue = draft.supersedes
  if (
    supersedesValue === null || typeof supersedesValue !== 'object' || Array.isArray(supersedesValue)
  ) {
    throw new Error('edited revision must supersede the exact reviewed revision')
  }
  const supersedes = supersedesValue as JsonRecord
  if (
    supersedes.experienceId !== current.experienceId ||
    supersedes.revision !== current.revision ||
    supersedes.digest !== current.digest
  ) {
    throw new Error('edited revision must supersede the exact reviewed revision')
  }
  const governanceValue = draft.governance
  if (
    governanceValue === null || typeof governanceValue !== 'object' || Array.isArray(governanceValue)
  ) {
    throw new Error('edited revision must remain private; public output requires Promotion')
  }
  const governance = governanceValue as JsonRecord
  if (governance.visibility !== 'private') {
    throw new Error('edited revision must remain private; public output requires Promotion')
  }
  const experience = finalizeProtocolObject<ExperienceRevision>(draft)
  validateExperienceComposition(store, experience)
  store.putBatch({ objects: [{ object: experience as unknown as JsonRecord, role: 'private_experience_revision' }] })
  store.recordExperienceReview({
    selector: experience.digest,
    state: 'draft',
    reviewerActorId,
    note: `Edited revision superseding ${toObjectRef(current as unknown as JsonRecord).digest}`,
  })
  return experience
}
