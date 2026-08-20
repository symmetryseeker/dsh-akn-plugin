import {
  canonicalJson,
  sha256,
  type Digest,
  type JsonRecord,
} from '@aen/protocol'
import { buildLiveManifest } from '@aen/adapter-dsh'
import { LocalEvidenceStore } from '@aen/local-store'
import type { DshAenSearchContext } from './runtime.js'
import { captureDshLiveSnapshot } from './snapshot.js'
import type { DshPluginAgent, DshPluginContext, DshPluginSessionEvent } from './types.js'
import { setTimeout as sleep } from 'node:timers/promises'

const POLICY_BOUNDARY_PREFIXES = [
  'sandbox/',
  'approval/',
  'permission/',
  'compaction/',
  'subagent/',
  'memory/',
]

const REGISTRY_BOUNDARY_EVENTS = [
  'skills/change',
  'tools/change',
  'system-prompt/change',
  'llm/adapters-updated',
]

export interface DshAenPluginConfig {
  enabled?: boolean
  storePath?: string
  harnessVersion?: string
  captureSkillContent?: boolean
  captureSkillResources?: boolean
  snapshotDelayMs?: number
}

interface ResolvedConfig {
  storePath: string
  harnessVersion: string
  captureSkillContent: boolean
  captureSkillResources: boolean
  snapshotDelayMs: number
}

interface PendingCapture {
  timer: ReturnType<typeof setTimeout>
  event: DshPluginSessionEvent
  reasons: Set<string>
}

type SearchContext = DshAenSearchContext

interface CapturedSearchContext {
  context: SearchContext
  requestHeaderSeq: number
}

interface RequestHeaderIdentity {
  digest: Digest
  seq: number
}

function resolvedConfig(config: DshAenPluginConfig): ResolvedConfig {
  const snapshotDelayMs = config.snapshotDelayMs ?? 25
  if (!Number.isSafeInteger(snapshotDelayMs) || snapshotDelayMs < 0 || snapshotDelayMs > 60_000) {
    throw new Error('aen: snapshotDelayMs must be a safe integer between 0 and 60000')
  }
  const storePath = config.storePath ?? '.aen/evidence.sqlite'
  if (storePath.length === 0) throw new Error('aen: storePath must not be empty')
  const harnessVersion = config.harnessVersion ?? 'unknown'
  if (harnessVersion.length === 0) throw new Error('aen: harnessVersion must not be empty')
  return {
    storePath,
    harnessVersion,
    captureSkillContent: config.captureSkillContent ?? true,
    captureSkillResources: config.captureSkillResources ?? false,
    snapshotDelayMs,
  }
}

function latestRequestHeader(agent: DshPluginAgent): DshPluginSessionEvent | undefined {
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]
    if (event?.type === 'request/header') return event
  }
  return undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function latestRequestContext(agent: DshPluginAgent): JsonRecord | undefined {
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]
    if (event?.type === 'request/context' && isRecord(event.data)) return event.data
  }
  return undefined
}

function requestHeaderIdentity(
  agent: DshPluginAgent,
  event: DshPluginSessionEvent,
): Digest | undefined {
  if (event.type !== 'request/header' || !isRecord(event.data) || !isRecord(event.data.header)) {
    return undefined
  }
  return sha256(canonicalJson({
    header: event.data.header,
    requestContext: latestRequestContext(agent),
  }))
}

function isPolicyBoundary(type: string): boolean {
  return POLICY_BOUNDARY_PREFIXES.some((prefix) => type.startsWith(prefix)) || type.includes('retry')
}

