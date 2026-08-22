import { describe, expect, it } from 'vitest'
import { selectMvpExperienceCandidates, type ExperienceRevision } from '../src/index.js'

function experience(
  suffix: string,
  options: {
    evidence: 'H1' | 'H2' | 'H3'
    quality?: number
    cost?: number
    latency?: number
    negative?: boolean
    applicability?: { taskFamilies: string[]; generality?: 'universal' | 'domain' | 'scene_specific' }
  },
): ExperienceRevision {
  return {
    experienceId: `urn:aen:experience:ranking:${suffix}`,
    digest: `sha256:${suffix.repeat(64).slice(0, 64)}`,
    createdAt: '2026-08-01T00:00:00Z',
    kind: options.negative ? 'negative_result' : 'strategy',
    claims: [{ evidenceLevel: options.evidence, contradictingEvidenceRefs: [] }],
    ...(options.applicability === undefined ? {} : { applicability: options.applicability }),
    ...(options.quality === undefined && options.cost === undefined && options.latency === undefined ? {} : {
      metricSummary: {
        sampleSize: 10,
        ...(options.quality === undefined ? {} : { quality: { mean: options.quality } }),
        ...(options.cost === undefined ? {} : { costUsd: { mean: options.cost } }),
        ...(options.latency === undefined ? {} : { latencyMs: { p95: options.latency } }),
        method: 'ranking-test',
      },
    }),
  } as unknown as ExperienceRevision
}

describe('MVP deterministic sparse reranking', () => {
  it('retains a primary, a negative boundary, and a Pareto alternative when available', () => {
    const candidates = [
      { experience: experience('a', { evidence: 'H3', quality: 0.95, cost: 1, latency: 1_000 }), compatibility: 'exact' as const, recallRank: 0 },
      { experience: experience('b', { evidence: 'H2', quality: 0.4, cost: 0.4, latency: 900, negative: true }), compatibility: 'compatible' as const, recallRank: 1 },
      { experience: experience('c', { evidence: 'H2', quality: 0.85, cost: 0.1, latency: 100 }), compatibility: 'exact' as const, recallRank: 2 },
      { experience: experience('d', { evidence: 'H1', quality: 0.5, cost: 2, latency: 2_000 }), compatibility: 'unknown' as const, recallRank: 3 },
    ]
    const first = selectMvpExperienceCandidates(candidates, 3, new Date('2026-08-20T00:00:00Z'))
    const second = selectMvpExperienceCandidates(candidates, 3, new Date('2026-08-20T00:00:00Z'))
    expect(first.map(({ experience: value, role }) => [value.experienceId, role])).toEqual([
      ['urn:aen:experience:ranking:a', 'primary'],
      ['urn:aen:experience:ranking:b', 'near_negative'],
      ['urn:aen:experience:ranking:c', 'pareto_alternative'],
    ])
    expect(second).toEqual(first)
    expect(first.every((candidate) => candidate.scoreExplanation.length >= 5)).toBe(true)
  })

  it('ranks universal experiences above scene-specific ones when all else is equal', () => {
    const base = { evidence: 'H1' as const }
    const candidates = [
      { experience: experience('universal', { ...base, applicability: { taskFamilies: ['math'], generality: 'universal' as const } }), compatibility: 'exact' as const, recallRank: 0 },
      { experience: experience('domain', { ...base, applicability: { taskFamilies: ['math'], generality: 'domain' as const } }), compatibility: 'exact' as const, recallRank: 1 },
      { experience: experience('scene', { ...base, applicability: { taskFamilies: ['math'], generality: 'scene_specific' as const } }), compatibility: 'exact' as const, recallRank: 2 },
      { experience: experience('unmeasured', { ...base, applicability: { taskFamilies: ['math'] } }), compatibility: 'exact' as const, recallRank: 3 },
    ]
    // limit 被实现 cap 到 3；universal/domain/scene 应占据前三，unmeasured 被淘汰
    const selected = selectMvpExperienceCandidates(candidates, 4, new Date('2026-08-20T00:00:00Z'))
    const ids = selected.map(({ experience: value }) => value.experienceId)
    expect(ids).toEqual([
      'urn:aen:experience:ranking:universal',
      'urn:aen:experience:ranking:domain',
      'urn:aen:experience:ranking:scene',
    ])
    expect(ids).not.toContain('urn:aen:experience:ranking:unmeasured')
    expect(selected[0]?.scoreExplanation.some((line) => line.includes('Generality: universal'))).toBe(true)
  })
})
