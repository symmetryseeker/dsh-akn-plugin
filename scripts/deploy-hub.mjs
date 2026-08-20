import { spawnSync } from 'node:child_process'
import { copyFile, lstat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requested = process.argv[2]
if (requested === undefined || requested.trim().length === 0) {
  throw new Error('usage: pnpm deploy:hub -- /absolute/output/directory')
}
const target = resolve(requested)
try {
  await lstat(target)
  throw new Error(`deployment target already exists: ${target}`)
} catch (error) {
  if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error
}

const result = spawnSync('pnpm', ['--filter', '@aen/hub-app', '--prod', 'deploy', target], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  stdio: 'inherit',
})
if (result.status !== 0) {
  throw new Error(`pnpm deploy failed with ${result.status ?? 'a signal'}`)
}
await copyFile(join(repositoryRoot, 'LICENSE'), join(target, 'LICENSE'))
process.stdout.write(`${JSON.stringify({ deployed: true, target, license: 'Apache-2.0' })}\n`)