async function waitForSharedOperation(
  operation: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal === undefined) {
    await operation
    return
  }
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      try {
        signal.throwIfAborted()
      } catch (error) {
        reject(error)
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    await Promise.race([operation, aborted])
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

export class DshAenPluginCoordinator {
  readonly store: LocalEvidenceStore
  readonly #ctx: DshPluginContext
  readonly #config: ResolvedConfig
  readonly #abort = new AbortController()
  readonly #pending = new Map<string, PendingCapture>()
  readonly #chains = new Map<string, Promise<void>>()
  readonly #lastCellIdentity = new Map<string, Digest>()
  readonly #searchContexts = new Map<string, CapturedSearchContext>()
  readonly #lastRequestHeaderIdentity = new Map<string, RequestHeaderIdentity>()
  readonly #disposers: Array<() => void> = []
  #closed = false

  constructor(ctx: DshPluginContext, config: DshAenPluginConfig = {}) {
    this.#ctx = ctx
    this.#config = resolvedConfig(config)
    this.store = new LocalEvidenceStore(this.#config.storePath)
  }

  start(): void {
    if (this.#closed) throw new Error('aen: cannot start a closed DSH plugin coordinator')
    this.#disposers.push(
      this.#ctx.on('agent/created', ({ agent }: { agent: DshPluginAgent }) => {
        const header = latestRequestHeader(agent)
        if (header !== undefined) {
          this.#observeRequestHeader(agent, header, 'agent_created_with_existing_header')
        }
      }),
      this.#ctx.on('agent/disposed', ({ agent }: { agent: DshPluginAgent }) => {
        this.#cancelPending(agent.id)
        this.#lastCellIdentity.delete(agent.id)
        this.#searchContexts.delete(agent.id)
        this.#lastRequestHeaderIdentity.delete(agent.id)
      }),
      this.#ctx.on(
        'session/event',
        (session: { id: string }, event: DshPluginSessionEvent) => {
          if (this.#closed) return
          // Tool traffic is the dominant hot path and is never an AEN capture
          // boundary. Return before registry lookup or policy-prefix scanning.
          if (event.type === 'tool/call' || event.type === 'tool/result') return
          const agent = this.#ctx.agents.get(session.id)
          if (agent === undefined) return
          if (event.type === 'request/header') {
            this.#observeRequestHeader(agent, event, 'effective_request_header')
            return
          }
          if (event.type === 'agent-preset/selected' || isPolicyBoundary(event.type)) {
            const header = latestRequestHeader(agent)
            if (header !== undefined) this.schedule(agent, header, event.type)
          }
          // Every other event, including tool/call and tool/result, performs no
          // I/O and schedules no work. DSH remains the sole trace authority.
        },
      ),
    )
    for (const event of REGISTRY_BOUNDARY_EVENTS) {
      this.#disposers.push(
        this.#ctx.on(event, () => {
          for (const agent of this.#ctx.agents.list()) {
            const header = latestRequestHeader(agent)
            if (header !== undefined) this.schedule(agent, header, event)
          }
        }),
      )
    }
    for (const agent of this.#ctx.agents.list()) {
      const header = latestRequestHeader(agent)
      if (header !== undefined) this.#observeRequestHeader(agent, header, 'plugin_start')
    }
  }

  #observeRequestHeader(
    agent: DshPluginAgent,
    event: DshPluginSessionEvent,
    reason: string,
  ): void {
    const identity = requestHeaderIdentity(agent, event)
    if (identity === undefined) {
      this.schedule(agent, event, reason)
      return
    }
    const previous = this.#lastRequestHeaderIdentity.get(agent.id)
    this.#lastRequestHeaderIdentity.set(agent.id, { digest: identity, seq: event.seq })
    if (previous?.digest !== identity) {
      this.schedule(agent, event, reason)
      return
    }
    const pending = this.#pending.get(agent.id)
    if (pending !== undefined) {
      // Preserve the original debounce deadline while making the eventual
      // snapshot's session range cover the newest equivalent request.
      pending.event = event
      return
    }
    const current = this.#searchContexts.get(agent.id)
    if (current !== undefined) {
      current.requestHeaderSeq = event.seq
      return
    }
    // A previous equivalent capture may still be running. If not, the earlier
    // attempt failed and an explicit retry is required rather than caching loss.
    if (!this.#chains.has(agent.id)) this.schedule(agent, event, reason)
  }

  schedule(agent: DshPluginAgent, event: DshPluginSessionEvent, reason: string): void {
    if (this.#closed || this.#abort.signal.aborted) return
    const current = this.#pending.get(agent.id)
    if (current !== undefined) {
      clearTimeout(current.timer)
      current.event = event
      current.reasons.add(reason)
      current.timer = this.#timer(agent.id)
      return
    }
    this.#pending.set(agent.id, {
      event,
      reasons: new Set([reason]),
      timer: this.#timer(agent.id),
    })
  }

  #timer(agentId: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const pending = this.#pending.get(agentId)
      if (pending === undefined) return
      this.#pending.delete(agentId)
      const agent = this.#ctx.agents.get(agentId)
      if (agent === undefined || this.#closed) return
      this.#enqueue(agent, pending.event, [...pending.reasons].sort())
    }, this.#config.snapshotDelayMs)
  }

  #enqueue(agent: DshPluginAgent, event: DshPluginSessionEvent, reasons: string[]): void {
    const previous = this.#chains.get(agent.id) ?? Promise.resolve()
    const operation = previous
      .catch(() => undefined)
      .then(() => this.#capture(agent, event, reasons))
      .catch((error: unknown) => {
        if (!this.#abort.signal.aborted) {
          this.#ctx.logger.warn(`aen: live Manifest snapshot failed for ${agent.id}: ${String(error)}`)
        }
      })
    this.#chains.set(agent.id, operation)
    void operation.finally(() => {
      if (this.#chains.get(agent.id) === operation) this.#chains.delete(agent.id)
    })
  }

  async #capture(
    agent: DshPluginAgent,
    event: DshPluginSessionEvent,
    reasons: string[],
  ): Promise<void> {
    this.#abort.signal.throwIfAborted()
    const snapshot = await captureDshLiveSnapshot(
      this.#ctx,
      agent,
      event,
      {
        harnessVersion: this.#config.harnessVersion,
        captureSkillContent: this.#config.captureSkillContent,
        captureSkillResources: this.#config.captureSkillResources,
      },
      this.#abort.signal,
    )
    const localSessionDigest = snapshot.sessionCorrelationDigest ?? sha256(
      canonicalJson({ namespace: 'dsh-live-session-local-correlation', sessionId: agent.session.id }),
    )
    const { manifest, artifacts } = buildLiveManifest(snapshot, {
      sessionDigest: localSessionDigest,
      toSeq: event.seq,
    })
    const { observedAt: _modelObservedAt, ...stableModel } = snapshot.model
    const { capturedAt: _environmentCapturedAt, ...stableEnvironment } = snapshot.environment
    const cellIdentity = sha256(canonicalJson({
      model: stableModel,
      harnessConfigurationDigest: manifest.configurationDigest,
      environment: stableEnvironment,
    }))
    const capturedHeaderIdentity = requestHeaderIdentity(agent, event)
    const latestHeaderIdentity = this.#lastRequestHeaderIdentity.get(agent.id)
    const coveredRequestHeaderSeq =
      capturedHeaderIdentity !== undefined && latestHeaderIdentity?.digest === capturedHeaderIdentity
        ? latestHeaderIdentity.seq
        : event.seq
    if (this.#lastCellIdentity.get(agent.id) === cellIdentity) {
      const current = this.#searchContexts.get(agent.id)
      if (current !== undefined) current.requestHeaderSeq = coveredRequestHeaderSeq
      return
    }
    this.#abort.signal.throwIfAborted()
    this.store.putBatch({
      session: {
        sessionDigest: localSessionDigest,
        sourceName: `dsh-live:${agent.session.id}`,
        importedAt: snapshot.capturedAt,
      },
      objects: [
        ...artifacts.map((artifact) => ({
          object: artifact as unknown as JsonRecord,
          role: `live_artifact:${artifact.kind}`,
        })),
        { object: manifest as unknown as JsonRecord, role: 'live_manifest' },
      ],
    })
    this.#lastCellIdentity.set(agent.id, cellIdentity)
    this.#searchContexts.set(agent.id, {
      context: {
        model: snapshot.model as SearchContext['model'],
        harnessConfigurationDigest: manifest.configurationDigest,
        harnessManifestDigest: manifest.digest,
        environment: snapshot.environment as SearchContext['environment'],
      },
      requestHeaderSeq: coveredRequestHeaderSeq,
    })
    this.#ctx.logger.info?.(
      `aen: stored live Manifest ${manifest.digest} for ${agent.id} (${reasons.join(', ')})`,
    )
  }

  #cancelPending(agentId: string): void {
    const pending = this.#pending.get(agentId)
    if (pending !== undefined) clearTimeout(pending.timer)
    this.#pending.delete(agentId)
  }

  async waitForIdle(): Promise<void> {
    while (this.#pending.size > 0 || this.#chains.size > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, this.#config.snapshotDelayMs)))
    }
  }

  async #waitForAgentIdle(agentId: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    while (this.#pending.has(agentId) || this.#chains.has(agentId)) {
      const chain = this.#chains.get(agentId)
      if (chain !== undefined) {
        await waitForSharedOperation(chain.catch(() => undefined), signal)
      } else {
        await sleep(
          Math.max(1, this.#config.snapshotDelayMs),
          undefined,
          signal === undefined ? undefined : { signal },
        )
      }
      signal?.throwIfAborted()
    }
  }

  /**
   * Resolve compatibility coordinates from the authoritative DSH Agent state.
   * An explicit Experience search may wait for (or request) the low-frequency
   * request/config snapshot; ordinary tool traffic never enters this path.
   */
  async resolveSearchContext(
    agentId: string,
    signal?: AbortSignal,
  ): Promise<SearchContext | undefined> {
    signal?.throwIfAborted()
    if (this.#closed || this.#abort.signal.aborted) return undefined
    const agent = this.#ctx.agents.get(agentId)
    if (agent === undefined) return undefined
    const header = latestRequestHeader(agent)
    if (header === undefined) return undefined
    this.#observeRequestHeader(agent, header, 'experience_search_context')
    await this.#waitForAgentIdle(agentId, signal)
    signal?.throwIfAborted()
    const resolved = this.#searchContexts.get(agentId)?.context
    return resolved === undefined ? undefined : structuredClone(resolved)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#abort.abort(new Error('AEN DSH plugin disposed'))
    for (const pending of this.#pending.values()) clearTimeout(pending.timer)
    this.#pending.clear()
    for (const dispose of this.#disposers.splice(0).reverse()) dispose()
    await Promise.allSettled([...this.#chains.values()])
    this.#lastCellIdentity.clear()
    this.#searchContexts.clear()
    this.#lastRequestHeaderIdentity.clear()
    this.store.close()
  }
}
