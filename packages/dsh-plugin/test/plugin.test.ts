import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { buildLiveManifest } from '@aen/adapter-dsh'
import { validateProtocolObject, type JsonValue } from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'
import * as plugin from '../src/index.js'
import * as policyPlugin from '../src/policy-plugin.js'
import * as providerPlugin from '../src/provider-plugin.js'
import * as toolPlugin from '../src/tool-plugin.js'
import { inject, name } from '../src/index.js'
import { DshAenPluginCoordinator } from '../src/coordinator.js'
import type { DshAenRuntime } from '../src/runtime.js'
import { captureDshLiveSnapshot } from '../src/snapshot.js'
import type {
  DshPluginAgent,
  DshPluginContext,
  DshPluginSessionEvent,
  DshSkillDefinitionLike,
  DshSkillSummaryLike,
} from '../src/types.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

class FakeContext implements DshPluginContext {
  readonly listeners = new Map<string, Set<(...args: any[]) => unknown>>()
  readonly warnings: string[] = []
  readonly infos: string[] = []
  readonly agentsById = new Map<string, DshPluginAgent>()
  skillSummaries: DshSkillSummaryLike[] = []
  skillDefinitions = new Map<string, DshSkillDefinitionLike>()
  skillSnapshotCalls = 0

  readonly agents = {
    list: (): DshPluginAgent[] => [...this.agentsById.values()],
    get: (id: string): DshPluginAgent | undefined => this.agentsById.get(id),
  }

  readonly skills = {
    snapshot: async (): Promise<{ skills: DshSkillSummaryLike[]; complete: boolean }> => {
      this.skillSnapshotCalls += 1
      return { skills: structuredClone(this.skillSummaries), complete: true }
    },
    get: async (name: string): Promise<DshSkillDefinitionLike | undefined> =>
      structuredClone(this.skillDefinitions.get(name)),
  }

  readonly logger = {
    warn: (message: string): void => { this.warnings.push(message) },
    info: (message: string): void => { this.infos.push(message) },
  }

  on(event: string, listener: (...args: any[]) => unknown): () => void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return () => { listeners.delete(listener) }
  }

  effect(register: () => void | (() => void | Promise<void>)): unknown {
    return register()
  }

  get(name: string): unknown {
    if (name !== 'agentPresets') return undefined
    return {
      composedPreset: () => 'coding',
      read: async () => '- name: coding-tools',
      resolve: async () => ({ trust: 'system' as const }),
    }
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

function event(type: string, seq: number, data: JsonValue): DshPluginSessionEvent {
  return { type, seq, time: 1787068800000 + seq, data }
}

function setup(): {
  ctx: FakeContext
  agent: DshPluginAgent
  coordinator: DshAenPluginCoordinator
  skillDirectory: string
} {
  const directory = mkdtempSync(join(tmpdir(), 'aen-dsh-plugin-'))
  directories.push(directory)
  const ctx = new FakeContext()
  const skillDirectory = join(directory, 'documents')
  mkdirSync(join(skillDirectory, 'scripts'), { recursive: true })
  writeFileSync(join(skillDirectory, 'SKILL.md'), '# Documents\n\nDocument instructions.\n')
  writeFileSync(join(skillDirectory, 'scripts', 'render.ts'), 'export const render = true\n')
  const events: DshPluginSessionEvent[] = [
    event('request/context', 0, {
      provider: 'deepseek',
      model: 'deepseek-chat',
      contextWindow: 64_000,
    }),
  ]
  const agent: DshPluginAgent = {
    id: 'session-live-1',
    session: {
      id: 'session-live-1',
      header: { cwd: '/private/workspace', agentPreset: 'coding' },
      events,
    },
    ctx: {},
  }
  ctx.agentsById.set(agent.id, agent)
  ctx.skillSummaries = [
    {
      name: 'documents',
      description: 'Work   with documents',
      provider: 'filesystem',
      source: 'project-dsh',
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: { kind: 'directory', path: skillDirectory },
    },
  ]
  ctx.skillDefinitions.set('documents', {
    ...ctx.skillSummaries[0] as DshSkillSummaryLike,
    path: join(skillDirectory, 'SKILL.md'),
    content: 'Document instructions\r\n',
    metadata: { license: 'MIT', redistributable: true },
  })
  const coordinator = new DshAenPluginCoordinator(ctx, {
    storePath: join(directory, 'evidence.sqlite'),
    harnessVersion: '0.1.0-rc.7',
    captureSkillResources: true,
    snapshotDelayMs: 0,
  })
  coordinator.start()
  return { ctx, agent, coordinator, skillDirectory }
}

function requestHeader(seq: number): DshPluginSessionEvent {
  return event('request/header', seq, {
    header: {
      config: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 4096 },
      system: 'You are a coding agent.',
      tools: [{ name: 'bash', description: 'Run a command' }],
    },
    reason: 'initial',
  })
}

