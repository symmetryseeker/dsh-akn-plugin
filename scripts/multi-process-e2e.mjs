import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'apps/cli/dist/main.js')
const hub = resolve(process.env.AEN_HUB_ENTRY ?? join(root, 'apps/hub/dist/main.js'))
const fixture = join(root, 'fixtures/dsh/failure-recovery-skills.session.jsonl')
const temporary = await mkdtemp(join(tmpdir(), 'aen-multiprocess-e2e-'))
const keep = process.env.AEN_E2E_KEEP === '1'
let postgresRunning = false
let postgresPid
let hubProcess
let hubLog = ''

function cleanEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra }
  for (const name of ['ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'all_proxy', 'https_proxy', 'http_proxy']) {
    delete environment[name]
  }
  return environment
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    env: cleanEnvironment(options.env),
    timeout: options.timeoutMs ?? 60_000,
  })
  if (result.status !== 0) {
    throw new Error([
      `command failed (${result.status ?? 'signal'}): ${executable} ${args.join(' ')}`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
  return result.stdout.trim()
}

function runJson(executable, args, options) {
  const output = run(executable, args, options)
  try {
    return JSON.parse(output)
  } catch {
    throw new Error(`command did not return JSON: ${executable} ${args.join(' ')}\n${output}`)
  }
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('failed to allocate a loopback port'))
        return
      }
      server.close((error) => error === undefined ? resolvePort(address.port) : reject(error))
    })
  })
}

async function waitForHealth(origin, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) return await response.json()
      lastError = new Error(`health returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Hub did not become healthy: ${lastError instanceof Error ? lastError.message : String(lastError)}\n${hubLog}`)
}

function postgresBin() {
  if (process.env.AEN_POSTGRES_BIN !== undefined) return resolve(process.env.AEN_POSTGRES_BIN)
  if (process.platform === 'darwin') return '/opt/homebrew/opt/postgresql@17/bin'
  const detected = spawnSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf8' }).stdout.trim()
  if (detected.length === 0) throw new Error('PostgreSQL 17 initdb was not found; set AEN_POSTGRES_BIN')
  return dirname(detected)
}

