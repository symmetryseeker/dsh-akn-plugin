import {
  canonicalJson,
  finalizeProtocolObject,
  sha256,
  type ContextInjectionObservation,
  type JsonRecord,
} from '@aen/protocol'
import type { InjectionInput } from './types.js'

export class ContextBudgetExceededError extends Error {
  readonly code = 'AEXP_CONTEXT_BUDGET_EXCEEDED'

  constructor(message: string) {
    super(message)
    this.name = 'ContextBudgetExceededError'
  }
}

function bytes(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), 'utf8')
}

export async function injectContextPlan(input: InjectionInput): Promise<ContextInjectionObservation[]> {
  const payload: Array<{ experienceRef: typeof input.plan.selections[number]['experienceRef']; sections: JsonRecord }> = []
  let totalBytes = 0
  let totalEstimatedTokens = 0
  for (const selection of input.plan.selections) {
    const read = await input.source.read(selection.experienceRef, selection.sections)
    if (
      read.experienceRef.experienceId !== selection.experienceRef.experienceId ||
      read.experienceRef.revision !== selection.experienceRef.revision ||
      read.experienceRef.digest !== selection.experienceRef.digest
    ) throw new Error('resource read returned a different immutable Experience revision')
    for (const section of selection.sections) {
      if (!(section in read.sections)) throw new Error(`resource read omitted required section without a plan change: ${section}`)
    }
    const sectionBytes = bytes(read.sections)
    const estimate = Math.ceil(sectionBytes / 4)
    if (estimate > selection.maxEstimatedTokens) {
      throw new ContextBudgetExceededError(`Experience ${selection.experienceRef.digest} exceeds its planned token budget`)
    }
    totalBytes += sectionBytes
    totalEstimatedTokens += estimate
    if (input.plan.totalBudget.maxBytes !== undefined && totalBytes > input.plan.totalBudget.maxBytes) {
      throw new ContextBudgetExceededError('Context Plan byte budget exceeded')
    }
    if (totalEstimatedTokens > input.plan.totalBudget.estimatedMaxTokens) {
      throw new ContextBudgetExceededError('Context Plan token budget exceeded')
    }
    payload.push({ experienceRef: selection.experienceRef, sections: read.sections })
  }
  const result = await input.inject(payload)
  const allowedSections = new Set(input.plan.selections.flatMap((selection) => selection.sections))
  if (result.injectedSections.some((section) => !allowedSections.has(section as never))) {
    throw new Error('injector reported a section outside the Context Plan')
  }
  const now = input.now ?? new Date().toISOString()
  const observations = payload.map((item, index) => {
    const selection = input.plan.selections[index]!
    const contentDigests = selection.sections.map((section) => sha256(canonicalJson(item.sections[section])))
    return finalizeProtocolObject<ContextInjectionObservation>({
      protocolVersion: '0.1',
      objectType: 'context_injection_observation',
      injectionId: `urn:aen:context-injection:${sha256(canonicalJson({ plan: input.plan.digest, experience: selection.experienceRef.digest, contentDigests })).slice(7, 31)}`,
      planId: input.plan.planId,
      experienceRef: selection.experienceRef,
      fetchedSections: selection.sections,
      injectedSections: result.injectedSections.filter((section) => selection.sections.includes(section as never)),
      contentDigests,
      estimatedTokens: Math.ceil(bytes(item.sections) / 4),
      ...(result.actualTokens === undefined ? {} : { actualTokens: result.actualTokens }),
      ...(result.effectiveSurfaceDigest === undefined ? {} : { effectiveSurfaceDigest: result.effectiveSurfaceDigest }),
      createdAt: now,
    })
  })
  for (const observation of observations) await input.record(observation)
  return observations
}
