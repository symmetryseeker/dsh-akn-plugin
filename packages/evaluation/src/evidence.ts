import type { EvaluationAggregate } from '@aen/protocol'
import type { ComparisonEvidenceDecision } from './types.js'

export function comparisonEvidenceDecision(
  aggregate: EvaluationAggregate,
  comparisonId: string,
): ComparisonEvidenceDecision {
  const comparison = aggregate.comparisons.find((candidate) => candidate.comparisonId === comparisonId)
  if (comparison === undefined) {
    return {
      maximumEvidenceLevel: 'H2',
      mode: 'observational',
      reasonCodes: ['NO_COUNTERFACTUAL_COMPARISON'],
    }
  }
  if (comparison.counterfactualEligibility.status !== 'eligible') {
    return {
      maximumEvidenceLevel: 'H2',
      mode: 'observational',
      reasonCodes: comparison.counterfactualEligibility.reasonCodes,
      conclusion: comparison.conclusion,
    }
  }
  return {
    maximumEvidenceLevel: 'H3',
    mode: 'causal',
    reasonCodes: ['PREREGISTERED_COMPARABLE_COUNTERFACTUAL'],
    conclusion: comparison.conclusion,
  }
}

export function assertCausalClaimAllowed(
  aggregate: EvaluationAggregate,
  comparisonId: string,
): void {
  const decision = comparisonEvidenceDecision(aggregate, comparisonId)
  if (decision.maximumEvidenceLevel !== 'H3') {
    throw new Error(`causal H3 claim is not allowed: ${decision.reasonCodes.join(', ')}`)
  }
}
