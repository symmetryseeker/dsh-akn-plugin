import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekHarnessAdapter } from '@aen/adapter-dsh'
import { LocalEvidenceStore } from '@aen/local-store'
import type { ExperienceCard, JsonRecord } from '@aen/protocol'
import { distillEpisode } from '@aen/workbench'
import { registerDshAenConsumerTools } from '../src/consumer.js'
import type { DshPluginContext } from '../src/types.js'

interface RegisteredTool {
  name: string
  parameters?: Record<string, unknown>
  execute(
    args: Record<string, unknown>,
    exec: { agent?: { id: string }; signal: AbortSignal },
  ): Promise<{ text: string }>
}

function execution(agentId?: string): { agent?: { id: string }; signal: AbortSignal } {
  return {
    ...(agentId === undefined ? {} : { agent: { id: agentId } }),
    signal: new AbortController().signal,
  }
}

const directories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const digest = `sha256:${'1'.repeat(64)}` as const
const card: ExperienceCard = {
  experienceId: 'urn:aen:experience:test', revision: 2, digest,
  title: 'Recover a failed tool call', summary: 'Observed recovery.',
  intendedUseSummary: ['reviewed recovery'], outOfScopeSummary: ['automatic retry'],
  knownFailureSummary: ['unchanged retry'], taskFamilies: ['failure-recovery'],
  compatibility: 'exact', maxEvidenceLevel: 'H1', positiveCaseSummary: 'passed',
  negativeCaseSummary: 'failed', safetyLabels: ['no-automatic-execution'],
  sourceSummary: 'signed', availableSections: ['card', 'recipe', 'cases', 'evidence'],
  scoreExplanation: ['exact'],
}

