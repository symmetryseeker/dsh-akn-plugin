import { spawnSync } from 'node:child_process'

const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(executable, ['licenses', 'list', '--prod', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
})
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const inventory = JSON.parse(result.stdout)
const allowed = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'])
const denied = Object.keys(inventory).filter((license) => !allowed.has(license))
if (denied.length > 0) {
  throw new Error(`production dependencies contain unreviewed license categories: ${denied.join(', ')}`)
}
process.stdout.write(`Production dependency license categories accepted: ${Object.keys(inventory).sort().join(', ')}\n`)
