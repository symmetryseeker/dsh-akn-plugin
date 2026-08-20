import z from '@deepseek-ai/schemastery'
import { DshAenPluginCoordinator } from './coordinator.js'
import type { DshPluginContext } from './types.js'
import { registerDshAenConsumerTools } from './consumer.js'

/** Cordis function-plugin name used by the DeepSeek Harness Loader. */
export const name = 'aen'

/** Authoritative DSH capability seams required by Manifest capture. */
export const inject = ['agents', 'skills']

export interface Config {
  enabled?: boolean
  storePath?: string
  harnessVersion?: string
  captureSkillContent?: boolean
  captureSkillResources?: boolean
  snapshotDelayMs?: number
  hubUrl?: string
  enableConsumerTools?: boolean
}

/** Loader validation for local-only, low-frequency Manifest capture. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  storePath: z.string().default('.aen/evidence.sqlite'),
  harnessVersion: z.string().default('unknown'),
  captureSkillContent: z.boolean().default(true),
  captureSkillResources: z.boolean().default(false),
  snapshotDelayMs: z.number().default(25),
  hubUrl: z.string(),
  enableConsumerTools: z.boolean().default(false),
})

/**
 * Install the AEN live Manifest coordinator. This function plugin has no
 * default export: the DSH Loader consumes the named name/inject/Config/apply
 * namespace and disposes all listeners with the owning Cordis fiber.
 */
export function apply(context: unknown, config: Config): void {
  const ctx = context as DshPluginContext
  if (config.enabled === false) return
  const coordinator = new DshAenPluginCoordinator(ctx, config)
  if (config.enableConsumerTools === true) {
    if (ctx.inject === undefined) {
      throw new Error('aen: this Cordis host does not support deferred tools injection')
    }
    ctx.inject(['tools'], (toolsContext) => {
      registerDshAenConsumerTools(toolsContext, {
        ...(config.hubUrl === undefined ? {} : { hubUrl: config.hubUrl }),
        store: coordinator.store,
        resolveContext: (agent, signal) => coordinator.resolveSearchContext(agent.id, signal),
      })
    })
  }
  coordinator.start()
  ctx.effect(() => () => coordinator.close(), 'aen.liveManifestCoordinator()')
}