describe('DeepSeek Harness Cordis plugin surface', () => {
  it('exports a named function-plugin namespace without a default plugin object', async () => {
    expect(name).toBe('aen')
    expect(inject).toEqual(['agents', 'skills'])
    expect('default' in await import('../src/index.js')).toBe(false)
  })

  it('captures at an effective request boundary, deduplicates unchanged config, and ignores tool-call hot paths', async () => {
    const { ctx, agent, coordinator } = setup()
    const header = requestHeader(1)
    ;(agent.session.events as DshPluginSessionEvent[]).push(header)
    ctx.emit('session/event', agent.session, header)
    await coordinator.waitForIdle()

    expect(coordinator.store.listObjects('harness_manifest')).toHaveLength(1)
    expect(ctx.skillSnapshotCalls).toBe(1)
    const manifestSummary = coordinator.store.listObjects('harness_manifest')[0]
    expect(manifestSummary).toBeDefined()
    if (manifestSummary === undefined) return
    const manifest = coordinator.store.getByDigest(manifestSummary.digest)
    expect(validateProtocolObject(manifest)).toMatchObject({ ok: true, issues: [] })
    expect(manifest?.coverage).toMatchObject({ mode: 'live_snapshot', skills: 'complete' })
    const skill = coordinator.store.listObjects('artifact')
      .map((summary) => coordinator.store.getByDigest(summary.digest))
      .find((object) => object?.kind === 'skill')
    expect(skill).toMatchObject({ snapshotCompleteness: 'complete_package', entrypoint: 'SKILL.md' })
    expect(skill?.treeDigest).toBeDefined()
    expect(skill?.resources).toHaveLength(1)

    const callsBeforeRepeatedHeader = ctx.skillSnapshotCalls
    const repeatedHeader = requestHeader(2)
    ;(agent.session.events as DshPluginSessionEvent[]).push(repeatedHeader)
    ctx.emit('session/event', agent.session, repeatedHeader)
    await coordinator.waitForIdle()
    expect(ctx.skillSnapshotCalls).toBe(callsBeforeRepeatedHeader)
    expect(coordinator.store.listObjects('harness_manifest')).toHaveLength(1)
    expect(await coordinator.resolveSearchContext(agent.id)).toBeDefined()
    expect(ctx.skillSnapshotCalls).toBe(callsBeforeRepeatedHeader)

    const callsBeforeTool = ctx.skillSnapshotCalls
    const toolCall = event('tool/call', 3, {
      turn: 1,
      step: 1,
      callId: 'call-1',
      name: 'bash',
      arguments: '{"command":"private"}',
    })
    ;(agent.session.events as DshPluginSessionEvent[]).push(toolCall)
    ctx.emit('session/event', agent.session, toolCall)
    await coordinator.waitForIdle()
    expect(ctx.skillSnapshotCalls).toBe(callsBeforeTool)
    expect(coordinator.store.listObjects('harness_manifest')).toHaveLength(1)

    ctx.emit('skills/change')
    await coordinator.waitForIdle()
    expect(ctx.skillSnapshotCalls).toBe(callsBeforeTool + 1)
    expect(coordinator.store.listObjects('harness_manifest')).toHaveLength(1)

    const definition = ctx.skillDefinitions.get('documents')
    expect(definition).toBeDefined()
    if (definition !== undefined) definition.content = 'Changed instructions'
    ctx.emit('skills/change')
    await coordinator.waitForIdle()
    expect(coordinator.store.listObjects('harness_manifest')).toHaveLength(2)
    expect(ctx.warnings).toEqual([])
    await coordinator.close()
  })

  it('keeps Harness configuration identity stable across run-local cwd and Model route changes', async () => {
    const ctx = new FakeContext()
    const makeAgent = (id: string, cwd: string): DshPluginAgent => ({
      id,
      session: { id, header: { cwd, agentPreset: 'coding' }, events: [] },
      ctx: {},
    })
    const makeHeader = (seq: number, cwd: string, provider: string, model: string): DshPluginSessionEvent =>
      event('request/header', seq, {
        header: {
          config: { provider, model, maxTokens: 4096 },
          system: `Workspace: ${cwd}\nProvider: ${provider}\nModel: ${model}\nFollow the same coding policy.`,
          tools: [{ name: 'bash', description: 'Run a command' }],
        },
      })
    const first = makeAgent('stable-config-a', '/private/workspace-a')
    const second = makeAgent('stable-config-b', '/private/workspace-b')
    const config = { harnessVersion: '0.1.0-rc.7', captureSkillContent: false, captureSkillResources: false }
    const firstSnapshot = await captureDshLiveSnapshot(
      ctx,
      first,
      makeHeader(1, '/private/workspace-a', 'deepseek', 'deepseek-chat'),
      config,
      new AbortController().signal,
    )
    const secondSnapshot = await captureDshLiveSnapshot(
      ctx,
      second,
      makeHeader(2, '/private/workspace-b', 'other-provider', 'other-model'),
      config,
      new AbortController().signal,
    )
    const firstManifest = buildLiveManifest(firstSnapshot).manifest
    const secondManifest = buildLiveManifest(secondSnapshot).manifest

    expect(firstManifest.configurationDigest).toBe(secondManifest.configurationDigest)
    expect(firstManifest.digest).not.toBe(secondManifest.digest)
    expect(firstManifest.modelSurface.systemPromptDigest).not.toBe(secondManifest.modelSurface.systemPromptDigest)
  })

  it('refreshes authoritative search context when the Model axis changes without changing Harness identity', async () => {
    const { ctx, agent, coordinator } = setup()
    const firstHeader = requestHeader(1)
    ;(agent.session.events as DshPluginSessionEvent[]).push(firstHeader)
    ctx.emit('session/event', agent.session, firstHeader)
    const firstContext = await coordinator.resolveSearchContext(agent.id)
    expect(firstContext?.model.modelId).toBe('deepseek-chat')

    const secondHeader = requestHeader(2)
    if (
      typeof secondHeader.data === 'object' && secondHeader.data !== null &&
      !Array.isArray(secondHeader.data) &&
      typeof secondHeader.data.header === 'object' && secondHeader.data.header !== null &&
      !Array.isArray(secondHeader.data.header) &&
      typeof secondHeader.data.header.config === 'object' && secondHeader.data.header.config !== null &&
      !Array.isArray(secondHeader.data.header.config)
    ) {
      secondHeader.data.header.config.model = 'deepseek-reasoner'
    }
    ;(agent.session.events as DshPluginSessionEvent[]).push(secondHeader)
    ctx.emit('session/event', agent.session, secondHeader)
    const secondContext = await coordinator.resolveSearchContext(agent.id)

    expect(secondContext?.model.modelId).toBe('deepseek-reasoner')
    expect(secondContext?.harnessConfigurationDigest).toBe(firstContext?.harnessConfigurationDigest)
    expect(secondContext?.harnessManifestDigest).not.toBe(firstContext?.harnessManifestDigest)
    expect(coordinator.store.listObjects('harness_manifest')).toHaveLength(2)
    await coordinator.close()
  })

  it('cancels one search waiter without cancelling the shared low-frequency snapshot', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aen-dsh-search-cancel-'))
    directories.push(directory)
    const ctx = new FakeContext()
    const agent: DshPluginAgent = {
      id: 'cancelled-search-agent',
      session: {
        id: 'cancelled-search-agent',
        header: { cwd: '/private/workspace', agentPreset: 'coding' },
        events: [],
      },
      ctx: {},
    }
    ctx.agentsById.set(agent.id, agent)
    const coordinator = new DshAenPluginCoordinator(ctx, {
      storePath: join(directory, 'evidence.sqlite'),
      harnessVersion: '0.1.0-rc.7',
      captureSkillContent: false,
      captureSkillResources: false,
      snapshotDelayMs: 20,
    })
    coordinator.start()
    const header = requestHeader(1)
    ;(agent.session.events as DshPluginSessionEvent[]).push(header)
    ctx.emit('session/event', agent.session, header)

    const cancellation = new AbortController()
    const resolving = coordinator.resolveSearchContext(agent.id, cancellation.signal)
    cancellation.abort(new Error('cancel one Experience search'))
    await expect(resolving).rejects.toThrow(/aborted/i)

    await coordinator.waitForIdle()
    expect(coordinator.store.listObjects('harness_manifest')).toHaveLength(1)
    expect(await coordinator.resolveSearchContext(agent.id)).toMatchObject({
      model: { provider: 'deepseek', modelId: 'deepseek-chat' },
    })
    await coordinator.close()
  })

  it('fails closed to a partial Skill snapshot when the package contains a symlink', async () => {
    if (process.platform === 'win32') return
    const { ctx, agent, coordinator, skillDirectory } = setup()
    symlinkSync(join(skillDirectory, 'SKILL.md'), join(skillDirectory, 'linked-skill.md'))
    const header = requestHeader(1)
    ;(agent.session.events as DshPluginSessionEvent[]).push(header)
    ctx.emit('session/event', agent.session, header)
    await coordinator.waitForIdle()
    const manifestSummary = coordinator.store.listObjects('harness_manifest')[0]
    expect(manifestSummary).toBeDefined()
    if (manifestSummary === undefined) return
    const manifest = coordinator.store.getByDigest(manifestSummary.digest)
    expect(manifest?.coverage).toMatchObject({ skills: 'catalog_only' })
    const skill = coordinator.store.listObjects('artifact')
      .map((summary) => coordinator.store.getByDigest(summary.digest))
      .find((object) => object?.kind === 'skill')
    expect(skill?.snapshotCompleteness).toBe('partial_snapshot')
    expect(skill?.treeDigest).toBeUndefined()
    expect(ctx.warnings.some((warning) => warning.includes('contains a symlink'))).toBe(true)
    await coordinator.close()
  })

  it('stops scheduling and writing after disposal', async () => {
    const { ctx, agent, coordinator } = setup()
    const header = requestHeader(1)
    ;(agent.session.events as DshPluginSessionEvent[]).push(header)
    ctx.emit('session/event', agent.session, header)
    await coordinator.waitForIdle()
    const before = ctx.skillSnapshotCalls
    await coordinator.close()
    ctx.emit('skills/change')
    expect(ctx.skillSnapshotCalls).toBe(before)
  })

  it('loads and disposes as a real Cordis function plugin', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aen-cordis-plugin-'))
    directories.push(directory)
    const storePath = join(directory, 'evidence.sqlite')
    const context = new Context()
    const header = requestHeader(1)
    const session = {
      id: 'cordis-session',
      header: {},
      events: [header],
    }
    const agent = { id: session.id, session, ctx: {} }
    const agents = {
      list: () => [agent],
      get: (id: string) => id === agent.id ? agent : undefined,
    }
    const skills = {
      snapshot: async () => ({ skills: [], complete: true }),
      get: async () => undefined,
    }
    const registeredTools: string[] = []
    const tools = {
      register(tool: unknown) {
        registeredTools.push(String((tool as { name?: unknown }).name))
        return () => undefined
      },
    }
    const services = await context.plugin({
      name: 'aen-test-services',
      apply(serviceContext) {
        serviceContext.provide('agents', agents)
        serviceContext.provide('skills', skills)
        serviceContext.provide('tools', tools)
      },
    })
    const fiber = await context.plugin(plugin as never, {
      storePath,
      harnessVersion: '0.1.0-rc.7',
      snapshotDelayMs: 0,
      enableConsumerTools: true,
    })
    expect(registeredTools).toEqual(['experience_search', 'experience_feedback'])
    context.emit('session/event' as never, session, header)
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    await fiber.dispose()
    const store = new LocalEvidenceStore(storePath)
    expect(store.listObjects('harness_manifest')).toHaveLength(1)
    store.close()
    await services.dispose()
  })

  it('composes policy, provider, and consumer tools as independent Cordis roles', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aen-cordis-roles-'))
    directories.push(directory)
    const storePath = join(directory, 'evidence.sqlite')
    const context = new Context()
    const header = requestHeader(1)
    const session = { id: 'role-session', header: {}, events: [header] }
    const agent = { id: session.id, session, ctx: {} }
    const registeredTools: string[] = []
    const services = await context.plugin({
      name: 'aen-role-test-services',
      apply(serviceContext) {
        serviceContext.provide('agents', {
          list: () => [agent],
          get: (id: string) => id === agent.id ? agent : undefined,
        })
        serviceContext.provide('skills', {
          snapshot: async () => ({ skills: [], complete: true }),
          get: async () => undefined,
        })
        serviceContext.provide('tools', {
          register(tool: unknown) {
            registeredTools.push(String((tool as { name?: unknown }).name))
            return () => undefined
          },
        })
      },
    })
    const policy = await context.plugin(policyPlugin as never, {
      captureSkillContent: true,
      captureSkillResources: false,
      allowHubSearch: false,
    })
    const provider = await context.plugin(providerPlugin as never, {
      storePath,
      harnessVersion: '0.1.0-rc.7',
      snapshotDelayMs: 0,
    })
    const tools = await context.plugin(toolPlugin as never, {})

    expect(context.get('aenPolicy')).toMatchObject({
      captureSkillContent: true,
      captureSkillResources: false,
      allowHubSearch: false,
      publicPublishing: 'disabled',
    })
    expect(context.get('aen')).toBeDefined()
    expect(registeredTools).toEqual(['experience_search', 'experience_feedback'])
    context.emit('session/event' as never, session, header)
    const runtime = context.get('aen') as DshAenRuntime
    const searchContext = await runtime.resolveSearchContext({ id: agent.id })
    expect(searchContext).toMatchObject({
      model: { provider: 'deepseek', modelId: 'deepseek-chat' },
      environment: { disclosure: 'metadata' },
    })
    expect(searchContext?.harnessConfigurationDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(searchContext?.harnessManifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/)

    const store = new LocalEvidenceStore(storePath)
    expect(store.listObjects('harness_manifest')).toHaveLength(1)
    store.close()

    await tools.dispose()
    await provider.dispose()
    expect(context.get('aen')).toBeUndefined()
    expect(context.get('aenPolicy')).toBeDefined()
    await policy.dispose()
    expect(context.get('aenPolicy')).toBeUndefined()
    await services.dispose()
  })

  it('fails closed when a tool role requests Hub access without policy permission', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aen-cordis-policy-denial-'))
    directories.push(directory)
    const context = new Context()
    const services = await context.plugin({
      name: 'aen-policy-denial-services',
      apply(serviceContext) {
        serviceContext.provide('agents', { list: () => [], get: () => undefined })
        serviceContext.provide('skills', {
          snapshot: async () => ({ skills: [], complete: true }),
          get: async () => undefined,
        })
        serviceContext.provide('tools', { register: () => () => undefined })
      },
    })
    const policy = await context.plugin(policyPlugin as never, { allowHubSearch: false })
    const provider = await context.plugin(providerPlugin as never, {
      storePath: join(directory, 'evidence.sqlite'),
    })

    await expect(context.plugin(toolPlugin as never, { hubUrl: 'https://hub.example.test' }))
      .rejects.toThrow('hubUrl requires aen-policy allowHubSearch=true')

    await provider.dispose()
    await policy.dispose()
    await services.dispose()
  })
})
