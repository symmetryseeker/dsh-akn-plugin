import {
  canonicalJson,
  sha256,
  type ArtifactDescriptor,
  type Digest,
  type EnvironmentFingerprint,
  type JsonRecord,
  type JsonValue,
  type ModelFingerprint,
  type NormalizedEvent,
} from '@aen/protocol'
import { publishObject } from './object.js'

export interface TraceSkillFact {
  name: string
  description?: string
  states: Array<'catalog' | 'model_loaded' | 'user_invoked'>
  contentDigests: Digest[]
}

export interface DshTraceAnalysis {
  effectiveHeader?: JsonRecord
  model: ModelFingerprint
  environment: EnvironmentFingerprint
  artifacts: ArtifactDescriptor[]
  artifactRefs: Array<{
    objectType: 'artifact'
    refId: string
    digest: Digest
    kind: 'skill' | 'tool'
  }>
  skills: TraceSkillFact[]
  policyFacts: Partial<Record<
    | 'sandbox'
    | 'approval'
    | 'filesystem'
    | 'network'
    | 'compaction'
    | 'retry'
    | 'subagents'
    | 'memory'
    | 'contextSelection'
    | 'toolTimeout',
    JsonValue
  >>
  coverage: {
    models: 'none' | 'partial'
    tools: 'none' | 'surface_only'
    skills: 'none' | 'catalog_only' | 'invoked_only'
    preset: 'none' | 'id_only'
    policies: 'none' | 'partial'
    effectiveSurface: 'none' | 'partial' | 'complete'
  }
  requestConfigDigest?: Digest
  toolSchemaSetDigest?: Digest
  systemPromptDigest?: Digest
  skillCatalogDigest?: Digest
  observedAt: string
  limitations: string[]
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

function eventRecord(event: NormalizedEvent): JsonRecord | undefined {
  return isRecord(event.data) ? event.data : undefined
}

function sourceOfUserMessage(event: NormalizedEvent): JsonRecord | undefined {
  if (event.sourceType !== 'user/message') return undefined
  const data = eventRecord(event)
  return isRecord(data?.source) ? data.source : undefined
}

function messageContentDigest(event: NormalizedEvent): Digest | undefined {
  const data = eventRecord(event)
  const message = isRecord(data?.message) ? data.message : data
  if (!isRecord(message) || !Array.isArray(message.content)) return undefined
  return sha256(canonicalJson(message.content))
}

function addSkillState(
  map: Map<string, TraceSkillFact>,
  name: string,
  state: TraceSkillFact['states'][number],
  description?: string,
  contentDigest?: Digest,
): void {
  if (name.length === 0) return
  const fact = map.get(name) ?? { name, states: [], contentDigests: [] }
  if (!fact.states.includes(state)) fact.states.push(state)
  if (description !== undefined) fact.description = description
  if (contentDigest !== undefined && !fact.contentDigests.includes(contentDigest)) {
    fact.contentDigests.push(contentDigest)
  }
  map.set(name, fact)
}

function toolResultCallId(event: NormalizedEvent): string | undefined {
  const data = eventRecord(event)
  const message = isRecord(data?.message) ? data.message : undefined
  const content = Array.isArray(message?.content) ? message.content : []
  const block = content.find((entry) => isRecord(entry) && entry.type === 'tool-result')
  return isRecord(block) ? stringField(block, 'toolCallId') : undefined
}

function safeSkillArgument(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return stringField(parsed, 'name')
  } catch {
    return undefined
  }
}

function selectedRequestConfig(config: JsonRecord): JsonRecord {
  const selected: JsonRecord = {}
  // Provider/model identity belongs to ModelFingerprint. Keeping it out of the
  // Harness request-config digest lets evaluation hold the Harness dimension
  // constant while changing only the Model dimension.
  for (const key of ['reasoningEffort', 'temperature', 'maxTokens', 'seed']) {
    const value = config[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      selected[key] = value
    }
  }
  return selected
}

