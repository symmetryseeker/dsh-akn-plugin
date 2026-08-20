import { execFile, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoot = resolve(process.env.AEN_DSH_PACKAGE_ROOT ?? join(repositoryRoot, 'packages', 'dsh-plugin'))
const pluginPackageName = process.env.AEN_DSH_PACKAGE_NAME ?? '@aen/dsh-plugin'
const dshRoot = resolve(process.env.DSH_SOURCE ?? join(repositoryRoot, 'deepseek-harness'))
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const temporaryRoot = await mkdtemp(join(tmpdir(), 'aen-dsh-host-smoke-'))
const packRoot = join(temporaryRoot, 'pack')
const dshHome = join(temporaryRoot, 'dsh-home')
const databasePath = join(temporaryRoot, 'evidence.sqlite')
const overlayPath = join(temporaryRoot, 'runtime.cordis.yml')

const port = await new Promise((resolvePort, rejectPort) => {
  const server = createServer()
  server.once('error', rejectPort)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (address === null || typeof address === 'string') {
      server.close()
      rejectPort(new Error('failed to allocate a local TCP port'))
      return
    }
    server.close((error) => error === undefined ? resolvePort(address.port) : rejectPort(error))
  })
})

const childEnvironment = { ...process.env, DSH_HOME: dshHome }
for (const key of [
  'ALL_PROXY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'all_proxy',
  'https_proxy',
  'http_proxy',
  'NODE_USE_ENV_PROXY',
]) delete childEnvironment[key]

async function assertDshBuild() {
  const required = [
    join(dshRoot, 'apps', 'web', 'dist', 'index.html'),
    join(dshRoot, 'packages', 'core', 'agent', 'lib', 'index.js'),
  ]
  for (const path of required) {
    try {
      await stat(path)
    } catch {
      throw new Error(`DeepSeek Harness build artifact is missing: ${path}\nRun: pnpm --dir ${dshRoot} run build`)
    }
  }
}

async function command(args, cwd) {
  const result = await execFileAsync(pnpm, args, {
    cwd,
    env: childEnvironment,
    maxBuffer: 16 * 1024 * 1024,
  })
  return `${result.stdout}${result.stderr}`
}

async function waitForWeb(processExit, logs) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const outcome = await Promise.race([
      processExit.then((exit) => ({ exit })),
      fetch(`http://127.0.0.1:${port}/`)
        .then(async (response) => ({ response, body: await response.text() }))
        .catch(() => undefined),
    ])
    if (outcome?.exit !== undefined) {
      throw new Error(`DeepSeek Harness exited before readiness: ${JSON.stringify(outcome.exit)}\n${logs()}`)
    }
    if (outcome?.response?.ok && outcome.body?.includes('<title>DeepSeek Harness</title>')) {
      return Buffer.byteLength(outcome.body)
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`DeepSeek Harness did not become ready within 30 seconds\n${logs()}`)
}

async function stop(child, processExit) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  const timeout = Symbol('timeout')
  const outcome = await Promise.race([
    processExit,
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(timeout), 10_000)),
  ])
  if (outcome === timeout) {
    child.kill('SIGKILL')
    throw new Error('DeepSeek Harness did not stop within 10 seconds after SIGTERM')
  }
  if (outcome.code !== 0) {
    throw new Error(`DeepSeek Harness stopped with ${JSON.stringify(outcome)}`)
  }
}

