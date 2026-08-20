import { describe, expect, it } from 'vitest'
import {
  validateProtocolObject,
  type ExperienceCard,
  type ExperienceContextPlan,
  type FeedbackEvent,
  type JsonRecord,
} from '@aen/protocol'
import {
  ContextBudgetExceededError,
  createContextPlan,
  createFeedbackEvent,
  createTaskCapsule,
  createConsumptionObservation,
  injectContextPlan,
  type ExperienceRevisionRef,
  type ExperienceSource,
} from '../src/index.js'

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`

function card(overrides: Partial<ExperienceCard> = {}): ExperienceCard {
  return {
    experienceId: 'urn:aen:experience:one',
    revision: 2,
    digest: digest('1'),
    title: 'Recover after a failed tool call',
    summary: 'A signed failure-recovery boundary.',
    intendedUseSummary: ['safe recovery'],
    outOfScopeSummary: ['automatic destructive retry'],
    knownFailureSummary: ['unchanged retry'],
    taskFamilies: ['software-engineering', 'failure-recovery'],
    compatibility: 'exact',
    maxEvidenceLevel: 'H1',
    positiveCaseSummary: 'retry passed',
    negativeCaseSummary: 'initial call failed',
    safetyLabels: ['no-automatic-execution'],
    sourceSummary: 'signed public revision',
    availableSections: ['card', 'recipe', 'cases', 'evidence'],
    estimatedSectionTokens: { card: 80, recipe: 120, cases: 100, evidence: 140 },
    scoreExplanation: ['exact Model × Harness match'],
    ...overrides,
  }
}

function capsule() {
  return createTaskCapsule({
    taxonomy: ['software-engineering', 'failure-recovery'],
    abstractIntent: 'Recover a failed operation and verify acceptance.',
    constraints: ['No destructive retry without approval.'],
    acceptanceTraits: ['independent verification'],
    riskClass: 'reversible_write',
    modelSelector: { path: 'model.modelId', operator: 'equals', value: 'deepseek-reasoner' },
    harnessCapabilities: [{ path: 'harness.capability', operator: 'equals', value: 'tools:bash' }],
    omittedSensitiveFields: ['rawPrompt', 'repositoryUrl', 'filePaths', 'artifactNames'],
    now: '2026-08-20T04:00:00Z',
  })
}

describe('privacy-minimized Task Capsule and Context Plan', () => {
  it('creates a short-lived protocol-valid capsule and rejects leaked local context', () => {
    const result = capsule()
    expect(validateProtocolObject(result)).toMatchObject({ ok: true, issues: [] })
    expect(result.abstractIntent).not.toContain('/Users/')
    expect(result.omittedSensitiveFields).toContain('rawPrompt')
    expect(() => createTaskCapsule({
      taxonomy: ['software-engineering'],
      abstractIntent: 'Edit /Users/alice/private-project/secret.ts',
      constraints: [],
      acceptanceTraits: [],
      riskClass: 'reversible_write',
      omittedSensitiveFields: ['rawPrompt'],
    })).toThrow('macos-absolute-user-path')
  })

  it('hard-filters incompatible cards, caps selections at three, and preserves the negative case', () => {
    const cards = [
      card(),
      card({ experienceId: 'urn:aen:experience:incompatible', digest: digest('2'), compatibility: 'incompatible', maxEvidenceLevel: 'H4' }),
      card({ experienceId: 'urn:aen:experience:compatible', digest: digest('3'), compatibility: 'compatible' }),
      card({ experienceId: 'urn:aen:experience:unknown', digest: digest('4'), compatibility: 'unknown' }),
      card({ experienceId: 'urn:aen:experience:fourth', digest: digest('5'), compatibility: 'compatible' }),
    ]
    const plan = createContextPlan(capsule(), cards, { estimatedMaxTokens: 2_000 })
    expect(validateProtocolObject(plan)).toMatchObject({ ok: true, issues: [] })
    expect(plan.selections).toHaveLength(3)
    expect(plan.selections.some((selection) => selection.experienceRef.digest === digest('2'))).toBe(false)
    expect(plan.selections[0]).toMatchObject({
      experienceRef: { digest: digest('1') },
      requiredNegativeCase: true,
    })
    expect(plan.selections[0]?.sections).toContain('cases')
    expect(plan.selections.flatMap((selection) => selection.sections)).not.toContain('artifacts')
  })
})

describe('budgeted injection and measured feedback', () => {
  function source(readSections: JsonRecord): ExperienceSource {
    return {
      search: async () => [],
      read: async (ref: ExperienceRevisionRef) => ({
        experienceRef: ref,
        sections: readSections,
        provenance: { source: 'public_hub', untrusted: true, contentDigest: digest('9') },
      }),
      feedback: async (_event: FeedbackEvent) => undefined,
    }
  }

  it('rejects an over-budget full JSON read before injection and records nothing', async () => {
    const plan = createContextPlan(capsule(), [card({
      availableSections: ['card'],
      negativeCaseSummary: undefined,
      estimatedSectionTokens: { card: 1 },
    })], { estimatedMaxTokens: 1 })
    let injected = 0
    let recorded = 0
    await expect(injectContextPlan({
      plan,
      source: source({ card: { value: 'x'.repeat(2_000) } }),
      inject: async () => { injected += 1; return { injectedSections: ['card'] } },
      record: () => { recorded += 1 },
    })).rejects.toBeInstanceOf(ContextBudgetExceededError)
    expect(injected).toBe(0)
    expect(recorded).toBe(0)
  })

  it('records an injection observation before adopted feedback can be created', async () => {
    const plan = createContextPlan(capsule(), [card({
      availableSections: ['card', 'cases'],
      estimatedSectionTokens: { card: 200, cases: 200 },
    })], { estimatedMaxTokens: 2_000, maxBytes: 20_000 })
    const recorded: JsonRecord[] = []
    const observations = await injectContextPlan({
      plan,
      source: source({
        card: { title: 'Recover safely', safetyLabels: ['no-automatic-execution'] },
        cases: { positive: 'recovered', negative: 'failed unchanged retry' },
      }),
      inject: async () => ({ injectedSections: ['card', 'cases'], actualTokens: 110 }),
      record: (observation) => { recorded.push(observation as unknown as JsonRecord) },
      now: '2026-08-20T04:01:00Z',
    })
    expect(observations).toHaveLength(1)
    expect(recorded).toHaveLength(1)
    expect(validateProtocolObject(observations[0])).toMatchObject({ ok: true, issues: [] })
    const selection = plan.selections[0]
    expect(selection).toBeDefined()
    if (selection === undefined) return
    expect(() => createFeedbackEvent({
      experienceRef: selection.experienceRef,
      decision: 'adopted',
      outcome: 'helpful',
    })).toThrow('requires a ContextInjectionObservation')
    const feedback = createFeedbackEvent({
      experienceRef: selection.experienceRef,
      decision: 'adopted',
      outcome: 'helpful',
      injectionObservation: observations[0],
      sharingScope: 'local',
      now: '2026-08-20T04:02:00Z',
    })
    expect(validateProtocolObject(feedback)).toMatchObject({ ok: true, issues: [] })
    expect(feedback).not.toHaveProperty('evidenceLevel')
    expect(feedback.reasonCodes?.[0]).toContain('context_injection:sha256:')

    const measured = createConsumptionObservation({
      experienceRef: selection.experienceRef,
      injectionObservation: observations[0]!,
      observationId: 'urn:aen:observation:consumer-test',
      taskRef: 'urn:aen:task:consumer-test',
      evaluatorRef: 'urn:aen:evaluator:acceptance-test',
      configurationCell: {
        model: {
          provider: 'deepseek', modelId: 'deepseek-reasoner',
          observedAt: '2026-08-20T04:02:00Z', mutability: 'provider_mutable',
        },
        harnessConfigurationDigest: digest('7'),
        harnessManifestDigest: digest('8'),
        environment: { capturedAt: '2026-08-20T04:02:00Z', disclosure: 'metadata' },
      },
      outcome: 'success',
      acceptanceResults: [{ criterionId: 'verified-output', passed: true, evidenceRefs: [] }],
      metrics: { quality: { score: 1 }, tokenUsage: { input: 100, output: 20 } },
      evidenceRefs: [],
      independence: {
        evaluatorActor: { actorId: 'urn:aen:actor:local-evaluator', type: 'agent' },
        declaredConflicts: [],
      },
      createdAt: '2026-08-20T04:03:00Z',
    })
    expect(validateProtocolObject(measured)).toMatchObject({ ok: true, issues: [] })
    expect(measured.treatment).toBe('experience_applied')
    expect(measured.contextInjectionRefs?.[0]?.digest).toBe(observations[0]?.digest)
  })
})
