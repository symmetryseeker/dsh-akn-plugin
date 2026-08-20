import { spawnSync } from 'node:child_process'
import { lstat, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(join(tmpdir(), 'aen-hub-deployment-'))
const deployment = join(temporary, 'hub')

function cleanEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra }
  for (const name of [
    'ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY',
    'all_proxy', 'https_proxy', 'http_proxy', 'NODE_USE_ENV_PROXY',
  ]) delete environment[name]
  return environment
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: cleanEnvironment(options.env),
    timeout: options.timeoutMs ?? 120_000,
  })
  if (result.status !== 0) {
    throw new Error([
      `command failed (${result.status ?? 'signal'}): ${executable} ${args.join(' ')}`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

function isInside(root, path) {
  const fromRoot = relative(root, path)
  return fromRoot.length === 0 || (!fromRoot.startsWith('..') && !fromRoot.startsWith('/'))
}

try {
  run(process.execPath, [join(repositoryRoot, 'scripts', 'deploy-hub.mjs'), deployment])
  const deploymentRoot = await realpath(deployment)
  const files = await readdir(deploymentRoot, { recursive: true, withFileTypes: true })
  const relativePaths = files.map((entry) => relative(deploymentRoot, join(entry.parentPath, entry.name)))
  if (!relativePaths.includes('LICENSE')) throw new Error('portable Hub deployment omitted its Apache-2.0 license')
  if (relativePaths.some((path) => path === 'src' || path.startsWith('src/') || path === 'test' || path.startsWith('test/'))) {
    throw new Error('portable Hub deployment included source or test directories')
  }
  for (const path of relativePaths) {
    const absolute = join(deploymentRoot, path)
    if (!(await lstat(absolute)).isSymbolicLink()) continue
    const target = await realpath(absolute)
    if (!isInside(deploymentRoot, target)) {
      throw new Error(`portable Hub deployment symlink escapes its root: ${path} -> ${target}`)
    }
  }

  const entry = join(deploymentRoot, 'dist', 'main.js')
  const help = run(process.execPath, [entry, '--help'], { cwd: deploymentRoot })
  if (!help.stdout.includes('AEN Reference Hub')) throw new Error('deployed Hub CLI did not start')

  const e2e = run(process.execPath, [join(repositoryRoot, 'scripts', 'multi-process-e2e.mjs')], {
    env: { AEN_HUB_ENTRY: entry, AEN_HUB_CONFIG_FROM_ENV: '1' },
    timeoutMs: 180_000,
  })
  const result = JSON.parse(e2e.stdout)
  if (result.ok !== true || result.client?.exactDigestRead !== true) {
    throw new Error(`deployed Hub multi-process E2E did not prove exact read: ${e2e.stdout}`)
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    portableDeployment: true,
    sourceAndTestsExcluded: true,
    licenseIncluded: true,
    symlinksRemainInsideDeployment: true,
    cliStartsOutsideWorkspace: true,
    postgresGitHttpE2E: true,
    environmentConfiguredGitIngress: true,
    projectedExperiences: result.hub?.projection?.experiences,
    exactDigestRead: result.client?.exactDigestRead,
  }, null, 2)}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
