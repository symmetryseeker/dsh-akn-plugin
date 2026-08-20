import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DshAenPluginCoordinator } from './coordinator.js'
import type { DshAenPolicy } from './policy-plugin.js'
import { DshAenRuntime } from './runtime.js'
import type { DshPluginContext } from './types.js'

/** Cordis plugin name for the DSH live-Manifest provider role. */
export const name = 'aen-provider'

/** Authoritative seams required by the provider. */
export const inject = ['agents', 'skills', 'aenPolicy']

export interface Config {
  enabled?: boolean
  storePath?: string
  harnessVersion?: string
  snapshotDelayMs?: number
}

/** Loader validation for provider-owned storage and snapshot timing. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  storePath: z.string().default('.aen/evidence.sqlite'),
  harnessVersion: z.string().default('unknown'),
  snapshotDelayMs: z.number().default(25),
})

/** Mount the local provider and expose it as the `aen` Cordis service. */
export function apply(context: unknown, config: Config): void {
  if (config.enabled === false) return
  const ctx = context as DshPluginContext
  const policy = ctx.get?.('aenPolicy') as DshAenPolicy | undefined
  if (policy === undefined) throw new Error('aen-provider: aenPolicy service is unavailable')
  const coordinator = new DshAenPluginCoordinator(ctx, {
    ...(config.storePath === undefined ? {} : { storePath: config.storePath }),
    ...(config.harnessVersion === undefined ? {} : { harnessVersion: config.harnessVersion }),
    ...(config.snapshotDelayMs === undefined ? {} : { snapshotDelayMs: config.snapshotDelayMs }),
    captureSkillContent: policy.captureSkillContent,
    captureSkillResources: policy.captureSkillResources,
  })
  ctx.effect(() => () => coordinator.close(), 'aen.provider()')
  coordinator.start()
  new DshAenRuntime(
    context as Context,
    coordinator.store,
    (agent, signal) => coordinator.resolveSearchContext(agent.id, signal),
  )
}
