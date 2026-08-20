import {
  canonicalJson,
  sha256,
  type ArtifactDescriptor,
  type Digest,
  type HarnessManifest,
  type JsonRecord,
  type JsonValue,
  type ManifestContext,
  type ModelFingerprint,
} from '@aen/protocol'
import { publishObject } from './object.js'
import type { DshLiveSkillSnapshot, DshLiveSnapshot } from './types.js'

const ADAPTER_NAME = '@aen/adapter-dsh'
const ADAPTER_VERSION = '0.1.0'

/**
 * Stable prompt-template identity for the Harness axis. Exact prompt bytes are
 * still committed separately in modelSurface.systemPromptDigest.
 */
export function dshConfigurationSystemPromptDigest(
  prompt: string,
  cwd: string | undefined,
  model: Pick<ModelFingerprint, 'provider' | 'modelId'>,
): Digest {
  let stable = prompt
  const replacements = [
    [cwd, '{AEN_WORKSPACE}'],
    [model.modelId, '{AEN_MODEL_ID}'],
    [model.provider, '{AEN_MODEL_PROVIDER}'],
  ] as const
  for (const [value, replacement] of replacements) {
    if (value !== undefined && value.length > 0) stable = stable.split(value).join(replacement)
  }
  return sha256(stable)
}

function stableArtifactId(kind: 'skill' | 'tool' | 'preset', name: string, identity?: JsonRecord): string {
  const suffix = sha256(canonicalJson({ kind, name, ...(identity ?? {}) })).slice(7, 31)
  return `urn:aen:artifact:dsh:${kind}:${suffix}`
}

function skillArtifact(skill: DshLiveSkillSnapshot): ArtifactDescriptor {
  const interfaceValue = {
    name: skill.name,
    description: skill.description,
    ...(skill.provider === undefined ? {} : { provider: skill.provider }),
    ...(skill.source === undefined ? {} : { source: skill.source }),
    ...(skill.resourceBaseKind === undefined ? {} : { resourceBaseKind: skill.resourceBaseKind }),
    ...(skill.invocation === undefined ? {} : { invocation: skill.invocation }),
  }
  const interfaceDigest = sha256(canonicalJson(interfaceValue))
  const contentDigest = skill.content === undefined ? undefined : sha256(skill.content)
  const resourceCommitments = (skill.resources ?? [])
    .map((resource) => ({ logicalName: resource.logicalName, digest: resource.digest }))
    .sort((left, right) => left.logicalName.localeCompare(right.logicalName))
  const dependencySetDigest =
    resourceCommitments.length === 0 ? undefined : sha256(canonicalJson(resourceCommitments))
  const treeDigest =
    skill.closure !== 'complete_package'
      ? undefined
      : sha256(
          canonicalJson({
            interfaceDigest,
            ...(contentDigest === undefined ? {} : { contentDigest }),
            resources: resourceCommitments,
          }),
        )
  return publishObject<ArtifactDescriptor>({
    protocolVersion: '0.1',
    objectType: 'artifact',
    artifactId: stableArtifactId('skill', skill.name, {
      ...(skill.provider === undefined ? {} : { provider: skill.provider }),
      ...(skill.source === undefined ? {} : { source: skill.source }),
    }),
    kind: 'skill',
    name: skill.name,
    ...(skill.provider === undefined ? {} : { provider: skill.provider }),
    formatProfile: 'agent_skills',
    snapshotCompleteness: skill.closure,
    interfaceDigest,
    ...(contentDigest === undefined ? {} : { contentDigest }),
    ...(treeDigest === undefined ? {} : { treeDigest }),
    ...(dependencySetDigest === undefined ? {} : { dependencySetDigest }),
    description: skill.description,
    ...(skill.invocation === undefined ? {} : { invocation: skill.invocation }),
    ...(skill.entrypoint === undefined ? {} : { entrypoint: skill.entrypoint }),
    source: { type: 'runtime' },
    ...(skill.licenseExpression === undefined ? {} : { licenseExpression: skill.licenseExpression }),
    redistributable: skill.redistributable,
    distribution: { transport: 'local_only' },
    ...(skill.resources === undefined
      ? {}
      : {
          resources: skill.resources.map((resource) => ({
            pathOrUriDigest: sha256(resource.logicalName),
            ...(resource.mediaType === undefined ? {} : { mediaType: resource.mediaType }),
            digest: resource.digest,
          })),
        }),
    disclosure: 'digest_only',
    extensions: {
      'https://aen.dev/extensions/dsh/live-closure': skill.closure,
      ...(skill.source === undefined
        ? {}
        : { 'https://aen.dev/extensions/dsh/skill-source': skill.source }),
      ...(skill.resourceBaseKind === undefined
        ? {}
        : { 'https://aen.dev/extensions/dsh/resource-base-kind': skill.resourceBaseKind }),
      'https://aen.dev/extensions/aen/source-strength': 'live_snapshot',
    },
  })
}

