import { withComputedDigest, type JsonRecord } from './digest.js'
import { validatePreDigestObject, validateProtocolObject } from './validation.js'

function validationError(prefix: string, result: ReturnType<typeof validateProtocolObject>): Error {
  const detail = result.issues
    .map((issue) => `${issue.code} ${issue.path}: ${issue.message}`)
    .join('; ')
  return new Error(`${prefix}: ${detail}`)
}

/** Finalize a pre-digest AEXP object through the normative two-phase validation lifecycle. */
export function finalizeProtocolObject<T>(draft: JsonRecord): T {
  const preDigest = validatePreDigestObject(draft)
  if (!preDigest.ok) throw validationError('invalid AEXP pre-digest object', preDigest)
  const published = withComputedDigest(draft)
  const result = validateProtocolObject(published)
  if (!result.ok) throw validationError('invalid AEXP published object', result)
  return published as unknown as T
}

/**
 * Validate content and attach its canonical digest before creating a required
 * top-level attestation. The returned value is not publishable until the
 * attestation is attached and validateProtocolObject succeeds.
 */
export function prepareProtocolObject<T>(draft: JsonRecord): T {
  const preDigest = validatePreDigestObject(draft)
  if (!preDigest.ok) throw validationError('invalid AEXP pre-digest object', preDigest)
  return withComputedDigest(draft) as unknown as T
}
