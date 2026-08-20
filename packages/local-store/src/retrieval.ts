import {
  selectMvpExperienceCandidates,
  type ExperienceCard,
  type ExperienceRevision,
  type JsonRecord,
  type SearchRequest,
} from '@aen/protocol'
import type { LocalEvidenceStore } from './index.js'

const LEVEL = { H0: 0, H1: 1, H2: 2, H3: 3, H4: 4 } as const
const RISK = { read_only: 0, reversible_write: 1, external_write: 2, destructive: 3 } as const
type EvidenceLevelName = keyof typeof LEVEL

export interface LocalSearchResult {
  cards: ExperienceCard[]
}

export interface FetchedExperienceSections {
  experienceRef: {
    experienceId: string
    revision: number
    digest: `sha256:${string}`
  }
  sections: JsonRecord
}

function asExperience(value: JsonRecord): ExperienceRevision {
  if (value.objectType !== 'experience_revision') throw new Error('object is not an ExperienceRevision')
  return value as unknown as ExperienceRevision
}

function levelRank(value: string): number {
  return LEVEL[value as EvidenceLevelName] ?? -1
}

function riskRank(value: string): number {
  return RISK[value as keyof typeof RISK] ?? Number.POSITIVE_INFINITY
}

function maxEvidence(experience: ExperienceRevision): EvidenceLevelName {
  return (experience.claims
    .map((claim) => claim.evidenceLevel as EvidenceLevelName)
    .sort((left, right) => levelRank(right) - levelRank(left))[0] ?? 'H0')
}

function selectorValue(request: SearchRequest, path: string): string | undefined {
  if (path === 'model.provider') return request.context?.model?.provider
  if (path === 'model.modelId') return request.context?.model?.modelId
  if (path === 'model.requestConfig.configDigest') return request.context?.model?.requestConfig?.configDigest
  if (path === 'harness.configurationDigest') return request.context?.harnessConfigurationDigest
  if (path === 'harness.manifestDigest') return request.context?.harnessManifestDigest
  if (path === 'environment.os.family') return request.context?.environment?.os?.family
  return undefined
}

function compatibility(experience: ExperienceRevision, request: SearchRequest): ExperienceCard['compatibility'] {
  const selectors = [
    ...(experience.applicability.modelSelectors ?? []),
    ...(experience.applicability.harnessSelectors ?? []),
    ...(experience.applicability.environmentSelectors ?? []),
  ]
  if (selectors.length === 0) return 'compatible'
  let unknown = false
  for (const selector of selectors) {
    const actual = selectorValue(request, selector.path)
    if (actual === undefined) {
      unknown = true
      continue
    }
    const expected = selector.value
    const matches = selector.operator === 'exists'
      ? true
      : Array.isArray(expected)
        ? expected.includes(actual)
        : expected === actual
    if (!matches) return 'incompatible'
  }
  if (request.context?.model?.mutability === 'provider_mutable' && !unknown) return 'compatible'
  return unknown ? 'unknown' : 'exact'
}

function estimatedTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4)
}

function card(
  experience: ExperienceRevision,
  compatibilityValue: ExperienceCard['compatibility'],
  rankingExplanation: string[] = [],
): ExperienceCard {
  const sections = ['claims', 'applicability', 'task', 'governance']
  if (experience.recipe !== undefined) sections.push('recipe')
  if (experience.cases !== undefined) sections.push('cases')
  if (experience.evidenceRefs.length > 0) sections.push('evidence')
  if (experience.artifactRefs.length > 0) sections.push('artifacts')
  const cardSection = {
    title: experience.title,
    summary: experience.summary,
    intendedUses: experience.intendedUses,
    outOfScopeUses: experience.outOfScopeUses,
    knownFailureModes: experience.knownFailureModes,
    taskFamilies: experience.applicability.taskFamilies,
    safetyLabels: experience.governance.safetyLabels,
  }
  return {
    experienceId: experience.experienceId,
    revision: experience.revision,
    digest: experience.digest,
    title: experience.title,
    summary: experience.summary,
    intendedUseSummary: experience.intendedUses,
    outOfScopeSummary: experience.outOfScopeUses,
    knownFailureSummary: experience.knownFailureModes,
    taskFamilies: experience.applicability.taskFamilies,
    compatibility: compatibilityValue,
    maxEvidenceLevel: maxEvidence(experience),
    ...(experience.metricSummary === undefined ? {} : { metricSummary: experience.metricSummary }),
    ...(experience.cases?.[0] === undefined ? {} : {
      positiveCaseSummary: experience.cases[0].positive.outcomeSummary,
      negativeCaseSummary: experience.cases[0].negative.outcomeSummary,
    }),
    safetyLabels: experience.governance.safetyLabels,
    sourceSummary: `${experience.publisher.actorId}; ${experience.governance.visibility}; ${experience.namespace}`,
    availableSections: sections,
    estimatedSectionTokens: Object.fromEntries(sections.map((section) => [
      section,
      estimatedTokens(section === 'card'
        ? cardSection
        : (experience as unknown as JsonRecord)[section] ?? experience.evidenceRefs),
    ])),
    scoreExplanation: [
      'Local SQLite FTS match over title, summary, task, recipe, and cases.',
      `Model × Harness compatibility: ${compatibilityValue}.`,
      `Maximum claim evidence: ${maxEvidence(experience)}.`,
      ...rankingExplanation,
    ],
  }
}

