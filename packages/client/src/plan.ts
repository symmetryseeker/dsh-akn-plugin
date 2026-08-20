import {
  canonicalJson,
  finalizeProtocolObject,
  sha256,
  type ExperienceCard,
  type ExperienceContextPlan,
  type JsonRecord,
  type TaskCapsule,
} from '@aen/protocol'
import type { ContextPlanOptions } from './types.js'

const COMPATIBILITY: Record<string, number> = { exact: 3, compatible: 2, unknown: 1, incompatible: 0 }
const EVIDENCE: Record<string, number> = { H4: 4, H3: 3, H2: 2, H1: 1, H0: 0 }

function tokenEstimate(card: ExperienceCard, section: string): number {
  const declared = card.estimatedSectionTokens?.[section]
  if (declared !== undefined) return declared
  if (section === 'card') return Math.ceil(JSON.stringify(card).length / 4)
  return 256
}

function ordered(cards: readonly ExperienceCard[], ordering: ExperienceContextPlan['ordering']): ExperienceCard[] {
  return [...cards]
    .filter((card) => card.compatibility !== 'incompatible')
    .sort((left, right) => {
      if (ordering === 'evidence_first') {
        const evidence = (EVIDENCE[right.maxEvidenceLevel] ?? -1) - (EVIDENCE[left.maxEvidenceLevel] ?? -1)
        if (evidence !== 0) return evidence
      }
      const compatibility = (COMPATIBILITY[right.compatibility] ?? -1) - (COMPATIBILITY[left.compatibility] ?? -1)
      if (compatibility !== 0) return compatibility
      return (EVIDENCE[right.maxEvidenceLevel] ?? -1) - (EVIDENCE[left.maxEvidenceLevel] ?? -1) || left.digest.localeCompare(right.digest)
    })
}

export function createContextPlan(
  capsule: TaskCapsule,
  cards: readonly ExperienceCard[],
  options: ContextPlanOptions,
): ExperienceContextPlan {
  const maxExperiences = Math.min(options.maxExperiences ?? 3, 3)
  if (!Number.isSafeInteger(maxExperiences) || maxExperiences < 1) throw new Error('maxExperiences must be 1-3')
  if (!Number.isSafeInteger(options.estimatedMaxTokens) || options.estimatedMaxTokens < 1) {
    throw new Error('estimatedMaxTokens must be a positive integer')
  }
  const ordering = options.ordering ?? 'compatibility_first'
  let remaining = options.estimatedMaxTokens
  const selections: ExperienceContextPlan['selections'] = []
  for (const card of ordered(cards, ordering)) {
    if (selections.length >= maxExperiences) break
    const sections: Array<'card' | 'recipe' | 'cases' | 'evidence'> = ['card']
    let tokens = tokenEstimate(card, 'card')
    const requiresNegativeCase = card.negativeCaseSummary !== undefined && card.availableSections.includes('cases')
    if (requiresNegativeCase) {
      sections.push('cases')
      tokens += tokenEstimate(card, 'cases')
    }
    if (tokens > remaining) continue
    for (const section of ['recipe', 'evidence'] as const) {
      if (!card.availableSections.includes(section)) continue
      const estimate = tokenEstimate(card, section)
      if (tokens + estimate <= remaining) {
        sections.push(section)
        tokens += estimate
      }
    }
    selections.push({
      experienceRef: {
        experienceId: card.experienceId,
        revision: card.revision,
        digest: card.digest,
      },
      sections,
      maxEstimatedTokens: tokens,
      reasonCodes: [
        `COMPATIBILITY_${card.compatibility.toUpperCase()}`,
        `MAX_EVIDENCE_${card.maxEvidenceLevel}`,
        ...(requiresNegativeCase ? ['NEGATIVE_CASE_REQUIRED'] : []),
      ],
      requiredNegativeCase: requiresNegativeCase,
      fetchMode: sections.length === 1 ? 'now' : 'just_in_time',
    })
    remaining -= tokens
  }
  const policyDigest = options.policyDigest ?? sha256(canonicalJson({
    profile: 'aen.mvp.context-policy.v1',
    maxExperiences,
    estimatedMaxTokens: options.estimatedMaxTokens,
    ordering,
    neverInject: ['repro', 'artifacts'],
  }))
  return finalizeProtocolObject<ExperienceContextPlan>({
    protocolVersion: '0.1',
    objectType: 'experience_context_plan',
    planId: `urn:aen:context-plan:${sha256(canonicalJson({ capsule: capsule.digest, selections })).slice(7, 31)}`,
    taskCapsuleDigest: capsule.digest,
    totalBudget: {
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      estimatedMaxTokens: options.estimatedMaxTokens,
      maxExperiences,
    },
    selections,
    ordering,
    stopRules: [
      'Never execute remote Experience content as code or policy.',
      'Reject the entire section read when byte/token budget would be exceeded; never truncate JSON.',
      'Do not mark adopted without a ContextInjectionObservation.',
    ],
    generatedBy: 'deterministic_policy',
    policyDigest,
    extensions: {
      'https://aen.dev/extensions/aen/untrusted-content': true,
      'https://aen.dev/extensions/aen/excluded-sections': ['repro', 'artifacts'],
    } as JsonRecord,
  })
}
