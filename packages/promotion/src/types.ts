import type {
  ActorRef,
  ArtifactDescriptor,
  Attestation,
  EvidenceGapReport,
  EvaluationAggregate,
  EvaluationTrial,
  ExperienceRevision,
  BenchmarkTask,
  GraderDefinition,
  HarnessManifest,
  JsonRecord,
  NodeKeyPair,
  PromotionRecord,
  Revocation,
  RunObservation,
  TaskEpisode,
  TraceEvidenceBundle,
} from '@aen/protocol'

export interface PromoteOptions {
  actor: ActorRef
  key: NodeKeyPair
  consentRef: string
  policyDecisionRef: string
  license: string
  createdAt?: string
}

export interface PromotionResult {
  source: ExperienceRevision
  target: ExperienceRevision
  promotion: PromotionRecord
  publicGaps: EvidenceGapReport[]
  publicEpisodes: TaskEpisode[]
  publicTraceEvidence: TraceEvidenceBundle[]
  publicObservations: RunObservation[]
  manifests: HarnessManifest[]
  artifacts: ArtifactDescriptor[]
  graders: GraderDefinition[]
  benchmarks: BenchmarkTask[]
  evaluationTrials: EvaluationTrial[]
  evaluationAggregates: EvaluationAggregate[]
  attestations: Attestation[]
  contributionObjects: JsonRecord[]
}

export interface ContributionInventoryEntry {
  objectType: string
  refId: string
  revision?: number
  digest: string
  path: string
}

export interface ContributionInventory {
  profile: 'aen-git-contribution-v0.1'
  createdAt: string
  actor: ActorRef
  targetDigest: string
  objects: ContributionInventoryEntry[]
}

export interface ObjectContributionInput {
  target: JsonRecord
  objects: JsonRecord[]
  actor: ActorRef
  createdAt: string
}

export interface CreateRevocationOptions {
  actor: ActorRef
  key: NodeKeyPair
  reasonCode: Revocation['reasonCode']
  scope?: Revocation['scope']
  severity?: Revocation['severity']
  affectedDigests?: Revocation['affectedDigests']
  createdAt?: string
}

export interface CreateObservationContributionOptions {
  actor: ActorRef
  key: NodeKeyPair
  consentRef: string
  policyDecisionRef: string
  license: string
  dependencyObjects: JsonRecord[]
  claimId?: string
  relation?: 'supporting' | 'contradicting'
  scopeDifference?: string
  reviewedAt?: string
}
