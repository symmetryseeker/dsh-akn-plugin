import type { KeyObject } from 'node:crypto'
import type { ExperienceCard, ExperienceRevision, JsonRecord, Revocation, RunObservation } from '@aen/protocol'
import type { ContributionInventory } from '@aen/promotion'

export interface AuthorizedPublisherKey {
  keyid: string
  publicKey: KeyObject
  actorId: string
  validFrom?: string
  revokedAt?: string
}

export interface IngestedContribution {
  root: string
  inventory: ContributionInventory
  target: ExperienceRevision | Revocation | RunObservation
  objects: JsonRecord[]
  verifiedKeyIds: string[]
}

export interface HubSearchQuery {
  query?: string
  taskFamilies?: string[]
  modelProvider?: string
  modelId?: string
  modelMutability?: string
  harnessConfigurationDigest?: string
  harnessManifestDigest?: string
  allowedLicenses?: string[]
  minEvidenceLevel?: ExperienceCard['maxEvidenceLevel']
  maxRiskClass?: 'read_only' | 'reversible_write' | 'external_write' | 'destructive'
  maxMeanCostUsd?: number
  maxP95LatencyMs?: number
  limit?: number
}

export interface HubProjectionOptions {
  textSearch?: 'postgres_fts' | 'portable_test'
}

export interface HubProjectionStatus {
  objects: number
  experiences: number
  latestExperiences: number
  revocations: number
  lastIngestedAt?: string
}

export interface HubExperienceCard extends ExperienceCard {
  blocked: boolean
}

export interface HubTombstone {
  tombstone: true
  digest: string
  reasonCode: string
  blockedAt: string
}

export interface HubFeedbackInput {
  object: JsonRecord
  sourcePath: string
}
