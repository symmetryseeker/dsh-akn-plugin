import {
  canonicalJson,
  sha256,
  type EnvironmentFingerprint,
  type JsonRecord,
  type JsonValue,
  type ModelFingerprint,
} from '@aen/protocol'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import {
  dshConfigurationSystemPromptDigest,
  type DshLiveSkillSnapshot,
  type DshLiveSnapshot,
} from '@aen/adapter-dsh'
import type {
  DshAgentPresetsLike,
  DshPluginAgent,
  DshPluginContext,
  DshPluginSessionEvent,
  DshSkillDefinitionLike,
} from './types.js'

export interface SnapshotConfig {
  harnessVersion: string
  captureSkillContent: boolean
  captureSkillResources: boolean
}

const MAX_SKILL_RESOURCE_FILES = 512
const MAX_SKILL_RESOURCE_DIRECTORIES = 128
const MAX_SKILL_RESOURCE_BYTES = 64 * 1024 * 1024
const MAX_SKILL_RESOURCE_FILE_BYTES = 8 * 1024 * 1024

interface SkillPackageClosure {
  entrypoint?: string
  resources?: DshLiveSkillSnapshot['resources']
  complete: boolean
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  return isRecord(value) && typeof value[key] === 'number' && Number.isFinite(value[key])
    ? value[key]
    : undefined
}

function normalizeDescription(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim()
}

function normalizeSkillContent(value: string): string {
  return value.replaceAll('\r\n', '\n').normalize('NFC').trimEnd()
}

function selectedRequestConfig(config: JsonRecord): JsonRecord {
  const selected: JsonRecord = {}
  for (const key of ['reasoningEffort', 'temperature', 'maxTokens', 'seed']) {
    const value = config[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      selected[key] = value
    }
  }
  return selected
}

function latestContext(agent: DshPluginAgent, provider: string, model: string): JsonRecord | undefined {
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]
    if (event?.type !== 'request/context' || !isRecord(event.data)) continue
    if (event.data.provider === provider && event.data.model === model) return event.data
  }
  return undefined
}

function modelFingerprint(
  agent: DshPluginAgent,
  config: JsonRecord,
  capturedAt: string,
): ModelFingerprint {
  const provider = stringField(config, 'provider') ?? 'unknown'
  const modelId = stringField(config, 'model') ?? 'unknown'
  const context = latestContext(agent, provider, modelId)
  const contextWindow = numberField(context, 'contextWindow')
  const selected = selectedRequestConfig(config)
  const configDigest = Object.keys(selected).length === 0 ? undefined : sha256(canonicalJson(selected))
  const reasoningEffort = stringField(config, 'reasoningEffort')
  const temperature = numberField(config, 'temperature')
  const maxOutputTokens = numberField(config, 'maxTokens')
  const seed = numberField(config, 'seed')
  return {
    provider,
    modelId,
    ...(contextWindow !== undefined && Number.isInteger(contextWindow) && contextWindow > 0
      ? { contextWindow }
      : {}),
    ...(configDigest === undefined
      ? {}
      : {
          requestConfig: {
            ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
            ...(temperature === undefined ? {} : { temperature }),
            ...(maxOutputTokens !== undefined && Number.isInteger(maxOutputTokens) && maxOutputTokens > 0
              ? { maxOutputTokens }
              : {}),
            ...(seed !== undefined && Number.isInteger(seed) ? { seed } : {}),
            configDigest,
          },
        }),
    observedAt: capturedAt,
    mutability: 'unknown',
  }
}

function environment(capturedAt: string, workspaceScoped: boolean): EnvironmentFingerprint {
  return {
    os: { family: process.platform, arch: process.arch },
    runtime: { node: process.version },
    ...(workspaceScoped ? { workspaceTraits: ['workspace-scoped'] } : {}),
    capturedAt,
    disclosure: 'metadata',
  }
}

