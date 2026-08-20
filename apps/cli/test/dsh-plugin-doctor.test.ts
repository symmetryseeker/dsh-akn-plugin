import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectDshPluginBundle } from '../src/dsh-plugin-doctor.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture(options: {
  omitRole?: string
  privateDependency?: boolean
  escapingExport?: boolean
} = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aen-plugin-doctor-'))
  directories.push(directory)
  await mkdir(join(directory, 'dist'))
  const exports: Record<string, { default: string; types: string }> = {}
  for (const role of ['definition', 'policy', 'provider', 'tools']) {
    if (`./${role}` === options.omitRole) continue
    const declaration = role === 'definition' ? 'runtime.d.ts' : `${role}-plugin.d.ts`
    exports[`./${role}`] = { default: `./dist/${role}.js`, types: `./dist/${declaration}` }
    await writeFile(join(directory, 'dist', `${role}.js`), 'export const ready = true\n')
    await writeFile(join(directory, 'dist', declaration), 'export declare const ready: true\n')
  }
  if (options.escapingExport === true && exports['./tools'] !== undefined) {
    exports['./tools'].default = '../outside.js'
  }
  await writeFile(join(directory, 'cordis.patch.yml'), [
    '- insert:',
    "    - id: aen-policy\n      name: '@aen/dsh-plugin/policy'",
    "    - id: aen\n      name: '@aen/dsh-plugin/provider'",
    "    - id: aen-tools\n      name: '@aen/dsh-plugin/tools'",
    '',
  ].join('\n'))
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: '@aen/dsh-plugin',
    exports,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: options.privateDependency ? { '@aen/private-runtime': '0.0.1' } : {},
  }))
  return directory
}

describe('DeepSeek Harness plugin doctor', () => {
  it('accepts a closed four-role bundle package', async () => {
    await expect(inspectDshPluginBundle(await fixture())).resolves.toMatchObject({ status: 'pass' })
  })

  it('rejects a package that omits a role export', async () => {
    const result = await inspectDshPluginBundle(await fixture({ omitRole: './tools' }))
    expect(result).toMatchObject({ status: 'fail' })
    expect(result.detail).toContain('typed role export is missing: ./tools')
  })

  it('rejects unpublished workspace runtime dependencies', async () => {
    const result = await inspectDshPluginBundle(await fixture({ privateDependency: true }))
    expect(result).toMatchObject({ status: 'fail' })
    expect(result.detail).toContain('@aen/private-runtime')
  })

  it('rejects a legacy single JavaScript entry as installation proof', async () => {
    const directory = await fixture()
    const result = await inspectDshPluginBundle(join(directory, 'dist', 'provider.js'))
    expect(result).toMatchObject({ status: 'fail' })
    expect(result.detail).toContain('single JS entry does not prove an installable DSH bundle')
  })

  it('rejects role exports that escape the package boundary', async () => {
    const result = await inspectDshPluginBundle(await fixture({ escapingExport: true }))
    expect(result).toMatchObject({ status: 'fail' })
    expect(result.detail).toContain('role runtime escapes the package: ./tools')
  })
})
