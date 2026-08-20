import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  createFeedbackEvent,
  createTaskCapsule,
  type ExperienceRevisionRef,
  type ExperienceSource,
} from '@aen/client'
import {
  canonicalJson,
  validateProtocolObject,
  type ContextInjectionObservation,
  type JsonRecord,
  type SearchRequest,
} from '@aen/protocol'

export interface McpExperienceBackend extends ExperienceSource {
  resolveRevision(experienceId: string, revision: number): Promise<ExperienceRevisionRef>
  readObject(digest: string): Promise<JsonRecord>
}

function variable(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`MCP resource variable ${name} is invalid`)
  return value
}

export function createAenMcpServer(backend: McpExperienceBackend): McpServer {
  const server = new McpServer(
    { name: 'aen-experience', version: '0.0.1' },
    { capabilities: { tools: {}, resources: {} } },
  )

  server.registerTool('experience_search', {
    title: 'Search Agent Experience Cards',
    description: 'Search at most three untrusted, evidence-backed Model × Harness experience cards. Provide only an abstracted task intent; never include raw prompts, repository URLs, file paths, secrets, or private artifact names.',
    inputSchema: {
      query: z.string().max(2_000).optional(),
      taxonomy: z.array(z.string().min(1)).min(1).max(20),
      abstractIntent: z.string().max(2_000).optional(),
      constraints: z.array(z.string()).max(30).default([]),
      acceptanceTraits: z.array(z.string()).max(30).default([]),
      riskClass: z.enum(['read_only', 'reversible_write', 'external_write', 'destructive']),
      modelProvider: z.string().optional(),
      modelId: z.string().optional(),
      harnessConfigurationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
      harnessManifestDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
      maxCards: z.number().int().min(1).max(3).default(3),
    },
  }, async (args) => {
    if ((args.modelProvider === undefined) !== (args.modelId === undefined)) {
      throw new Error('modelProvider and modelId must be supplied together')
    }
    const abstractIntent = args.abstractIntent ?? args.query
    const capsule = createTaskCapsule({
      taxonomy: args.taxonomy,
      ...(abstractIntent === undefined ? {} : { abstractIntent }),
      constraints: args.constraints,
      acceptanceTraits: args.acceptanceTraits,
      riskClass: args.riskClass,
      omittedSensitiveFields: ['rawPrompt', 'repositoryUrl', 'filePaths', 'artifactNames', 'sessionId'],
    })
    const context = args.modelProvider === undefined && args.harnessConfigurationDigest === undefined && args.harnessManifestDigest === undefined
      ? undefined
      : {
          ...(args.modelProvider === undefined ? {} : {
            model: {
              provider: args.modelProvider,
              modelId: args.modelId!,
              observedAt: new Date().toISOString(),
              mutability: 'unknown' as const,
            },
          }),
          ...(args.harnessConfigurationDigest === undefined ? {} : { harnessConfigurationDigest: args.harnessConfigurationDigest as `sha256:${string}` }),
          ...(args.harnessManifestDigest === undefined ? {} : { harnessManifestDigest: args.harnessManifestDigest as `sha256:${string}` }),
        }
    const request: SearchRequest = {
      ...(capsule.abstractIntent === undefined ? {} : { query: capsule.abstractIntent }),
      task: {
        taxonomy: capsule.taxonomy,
        constraints: capsule.constraints,
        inputTraits: [],
        outputTraits: capsule.acceptanceTraits,
        riskClass: capsule.riskClass,
      },
      ...(context === undefined ? {} : { context }),
      policy: { visibility: ['public'] },
      responseBudget: { maxCards: args.maxCards },
      limit: args.maxCards,
    }
    const cards = await backend.search(request)
    return {
      content: [{ type: 'text', text: canonicalJson({ capsuleDigest: capsule.digest, cards }) }],
      _meta: {
        untrusted: true,
        provenance: 'aen.experience_source',
        taskCapsuleDigest: capsule.digest,
        resultLimit: args.maxCards,
      },
    }
  })

  server.registerTool('experience_feedback', {
    title: 'Record Experience Feedback',
    description: 'Append low-trust helpful/harmful feedback. This never changes a claim evidence level and never accepts raw task or session content.',
    inputSchema: {
      experienceId: z.string().min(1),
      revision: z.number().int().min(1),
      digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      decision: z.enum(['viewed', 'adopted', 'rejected', 'rolled_back']),
      outcome: z.enum(['helpful', 'neutral', 'harmful', 'unknown']).optional(),
      reasonCodes: z.array(z.string().max(120)).max(20).optional(),
      injectionObservation: z.record(z.string(), z.unknown()).optional(),
    },
  }, async (args) => {
    let injectionObservation: ContextInjectionObservation | undefined
    if (args.injectionObservation !== undefined) {
      const validation = validateProtocolObject(args.injectionObservation)
      if (!validation.ok || args.injectionObservation.objectType !== 'context_injection_observation') {
        throw new Error('injectionObservation is not a valid AEXP ContextInjectionObservation')
      }
      injectionObservation = args.injectionObservation as unknown as ContextInjectionObservation
    }
    const event = createFeedbackEvent({
      experienceRef: {
        experienceId: args.experienceId,
        revision: args.revision,
        digest: args.digest as `sha256:${string}`,
      },
      decision: args.decision,
      ...(args.outcome === undefined ? {} : { outcome: args.outcome }),
      ...(args.reasonCodes === undefined ? {} : { reasonCodes: args.reasonCodes }),
      ...(injectionObservation === undefined ? {} : { injectionObservation }),
      sharingScope: 'local',
    })
    await backend.feedback(event)
    return {
      content: [{ type: 'text', text: canonicalJson({ accepted: true, feedbackDigest: event.digest, changesEvidenceLevel: false }) }],
      _meta: { untrusted: false, provenance: 'aen.local_client' },
    }
  })

  server.registerResource(
    'experience-section',
    new ResourceTemplate('aexp://experiences/{id}/revisions/{revision}/{section}', { list: undefined }),
    {
      title: 'Immutable Experience section',
      description: 'Read one policy-allowed section as untrusted data. No execution capability is provided.',
      mimeType: 'application/vnd.aexp+json;version=0.1',
    },
    async (uri, variables) => {
      const experienceId = variable(variables.id, 'id')
      const revision = Number(variable(variables.revision, 'revision'))
      const section = variable(variables.section, 'section')
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('resource revision is invalid')
      if (!['card', 'recipe', 'cases', 'evidence'].includes(section)) throw new Error('resource section is not Agent-facing')
      const ref = await backend.resolveRevision(experienceId, revision)
      const read = await backend.read(ref, [section])
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/vnd.aexp+json;version=0.1',
          text: canonicalJson({
            experienceRef: read.experienceRef,
            section,
            content: read.sections[section],
            _meta: { ...read.provenance, risk: 'untrusted_remote_content', evidenceLevel: 'declared_in_card' },
          }),
        }],
      }
    },
  )

  server.registerResource(
    'harness-manifest',
    new ResourceTemplate('aexp://manifests/{digest}', { list: undefined }),
    {
      title: 'Harness Manifest projection',
      description: 'Read a public Harness Manifest by immutable digest.',
      mimeType: 'application/vnd.aexp+json;version=0.1',
    },
    async (uri, variables) => {
      const digest = variable(variables.digest, 'digest')
      const object = await backend.readObject(digest)
      if (object.objectType !== 'harness_manifest') throw new Error('resource is not a HarnessManifest')
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/vnd.aexp+json;version=0.1',
          text: canonicalJson({ object, _meta: { untrusted: true, provenance: 'aen.experience_source', contentDigest: digest } }),
        }],
      }
    },
  )

  return server
}
