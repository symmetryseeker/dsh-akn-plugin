#!/usr/bin/env node

import { Command } from 'commander'
import {
  loadAuthorizedPublisherKeys,
  loadGitContributions,
  PostgresHubProjection,
} from '@aen/hub'
import { createHubServer } from './server.js'

const program = new Command()
  .name('aen-hub')
  .description('AEN Reference Hub: Git ingress, PostgreSQL projection, and read-only Web/API')
  .version('0.0.1')

function databaseUrl(option?: string): string {
  const value = option ?? process.env.DATABASE_URL
  if (value === undefined || value.trim().length === 0) throw new Error('PostgreSQL URL is required via --database-url or DATABASE_URL')
  return value
}

program
  .command('migrate')
  .option('--database-url <url>', 'PostgreSQL connection URL')
  .action(async (options: { databaseUrl?: string }) => {
    const projection = new PostgresHubProjection({ connectionString: databaseUrl(options.databaseUrl) })
    try {
      await projection.migrate()
      process.stdout.write(`${JSON.stringify({ migrated: true })}\n`)
    } finally {
      await projection.close()
    }
  })

program
  .command('rebuild')
  .requiredOption('--git-root <path>', 'Git contribution repository root')
  .requiredOption('--keys <path>', 'authorized publisher key registry JSON')
  .option('--database-url <url>', 'PostgreSQL connection URL')
  .action(async (options: { gitRoot: string; keys: string; databaseUrl?: string }) => {
    const projection = new PostgresHubProjection({ connectionString: databaseUrl(options.databaseUrl) })
    try {
      const keys = await loadAuthorizedPublisherKeys(options.keys)
      const contributions = await loadGitContributions(options.gitRoot, keys)
      await projection.migrate()
      await projection.rebuild(contributions)
      process.stdout.write(`${JSON.stringify({ rebuilt: true, contributions: contributions.length, objects: contributions.reduce((sum, item) => sum + item.objects.length, 0) }, null, 2)}\n`)
    } finally {
      await projection.close()
    }
  })

program
  .command('verify')
  .requiredOption('--git-root <path>', 'Git contribution repository root')
  .requiredOption('--keys <path>', 'authorized publisher key registry JSON')
  .action(async (options: { gitRoot: string; keys: string }) => {
    const keys = await loadAuthorizedPublisherKeys(options.keys)
    const contributions = await loadGitContributions(options.gitRoot, keys)
    process.stdout.write(`${JSON.stringify({
      valid: true,
      contributions: contributions.length,
      objects: contributions.reduce((sum, item) => sum + item.objects.length, 0),
      verifiedKeyIds: [...new Set(contributions.flatMap((item) => item.verifiedKeyIds))],
    }, null, 2)}\n`)
  })

program
  .command('serve')
  .option('--database-url <url>', 'PostgreSQL connection URL')
  .option('--host <host>', 'listen host', '127.0.0.1')
  .option('--port <port>', 'listen port', '4173')
  .option('--admin-token <token>', 'emergency moderation bearer token')
  .option('--git-root <path>', 'optional Git contribution repository root to rebuild at startup')
  .option('--keys <path>', 'authorized publisher key registry, required with --git-root')
  .action(async (options: {
    databaseUrl?: string
    host: string
    port: string
    adminToken?: string
    gitRoot?: string
    keys?: string
  }) => {
    const gitRoot = options.gitRoot ?? process.env.AEN_GIT_ROOT
    const keysPath = options.keys ?? process.env.AEN_AUTHORIZED_KEYS
    if ((gitRoot === undefined) !== (keysPath === undefined)) {
      throw new Error('--git-root/AEN_GIT_ROOT and --keys/AEN_AUTHORIZED_KEYS must be configured together')
    }
    const port = Number(options.port)
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('--port is invalid')
    const projection = new PostgresHubProjection({ connectionString: databaseUrl(options.databaseUrl) })
    await projection.migrate()
    const authorizedKeys = keysPath === undefined ? [] : await loadAuthorizedPublisherKeys(keysPath)
    if (gitRoot !== undefined && keysPath !== undefined) {
      await projection.rebuild(await loadGitContributions(gitRoot, authorizedKeys))
    }
    const adminToken = options.adminToken ?? process.env.AEN_HUB_ADMIN_TOKEN
    const server = createHubServer(projection, {
      ...(adminToken === undefined ? {} : { adminToken }),
      authorizedKeys,
    })
    server.listen(port, options.host, () => {
      process.stdout.write(`AEN Reference Hub listening at http://${options.host}:${port}\n`)
    })
    const stop = () => server.close(() => { void projection.close().finally(() => process.exit(0)) })
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })

await program.parseAsync(process.argv)