function toolName(schema: JsonValue, index: number): string {
  return schema !== null && typeof schema === 'object' && !Array.isArray(schema) && typeof schema.name === 'string'
    ? schema.name
    : `tool-${index}`
}

function toolArtifact(schema: JsonValue, index: number): ArtifactDescriptor {
  const name = toolName(schema, index)
  return publishObject<ArtifactDescriptor>({
    protocolVersion: '0.1',
    objectType: 'artifact',
    artifactId: stableArtifactId('tool', name),
    kind: 'tool',
    name,
    formatProfile: 'native',
    snapshotCompleteness: 'interface_only',
    interfaceDigest: sha256(canonicalJson(schema)),
    source: { type: 'runtime' },
    redistributable: false,
    distribution: { transport: 'local_only' },
    disclosure: 'digest_only',
    extensions: {
      'https://aen.dev/extensions/dsh/live-state': 'effective_surface',
      'https://aen.dev/extensions/aen/source-strength': 'live_snapshot',
    },
  })
}

function presetArtifact(snapshot: DshLiveSnapshot): ArtifactDescriptor | undefined {
  if (snapshot.preset === undefined) return undefined
  return publishObject<ArtifactDescriptor>({
    protocolVersion: '0.1',
    objectType: 'artifact',
    artifactId: stableArtifactId('preset', snapshot.preset.id),
    kind: 'preset',
    name: snapshot.preset.id,
    formatProfile: 'native',
    snapshotCompleteness: 'content_only',
    contentDigest: sha256(canonicalJson(snapshot.preset.composition)),
    source: { type: 'runtime' },
    redistributable: false,
    distribution: { transport: 'local_only' },
    disclosure: 'digest_only',
    extensions: {
      'https://aen.dev/extensions/aen/source-strength': 'live_snapshot',
    },
  })
}

function artifactRef(artifact: ArtifactDescriptor): {
  objectType: 'artifact'
  refId: string
  digest: Digest
  kind: ArtifactDescriptor['kind']
} {
  return {
    objectType: 'artifact',
    refId: artifact.artifactId,
    digest: artifact.digest,
    kind: artifact.kind,
  }
}

function completePolicies(policies: DshLiveSnapshot['policies']): boolean {
  return [
    'sandbox',
    'approval',
    'filesystem',
    'network',
    'compaction',
    'retry',
    'subagents',
    'memory',
    'contextSelection',
    'toolTimeout',
  ].every((key) => policies[key as keyof typeof policies] !== undefined)
}

export interface DshLiveManifestResult {
  manifest: HarnessManifest
  artifacts: ArtifactDescriptor[]
}

