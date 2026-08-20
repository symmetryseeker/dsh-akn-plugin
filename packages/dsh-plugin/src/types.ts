import type { JsonValue } from '@aen/protocol'

export interface DshPluginSessionEvent {
  type: string
  seq: number
  time: number
  data: JsonValue
}

export interface DshPluginSession {
  id: string
  header: { cwd?: string; agentPreset?: string }
  events: readonly DshPluginSessionEvent[]
}

export interface DshPluginAgent {
  id: string
  session: DshPluginSession
  ctx: unknown
}

export interface DshSkillSummaryLike {
  name: string
  description: string
  provider?: string
  source?: string
  invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
  resourceBase?: {
    kind?: 'directory' | 'url' | 'opaque'
    path?: string
    url?: string
    description?: string
  }
}

export interface DshSkillDefinitionLike extends DshSkillSummaryLike {
  content?: string
  path?: string
  metadata?: Readonly<Record<string, unknown>>
}

export interface DshPluginContext {
  agents: {
    list(): DshPluginAgent[]
    get(id: string): DshPluginAgent | undefined
  }
  skills: {
    snapshot(options: { cwd?: string; scope?: unknown; signal?: AbortSignal }): Promise<{
      skills: DshSkillSummaryLike[]
      complete: boolean
    }>
    get(
      name: string,
      options: { cwd?: string; scope?: unknown; signal?: AbortSignal },
    ): Promise<DshSkillDefinitionLike | undefined>
  }
  logger: { warn(message: string): void; info?(message: string): void }
  tools?: { register(tool: unknown): unknown }
  on(event: string, listener: (...args: any[]) => unknown): () => void
  effect(register: () => void | (() => void | Promise<void>), label?: string): unknown
  inject?(
    services: string[],
    callback: (context: DshPluginContext) => void,
  ): unknown
  get?(name: string): unknown
}

export interface DshAgentPresetsLike {
  composedPreset(agentContext: unknown): string | undefined
  read(id: string): Promise<string>
  resolve(id: string): Promise<{ trust?: 'system' | 'user' }>
}
