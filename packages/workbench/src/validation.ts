import {
  toObjectRef,
  validateProtocolObject,
  type ExperienceRevision,
  type JsonRecord,
  type ObjectRef,
} from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'

function refKey(ref: { digest: string }): string {
  return ref.digest
}

function assertRefResolves(store: LocalEvidenceStore, ref: ObjectRef, label: string): void {
  const object = store.getByDigest(ref.digest)
  if (object === undefined) throw new Error(`${label} does not resolve locally: ${ref.digest}`)
  const resolved = toObjectRef(object)
  if (resolved.objectType !== ref.objectType || resolved.refId !== ref.refId || resolved.revision !== ref.revision) {
    throw new Error(`${label} identity does not match its digest: ${ref.digest}`)
  }
}

export function validateExperienceComposition(
  store: LocalEvidenceStore,
  value: ExperienceRevision,
): void {
  const protocol = validateProtocolObject(value)
  if (!protocol.ok) {
    throw new Error(`invalid ExperienceRevision: ${protocol.issues.map((issue) => issue.message).join('; ')}`)
  }
  if (value.governance.visibility !== 'private') {
    throw new Error('workbench only accepts private ExperienceRevision objects; public objects require Promotion')
  }
  const evidence = new Set(value.evidenceRefs.map(refKey))
  const artifacts = new Set(value.artifactRefs.map(refKey))
  for (const ref of value.evidenceRefs) assertRefResolves(store, ref, 'experience evidenceRef')
  for (const ref of value.artifactRefs) assertRefResolves(store, ref, 'experience artifactRef')
  for (const claim of value.claims) {
    for (const ref of [...claim.supportingEvidenceRefs, ...claim.contradictingEvidenceRefs]) {
      if (!evidence.has(ref.digest)) {
        throw new Error(`claim ${claim.claimId} refers to evidence absent from experience.evidenceRefs`)
      }
    }
    for (const ref of claim.artifactRefs ?? []) {
      if (!artifacts.has(ref.digest)) {
        throw new Error(`claim ${claim.claimId} refers to artifact absent from experience.artifactRefs`)
      }
    }
  }
  for (const pair of value.cases ?? []) {
    for (const ref of [...pair.positive.traceEvidenceRefs, ...pair.negative.traceEvidenceRefs]) {
      if (!evidence.has(ref.digest)) {
        throw new Error('case pair refers to evidence absent from experience.evidenceRefs')
      }
    }
  }
}

export function asExperience(value: JsonRecord): ExperienceRevision {
  if (value.objectType !== 'experience_revision') throw new Error('object is not an ExperienceRevision')
  return value as unknown as ExperienceRevision
}
