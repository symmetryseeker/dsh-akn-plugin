import z from '@deepseek-ai/schemastery'
import type { LocalEvidenceStore } from '@aen/local-store'
import type { DshAenPolicy } from './policy-plugin.js'
import type { DshAenRuntime } from './runtime.js'
import { registerDshAenConsumerTools } from './consumer.js'
import type { DshPluginContext } from './types.js'

/** Cordis plugin name for the AEN model-tool Consumer role. */
export const name = 'aen-tools'

/** Provider, policy, and authoritative DSH tool registry required by this role. */
export const inject = ['aen', 'aenPolicy', 'tools']

export interface Config {
  hubUrl?: string
}

/** Loader validation for the optional public Hub endpoint. */
export const Config: z<Config> = z.object({
  hubUrl: z.string(),
})

/** Register only search and low-trust feedback after all required services exist. */
export function apply(context: unknown, config: Config): void {
  const ctx = context as DshPluginContext
  const runtime = ctx.get?.('aen') as DshAenRuntime | undefined
  const policy = ctx.get?.('aenPolicy') as DshAenPolicy | undefined
  if (runtime === undefined) throw new Error('aen-tools: aen provider service is unavailable')
  if (policy === undefined) throw new Error('aen-tools: aenPolicy service is unavailable')
  if (config.hubUrl !== undefined && config.hubUrl.length > 0 && !policy.allowHubSearch) {
    throw new Error('aen-tools: hubUrl requires aen-policy allowHubSearch=true')
  }
  registerDshAenConsumerTools(ctx, {
    ...(config.hubUrl === undefined ? {} : { hubUrl: config.hubUrl }),
    store: runtime.store as LocalEvidenceStore,
    resolveContext: (agent, signal) => runtime.resolveSearchContext(agent, signal),
  })
}