let host
let hostExit
let hostStopped = false
let hostOutput = ''
try {
  await assertDshBuild()
  await mkdir(packRoot, { recursive: true })
  await mkdir(dshHome, { recursive: true })
  const packOutput = await command(['pack', '--pack-destination', packRoot], pluginRoot)
  const tarballLine = packOutput.split(/\r?\n/u).findLast((line) => line.endsWith('.tgz'))
  if (tarballLine === undefined) throw new Error(`pnpm pack did not report a tarball\n${packOutput}`)
  const tarball = resolve(tarballLine.trim())

  await command(['dsh', 'plugin', '--profile', 'web', 'add', tarball], dshRoot)
  const profileManifestPath = join(dshHome, 'profiles', 'web', 'package.json')
  const profileManifest = JSON.parse(await readFile(profileManifestPath, 'utf8'))
  const bundles = profileManifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.includes(pluginPackageName)) {
    throw new Error(`dsh plugin add did not activate ${pluginPackageName} as a profile bundle`)
  }
  const installedPackageRoot = join(
    dshHome,
    'profiles',
    'web',
    'node_modules',
    ...pluginPackageName.split('/'),
  )
  const installedManifest = JSON.parse(await readFile(join(installedPackageRoot, 'package.json'), 'utf8'))
  const privateRuntimeDependencies = Object.keys(installedManifest.dependencies ?? {})
    .filter((dependency) => dependency.startsWith('@aen/'))
  if (privateRuntimeDependencies.length > 0) {
    throw new Error(`installed plugin retained unpublished AEN runtime dependencies: ${privateRuntimeDependencies.join(', ')}`)
  }
  for (const subpath of ['./definition', './policy', './provider', './tools', './evaluation-driver']) {
    const exported = installedManifest.exports?.[subpath]
    if (typeof exported?.default !== 'string' || typeof exported?.types !== 'string') {
      throw new Error(`installed plugin omitted typed package export: ${subpath}`)
    }
    await stat(join(installedPackageRoot, exported.default))
    const declarationPath = join(installedPackageRoot, exported.types)
    await stat(declarationPath)
    const declaration = await readFile(declarationPath, 'utf8')
    if (declaration.includes("from '@aen/")) {
      throw new Error(`installed plugin declaration ${subpath} leaks an unpublished AEN type dependency`)
    }
  }
  const rootRuntimeExport = installedManifest.exports?.['.']?.default
  if (typeof rootRuntimeExport !== 'string') {
    throw new Error('installed plugin omitted the root runtime export')
  }
  const installedRuntimeRoot = dirname(join(installedPackageRoot, rootRuntimeExport))
  const installedRuntimeFiles = await readdir(installedRuntimeRoot)
  const expectedRuntimeModules = new Set([
    'index.js',
    'definition.js',
    'policy.js',
    'provider.js',
    'tools.js',
    'evaluation-driver.js',
  ])
  const installedRuntimeModules = installedRuntimeFiles.filter((file) => file.endsWith('.js'))
  const missingRuntimeModules = [...expectedRuntimeModules]
    .filter((file) => !installedRuntimeModules.includes(file))
  if (missingRuntimeModules.length > 0) {
    throw new Error(`installed plugin omitted bundled Cordis roles: ${missingRuntimeModules.join(', ')}`)
  }
  const unexpectedRuntimeModules = installedRuntimeModules
    .filter((file) => !expectedRuntimeModules.has(file))
  if (unexpectedRuntimeModules.length > 0) {
    throw new Error(`installed plugin exposed unbundled runtime modules: ${unexpectedRuntimeModules.join(', ')}`)
  }
  const installedPatch = await readFile(join(installedPackageRoot, 'cordis.patch.yml'), 'utf8')
  for (const role of [
    ['aen-policy', `${pluginPackageName}/policy`],
    ['aen', `${pluginPackageName}/provider`],
    ['aen-tools', `${pluginPackageName}/tools`],
  ]) {
    if (!installedPatch.includes(`id: ${role[0]}`) || !installedPatch.includes(`name: '${role[1]}'`)) {
      throw new Error(`installed bundle patch omitted Cordis role ${role[0]} -> ${role[1]}`)
    }
  }

  await writeFile(overlayPath, [
    '- id: aen-policy',
    '  config:',
    '    captureSkillContent: true',
    '    captureSkillResources: true',
    '    allowHubSearch: false',
    '- id: aen',
    '  config:',
    '    enabled: true',
    `    storePath: ${JSON.stringify(databasePath)}`,
    '    harnessVersion: 0.1.0-rc.7',
    '    snapshotDelayMs: 25',
    '- id: aen-tools',
    '  disabled: false',
    '',
  ].join('\n'))

  host = spawn(pnpm, [
    'dsh', '--profile', 'web', '--patch', overlayPath,
    '--host', '127.0.0.1', '--port', String(port),
  ], {
    cwd: dshRoot,
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  host.stdout?.on('data', (chunk) => { hostOutput += String(chunk) })
  host.stderr?.on('data', (chunk) => { hostOutput += String(chunk) })
  hostExit = new Promise((resolveExit) => {
    host.on('exit', (code, signal) => resolveExit({ code, signal }))
  })
  const htmlBytes = await waitForWeb(hostExit, () => hostOutput)
  await stat(databasePath)
  await stop(host, hostExit)
  hostStopped = true

  const database = new DatabaseSync(databasePath, { readOnly: true })
  const version = Number(database.prepare('PRAGMA user_version').get()?.user_version)
  const tableRows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  database.close()
  const tables = new Set(tableRows.map((row) => String(row.name)))
  for (const table of ['objects', 'sessions', 'experience_fts', 'local_deletion_tombstones']) {
    if (!tables.has(table)) throw new Error(`installed plugin database omitted table: ${table}`)
  }
  if (version !== 3) throw new Error(`installed plugin database schema is ${version}, expected 3`)

  await command(['dsh', 'plugin', '--profile', 'web', 'remove', pluginPackageName], dshRoot)
  const uninstalledProfile = JSON.parse(await readFile(profileManifestPath, 'utf8'))
  const uninstalledBundles = uninstalledProfile.dsh?.profile?.bundles
  if (uninstalledProfile.dependencies?.[pluginPackageName] !== undefined) {
    throw new Error(`dsh plugin remove retained ${pluginPackageName} in profile dependencies`)
  }
  if (Array.isArray(uninstalledBundles) && uninstalledBundles.includes(pluginPackageName)) {
    throw new Error(`dsh plugin remove retained ${pluginPackageName} in the profile bundle stack`)
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    installMode: 'dsh_plugin_tarball_bundle',
    packageName: pluginPackageName,
    profile: 'web',
    roleModules: ['definition', 'policy', 'provider', 'tools'],
    libraryModules: ['evaluation-driver'],
    cordisFibers: ['policy', 'provider', 'tools'],
    privateRuntimeDependencies: 0,
    consumerToolsEnabled: true,
    hubAccessByDefault: false,
    publicPublishingByDefault: false,
    httpStatus: 200,
    htmlBytes,
    sqliteSchemaVersion: version,
    gracefulExitCode: 0,
    uninstallVerified: true,
  }, undefined, 2)}\n`)
} finally {
  if (host !== undefined && hostExit !== undefined && !hostStopped) {
    try {
      await stop(host, hostExit)
    } catch {
      // The primary failure above carries the actionable process output.
    }
  }
  if (process.env.AEN_KEEP_DSH_SMOKE !== '1') {
    await rm(temporaryRoot, { recursive: true, force: true })
  } else {
    process.stderr.write(`AEN_KEEP_DSH_SMOKE=1 kept ${temporaryRoot}\n`)
  }
}
