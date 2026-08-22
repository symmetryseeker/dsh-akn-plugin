import type { ExperienceCard, ExperienceRevision } from './schemas.js'

const EVIDENCE = { H0: 0, H1: 1, H2: 2, H3: 3, H4: 4 } as const
const COMPATIBILITY = { incompatible: 0, unknown: 1, compatible: 2, exact: 3 } as const
/** 通用性轴（共进化指导自进化）：universal 经验优先注入。 */
const GENERALITY = { scene_specific: 1, domain: 2, universal: 3 } as const

export type MvpSelectionRole = 'primary' | 'near_negative' | 'pareto_alternative' | 'ranked_fallback'

export interface MvpRankCandidate {
  experience: ExperienceRevision
  compatibility: ExperienceCard['compatibility']
  /** Zero is the strongest deterministic lexical-recall position. */
  recallRank: number
}

export interface MvpRankedCandidate extends MvpRankCandidate {
  score: number
  role: MvpSelectionRole
  scoreExplanation: string[]
}

function level(experience: ExperienceRevision): keyof typeof EVIDENCE {
  return experience.claims
    .map((claim) => claim.evidenceLevel as keyof typeof EVIDENCE)
    .sort((left, right) => EVIDENCE[right] - EVIDENCE[left])[0] ?? 'H0'
}

function quality(experience: ExperienceRevision): number | undefined {
  return experience.metricSummary?.quality?.mean ?? experience.metricSummary?.successRate
}

function cost(experience: ExperienceRevision): number | undefined {
  return experience.metricSummary?.costUsd?.mean
}

function latency(experience: ExperienceRevision): number | undefined {
  return experience.metricSummary?.latencyMs?.p95 ?? experience.metricSummary?.latencyMs?.p50
}

function negativeSignal(experience: ExperienceRevision): boolean {
  return experience.kind === 'negative_result' ||
    (experience.cases?.length ?? 0) > 0 ||
    (experience.metricSummary?.negativeTransferRate ?? 0) > 0 ||
    experience.claims.some((claim) => claim.contradictingEvidenceRefs.length > 0)
}

/** 经验的可迁移度轴（universal > domain > scene_specific > unmeasured）。 */
function generalityRank(experience: ExperienceRevision): number {
  const value = experience.applicability?.generality
  return value === undefined ? 0 : GENERALITY[value as keyof typeof GENERALITY] ?? 0
}

function normalizedLower(value: number | undefined, values: number[]): number {
  if (value === undefined || values.length < 2) return 0
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  return maximum === minimum ? 0.5 : (maximum - value) / (maximum - minimum)
}

function normalizedHigher(value: number | undefined, values: number[]): number {
  if (value === undefined || values.length < 2) return 0
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  return maximum === minimum ? 0.5 : (value - minimum) / (maximum - minimum)
}

function dominates(left: ExperienceRevision, right: ExperienceRevision): boolean {
  const pairs: Array<[number | undefined, number | undefined, 'higher' | 'lower']> = [
    [quality(left), quality(right), 'higher'],
    [cost(left), cost(right), 'lower'],
    [latency(left), latency(right), 'lower'],
  ]
  const comparable = pairs.filter(([a, b]) => a !== undefined && b !== undefined)
  if (comparable.length < 2) return false
  const noWorse = comparable.every(([a, b, direction]) =>
    direction === 'higher' ? Number(a) >= Number(b) : Number(a) <= Number(b))
  const strictlyBetter = comparable.some(([a, b, direction]) =>
    direction === 'higher' ? Number(a) > Number(b) : Number(a) < Number(b))
  return noWorse && strictlyBetter
}

function roleExplanation(role: MvpSelectionRole): string {
  if (role === 'primary') return 'Selection role: primary compatibility/evidence result.'
  if (role === 'near_negative') return 'Selection role: nearby negative or boundary-bearing result retained to expose transfer risk.'
  if (role === 'pareto_alternative') return 'Selection role: non-dominated quality/cost/latency alternative.'
  return 'Selection role: next deterministic ranked fallback because no stronger diversity role was available.'
}

