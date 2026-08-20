import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

process.env.AEN_DSH_PACKAGE_ROOT = repositoryRoot
process.env.AEN_DSH_PACKAGE_NAME = 'dsh-akn-plugin'

await import('./dsh-plugin-host-smoke.mjs')