function latestEvent(events: NormalizedEvent[], sourceType: string): NormalizedEvent | undefined {
  return [...events].reverse().find((event) => event.sourceType === sourceType)
}

function modelFromTrace(events: NormalizedEvent[], observedAt: string): {
  model: ModelFingerprint
  configDigest?: Digest
} {
  const requestHeaderEvent = latestEvent(events, 'request/header')
  const requestData = requestHeaderEvent === undefined ? undefined : eventRecord(requestHeaderEvent)
  const header = isRecord(requestData?.header) ? requestData.header : undefined
  const config = isRecord(header?.config) ? header.config : undefined
  const contextEvent = latestEvent(events, 'request/context')
  const context = contextEvent === undefined ? undefined : eventRecord(contextEvent)
  const assistantEvent = [...events]
    .reverse()
    .find((event) => event.sourceType === 'assistant/message')
  const assistantData = assistantEvent === undefined ? undefined : eventRecord(assistantEvent)
  const assistantMessage = isRecord(assistantData?.message) ? assistantData.message : undefined
  const assistantSource = isRecord(assistantMessage?.source) ? assistantMessage.source : undefined

  const provider =
    stringField(config, 'provider') ??
    stringField(context, 'provider') ??
    stringField(assistantSource, 'provider') ??
    'unknown'
  const modelId =
    stringField(config, 'model') ?? stringField(context, 'model') ?? stringField(assistantSource, 'model') ?? 'unknown'
  const requestSelected = config === undefined ? undefined : selectedRequestConfig(config)
  const configDigest =
    requestSelected === undefined || Object.keys(requestSelected).length === 0
      ? undefined
      : sha256(canonicalJson(requestSelected))
  const reasoningEffort = stringField(config, 'reasoningEffort')
  const temperature = numberField(config, 'temperature')
  const maxOutputTokens = numberField(config, 'maxTokens')
  const seed = numberField(config, 'seed')
  const contextWindow = numberField(context, 'contextWindow')

  return {
    model: {
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
      observedAt,
      mutability: 'unknown',
    },
    ...(configDigest === undefined ? {} : { configDigest }),
  }
}

function stableArtifactId(kind: 'skill' | 'tool', name: string): string {
  return `urn:aen:artifact:dsh:${kind}:${sha256(canonicalJson({ kind, name })).slice(7, 31)}`
}

function createArtifact(
  kind: 'skill' | 'tool',
  name: string,
  interfaceValue: JsonValue,
  traceState: JsonValue,
  options: { description?: string; contentDigest?: Digest } = {},
): ArtifactDescriptor {
  return publishObject<ArtifactDescriptor>({
    protocolVersion: '0.1',
    objectType: 'artifact',
    artifactId: stableArtifactId(kind, name),
    kind,
    name,
    formatProfile: kind === 'skill' ? 'agent_skills' : 'native',
    snapshotCompleteness: options.contentDigest === undefined ? 'interface_only' : 'content_only',
    interfaceDigest: sha256(canonicalJson(interfaceValue)),
    ...(options.contentDigest === undefined ? {} : { contentDigest: options.contentDigest }),
    ...(options.description === undefined ? {} : { description: options.description }),
    source: { type: 'runtime' },
    redistributable: false,
    distribution: { transport: 'local_only' },
    disclosure: 'digest_only',
    extensions: {
      'https://aen.dev/extensions/dsh/trace-state': traceState,
      'https://aen.dev/extensions/aen/source-strength': 'trace_observed',
    },
  })
}

