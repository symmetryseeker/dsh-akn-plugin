import type { JsonRecord } from '@aen/protocol'

export interface ContributionGraphIssue {
  sourceDigest: string
  path: string
  targetDigest: string
  message: string
}

interface RequiredTarget {
  path: string
  digest: string
  objectType?: string
}

function objectRefs(value: unknown, path = ''): RequiredTarget[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => objectRefs(child, `${path}/${index}`))
  }
  if (value === null || typeof value !== 'object') return []
  const record = value as JsonRecord
  const own = typeof record.protocolVersion !== 'string' &&
    typeof record.objectType === 'string' &&
    typeof record.refId === 'string' &&
    typeof record.digest === 'string'
    ? [{ path: path || '/', digest: record.digest, objectType: record.objectType }]
    : []
  return [
    ...own,
    ...Object.entries(record).flatMap(([key, child]) => objectRefs(child, `${path}/${key}`)),
  ]
}

function scalarTargets(object: JsonRecord): RequiredTarget[] {
  const targets: RequiredTarget[] = []
  if (object.objectType === 'trace_evidence' && typeof object.episodeDigest === 'string') {
    targets.push({ path: '/episodeDigest', digest: object.episodeDigest, objectType: 'task_episode' })
  }
  if (object.objectType === 'observation') {
    const cell = object.configurationCell as JsonRecord | undefined
    if (typeof cell?.harnessManifestDigest === 'string') {
      targets.push({
        path: '/configurationCell/harnessManifestDigest',
        digest: cell.harnessManifestDigest,
        objectType: 'harness_manifest',
      })
    }
  }
  if (object.objectType === 'experience_revision') {
    const applicability = object.applicability as JsonRecord | undefined
    const selectors = applicability?.harnessSelectors
    if (Array.isArray(selectors)) {
      selectors.forEach((selector, index) => {
        if (
          selector !== null && typeof selector === 'object' &&
          (selector as JsonRecord).path === 'harness.manifestDigest' &&
          typeof (selector as JsonRecord).value === 'string'
        ) {
          targets.push({
            path: `/applicability/harnessSelectors/${index}/value`,
            digest: (selector as JsonRecord).value as string,
            objectType: 'harness_manifest',
          })
        }
      })
    }
  }
  return targets
}

export function validateContributionGraph(objects: readonly JsonRecord[]): ContributionGraphIssue[] {
  const byDigest = new Map(objects.map((object) => [String(object.digest), object]))
  const issues: ContributionGraphIssue[] = []
  for (const source of objects) {
    const sourceDigest = String(source.digest)
    for (const target of [...objectRefs(source), ...scalarTargets(source)]) {
      // A revocation must remain distributable after the withdrawn body has been removed.
      // Its signed target/affected digests are intentionally external references.
      if (source.objectType === 'revocation' && target.path === '/target') continue
      // A validator may dispute an already-ingested immutable claim without
      // redistributing the author's entire Experience evidence graph.
      if (source.objectType === 'contention' && target.path === '/claimRef/experienceRef') continue
      const resolved = byDigest.get(target.digest)
      if (resolved === undefined) {
        issues.push({
          sourceDigest,
          path: target.path,
          targetDigest: target.digest,
          message: 'referenced object is absent from the contribution',
        })
      } else if (target.objectType !== undefined && resolved.objectType !== target.objectType) {
        issues.push({
          sourceDigest,
          path: target.path,
          targetDigest: target.digest,
          message: `referenced objectType ${String(resolved.objectType)} does not match ${target.objectType}`,
        })
      }
    }
  }
  return issues.sort((left, right) =>
    left.sourceDigest.localeCompare(right.sourceDigest) || left.path.localeCompare(right.path))
}

export function assertContributionGraphClosed(objects: readonly JsonRecord[]): void {
  const issues = validateContributionGraph(objects)
  if (issues.length > 0) {
    throw new Error(`public contribution has unresolved references: ${issues.map((issue) =>
      `${issue.sourceDigest}${issue.path}->${issue.targetDigest} (${issue.message})`).join('; ')}`)
  }
}

/**
 * Reject unrelated objects smuggled beside a signed root. Sidecars are roots
 * only when their semantics are independently checked by ingress.
 */
export function findUnreachableContributionObjects(
  targetDigest: string,
  objects: readonly JsonRecord[],
  sidecarTypes: readonly string[] = [],
): JsonRecord[] {
  const byDigest = new Map(objects.map((object) => [String(object.digest), object]))
  const reachable = new Set<string>()
  const queue = [
    targetDigest,
    ...objects
      .filter((object) => sidecarTypes.includes(String(object.objectType)))
      .map((object) => String(object.digest)),
  ]
  while (queue.length > 0) {
    const digest = queue.pop()
    if (digest === undefined || reachable.has(digest)) continue
    const object = byDigest.get(digest)
    if (object === undefined) continue
    reachable.add(digest)
    for (const ref of [...objectRefs(object), ...scalarTargets(object)]) {
      if (byDigest.has(ref.digest) && !reachable.has(ref.digest)) queue.push(ref.digest)
    }
  }
  return objects.filter((object) => !reachable.has(String(object.digest)))
}