function metadataString(definition: DshSkillDefinitionLike | undefined, key: string): string | undefined {
  const value = definition?.metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

function metadataBoolean(definition: DshSkillDefinitionLike | undefined, key: string): boolean {
  return definition?.metadata?.[key] === true
}

function mediaType(path: string): string | undefined {
  const extension = path.toLowerCase().split('.').pop()
  return ({
    md: 'text/markdown', txt: 'text/plain', json: 'application/json',
    yaml: 'application/yaml', yml: 'application/yaml', js: 'text/javascript',
    mjs: 'text/javascript', cjs: 'text/javascript', ts: 'text/typescript',
    tsx: 'text/typescript', py: 'text/x-python', sh: 'text/x-shellscript',
    bash: 'text/x-shellscript', svg: 'image/svg+xml', png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf',
  } as Record<string, string>)[extension ?? '']
}

function logicalPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`)
}

async function skillPackageClosure(
  definition: DshSkillDefinitionLike | undefined,
  config: SnapshotConfig,
  signal: AbortSignal,
): Promise<SkillPackageClosure> {
  if (!config.captureSkillResources || definition?.resourceBase?.kind !== 'directory') {
    return { complete: false }
  }
  if (typeof definition.resourceBase.path !== 'string' || typeof definition.path !== 'string') {
    return { complete: false }
  }
  signal.throwIfAborted()
  const declaredBase = resolve(definition.resourceBase.path)
  const declaredEntrypoint = resolve(definition.path)
  const [baseMetadata, entryMetadata] = await Promise.all([
    lstat(declaredBase),
    lstat(declaredEntrypoint),
  ])
  if (
    baseMetadata.isSymbolicLink() || !baseMetadata.isDirectory() ||
    entryMetadata.isSymbolicLink() || !entryMetadata.isFile()
  ) throw new Error('skill package base/entrypoint must be a regular directory and file')
  const [root, entrypoint] = await Promise.all([realpath(declaredBase), realpath(declaredEntrypoint)])
  if (!inside(root, entrypoint) || dirname(entrypoint) !== root || basename(entrypoint).toLowerCase() !== 'skill.md') {
    throw new Error('complete skill package capture requires an in-directory SKILL.md entrypoint')
  }
  const resources: NonNullable<DshLiveSkillSnapshot['resources']> = []
  const pending = [root]
  let directories = 0
  let totalBytes = 0
  while (pending.length > 0) {
    signal.throwIfAborted()
    const directory = pending.pop()
    if (directory === undefined) break
    directories += 1
    if (directories > MAX_SKILL_RESOURCE_DIRECTORIES) throw new Error('skill package exceeds directory limit')
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      signal.throwIfAborted()
      const path = resolve(directory, entry.name)
      if (!inside(root, path)) throw new Error('skill package entry escapes its resource base')
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) throw new Error(`skill package contains a symlink: ${logicalPath(root, path)}`)
      if (metadata.isDirectory()) {
        pending.push(path)
        continue
      }
      if (!metadata.isFile()) throw new Error(`skill package contains a non-regular entry: ${logicalPath(root, path)}`)
      if (path === entrypoint) continue
      if (resources.length >= MAX_SKILL_RESOURCE_FILES) throw new Error('skill package exceeds file limit')
      if (metadata.size > MAX_SKILL_RESOURCE_FILE_BYTES) throw new Error(`skill resource exceeds per-file limit: ${logicalPath(root, path)}`)
      totalBytes += metadata.size
      if (totalBytes > MAX_SKILL_RESOURCE_BYTES) throw new Error('skill package exceeds total byte limit')
      const bytes = await readFile(path)
      const name = logicalPath(root, path)
      const type = mediaType(name)
      resources.push({
        logicalName: name,
        ...(type === undefined ? {} : { mediaType: type }),
        digest: sha256(bytes),
      })
    }
  }
  resources.sort((left, right) => left.logicalName.localeCompare(right.logicalName))
  return { entrypoint: 'SKILL.md', resources, complete: true }
}

async function skillSnapshot(
  ctx: DshPluginContext,
  agent: DshPluginAgent,
  config: SnapshotConfig,
  signal: AbortSignal,
): Promise<{ skills: DshLiveSkillSnapshot[]; complete: boolean }> {
  const lookup = {
    ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
    scope: agent,
    signal,
  }
  const catalog = await ctx.skills.snapshot(lookup)
  const skills: DshLiveSkillSnapshot[] = []
  for (const summary of catalog.skills) {
    signal.throwIfAborted()
    let definition: DshSkillDefinitionLike | undefined
    if (config.captureSkillContent) {
      try {
        definition = await ctx.skills.get(summary.name, lookup)
      } catch (error) {
        ctx.logger.warn(`aen: skill ${summary.name} content snapshot failed: ${String(error)}`)
      }
    }
    const content = typeof definition?.content === 'string'
      ? normalizeSkillContent(definition.content)
      : undefined
    let packageClosure: SkillPackageClosure = { complete: false }
    if (content !== undefined) {
      try {
        packageClosure = await skillPackageClosure(definition, config, signal)
      } catch (error) {
        ctx.logger.warn(`aen: skill ${summary.name} package closure snapshot failed: ${String(error)}`)
      }
    }
    const license = metadataString(definition, 'license')
    skills.push({
      name: summary.name,
      description: normalizeDescription(summary.description),
      ...(summary.provider === undefined ? {} : { provider: summary.provider }),
      ...(summary.source === undefined ? {} : { source: summary.source }),
      ...(summary.resourceBase?.kind === undefined
        ? {}
        : { resourceBaseKind: summary.resourceBase.kind }),
      ...(summary.invocation === undefined ? {} : { invocation: summary.invocation }),
      ...(content === undefined ? {} : { content }),
      ...(packageClosure.entrypoint === undefined ? {} : { entrypoint: packageClosure.entrypoint }),
      ...(packageClosure.resources === undefined ? {} : { resources: packageClosure.resources }),
      closure: content === undefined
        ? 'interface_only'
        : packageClosure.complete
          ? 'complete_package'
          : 'partial_snapshot',
      ...(license === undefined ? {} : { licenseExpression: license }),
      redistributable: metadataBoolean(definition, 'redistributable'),
    })
  }
  return { skills, complete: catalog.complete }
}

function policyCategory(eventType: string): keyof DshLiveSnapshot['policies'] | undefined {
  if (eventType.startsWith('sandbox/')) return 'sandbox'
  if (eventType.startsWith('approval/')) return 'approval'
  if (eventType.startsWith('permission/')) return 'filesystem'
  if (eventType.startsWith('compaction/')) return 'compaction'
  if (eventType.includes('retry')) return 'retry'
  if (eventType.startsWith('subagent/')) return 'subagents'
  if (eventType.startsWith('memory/')) return 'memory'
  return undefined
}

function policySnapshot(events: readonly DshPluginSessionEvent[]): DshLiveSnapshot['policies'] {
  const policies: DshLiveSnapshot['policies'] = {}
  for (const event of events) {
    const category = policyCategory(event.type)
    if (category === undefined) continue
    policies[category] = {
      source: 'durable_session_event',
      eventType: event.type,
      valueDigest: sha256(canonicalJson(event.data)),
    }
  }
  return policies
}

function optionalPresetService(ctx: DshPluginContext): DshAgentPresetsLike | undefined {
  const value = ctx.get?.('agentPresets')
  if (!isRecord(value)) return undefined
  if (
    typeof value.composedPreset !== 'function' ||
    typeof value.read !== 'function' ||
    typeof value.resolve !== 'function'
  ) return undefined
  return value as unknown as DshAgentPresetsLike
}

async function presetSnapshot(
  ctx: DshPluginContext,
  agent: DshPluginAgent,
): Promise<DshLiveSnapshot['preset'] | undefined> {
  const service = optionalPresetService(ctx)
  const id = service?.composedPreset(agent.ctx) ?? agent.session.header.agentPreset
  if (id === undefined || service === undefined) return undefined
  const [composition, descriptor] = await Promise.all([service.read(id), service.resolve(id)])
  return {
    id,
    composition,
    ...(descriptor.trust === undefined ? {} : { trust: descriptor.trust }),
  }
}

export async function captureDshLiveSnapshot(
  ctx: DshPluginContext,
  agent: DshPluginAgent,
  requestHeaderEvent: DshPluginSessionEvent,
  config: SnapshotConfig,
  signal: AbortSignal,
): Promise<DshLiveSnapshot> {
  if (requestHeaderEvent.type !== 'request/header' || !isRecord(requestHeaderEvent.data)) {
    throw new Error('aen: live snapshot requires a durable request/header event')
  }
  const header = isRecord(requestHeaderEvent.data.header) ? requestHeaderEvent.data.header : undefined
  const callConfig = isRecord(header?.config) ? header.config : undefined
  if (header === undefined || callConfig === undefined) {
    throw new Error('aen: request/header is missing the effective header/config')
  }
  const capturedAt = new Date(requestHeaderEvent.time).toISOString()
  const [skillResult, preset] = await Promise.all([
    skillSnapshot(ctx, agent, config, signal),
    presetSnapshot(ctx, agent),
  ])
  signal.throwIfAborted()
  const tools = Array.isArray(header.tools) ? (header.tools as JsonValue[]) : []
  const systemPrompt = stringField(header, 'system')
  const model = modelFingerprint(agent, callConfig, capturedAt)
  const limitations = [
    'The plugin records exact request/header model-facing surfaces but only digest projections of durable policy events.',
    'Harness configuration identity uses an authoritative prompt-template digest with the run-local workspace and Model route removed; the exact per-run systemPromptDigest remains in the Manifest model surface.',
    'Skill package closure is only complete for explicitly authorized directory skills with an in-directory SKILL.md; symlinks, unreadable entries, and capture limits fail closed to partial.',
    'Public publication is not performed by the DSH plugin.',
  ]
  if (config.harnessVersion === 'unknown') {
    limitations.push('The DSH Harness version was not configured for this plugin instance.')
  }
  if (preset === undefined && agent.session.header.agentPreset !== undefined) {
    limitations.push('The preset id was visible, but no authoritative composition service was available to hash it.')
  }
  return {
    capturedAt,
    harness: { version: config.harnessVersion, distribution: 'DeepSeek Harness Cordis plugin' },
    model,
    sessionCorrelationDigest: sha256(agent.session.id),
    sequenceRange: { toSeq: requestHeaderEvent.seq },
    ...(preset === undefined ? {} : { preset }),
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
    ...(systemPrompt === undefined ? {} : {
      configurationSystemPromptDigest: dshConfigurationSystemPromptDigest(
        systemPrompt,
        agent.session.header.cwd,
        model,
      ),
    }),
    toolSchemas: tools,
    skills: skillResult.skills,
    skillRegistryComplete: skillResult.complete,
    policies: policySnapshot(agent.session.events),
    environment: environment(capturedAt, agent.session.header.cwd !== undefined),
    limitations,
  }
}
