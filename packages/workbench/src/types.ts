import type {
  Digest,
  EvidenceGapReport,
  ExperienceCard,
  ExperienceRevision,
  HarnessManifest,
  JsonRecord,
  ModelFingerprint,
  ObjectRef,
} from '@aen/protocol'
import type { ExperienceReviewRecord, ExperienceReviewState } from '@aen/local-store'

export interface DistillOptions {
  publisher?: { actorId: string; type: 'human' | 'agent' | 'organization' | 'service' | 'node'; displayName?: string }
  namespace?: string
}

export interface DistillResult {
  experience: ExperienceRevision
  review: ExperienceReviewRecord
  inputRefs: {
    episode: ObjectRef
    traceEvidence: ObjectRef
    observation: ObjectRef
    manifest: ObjectRef
    gapReport: ObjectRef
  }
}

export type ReviewDecision = 'keep-private' | 'reject' | 'request-public' | 'reset-draft'

export interface ReviewPacket {
  experience: {
    experienceId: string
    revision: number
    digest: Digest
    title: string
    summary: string
    currentState: ExperienceReviewState
  }
  claims: Array<{
    claimId: string
    statement: string
    mode: string
    evidenceLevel: string
    supportingEvidence: ObjectRef[]
    contradictingEvidence: ObjectRef[]
    falsificationConditions: string[]
  }>
  configuration: {
    model: ModelFingerprint
    manifest: Pick<HarnessManifest, 'manifestId' | 'digest' | 'harness' | 'coverage'>
  }
  redaction: {
    hiddenOrRemoved: string[]
    residualRisk: string
    humanReviewed: boolean
  }
  evidenceGap: EvidenceGapReport
  publication: {
    targetGenerated: false
    note: string
  }
  governance: ExperienceRevision['governance']
  artifacts: Array<{
    artifactId: string
    kind: string
    name: string
    license?: string
    redistributable: boolean
    snapshotCompleteness?: string
  }>
  knownRisks: string[]
}

export interface LocalSearchResult {
  cards: ExperienceCard[]
}

export interface FetchedExperienceSections {
  experienceRef: { experienceId: string; revision: number; digest: Digest }
  sections: JsonRecord
}