try {
  await Promise.all([access(cli), access(hub), access(fixture)])
  const state = join(temporary, 'state')
  const store = join(temporary, 'evidence.sqlite')
  const contributions = join(temporary, 'contributions')
  const contribution = join(contributions, 'publisher', 'failure-recovery')
  const actorId = 'urn:aen:actor:multiprocess-e2e'
  await mkdir(contributions, { recursive: true })

  const initialized = runJson(process.execPath, [cli, 'init', '--directory', state, '--actor', actorId, '--display-name', 'AEN multi-process E2E'])
  const imported = runJson(process.execPath, [cli, 'import', 'dsh', fixture, '--store', store, '--exporter-version', 'e2e-fixture'])
  if (imported.episodeCount < 1) throw new Error('fixture import produced no TaskEpisode')
  const episodes = runJson(process.execPath, [cli, 'episode', 'list', '--store', store]).episodes
  if (!Array.isArray(episodes) || episodes.length === 0) throw new Error('episode list is empty after import')
  const episodeId = episodes[0].episodeId
  const distilled = runJson(process.execPath, [cli, 'distill', episodeId, '--store', store, '--publisher', actorId])
  const experienceId = distilled.experience.experienceId
  runJson(process.execPath, [
    cli, 'review', experienceId, '--store', store, '--decision', 'request-public',
    '--reviewer', actorId, '--note', 'isolated multi-process acceptance test',
  ])
  const promoted = runJson(process.execPath, [
    cli, 'promote', experienceId, '--public', '--out', contribution,
    '--consent', 'urn:aen:consent:multiprocess-e2e', '--store', store,
    '--config', initialized.config,
  ])

  const publisher = JSON.parse(await readFile(initialized.config, 'utf8'))
  const registry = join(state, 'authorized-keys.json')
  await writeFile(registry, `${JSON.stringify({
    profile: 'aen-authorized-publisher-keys-v0.1',
    keys: [{
      keyid: publisher.key.keyid,
      actorId,
      publicKeyPath: publisher.key.publicKeyPath,
    }],
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o644, flag: 'wx' })

  const verified = runJson(process.execPath, [hub, 'verify', '--git-root', contributions, '--keys', registry])
  if (verified.contributions !== 1) throw new Error(`expected one verified contribution, got ${verified.contributions}`)

  const pgBin = postgresBin()
  const pgData = join(temporary, 'postgres')
  const pgPort = await freePort()
  let hubPort = await freePort()
  while (hubPort === pgPort) hubPort = await freePort()
  run(join(pgBin, 'initdb'), ['-D', pgData, '--auth=trust', '--no-locale', '--encoding=UTF8'])
  run(join(pgBin, 'pg_ctl'), [
    '-D', pgData,
    '-l', join(temporary, 'postgres.log'),
    '-o', `-h 127.0.0.1 -p ${pgPort}`,
    '-w', 'start',
  ])
  postgresRunning = true
  postgresPid = Number((await readFile(join(pgData, 'postmaster.pid'), 'utf8')).split('\n')[0])
  if (!Number.isSafeInteger(postgresPid) || postgresPid < 1) throw new Error('PostgreSQL postmaster PID is invalid')
  const databaseUrl = `postgresql://127.0.0.1:${pgPort}/postgres`
  const origin = `http://127.0.0.1:${hubPort}`

  const hubArguments = [
    hub, 'serve', '--database-url', databaseUrl, '--host', '127.0.0.1', '--port', String(hubPort),
    ...(process.env.AEN_HUB_CONFIG_FROM_ENV === '1'
      ? []
      : ['--git-root', contributions, '--keys', registry]),
  ]
  const hubEnvironment = process.env.AEN_HUB_CONFIG_FROM_ENV === '1'
    ? { AEN_GIT_ROOT: contributions, AEN_AUTHORIZED_KEYS: registry }
    : {}
  hubProcess = spawn(process.execPath, hubArguments, {
    cwd: root,
    env: cleanEnvironment(hubEnvironment),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  hubProcess.stdout.on('data', (chunk) => { hubLog += chunk.toString() })
  hubProcess.stderr.on('data', (chunk) => { hubLog += chunk.toString() })

  const health = await waitForHealth(origin)
  if (health.projection.experiences !== 1) throw new Error(`Hub projected ${health.projection.experiences} Experiences instead of one`)

  const targetPath = readdir(join(contribution, 'objects'))
    .then((names) => names.find((name) => name.startsWith('experience_revision--')))
  const targetName = await targetPath
  if (targetName === undefined) throw new Error('promoted contribution has no ExperienceRevision object')
  const target = JSON.parse(await readFile(join(contribution, 'objects', targetName), 'utf8'))
  const taskFamily = target.applicability.taskFamilies[0]
  const search = runJson(process.execPath, [
    cli, 'search', target.title, '--public', '--hub', origin,
    '--taxonomy', taskFamily, '--limit', '3', '--store', store,
  ])
  const cards = Array.isArray(search.results)
    ? search.results.flatMap((result) => Array.isArray(result.cards) ? result.cards : [])
    : []
  if (!cards.some((card) => card.digest === target.digest)) {
    throw new Error(`CLI/Hub search did not return the immutable target ${target.digest}`)
  }

  const canonicalUrl = `${origin}/v1/experiences/${encodeURIComponent(target.experienceId)}/revisions/${target.revision}?digest=${encodeURIComponent(target.digest)}`
  const canonicalResponse = await fetch(canonicalUrl, { signal: AbortSignal.timeout(2_000) })
  if (!canonicalResponse.ok) throw new Error(`canonical read returned HTTP ${canonicalResponse.status}`)
  const canonical = await canonicalResponse.json()
  if (canonical.digest !== target.digest) throw new Error('canonical read returned a different digest')

  const webResponse = await fetch(origin, { signal: AbortSignal.timeout(2_000) })
  const web = await webResponse.text()
  if (!webResponse.ok || !web.includes('Agent Experience Network')) throw new Error('Hub Web surface is unavailable')

  const deleted = runJson(process.execPath, [
    cli, 'delete-local', distilled.experience.digest,
    '--store', store,
    '--confirm-digest', distilled.experience.digest,
    '--reason', 'multiprocess_acceptance_cleanup',
  ])
  const deletedRead = spawnSync(process.execPath, [cli, 'inspect', distilled.experience.digest, '--store', store], {
    cwd: root,
    encoding: 'utf8',
    env: cleanEnvironment(),
    timeout: 10_000,
  })
  if (deletedRead.status !== 1 || !deletedRead.stderr.includes('"found": false')) {
    throw new Error(`deleted local body remained readable\n${deletedRead.stdout}\n${deletedRead.stderr}`)
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    temporaryDirectory: keep ? temporary : undefined,
    import: { sessionDigest: imported.sessionDigest, episodeCount: imported.episodeCount },
    promotion: {
      experienceId: target.experienceId,
      revision: target.revision,
      digest: target.digest,
      objectCount: promoted.contribution.objectCount,
      verifiedKeyIds: verified.verifiedKeyIds,
    },
    hub: { origin, projection: health.projection },
    client: { searchResults: cards.length, exactDigestRead: true, webAvailable: true },
    localDeletion: { deleted: deleted.deleted === true, bodyUnreadable: true },
  }, null, 2)}\n`)
} finally {
  if (hubProcess !== undefined && hubProcess.exitCode === null) {
    hubProcess.kill('SIGTERM')
    const exited = await Promise.race([
      new Promise((resolveExit) => hubProcess.once('exit', () => resolveExit(true))),
      new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(false), 3_000)),
    ])
    if (!exited && hubProcess.exitCode === null) hubProcess.kill('SIGKILL')
  }
  if (postgresRunning && postgresPid !== undefined) {
    try {
      process.kill(postgresPid, 'SIGTERM')
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        try {
          process.kill(postgresPid, 0)
          await new Promise((resolveWait) => setTimeout(resolveWait, 100))
        } catch {
          postgresRunning = false
          break
        }
      }
      if (postgresRunning) process.kill(postgresPid, 'SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
  if (!keep) await rm(temporary, { recursive: true, force: true })
}
