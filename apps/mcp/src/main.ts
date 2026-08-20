#!/usr/bin/env node

import { Command } from 'commander'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { LocalEvidenceStore } from '@aen/local-store'
import { createLocalFallbackBackend } from './backend.js'
import { createAenMcpServer } from './server.js'

const program = new Command()
  .name('aen-mcp')
  .description('AEN MCP server with exactly two tools and immutable resource reads')
  .option('--hub <url>', 'optional AEN Reference Hub; local store remains usable without it')
  .option('--store <path>', 'local feedback and injection evidence store', '.aen/evidence.sqlite')

program.action(async (options: { hub?: string; store: string }) => {
  const local = new LocalEvidenceStore(options.store)
  const backend = createLocalFallbackBackend(local, {
    ...(options.hub === undefined ? {} : { hubUrl: options.hub }),
    warn: (message) => process.stderr.write(`${message}\n`),
  })
  process.once('exit', () => local.close())
  const server = createAenMcpServer(backend)
  await server.connect(new StdioServerTransport())
})

await program.parseAsync(process.argv)