function extractSkills(events: NormalizedEvent[]): TraceSkillFact[] {
  const facts = new Map<string, TraceSkillFact>()
  const skillCalls = new Map<string, string>()
  for (const event of events) {
    const source = sourceOfUserMessage(event)
    if (source?.kind === 'skill-catalog' && Array.isArray(source.entries)) {
      for (const entry of source.entries) {
        if (!isRecord(entry)) continue
        const name = stringField(entry, 'name')
        const description = stringField(entry, 'description')
        if (name !== undefined) addSkillState(facts, name, 'catalog', description)
      }
    }
    if (source?.kind === 'skill-invocation') {
      const name = stringField(source, 'name')
      if (name !== undefined) addSkillState(facts, name, 'user_invoked', undefined, messageContentDigest(event))
    }
    if (event.sourceType === 'tool/call') {
      const data = eventRecord(event)
      if (stringField(data, 'name') === 'skill') {
        const callId = stringField(data, 'callId')
        const skillName = safeSkillArgument(data?.arguments)
        if (callId !== undefined && skillName !== undefined) skillCalls.set(callId, skillName)
      }
    }
    if (event.sourceType === 'tool/result') {
      const callId = toolResultCallId(event)
      const skillName = callId === undefined ? undefined : skillCalls.get(callId)
      if (skillName !== undefined && !toolResultFailed(event)) {
        addSkillState(facts, skillName, 'model_loaded', undefined, messageContentDigest(event))
      }
    }
  }
  return [...facts.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function toolResultFailed(event: NormalizedEvent): boolean {
  if (event.sourceType !== 'tool/result') return false
  const data = eventRecord(event)
  if (isRecord(data?.error)) return true
  const message = isRecord(data?.message) ? data.message : undefined
  const content = Array.isArray(message?.content) ? message.content : []
  const block = content.find((entry) => isRecord(entry) && entry.type === 'tool-result')
  return isRecord(block) && block.isError === true
}

export function toolCallIdentity(event: NormalizedEvent): {
  callId: string
  name: string
  turn?: number
  step?: number
} | undefined {
  if (event.sourceType !== 'tool/call') return undefined
  const data = eventRecord(event)
  const callId = stringField(data, 'callId')
  const name = stringField(data, 'name')
  if (callId === undefined || name === undefined) return undefined
  const turn = numberField(data, 'turn')
  const step = numberField(data, 'step')
  return { callId, name, ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }) }
}

export function toolResultIdentity(event: NormalizedEvent): {
  callId: string
  turn?: number
  step?: number
  failed: boolean
} | undefined {
  if (event.sourceType !== 'tool/result') return undefined
  const data = eventRecord(event)
  const callId = toolResultCallId(event)
  if (callId === undefined) return undefined
  const turn = numberField(data, 'turn')
  const step = numberField(data, 'step')
  return {
    callId,
    ...(turn === undefined ? {} : { turn }),
    ...(step === undefined ? {} : { step }),
    failed: toolResultFailed(event),
  }
}

function policyFacts(events: NormalizedEvent[]): DshTraceAnalysis['policyFacts'] {
  const categories = new Map<string, Set<string>>()
  const record = (category: string, sourceType: string): void => {
    const values = categories.get(category) ?? new Set<string>()
    values.add(sourceType)
    categories.set(category, values)
  }
  for (const event of events) {
    if (event.sourceType.startsWith('sandbox/')) record('sandbox', event.sourceType)
    else if (event.sourceType.startsWith('approval/')) record('approval', event.sourceType)
    else if (event.sourceType.startsWith('permission/')) record('filesystem', event.sourceType)
    else if (event.sourceType.startsWith('compaction/')) record('compaction', event.sourceType)
    else if (event.sourceType.includes('retry')) record('retry', event.sourceType)
    else if (event.sourceType.startsWith('subagent/')) record('subagents', event.sourceType)
  }
  return Object.fromEntries(
    [...categories.entries()].map(([key, eventTypes]) => [
      key,
      { mode: 'trace_observed', eventTypes: [...eventTypes].sort() },
    ]),
  ) as DshTraceAnalysis['policyFacts']
}

