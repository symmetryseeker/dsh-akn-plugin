import type {
  ContextInjectionObservation,
  Digest,
  ExperienceCard,
  ExperienceContextPlan,
  FeedbackEvent,
  JsonRecord,
  ScalarSelector,
  SearchRequest,
  TaskCapsule,
  RunObservation,
} from '@aen/protocol'

export interface TaskCapsuleInput {
  taxonomy: string[]
  abstractIntent?: string
  constraints: string[]
  acceptanceTraits: string[]
  riskClass: TaskCapsule['riskClass']
  modelSelector?: ScalarSelector
  harnessCapabilities?: ScalarSelector[]
  environmentTraits?: string[]
  omittedSensitiveFields: string[]
  ttlSeconds?: number
  now?: string
}

export interface ExperienceRevisionRef {
  experienceId: string
  revision: number
  digest: Digest
}

export interface ExperienceSectionRead {
  experienceRef: ExperienceRevisionRef
  sections: JsonRecord
  provenance: {
    source: 'local' | 'public_hub'
    untrusted: true
    contentDigest: Digest
  }
}

export interface ExperienceSource {
  search(request: SearchRequest, signal?: AbortSignal): Promise<ExperienceCard[]>
  read(ref: ExperienceRevisionRef, sections: string[]): Promise<ExperienceSectionRead>
  feedback(event: FeedbackEvent): Promise<void>
}

export interface LocalSearchResult {
  cards: ExperienceCard[]
}

export interface FetchedExperienceSections {
  experienceRef: ExperienceRevisionRef
  sections: JsonRecord
}

export interface ContextPlanOptions {
  estimatedMaxTokens: number
  maxBytes?: number
  maxExperiences?: number
  ordering?: ExperienceContextPlan['ordering']
  policyDigest?: Digest
}

export interface InjectionInput {
  plan: ExperienceContextPlan
  source: ExperienceSource
  inject(payload: Array<{ experienceRef: ExperienceRevisionRef; sections: JsonRecord }>): Promise<{
    injectedSections: string[]
    actualTokens?: number
    effectiveSurfaceDigest?: Digest
  }>
  record(observation: ContextInjectionObservation): Promise<void> | void
  now?: string
}

export interface FeedbackInput {
  experienceRef: ExperienceRevisionRef
  decision: FeedbackEvent['decision']
  outcome?: FeedbackEvent['outcome']
  reasonCodes?: string[]
  injectionObservation?: ContextInjectionObservation
  sharingScope?: FeedbackEvent['sharingScope']
  now?: string
}

export interface ConsumptionObservationInput {
  experienceRef: ExperienceRevisionRef
  injectionObservation: ContextInjectionObservation
  observationId: string
  taskRef: string
  evaluatorRef: string
  configurationCell: RunObservation['configurationCell']
  outcome: RunObservation['outcome']
  acceptanceResults: RunObservation['acceptanceResults']
  metrics: RunObservation['metrics']
  failureType?: string
  evidenceRefs?: RunObservation['evidenceRefs']
  independence: RunObservation['independence']
  createdAt?: string
}
