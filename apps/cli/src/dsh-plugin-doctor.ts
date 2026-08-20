import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

export interface DoctorCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

interface PackageExport {
  default?: unknown
  types?: unknown
}

interface PluginManifest {
  name?: unknown
  dependencies?: Record<string, unknown>
  exports?: Record<string, PackageExport>
  dsh?: { bundle?: { patch?: unknown } }
}

const ROLE_EXPORTS = ['./definition', './policy', './provider', './tools'] as const
const PATCH_ROLES = [
  ['aen-policy', '@aen/dsh-plugin/policy'],
  ['aen', '@aen/dsh-plugin/provider'],
  ['aen-tools', '@aen/dsh-plugin/tools'],
] as const

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function resolveInside(packageRoot: string, reference: string): string | undefined {
  const path = resolve(packageRoot, reference)
  const pathFromRoot = relative(packageRoot, path)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(pathFromRoot)) {
    return undefined
  }
  return path
}

/** Validate the package surface that official `dsh plugin add` consumes. */
export async function inspectDshPluginBundle(inputPath: string): Promise<DoctorCheck> {
  const absolute = resolve(inputPath)
  let inputStat
  try {
    inputStat = await stat(absolute)
  } catch (error) {
    return {
      name: 'dsh-plugin-bundle',
      status: 'fail',
      detail: `bundle path is unavailable: ${absolute}; ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (inputStat.isFile() && absolute.endsWith('.js')) {
    return {
      name: 'dsh-plugin-bundle',
      status: 'fail',
      detail: `a single JS entry does not prove an installable DSH bundle: ${absolute}; point --plugin at the package directory or package.json`,
    }
  }

  const manifestPath = inputStat.isDirectory()
    ? resolve(absolute, 'package.json')
    : basename(absolute) === 'package.json'
      ? absolute
      : ''
  if (manifestPath.length === 0) {
    return {
      name: 'dsh-plugin-bundle',
      status: 'fail',
      detail: `unsupported plugin doctor target: ${absolute}; expected a package directory or package.json`,
    }
  }

  let manifest: PluginManifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PluginManifest
  } catch (error) {
    return {
      name: 'dsh-plugin-bundle',
      status: 'fail',
      detail: `cannot read plugin manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const packageRoot = dirname(manifestPath)
  const problems: string[] = []
  if (manifest.name !== '@aen/dsh-plugin') problems.push('package name is not @aen/dsh-plugin')

  const patchRef = manifest.dsh?.bundle?.patch
  if (typeof patchRef !== 'string' || patchRef.length === 0) {
    problems.push('dsh.bundle.patch is missing')
  } else {
    const patchPath = resolveInside(packageRoot, patchRef)
    if (patchPath === undefined) {
      problems.push(`bundle patch escapes the package: ${patchRef}`)
    } else if (!await exists(patchPath)) {
      problems.push(`bundle patch is missing: ${patchRef}`)
    } else {
      const patch = await readFile(patchPath, 'utf8')
      for (const [id, moduleName] of PATCH_ROLES) {
        if (!patch.includes(`id: ${id}`) || !patch.includes(`name: '${moduleName}'`)) {
          problems.push(`bundle patch omits ${id} -> ${moduleName}`)
        }
      }
    }
  }

  for (const subpath of ROLE_EXPORTS) {
    const entry = manifest.exports?.[subpath]
    if (typeof entry?.default !== 'string' || typeof entry.types !== 'string') {
      problems.push(`typed role export is missing: ${subpath}`)
      continue
    }
    const runtimePath = resolveInside(packageRoot, entry.default)
    if (runtimePath === undefined) {
      problems.push(`role runtime escapes the package: ${subpath} -> ${entry.default}`)
    } else if (!await exists(runtimePath)) {
      problems.push(`role runtime is not built: ${subpath} -> ${entry.default}`)
    }
    const declarationPath = resolveInside(packageRoot, entry.types)
    if (declarationPath === undefined) {
      problems.push(`role declaration escapes the package: ${subpath} -> ${entry.types}`)
    } else if (!await exists(declarationPath)) {
      problems.push(`role declaration is not built: ${subpath} -> ${entry.types}`)
    } else if ((await readFile(declarationPath, 'utf8')).includes("from '@aen/")) {
      problems.push(`role declaration leaks an unpublished AEN type dependency: ${subpath}`)
    }
  }

  const privateRuntimeDependencies = Object.keys(manifest.dependencies ?? {})
    .filter((dependency) => dependency.startsWith('@aen/'))
  if (privateRuntimeDependencies.length > 0) {
    problems.push(`unpublished AEN runtime dependencies: ${privateRuntimeDependencies.join(', ')}`)
  }

  return problems.length === 0
    ? {
        name: 'dsh-plugin-bundle',
        status: 'pass',
        detail: `${packageRoot}; definition/policy/provider/tools exports and DSH bundle patch are complete`,
      }
    : {
        name: 'dsh-plugin-bundle',
        status: 'fail',
        detail: `${packageRoot}; ${problems.join('; ')}`,
      }
}
