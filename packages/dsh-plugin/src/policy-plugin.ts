import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name for the local AEN policy role. */
export const name = 'aen-policy'

export interface Config {
  captureSkillContent?: boolean
  captureSkillResources?: boolean
  allowHubSearch?: boolean
}

/** Read-only policy contract shared by independently mounted AEN roles. */
export interface DshAenPolicy {
  readonly captureSkillContent: boolean
  readonly captureSkillResources: boolean
  readonly allowHubSearch: boolean
  readonly publicPublishing: 'disabled'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    aenPolicy: DshAenPolicy
  }
}

/** Loader validation for explicit local capture and network permissions. */
export const Config: z<Config> = z.object({
  captureSkillContent: z.boolean().default(true),
  captureSkillResources: z.boolean().default(false),
  allowHubSearch: z.boolean().default(false),
})

/** Policy service consumed by the provider and tool plugins. */
class DshAenPolicyRuntime extends Service implements DshAenPolicy {
  readonly captureSkillContent: boolean
  readonly captureSkillResources: boolean
  readonly allowHubSearch: boolean
  readonly publicPublishing = 'disabled' as const

  constructor(context: Context, config: Config = {}) {
    super(context, 'aenPolicy')
    this.captureSkillContent = config.captureSkillContent ?? true
    this.captureSkillResources = config.captureSkillResources ?? false
    this.allowHubSearch = config.allowHubSearch ?? false
  }
}

/** Provide the immutable local AEN policy for this composition. */
export function apply(context: unknown, config: Config): void {
  new DshAenPolicyRuntime(context as Context, config)
}