export function buildLiveManifest(
  snapshot: DshLiveSnapshot,
  context: ManifestContext = {},
): DshLiveManifestResult {
  const skills = snapshot.skills.map(skillArtifact)
  const tools = snapshot.toolSchemas.map(toolArtifact)
  const preset = presetArtifact(snapshot)
  const artifacts = [...skills, ...tools, ...(preset === undefined ? [] : [preset])].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId),
  )
  const compositionDigest =
    snapshot.preset === undefined ? undefined : sha256(canonicalJson(snapshot.preset.composition))
  const requestConfigDigest = snapshot.model.requestConfig?.configDigest
  const skillCatalogDigest = sha256(
    canonicalJson(
      snapshot.skills
        .map(({ name, description, provider, invocation }) => ({
          name,
          description,
          ...(provider === undefined ? {} : { provider }),
          ...(invocation === undefined ? {} : { invocation }),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ),
  )
  const configIdentity = sha256(
    canonicalJson({
      harness: snapshot.harness,
      ...(compositionDigest === undefined ? {} : { preset: compositionDigest }),
      ...(snapshot.configurationSystemPromptDigest === undefined && snapshot.systemPrompt === undefined
        ? {}
        : { systemPrompt: snapshot.configurationSystemPromptDigest ?? sha256(snapshot.systemPrompt!) }),
      tools: snapshot.toolSchemas,
      skills: artifacts.filter((artifact) => artifact.kind === 'skill').map((artifact) => artifact.digest),
      policies: snapshot.policies,
    }),
  )
  const limitations = [...(snapshot.limitations ?? [])]
  if (!snapshot.skillRegistryComplete) {
    limitations.push('The live source did not claim a complete skill registry enumeration.')
  }
  for (const skill of snapshot.skills) {
    if (skill.closure !== 'complete_package') {
      limitations.push(`Skill ${skill.name} is ${skill.closure}; its complete package closure is not proven.`)
    }
    if (!skill.redistributable) {
      limitations.push(`Skill ${skill.name} is metadata-only because redistribution was not granted.`)
    }
  }
  const sessionDigest = context.sessionDigest ?? snapshot.sessionDigest
  const fromSeq = context.fromSeq ?? snapshot.sequenceRange?.fromSeq
  const toSeq = context.toSeq ?? snapshot.sequenceRange?.toSeq
  const manifest = publishObject<HarnessManifest>({
    protocolVersion: '0.1',
    objectType: 'harness_manifest',
    manifestId: `urn:aen:manifest:dsh:live:${configIdentity.slice(7, 31)}:${Date.parse(snapshot.capturedAt)}`,
    configurationDigest: configIdentity,
    capturedAt: snapshot.capturedAt,
    adapter: { name: ADAPTER_NAME, version: ADAPTER_VERSION },
    harness: {
      name: 'DeepSeek Harness',
      version: snapshot.harness.version,
      ...(snapshot.harness.commit === undefined ? {} : { commit: snapshot.harness.commit }),
      ...(snapshot.harness.distribution === undefined
        ? {}
        : { distribution: snapshot.harness.distribution }),
    },
    sessionScope: {
      ...(sessionDigest === undefined ? {} : { sessionDigest }),
      ...(fromSeq === undefined ? {} : { fromSeq }),
      ...(toSeq === undefined ? {} : { toSeq }),
    },
    ...(snapshot.preset === undefined
      ? {}
      : {
          preset: {
            id: snapshot.preset.id,
            ...(compositionDigest === undefined ? {} : { compositionDigest }),
            ...(snapshot.preset.trust === undefined ? {} : { trust: snapshot.preset.trust }),
          },
        }),
    modelSurface: {
      ...(snapshot.systemPrompt === undefined
        ? {}
        : { systemPromptDigest: sha256(snapshot.systemPrompt) }),
      toolSchemaSetDigest: sha256(canonicalJson(snapshot.toolSchemas)),
      skillCatalogDigest,
      ...(requestConfigDigest === undefined ? {} : { requestConfigDigest }),
    },
    artifacts: artifacts.map(artifactRef),
    policies: snapshot.policies,
    environment: snapshot.environment,
    coverage: {
      mode: 'live_snapshot',
      models: 'complete',
      tools: 'complete',
      skills: snapshot.skills.length === 0
        ? 'none'
        : snapshot.skillRegistryComplete && snapshot.skills.every((skill) => skill.closure === 'complete_package')
          ? 'complete'
          : 'catalog_only',
      preset: snapshot.preset === undefined ? 'none' : 'complete',
      policies: completePolicies(snapshot.policies)
        ? 'complete'
        : Object.keys(snapshot.policies).length === 0
          ? 'none'
          : 'partial',
      effectiveSurface: 'complete',
      limitations,
    },
    extensions: {
      ...(snapshot.sessionCorrelationDigest === undefined
        ? {}
        : { 'https://aen.dev/extensions/dsh/session-correlation-digest': snapshot.sessionCorrelationDigest }),
    },
  })
  return { manifest, artifacts }
}
