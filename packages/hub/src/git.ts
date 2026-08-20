import { lstat, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadContributionBundle } from './ingest.js'
import type { AuthorizedPublisherKey, IngestedContribution } from './types.js'

const IGNORED = new Set(['.git', 'node_modules', '.aen'])

export async function discoverContributionDirectories(rootPath: string): Promise<string[]> {
  const root = resolve(rootPath)
  const found: string[] = []
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    if (current.depth > 8) throw new Error(`Git contribution tree exceeds maximum depth at ${current.directory}`)
    const entries = await readdir(current.directory, { withFileTypes: true })
    if (entries.some((entry) => entry.isFile() && entry.name === 'inventory.json')) {
      if (!entries.some((entry) => entry.isFile() && entry.name === 'inventory.jcs.json')) {
        throw new Error(`contribution has inventory.json but no inventory.jcs.json: ${current.directory}`)
      }
      found.push(current.directory)
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED.has(entry.name)) continue
      const child = resolve(current.directory, entry.name)
      const metadata = await lstat(child)
      if (metadata.isSymbolicLink()) throw new Error(`symlinked Git contribution directories are forbidden: ${child}`)
      pending.push({ directory: child, depth: current.depth + 1 })
    }
  }
  return found.sort()
}

export async function loadGitContributions(
  root: string,
  keys: readonly AuthorizedPublisherKey[],
): Promise<IngestedContribution[]> {
  const directories = await discoverContributionDirectories(root)
  const contributions: IngestedContribution[] = []
  for (const directory of directories) contributions.push(await loadContributionBundle(directory, keys))
  const revokedDigests = new Set<string>(contributions
    .filter((contribution) => contribution.target.objectType === 'revocation')
    .flatMap((contribution) => contribution.target.objectType === 'revocation'
      ? contribution.target.affectedDigests
      : []))
  for (const contribution of contributions) {
    if (contribution.target.objectType === 'revocation') continue
    const leaked = contribution.objects.find((object) => revokedDigests.has(String(object.digest)))
    if (leaked !== undefined) {
      throw new Error(
        `Git registry current tree still distributes revoked body ${String(leaked.digest)}; ` +
        'remove its source contribution in the same reviewed revocation change',
      )
    }
  }
  return contributions
}