describe('native DeepSeek Harness consumer surface', () => {
  it('registers only search/feedback, blocks private query data, and keeps feedback local', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aen-dsh-consumer-'))
    directories.push(directory)
    const store = new LocalEvidenceStore(join(directory, 'evidence.sqlite'))
    const registered: RegisteredTool[] = []
    const ctx = {
      tools: { register: (tool: unknown) => { registered.push(tool as typeof registered[number]) } },
      logger: { warn: vi.fn() },
    } as unknown as DshPluginContext
    const harnessConfigurationDigest = `sha256:${'2'.repeat(64)}` as const
    const harnessManifestDigest = `sha256:${'3'.repeat(64)}` as const
    registerDshAenConsumerTools(ctx, {
      hubUrl: 'https://hub.example',
      store,
      resolveContext: async (agent) => agent.id === 'agent-1'
        ? {
            model: {
              provider: 'deepseek', modelId: 'deepseek-reasoner',
              observedAt: '2026-08-20T00:00:00.000Z', mutability: 'unknown',
            },
            harnessConfigurationDigest,
            harnessManifestDigest,
            environment: {
              os: { family: 'darwin', arch: 'arm64' },
              capturedAt: '2026-08-20T00:00:00.000Z', disclosure: 'metadata',
            },
          }
        : undefined,
    })
    expect(registered.map((tool) => tool.name)).toEqual(['experience_search', 'experience_feedback'])
    expect(registered.map((tool) => tool.name)).not.toContain('experience_execute')
    expect(registered.map((tool) => tool.name)).not.toContain('experience_fetch')
    expect(registered[0]?.parameters).not.toHaveProperty('model_provider')
    expect(registered[0]?.parameters).not.toHaveProperty('model_id')
    expect(registered[0]?.parameters).not.toHaveProperty('harness_configuration_digest')
    expect(registered[0]?.parameters).not.toHaveProperty('harness_manifest_digest')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ cards: [card] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const search = registered[0]
    expect(search).toBeDefined()
    if (search === undefined) return
    const result = await search.execute({
      abstract_intent: 'Recover a failed operation.',
      taxonomy: ['failure-recovery'],
      risk_class: 'reversible_write',
      max_cards: 3,
    }, execution('agent-1'))
    expect(result.text).toContain('"untrusted":true')
    expect(result.text).toContain('"source":"authoritative_dsh_agent"')
    expect(result.text).toContain('aexp://experiences/')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestInit = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      context: {
        model: { provider: 'deepseek', modelId: 'deepseek-reasoner' },
        harnessConfigurationDigest,
        harnessManifestDigest,
        environment: { os: { family: 'darwin', arch: 'arm64' } },
      },
    })
    await expect(search.execute({
      abstract_intent: 'Read /Users/alice/private-project/secret.ts',
      taxonomy: ['failure-recovery'],
      risk_class: 'read_only',
    }, execution('agent-1'))).rejects.toThrow('macos-absolute-user-path')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await expect(search.execute({
      abstract_intent: 'Recover a failed operation.',
      taxonomy: ['failure-recovery'],
      risk_class: 'reversible_write',
    }, execution())).rejects.toThrow('authoritative DSH Agent execution context')

    const feedback = registered[1]
    expect(feedback).toBeDefined()
    if (feedback === undefined) return
    const saved = await feedback.execute({
      experience_id: card.experienceId,
      revision: card.revision,
      digest: card.digest,
      decision: 'rejected',
      outcome: 'harmful',
      reason_codes: ['negative-transfer'],
    }, execution('agent-1'))
    expect(saved.text).toContain('"changesEvidenceLevel":false')
    expect(store.listObjects('feedback')).toHaveLength(1)
    store.close()
  })

  it('works with no Hub and does not attempt network access', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aen-dsh-local-consumer-'))
    directories.push(directory)
    const store = new LocalEvidenceStore(join(directory, 'evidence.sqlite'))
    const imported = await new DeepSeekHarnessAdapter().importEvidence({
      mediaType: 'application/x-ndjson',
      sourceName: 'failure-recovery-skills.session.jsonl',
      schemaNamespace: 'https://github.com/deepseek-ai/DeepSeek-Harness/session-log',
      schemaVersion: '0',
      exporterVersion: '0.1.0-rc.7',
      localPath: fileURLToPath(new URL('../../../fixtures/dsh/failure-recovery-skills.session.jsonl', import.meta.url)),
    })
    store.putBatch({
      objects: [
        { object: imported.manifest as unknown as JsonRecord },
        ...imported.artifacts.map((object) => ({ object: object as unknown as JsonRecord })),
        ...imported.episodes.flatMap((chain) => [
          { object: chain.gapReport as unknown as JsonRecord },
          { object: chain.episode as unknown as JsonRecord },
          { object: chain.traceEvidence as unknown as JsonRecord },
          { object: chain.observation as unknown as JsonRecord },
        ]),
      ],
    })
    const chain = imported.episodes[0]
    expect(chain).toBeDefined()
    if (chain === undefined) return
    const localExperience = distillEpisode(store, chain.episode.episodeId).experience
    const registered: RegisteredTool[] = []
    const ctx = {
      tools: { register: (tool: unknown) => { registered.push(tool as typeof registered[number]) } },
      logger: { warn: vi.fn() },
    } as unknown as DshPluginContext
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    registerDshAenConsumerTools(ctx, {
      store,
      resolveContext: async () => ({
        model: chain.observation.configurationCell.model,
        harnessConfigurationDigest: chain.observation.configurationCell.harnessConfigurationDigest,
        harnessManifestDigest: chain.observation.configurationCell.harnessManifestDigest,
        environment: chain.observation.configurationCell.environment,
      }),
    })
    const search = registered[0]
    expect(search).toBeDefined()
    if (search === undefined) return
    const result = await search.execute({
      abstract_intent: 'Recover a failed operation.',
      taxonomy: ['failure-recovery'],
      risk_class: 'reversible_write',
    }, execution('local-agent'))
    expect(result.text).toContain('"source":"local"')
    expect(result.text).toContain(localExperience.digest)
    expect(result.text).toContain('"compatibility":"exact"')
    expect(fetchMock).not.toHaveBeenCalled()
    store.close()
  })
})
