import { Context, Service } from '@deepseek-ai/cordis'

export type DshAenDigest = `sha256:${string}`

export interface DshAenAgentRef {
  readonly id: string
}

export interface DshAenModelFingerprint {
  provider: string
  modelId: string
  declaredVersion?: string
  providerRevision?: string
  immutableWeightsDigest?: DshAenDigest
  capabilityDigest?: DshAenDigest
  contextWindow?: number
  requestConfig?: {
    reasoningEffort?: string
    temperature?: number
    maxOutputTokens?: number
    seed?: number
    configDigest: DshAenDigest
  }
  observedAt: string
  mutability: 'immutable' | 'versioned' | 'provider_mutable' | 'unknown'
}

export interface DshAenEnvironmentFingerprint {
  os?: { family: string; version?: string; arch?: string }
  runtime?: Record<string, string>
  dependencySetDigest?: DshAenDigest
  containerImageDigest?: DshAenDigest
  region?: string
  hardwareClass?: string
  workspaceTraits?: string[]
  externalServiceDigests?: DshAenDigest[]
  capturedAt: string
  disclosure: 'none' | 'metadata' | 'excerpt' | 'full'
}

/** Authoritative compatibility coordinates resolved from the current DSH Agent. */
export interface DshAenSearchContext {
  model: DshAenModelFingerprint
  harnessConfigurationDigest: DshAenDigest
  harnessManifestDigest: DshAenDigest
  environment: DshAenEnvironmentFingerprint
}

/**
 * Provider-backed AEN service contract consumed by independent Cordis roles.
 * The storage handle is intentionally opaque at the public bundle boundary:
 * it is private evidence infrastructure, not a second public AEN API.
 */
export class DshAenRuntime extends Service {
  readonly store: unknown
  readonly resolveSearchContext: (
    agent: DshAenAgentRef,
    signal?: AbortSignal,
  ) => Promise<DshAenSearchContext | undefined>

  constructor(
    context: Context,
    store: unknown,
    resolveSearchContext: (
      agent: DshAenAgentRef,
      signal?: AbortSignal,
    ) => Promise<DshAenSearchContext | undefined>,
  ) {
    super(context, 'aen')
    this.store = store
    this.resolveSearchContext = resolveSearchContext
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    aen: DshAenRuntime
  }
}