/** Deterministic sparse-retrieval reranker for the AEN MVP profile. */
export function selectMvpExperienceCandidates(
  candidates: readonly MvpRankCandidate[],
  limit: number,
  now = new Date(),
): MvpRankedCandidate[] {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 0), 3)
  if (boundedLimit === 0 || candidates.length === 0) return []
  const qualities = candidates.map(({ experience }) => quality(experience)).filter((value): value is number => value !== undefined)
  const costs = candidates.map(({ experience }) => cost(experience)).filter((value): value is number => value !== undefined)
  const latencies = candidates.map(({ experience }) => latency(experience)).filter((value): value is number => value !== undefined)
  const ranked = candidates.map((candidate) => {
    const evidence = level(candidate.experience)
    const ageDays = Math.max(0, (now.getTime() - Date.parse(candidate.experience.createdAt)) / 86_400_000)
    const freshness = Math.max(0, 8 - Math.min(8, ageDays / 30))
    const qualityBonus = normalizedHigher(quality(candidate.experience), qualities) * 8
    const costBonus = normalizedLower(cost(candidate.experience), costs) * 4
    const latencyBonus = normalizedLower(latency(candidate.experience), latencies) * 4
    const negativeTransferPenalty = (candidate.experience.metricSummary?.negativeTransferRate ?? 0) * 12
    const generality = generalityRank(candidate.experience)
    // 通用经验优先（共进化指导自进化）：权重小于 compatibility 的 100，但高于 freshness
    const generalityBonus = generality * 10
    const score = COMPATIBILITY[candidate.compatibility as keyof typeof COMPATIBILITY] * 100 + EVIDENCE[evidence] * 20 +
      Math.max(0, 30 - candidate.recallRank) + freshness + generalityBonus + qualityBonus + costBonus + latencyBonus +
      (negativeSignal(candidate.experience) ? 4 : 0) - negativeTransferPenalty
    const generalityLabel = candidate.experience.applicability?.generality
    return {
      ...candidate,
      score,
      role: 'ranked_fallback' as MvpSelectionRole,
      scoreExplanation: [
        `Compatibility rank: ${candidate.compatibility}.`,
        `Maximum claim evidence: ${evidence}.`,
        `Sparse lexical recall position: ${candidate.recallRank + 1}.`,
        `Freshness contribution: ${freshness.toFixed(2)}.`,
        `Generality: ${generalityLabel ?? 'unmeasured'} (${generalityBonus.toFixed(0)} points).`,
        ...(negativeSignal(candidate.experience) ? ['Negative/boundary evidence was retained in ranking.'] : []),
        ...(quality(candidate.experience) === undefined ? [] : [`Quality signal: ${quality(candidate.experience)}.`]),
        ...(cost(candidate.experience) === undefined ? [] : [`Mean cost signal: ${cost(candidate.experience)} USD.`]),
        ...(latency(candidate.experience) === undefined ? [] : [`Latency signal: ${latency(candidate.experience)} ms.`]),
        ...(negativeTransferPenalty === 0 ? [] : [`Negative-transfer penalty: ${negativeTransferPenalty.toFixed(2)}.`]),
      ],
    }
  }).sort((left, right) =>
    right.score - left.score ||
    left.recallRank - right.recallRank ||
    left.experience.digest.localeCompare(right.experience.digest))

  const chosen: MvpRankedCandidate[] = []
  const choose = (candidate: MvpRankedCandidate | undefined, role: MvpSelectionRole): void => {
    if (candidate === undefined || chosen.some((item) => item.experience.digest === candidate.experience.digest)) return
    chosen.push({ ...candidate, role, scoreExplanation: [...candidate.scoreExplanation, roleExplanation(role)] })
  }
  choose(ranked[0], 'primary')
  if (chosen.length < boundedLimit) {
    choose(ranked.find((candidate) =>
      !chosen.some((item) => item.experience.digest === candidate.experience.digest) &&
      negativeSignal(candidate.experience)), 'near_negative')
  }
  if (chosen.length < boundedLimit) {
    choose(ranked.find((candidate) =>
      !chosen.some((item) => item.experience.digest === candidate.experience.digest) &&
      !ranked.some((other) => other.experience.digest !== candidate.experience.digest &&
        dominates(other.experience, candidate.experience))), 'pareto_alternative')
  }
  for (const candidate of ranked) {
    if (chosen.length >= boundedLimit) break
    choose(candidate, 'ranked_fallback')
  }
  return chosen
}