function isExpired(experience: ExperienceRevision, now: Date): boolean {
  const expiresAt = experience.governance.retention?.expiresAt
  return expiresAt !== undefined && new Date(expiresAt) <= now
}

/** Resolve one preregistered immutable Experience without relying on FTS recall order. */
export function localExperienceCard(
  store: LocalEvidenceStore,
  selector: string,
  request: SearchRequest,
  now = new Date(),
): ExperienceCard {
  const inspected = store.inspect(selector)
  if (inspected === undefined || inspected.summary.objectType !== 'experience_revision') {
    throw new Error(`experience revision not found: ${selector}`)
  }
  const experience = asExperience(inspected.object)
  if (isExpired(experience, now)) throw new Error(`experience revision is expired: ${selector}`)
  if (
    request.task?.taxonomy !== undefined &&
    !request.task.taxonomy.some((family) => experience.applicability.taskFamilies.includes(family))
  ) throw new Error(`experience revision does not apply to the scheduled Benchmark task family: ${selector}`)
  const match = compatibility(experience, request)
  if (match === 'incompatible') {
    throw new Error(`experience revision is incompatible with the scheduled Model × Harness cell: ${selector}`)
  }
  return card(experience, match, ['Selected by immutable preregistered Experience ref.'])
}

export function searchLocalExperiences(
  store: LocalEvidenceStore,
  request: SearchRequest,
  now = new Date(),
): LocalSearchResult {
  const limit = Math.min(3, request.responseBudget?.maxCards ?? request.limit ?? 3)
  const candidates = store.searchExperiences(request.query ?? '', Math.min(100, Math.max(limit * 20, 20)))
  const accepted: Array<{
    experience: ExperienceRevision
    compatibility: ExperienceCard['compatibility']
    recallRank: number
  }> = []
  for (const [recallRank, candidate] of candidates.entries()) {
    const object = store.getByDigest(candidate.digest)
    if (object === undefined) continue
    const experience = asExperience(object)
    if (isExpired(experience, now)) continue
    if (
      request.policy?.visibility !== undefined &&
      !request.policy.visibility.includes(experience.governance.visibility)
    ) continue
    if (
      request.task?.taxonomy !== undefined &&
      !request.task.taxonomy.some((family) => experience.applicability.taskFamilies.includes(family))
    ) continue
    const match = compatibility(experience, request)
    if (match === 'incompatible') continue
    if (
      request.policy?.maxRiskClass !== undefined &&
      riskRank(experience.task.riskClass) > riskRank(request.policy.maxRiskClass)
    ) continue
    const evidence = maxEvidence(experience)
    if (request.policy?.minEvidenceLevel !== undefined && levelRank(evidence) < levelRank(request.policy.minEvidenceLevel)) {
      continue
    }
    if (
      request.policy?.allowedLicenses !== undefined &&
      (experience.governance.license === undefined || !request.policy.allowedLicenses.includes(experience.governance.license))
    ) continue
    if (
      request.policy?.maxMeanCostUsd !== undefined &&
      (experience.metricSummary?.costUsd?.mean === undefined ||
        experience.metricSummary.costUsd.mean > request.policy.maxMeanCostUsd)
    ) continue
    if (
      request.policy?.maxP95LatencyMs !== undefined &&
      (experience.metricSummary?.latencyMs?.p95 === undefined ||
        experience.metricSummary.latencyMs.p95 > request.policy.maxP95LatencyMs)
    ) continue
    accepted.push({ experience, compatibility: match, recallRank })
  }
  return {
    cards: selectMvpExperienceCandidates(accepted, limit, now)
      .map((ranked) => card(ranked.experience, ranked.compatibility, ranked.scoreExplanation)),
  }
}

const SECTION_NAMES = new Set([
  'card',
  'claims',
  'applicability',
  'recipe',
  'cases',
  'evidence',
  'artifacts',
  'task',
  'governance',
])

export function fetchExperienceSections(
  store: LocalEvidenceStore,
  selector: string,
  include: string[],
): FetchedExperienceSections {
  const inspected = store.inspect(selector)
  if (inspected === undefined || inspected.summary.objectType !== 'experience_revision') {
    throw new Error(`experience revision not found: ${selector}`)
  }
  const experience = asExperience(inspected.object)
  const sections: JsonRecord = {}
  for (const name of include) {
    if (!SECTION_NAMES.has(name)) throw new Error(`unsupported Experience section: ${name}`)
    if (name === 'card') {
      sections.card = {
        title: experience.title,
        summary: experience.summary,
        intendedUses: experience.intendedUses,
        outOfScopeUses: experience.outOfScopeUses,
        knownFailureModes: experience.knownFailureModes,
        taskFamilies: experience.applicability.taskFamilies,
        safetyLabels: experience.governance.safetyLabels,
      }
    } else if (name === 'evidence') {
      sections.evidence = experience.evidenceRefs.map((ref) => ({
        ref,
        object: store.getByDigest(ref.digest) ?? null,
      }))
    } else if (name === 'artifacts') {
      sections.artifacts = experience.artifactRefs.map((ref) => ({
        ref,
        object: store.getByDigest(ref.digest) ?? null,
      }))
    } else {
      const value = (experience as unknown as JsonRecord)[name]
      if (value !== undefined) sections[name] = value
    }
  }
  return {
    experienceRef: {
      experienceId: experience.experienceId,
      revision: experience.revision,
      digest: experience.digest,
    },
    sections,
  }
}
