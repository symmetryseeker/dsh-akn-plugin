import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalJson, toObjectRef, type JsonRecord } from '@aen/protocol'
import type {
  ContributionInventory,
  ObjectContributionInput,
  PromoteOptions,
  PromotionResult,
} from './types.js'

function safeSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 96)
}

export async function writeObjectContributionBundle(
  outputDirectory: string,
  input: ObjectContributionInput,
): Promise<ContributionInventory> {
  const root = resolve(outputDirectory)
  const objectDirectory = resolve(root, 'objects')
  await mkdir(objectDirectory, { recursive: true })
  if (!input.objects.some((object) => object.digest === input.target.digest)) {
    throw new Error('contribution objects do not contain the target')
  }
  const entries = input.objects.map((object) => {
    const ref = toObjectRef(object)
    const name = `${safeSegment(ref.objectType)}--${safeSegment(ref.refId)}${ref.revision === undefined ? '' : `--r${ref.revision}`}--${ref.digest.slice(7, 23)}.json`
    return { object, ref, relativePath: `objects/${name}`, absolutePath: resolve(objectDirectory, name) }
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  for (const entry of entries) {
    await writeFile(entry.absolutePath, `${JSON.stringify(entry.object, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  }
  const inventory: ContributionInventory = {
    profile: 'aen-git-contribution-v0.1',
    createdAt: input.createdAt,
    actor: input.actor,
    targetDigest: String(input.target.digest),
    objects: entries.map(({ ref, relativePath }) => ({
      objectType: ref.objectType,
      refId: ref.refId,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      digest: ref.digest,
      path: relativePath,
    })),
  }
  await writeFile(resolve(root, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await writeFile(resolve(root, 'inventory.jcs.json'), canonicalJson(inventory), { encoding: 'utf8', flag: 'wx' })
  return inventory
}

export async function writeContributionBundle(
  outputDirectory: string,
  result: PromotionResult,
  options: Pick<PromoteOptions, 'actor'>,
): Promise<ContributionInventory> {
  return writeObjectContributionBundle(outputDirectory, {
    target: result.target as unknown as JsonRecord,
    objects: result.contributionObjects,
    actor: options.actor,
    createdAt: result.promotion.createdAt,
  })
}