export function analyzeDshTrace(events: NormalizedEvent[]): DshTraceAnalysis {
  const observedAt = [...events].reverse().find((event) => event.time !== undefined)?.time ?? new Date(0).toISOString()
  const requestEvent = latestEvent(events, 'request/header')
  const requestData = requestEvent === undefined ? undefined : eventRecord(requestEvent)
  const effectiveHeader = isRecord(requestData?.header) ? requestData.header : undefined
  const config = isRecord(effectiveHeader?.config) ? effectiveHeader.config : undefined
  const tools = Array.isArray(effectiveHeader?.tools) ? effectiveHeader.tools : undefined
  const system = stringField(effectiveHeader, 'system')
  const skills = extractSkills(events)
  const modelResult = modelFromTrace(events, observedAt)
  const artifacts: ArtifactDescriptor[] = []

  if (tools !== undefined) {
    for (const tool of tools) {
      if (!isRecord(tool)) continue
      const name = stringField(tool, 'name')
      if (name === undefined) continue
      artifacts.push(createArtifact('tool', name, tool as JsonValue, { states: ['effective_surface'] }))
    }
  }
  for (const skill of skills) {
    artifacts.push(
      createArtifact(
        'skill',
        skill.name,
        { name: skill.name, ...(skill.description === undefined ? {} : { description: skill.description }) },
        { states: skill.states, packageClosureObserved: false },
        {
          ...(skill.description === undefined ? {} : { description: skill.description }),
          ...(skill.contentDigests.length === 0
            ? {}
            : { contentDigest: sha256(canonicalJson(skill.contentDigests)) }),
        },
      ),
    )
  }
  artifacts.sort((left, right) => left.artifactId.localeCompare(right.artifactId))
  const skillCatalog = skills
    .filter((skill) => skill.states.includes('catalog'))
    .map(({ name, description }) => ({ name, ...(description === undefined ? {} : { description }) }))
  const invoked = skills.some(
    (skill) => skill.states.includes('model_loaded') || skill.states.includes('user_invoked'),
  )
  const policies = policyFacts(events)
  const limitations = [
    'Offline DSH import observes an append-only session log, not a live Harness registry snapshot.',
    'Trace-visible tool schemas describe the effective model surface but not every installed or shadowed tool.',
    'Skill catalog and invocation records do not prove the complete skill package closure, resources, license, or registry state.',
    'Environment and policy configuration may be absent even when their effects appear in trace events.',
  ]
  if (modelResult.model.provider === 'unknown' || modelResult.model.modelId === 'unknown') {
    limitations.push('The trace did not identify both the effective model provider and model id.')
  }

  return {
    ...(effectiveHeader === undefined ? {} : { effectiveHeader }),
    model: modelResult.model,
    environment: {
      capturedAt: observedAt,
      disclosure: 'digest_only',
      workspaceTraits: ['dsh-session-export', 'offline-import'],
    },
    artifacts,
    artifactRefs: artifacts.map((artifact) => ({
      objectType: 'artifact',
      refId: artifact.artifactId,
      digest: artifact.digest,
      kind: artifact.kind as 'skill' | 'tool',
    })),
    skills,
    policyFacts: policies,
    coverage: {
      models:
        modelResult.model.provider === 'unknown' && modelResult.model.modelId === 'unknown'
          ? 'none'
          : 'partial',
      tools: tools === undefined ? 'none' : 'surface_only',
      skills: skills.length === 0 ? 'none' : invoked ? 'invoked_only' : 'catalog_only',
      preset: events[0] !== undefined && isRecord(events[0].data) && typeof events[0].data.agentPreset === 'string'
        ? 'id_only'
        : 'none',
      policies: Object.keys(policies).length === 0 ? 'none' : 'partial',
      effectiveSurface:
        effectiveHeader === undefined ? 'none' : config !== undefined && tools !== undefined ? 'complete' : 'partial',
    },
    ...(modelResult.configDigest === undefined ? {} : { requestConfigDigest: modelResult.configDigest }),
    ...(tools === undefined ? {} : { toolSchemaSetDigest: sha256(canonicalJson(tools)) }),
    ...(system === undefined ? {} : { systemPromptDigest: sha256(system) }),
    ...(skillCatalog.length === 0
      ? {}
      : { skillCatalogDigest: sha256(canonicalJson(skillCatalog)) }),
    observedAt,
    limitations,
  }
}
