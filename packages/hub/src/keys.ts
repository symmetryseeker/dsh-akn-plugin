import { createPublicKey } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { AuthorizedPublisherKey } from './types.js'

interface KeyRegistryFile {
  profile: 'aen-authorized-publisher-keys-v0.1'
  keys: Array<{
    keyid: string
    actorId: string
    publicKeyPath: string
    validFrom?: string
    revokedAt?: string
  }>
}

function parse(value: unknown): KeyRegistryFile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('key registry must be an object')
  const registry = value as Partial<KeyRegistryFile>
  if (registry.profile !== 'aen-authorized-publisher-keys-v0.1' || !Array.isArray(registry.keys)) {
    throw new Error('key registry profile is invalid')
  }
  for (const key of registry.keys) {
    if (
      key === null || typeof key !== 'object' || typeof key.keyid !== 'string' ||
      typeof key.actorId !== 'string' || typeof key.publicKeyPath !== 'string'
    ) throw new Error('key registry entry is invalid')
  }
  return registry as KeyRegistryFile
}

export async function loadAuthorizedPublisherKeys(path: string): Promise<AuthorizedPublisherKey[]> {
  const registryPath = await realpath(resolve(path))
  const root = dirname(registryPath)
  const registry = parse(JSON.parse(await readFile(registryPath, 'utf8')))
  const seen = new Set<string>()
  const keys: AuthorizedPublisherKey[] = []
  for (const entry of registry.keys) {
    if (seen.has(entry.keyid)) throw new Error(`duplicate authorized keyid: ${entry.keyid}`)
    seen.add(entry.keyid)
    const candidate = resolve(root, entry.publicKeyPath)
    if (!candidate.startsWith(`${root}${sep}`)) throw new Error(`public key escapes registry directory: ${entry.publicKeyPath}`)
    const metadata = await lstat(candidate)
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`public key must be a regular file: ${entry.publicKeyPath}`)
    const publicKey = createPublicKey(await readFile(candidate, 'utf8'))
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error(`authorized key is not Ed25519: ${entry.keyid}`)
    keys.push({
      keyid: entry.keyid,
      actorId: entry.actorId,
      publicKey,
      ...(entry.validFrom === undefined ? {} : { validFrom: entry.validFrom }),
      ...(entry.revokedAt === undefined ? {} : { revokedAt: entry.revokedAt }),
    })
  }
  return keys
}
