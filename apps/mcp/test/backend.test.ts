import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFeedbackEvent } from '@aen/client'
import { LocalEvidenceStore } from '@aen/local-store'
import { createLocalFallbackBackend } from '../src/backend.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('MCP local fallback backend', () => {
  it('searches and records feedback locally when Hub is absent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aen-mcp-local-'))
    directories.push(directory)
    const store = new LocalEvidenceStore(join(directory, 'evidence.sqlite'))
    const backend = createLocalFallbackBackend(store)
    await expect(backend.search({ query: 'offline', policy: { visibility: ['public'] } })).resolves.toEqual([])
    const event = createFeedbackEvent({
      experienceRef: {
        experienceId: 'urn:aen:experience:offline',
        revision: 1,
        digest: `sha256:${'1'.repeat(64)}`,
      },
      decision: 'viewed',
      sharingScope: 'local',
      now: '2026-08-20T00:00:00Z',
    })
    await backend.feedback(event)
    expect(store.listObjects('feedback')).toHaveLength(1)
    store.close()
  })

  it('logs a Hub failure and falls back without a second network dependency', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aen-mcp-fallback-'))
    directories.push(directory)
    const store = new LocalEvidenceStore(join(directory, 'evidence.sqlite'))
    const warn = vi.fn()
    const remote = {
      search: vi.fn().mockRejectedValue(new Error('connection refused')),
      read: vi.fn(),
      resolveRevision: vi.fn(),
      readObject: vi.fn(),
    }
    const backend = createLocalFallbackBackend(store, { remote, warn })
    await expect(backend.search({ query: 'offline' })).resolves.toEqual([])
    expect(remote.search).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('using exact local store fallback'))
    store.close()
  })
})
