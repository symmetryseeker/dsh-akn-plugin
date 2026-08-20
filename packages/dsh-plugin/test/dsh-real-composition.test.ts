import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalEvidenceStore } from '@aen/local-store'
import { LocalStoreExperienceSource } from '@aen/client'
import { validateProtocolObject } from '@aen/protocol'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { AgentRegistry, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as aenPlugin from '../src/index.js'
import * as policyPlugin from '../src/policy-plugin.js'
import * as providerPlugin from '../src/provider-plugin.js'
import * as toolPlugin from '../src/tool-plugin.js'

const directories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('DeepSeek Harness 0.1.0-rc.7 service composition', () => {
  it('captures a protocol-valid live Manifest from the real DSH registries', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aen-dsh-real-'))
    directories.push(directory)
    const storePath = join(directory, 'evidence.sqlite')
    const skillDirectory = join(directory, 'documents')
    mkdirSync(join(skillDirectory, 'references'), { recursive: true })
    writeFileSync(join(skillDirectory, 'SKILL.md'), '# Documents\n\nUse the document workflow.\n')
    writeFileSync(join(skillDirectory, 'references', 'format.md'), 'Verify the rendered result.\n')
    const context = new Context()
    const sessionFiber = await context.plugin(SessionStore)
    const agentFiber = await context.plugin(AgentRegistry)
    const skillFiber = await context.plugin(SkillRegistry)

    const session = context.sessions.create(SessionId('aen-real-composition'), {
      meta: { cwd: directory },
    })
    const agent = {
      id: session.id,
      options: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 4096 },
      session,
      inbox: {},
      status: 'idle',
      ctx: context,
      cancel: () => undefined,
      whenIdle: async () => undefined,
      runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> =>
        task(new AbortController().signal),
      send: () => undefined,
      followup: () => undefined,
      steer: () => undefined,
      inject: () => undefined,
    } as unknown as Agent
    const unregisterAgent = context.agents.register(agent)
    const unregisterSkill = context.skills.register({
      name: 'documents',
      description: 'Work with documents',
      source: 'runtime',
      path: join(skillDirectory, 'SKILL.md'),
      resourceBase: { kind: 'directory', path: skillDirectory },
      content: 'Use the document workflow and verify the rendered result.',
      metadata: { license: 'MIT', redistributable: true },
    })

    const pluginFiber = await context.plugin(aenPlugin as never, {
      storePath,
      harnessVersion: '0.1.0-rc.7',
      captureSkillResources: true,
      snapshotDelayMs: 0,
    })
    session.append('request/context', {
      provider: 'deepseek',
      model: 'deepseek-chat',
      contextWindow: 64_000,
    })
    session.append('request/header', {
      header: {
        config: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 4096 },
        system: 'You are a coding agent.',
        tools: [{
          name: 'bash',
          description: 'Run a command',
          parameters: { type: 'object', properties: {} },
        }],
      },
      reason: 'initial',
    })
    // Deterministically wait for the async live-Manifest capture to land in the
    // evidence store instead of a fixed 50ms sleep. Snapshot capture reads the
    // skill/agent registries and can exceed 50ms on slower CI runners, which
    // made the fixed wait flaky (empty manifest list).
    const store = new LocalEvidenceStore(storePath)
    const deadline = Date.now() + 5_000
    while (store.listObjects('harness_manifest').length === 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
    }
    await pluginFiber.dispose()

    const manifests = store.listObjects('harness_manifest')
    expect(manifests).toHaveLength(1)
    const manifest = manifests[0] === undefined ? undefined : store.getByDigest(manifests[0].digest)
    expect(validateProtocolObject(manifest)).toMatchObject({ ok: true, issues: [] })
    expect(manifest?.coverage).toMatchObject({ mode: 'live_snapshot', skills: 'complete' })
    expect(store.listObjects('artifact').some((summary) => {
      const object = store.getByDigest(summary.digest)
      return object?.kind === 'skill' && object.snapshotCompleteness === 'complete_package' &&
        object.treeDigest !== undefined && Array.isArray(object.resources) && object.resources.length === 1
    })).toBe(true)
    store.close()

    unregisterSkill()
    unregisterAgent()
    await skillFiber.dispose()
    await agentFiber.dispose()
    await sessionFiber.dispose()
  })

  it('executes search through the official ToolRuntime with authoritative Agent context', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aen-dsh-tool-runtime-'))
    directories.push(directory)
    const storePath = join(directory, 'evidence.sqlite')
    const context = new Context()
    const sessionFiber = await context.plugin(SessionStore)
    const agentFiber = await context.plugin(AgentRegistry)
    const skillFiber = await context.plugin(SkillRegistry)
    const systemPromptFiber = await context.plugin(SystemPrompt, {})
    const toolRuntimeFiber = await context.plugin(ToolRuntime, { mode: 'native' })

    const session = context.sessions.create(SessionId('aen-real-tool-runtime'), {
      meta: { cwd: directory },
    })
    const agent = {
      id: session.id,
      options: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 4096 },
      session,
      inbox: {},
      status: 'idle',
      ctx: context,
      cancel: () => undefined,
      whenIdle: async () => undefined,
      runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> =>
        task(new AbortController().signal),
      send: () => undefined,
      followup: () => undefined,
      steer: () => undefined,
      inject: () => undefined,
    } as unknown as Agent
    const unregisterAgent = context.agents.register(agent)

    const policyFiber = await context.plugin(policyPlugin as never, {
      allowHubSearch: true,
      captureSkillContent: true,
      captureSkillResources: false,
    })
    const providerFiber = await context.plugin(providerPlugin as never, {
      storePath,
      harnessVersion: '0.1.0-rc.7',
      snapshotDelayMs: 0,
    })
    const aenToolsFiber = await context.plugin(toolPlugin as never, {
      hubUrl: 'https://hub.example.test',
    })

    const searchSchema = context.tools.schemas(agent)
      .find((schema) => schema.name === 'experience_search')
    expect(searchSchema).toBeDefined()
    const searchProperties = (searchSchema?.parameters as {
      properties?: Record<string, unknown>
    } | undefined)?.properties ?? {}
    expect(Object.keys(searchProperties).sort()).toEqual([
      'abstract_intent', 'max_cards', 'risk_class', 'taxonomy',
    ])

    session.append('request/context', {
      provider: 'deepseek',
      model: 'deepseek-chat',
      contextWindow: 64_000,
    })
    session.append('request/header', {
      header: {
        config: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 4096 },
        system: 'You are a coding agent.',
        tools: context.tools.schemas(agent),
      },
      reason: 'initial',
    })

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ cards: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const result = await context.tools.execute({
      callId: CallId('aen-search-with-agent'),
      name: 'experience_search',
      arguments: {
        abstract_intent: 'Recover a failed operation.',
        taxonomy: ['failure-recovery'],
        risk_class: 'reversible_write',
        max_cards: 3,
      },
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(JSON.stringify(result.error))
    expect(result.value).toMatchObject({ text: expect.stringContaining('authoritative_dsh_agent') })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      context?: {
        model?: { provider?: string; modelId?: string }
        harnessConfigurationDigest?: string
        harnessManifestDigest?: string
        environment?: { disclosure?: string }
      }
    }
    expect(request.context).toMatchObject({
      model: { provider: 'deepseek', modelId: 'deepseek-chat' },
      environment: { disclosure: 'metadata' },
    })
    expect(request.context?.harnessConfigurationDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(request.context?.harnessManifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/)

    const localSearch = vi.spyOn(LocalStoreExperienceSource.prototype, 'search')
    fetchMock.mockImplementationOnce((_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) {
        reject(new Error('expected Hub fetch to receive the DSH cancellation signal'))
        return
      }
      const rejectAborted = () => reject(signal.reason)
      if (signal.aborted) rejectAborted()
      else signal.addEventListener('abort', rejectAborted, { once: true })
    }))
    const cancellation = new AbortController()
    const cancelledSearch = context.tools.execute({
      callId: CallId('aen-search-cancelled'),
      name: 'experience_search',
      arguments: {
        abstract_intent: 'Recover a failed operation.',
        taxonomy: ['failure-recovery'],
        risk_class: 'reversible_write',
      },
      agent,
      signal: cancellation.signal,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    cancellation.abort(new Error('cancel AEN search'))
    const cancelled = await cancelledSearch
    expect(cancelled.isError).toBe(true)
    expect(localSearch).not.toHaveBeenCalled()

    const agentless = await context.tools.execute({
      callId: CallId('aen-search-without-agent'),
      name: 'experience_search',
      arguments: {
        abstract_intent: 'Recover a failed operation.',
        taxonomy: ['failure-recovery'],
        risk_class: 'reversible_write',
      },
      signal: new AbortController().signal,
    })
    expect(agentless.isError).toBe(true)
    expect(JSON.stringify(agentless.content)).toContain('authoritative DSH Agent execution context')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await aenToolsFiber.dispose()
    await providerFiber.dispose()
    await policyFiber.dispose()
    const store = new LocalEvidenceStore(storePath)
    const manifests = store.listObjects('harness_manifest')
    expect(manifests).toHaveLength(1)
    expect(request.context?.harnessManifestDigest).toBe(manifests[0]?.digest)
    const manifest = manifests[0] === undefined ? undefined : store.getByDigest(manifests[0].digest)
    expect(request.context?.harnessConfigurationDigest).toBe(manifest?.configurationDigest)
    store.close()

    unregisterAgent()
    await toolRuntimeFiber.dispose()
    await systemPromptFiber.dispose()
    await skillFiber.dispose()
    await agentFiber.dispose()
    await sessionFiber.dispose()
  })
})
