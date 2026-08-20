import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

function postgresBin() {
  if (process.env.AEN_POSTGRES_BIN !== undefined) return resolve(process.env.AEN_POSTGRES_BIN)
  if (process.platform === 'darwin') return '/opt/homebrew/opt/postgresql@17/bin'
  const detected = spawnSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf8' }).stdout.trim()
  if (detected.length === 0) throw new Error('PostgreSQL initdb was not found; set AEN_POSTGRES_BIN')
  return dirname(detected)
}

function cleanEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra }
  for (const name of ['ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'all_proxy', 'https_proxy', 'http_proxy']) {
    delete environment[name]
  }
  return environment
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
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

const prefix = join(tmpdir(), 'aen-real-postgres-')
const temporary = await mkdtemp(prefix)
if (!temporary.startsWith(prefix)) throw new Error(`unsafe temporary directory: ${temporary}`)
const pgBin = postgresBin()
const data = join(temporary, 'data')
let running = false

try {
  await Promise.all([access(join(pgBin, 'initdb')), access(join(pgBin, 'pg_ctl'))])
  const port = await freePort()
  run(join(pgBin, 'initdb'), ['-D', data, '--auth=trust', '--no-locale', '--encoding=UTF8'])
  run(join(pgBin, 'pg_ctl'), [
    '-D', data,
    '-l', join(temporary, 'postgres.log'),
    '-o', `-h 127.0.0.1 -p ${port}`,
    '-w', 'start',
  ])
  running = true
  run('pnpm', ['--filter', '@aen/hub', 'test'], {
    inherit: true,
    timeoutMs: 120_000,
    env: { AEN_TEST_DATABASE_URL: `postgresql://127.0.0.1:${port}/postgres` },
  })
} finally {
  if (running) {
    run(join(pgBin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
  await rm(temporary, { recursive: true, force: true })
}
