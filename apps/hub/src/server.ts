import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  validateApiPayload,
  type ExperienceCard,
  type ExperienceRevision,
  type JsonRecord,
  type Revocation,
  type SearchRequest,
} from '@aen/protocol'
import type {
  AuthorizedPublisherKey,
  HubTombstone,
  HubSearchQuery,
  PostgresHubProjection,
} from '@aen/hub'
import { assertAuthorizedRevocation } from '@aen/hub'
import { APP_JS, INDEX_HTML, STYLES_CSS } from './web.js'

export interface HubServerOptions {
  adminToken?: string
  maxBodyBytes?: number
  authorizedKeys?: readonly AuthorizedPublisherKey[]
}

function headers(response: ServerResponse, contentType: string): void {
  response.setHeader('content-type', contentType)
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('x-frame-options', 'DENY')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  response.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  headers(response, 'application/json; charset=utf-8')
  response.statusCode = status
  response.end(`${JSON.stringify(value)}\n`)
}

function sendText(response: ServerResponse, status: number, contentType: string, value: string): void {
  headers(response, contentType)
  response.statusCode = status
  response.end(value)
}

async function body(request: IncomingMessage, maxBytes: number): Promise<JsonRecord> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`)
    chunks.push(bytes)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('request body must be a JSON object')
  return value as JsonRecord
}

function adminAllowed(request: IncomingMessage, options: HubServerOptions): boolean {
  return options.adminToken !== undefined && request.headers.authorization === `Bearer ${options.adminToken}`
}

function pathParts(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
}

function isTombstone(value: JsonRecord | HubTombstone | undefined): value is HubTombstone {
  return value !== undefined && value.tombstone === true
}

function maxEvidence(experience: ExperienceRevision): ExperienceCard['maxEvidenceLevel'] {
  const order: Record<string, number> = { H0: 0, H1: 1, H2: 2, H3: 3, H4: 4 }
  return experience.claims.map((claim) => claim.evidenceLevel)
    .sort((left, right) => (order[right] ?? -1) - (order[left] ?? -1))[0] ?? 'H0'
}

function card(experience: ExperienceRevision): ExperienceCard {
  const sections = ['card', 'claims', 'applicability', 'task', 'governance']
  if (experience.recipe !== undefined) sections.push('recipe')
  if (experience.cases !== undefined) sections.push('cases')
  if (experience.evidenceRefs.length > 0) sections.push('evidence')
  return {
    experienceId: experience.experienceId,
    revision: experience.revision,
    digest: experience.digest,
    title: experience.title,
    summary: experience.summary,
    intendedUseSummary: experience.intendedUses,
    outOfScopeSummary: experience.outOfScopeUses,
    knownFailureSummary: experience.knownFailureModes,
    taskFamilies: experience.applicability.taskFamilies,
    compatibility: 'unknown',
    maxEvidenceLevel: maxEvidence(experience),
    ...(experience.metricSummary === undefined ? {} : { metricSummary: experience.metricSummary }),
    ...(experience.cases?.[0] === undefined ? {} : {
      positiveCaseSummary: experience.cases[0].positive.outcomeSummary,
      negativeCaseSummary: experience.cases[0].negative.outcomeSummary,
    }),
    safetyLabels: experience.governance.safetyLabels,
    sourceSummary: `${experience.publisher.actorId}; ${experience.governance.license ?? 'no-license'}`,
    availableSections: sections,
    estimatedSectionTokens: Object.fromEntries(sections.map((section) => [section, Math.ceil(JSON.stringify(
      section === 'card' ? { title: experience.title, summary: experience.summary } :
        section === 'evidence' ? experience.evidenceRefs : (experience as unknown as JsonRecord)[section],
    ).length / 4)])),
    scoreExplanation: ['Immutable public revision read; compatibility must be evaluated against the consumer context.'],
  }
}

function projectSections(experience: ExperienceRevision, include: string[]): JsonRecord {
  const allowed = new Set(['card', 'claims', 'applicability', 'recipe', 'cases', 'evidence', 'task', 'governance'])
  const sections: JsonRecord = {}
  for (const section of include) {
    if (!allowed.has(section)) throw new Error(`unsupported Experience section: ${section}`)
    if (section === 'card') sections.card = card(experience)
    else if (section === 'evidence') sections.evidence = experience.evidenceRefs
    else {
      const value = (experience as unknown as JsonRecord)[section]
      if (value !== undefined) sections[section] = value
    }
  }
  return sections
}

export function createHubServer(
  projection: PostgresHubProjection,
  options: HubServerOptions = {},
): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://hub.local')
      const parts = pathParts(url.pathname)
      if (request.method === 'GET' && url.pathname === '/') {
        sendText(response, 200, 'text/html; charset=utf-8', INDEX_HTML)
      } else if (request.method === 'GET' && url.pathname === '/styles.css') {
        sendText(response, 200, 'text/css; charset=utf-8', STYLES_CSS)
      } else if (request.method === 'GET' && url.pathname === '/app.js') {
        sendText(response, 200, 'text/javascript; charset=utf-8', APP_JS)
      } else if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          service: 'aen-reference-hub',
          version: '0.0.1',
          protocol: 'AEXP 0.1 Draft',
          profile: 'aen-mvp/0.1',
          projection: await projection.status(),
        })
      } else if (request.method === 'GET' && url.pathname === '/v1/experiences') {
        const query: HubSearchQuery = {
          ...(url.searchParams.get('q') === null ? {} : { query: url.searchParams.get('q')! }),
          ...(url.searchParams.get('modelProvider') === null ? {} : { modelProvider: url.searchParams.get('modelProvider')! }),
          ...(url.searchParams.get('modelId') === null ? {} : { modelId: url.searchParams.get('modelId')! }),
          ...(url.searchParams.get('harnessConfigurationDigest') === null ? {} : { harnessConfigurationDigest: url.searchParams.get('harnessConfigurationDigest')! }),
          ...(url.searchParams.get('harnessManifestDigest') === null ? {} : { harnessManifestDigest: url.searchParams.get('harnessManifestDigest')! }),
          ...(url.searchParams.get('taskFamily') === null ? {} : { taskFamilies: url.searchParams.getAll('taskFamily') }),
          ...(url.searchParams.get('license') === null ? {} : { allowedLicenses: url.searchParams.getAll('license') }),
          ...(url.searchParams.get('minEvidenceLevel') === null ? {} : { minEvidenceLevel: url.searchParams.get('minEvidenceLevel') as NonNullable<HubSearchQuery['minEvidenceLevel']> }),
          ...(url.searchParams.get('maxRiskClass') === null ? {} : { maxRiskClass: url.searchParams.get('maxRiskClass') as NonNullable<HubSearchQuery['maxRiskClass']> }),
          ...(url.searchParams.get('maxMeanCostUsd') === null ? {} : { maxMeanCostUsd: Number(url.searchParams.get('maxMeanCostUsd')) }),
          ...(url.searchParams.get('maxP95LatencyMs') === null ? {} : { maxP95LatencyMs: Number(url.searchParams.get('maxP95LatencyMs')) }),
          limit: Number(url.searchParams.get('limit') ?? 3),
        }
        sendJson(response, 200, { cards: await projection.search(query) })
      } else if (request.method === 'POST' && url.pathname === '/v1/search') {
        const value = await body(request, options.maxBodyBytes ?? 1_048_576)
        const validation = validateApiPayload('search_request', value)
        if (!validation.ok) throw new Error(`invalid SearchRequest: ${validation.issues.map((issue) => issue.message).join('; ')}`)
        const search = value as unknown as SearchRequest
        const cards = await projection.search({
          ...(search.query === undefined ? {} : { query: search.query }),
          ...(search.task?.taxonomy === undefined ? {} : { taskFamilies: search.task.taxonomy }),
          ...(search.context?.model?.provider === undefined ? {} : { modelProvider: search.context.model.provider }),
          ...(search.context?.model?.modelId === undefined ? {} : { modelId: search.context.model.modelId }),
          ...(search.context?.model?.mutability === undefined ? {} : { modelMutability: search.context.model.mutability }),
          ...(search.context?.harnessConfigurationDigest === undefined ? {} : { harnessConfigurationDigest: search.context.harnessConfigurationDigest }),
          ...(search.context?.harnessManifestDigest === undefined ? {} : { harnessManifestDigest: search.context.harnessManifestDigest }),
          ...(search.policy?.allowedLicenses === undefined ? {} : { allowedLicenses: search.policy.allowedLicenses }),
          ...(search.policy?.minEvidenceLevel === undefined ? {} : {
            minEvidenceLevel: search.policy.minEvidenceLevel as NonNullable<HubSearchQuery['minEvidenceLevel']>,
          }),
          ...(search.policy?.maxRiskClass === undefined ? {} : {
            maxRiskClass: search.policy.maxRiskClass as NonNullable<HubSearchQuery['maxRiskClass']>,
          }),
          ...(search.policy?.maxMeanCostUsd === undefined ? {} : { maxMeanCostUsd: search.policy.maxMeanCostUsd }),
          ...(search.policy?.maxP95LatencyMs === undefined ? {} : { maxP95LatencyMs: search.policy.maxP95LatencyMs }),
          limit: Math.min(search.responseBudget?.maxCards ?? search.limit ?? 3, 3),
        })
        sendJson(response, 200, { cards })
      } else if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'experiences' && parts.length === 3) {
        const value = await projection.getExperience(parts[2]!)
        if (value === undefined) sendJson(response, 404, { error: 'experience not found' })
        else if (isTombstone(value)) sendJson(response, 410, value)
        else {
          const include = (url.searchParams.get('include') ?? '').split(',').filter(Boolean)
          sendJson(response, 200, include.length === 0 ? value : {
            experienceRef: {
              experienceId: String(value.experienceId),
              revision: Number(value.revision),
              digest: String(value.digest),
            },
            sections: projectSections(value as unknown as ExperienceRevision, include),
            _meta: { untrusted: true, provenance: 'public_hub', contentDigest: value.digest },
          })
        }
      } else if (
        request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'experiences' &&
        parts[3] === 'revisions' && parts.length === 4
      ) {
        sendJson(response, 200, { revisions: await projection.listExperienceRevisions(parts[2]!) })
      } else if (
        request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'experiences' &&
        parts[3] === 'revisions' && parts.length === 5
      ) {
        const revision = Number(parts[4])
        const digest = url.searchParams.get('digest')
        if (!Number.isSafeInteger(revision) || revision < 1) sendJson(response, 400, { error: 'revision must be positive' })
        else {
          const value = digest === null
            ? await projection.resolveExperienceRevision(parts[2]!, revision)
            : await projection.getExperienceRevision(parts[2]!, revision, digest)
          if (value === undefined) sendJson(response, 404, { error: 'revision not found' })
          else if (isTombstone(value)) sendJson(response, 410, value)
          else {
            const include = (url.searchParams.get('include') ?? '').split(',').filter(Boolean)
            sendJson(response, 200, include.length === 0 ? value : {
              experienceRef: {
                experienceId: String(value.experienceId), revision: Number(value.revision), digest: String(value.digest),
              },
              sections: projectSections(value as unknown as ExperienceRevision, include),
              _meta: { untrusted: true, provenance: 'public_hub', contentDigest: value.digest },
            })
          }
        }
      } else if (
        request.method === 'GET' && parts[0] === 'v1' &&
        (parts[1] === 'manifests' || parts[1] === 'artifacts') && parts.length === 3
      ) {
        const value = await projection.getObject(parts[2]!)
        const expected = parts[1] === 'manifests' ? 'harness_manifest' : 'artifact'
        if (value === undefined || (!isTombstone(value) && value.objectType !== expected)) {
          sendJson(response, 404, { error: `${expected} not found` })
        } else sendJson(response, isTombstone(value) ? 410 : 200, value)
      } else if (
        request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'contentions' && parts.length === 3
      ) {
        sendJson(response, 200, { contentions: await projection.listContentions(parts[2]!) })
      } else if (request.method === 'GET' && url.pathname === '/v1/experience') {
        const id = url.searchParams.get('id')
        if (id === null) sendJson(response, 400, { error: 'id is required' })
        else {
          const value = await projection.getExperience(id)
          sendJson(response, value === undefined ? 404 : 200, value ?? { error: 'experience not found' })
        }
      } else if (request.method === 'GET' && url.pathname.startsWith('/v1/objects/')) {
        const digest = decodeURIComponent(url.pathname.slice('/v1/objects/'.length))
        const value = await projection.getObject(digest)
        sendJson(response, value === undefined ? 404 : 200, value ?? { error: 'object not found' })
      } else if (request.method === 'GET' && url.pathname === '/v1/sections') {
        const id = url.searchParams.get('id')
        const revision = Number(url.searchParams.get('revision'))
        const digest = url.searchParams.get('digest')
        const include = (url.searchParams.get('include') ?? 'card').split(',').filter(Boolean)
        if (id === null || digest === null || !Number.isSafeInteger(revision) || revision < 1) {
          sendJson(response, 400, { error: 'id, positive revision, and digest are required' })
        } else {
          const value = await projection.getExperienceRevision(id, revision, digest)
          if (value === undefined || 'tombstone' in value) sendJson(response, value === undefined ? 404 : 410, value ?? { error: 'revision not found' })
          else {
            const experience = value as unknown as ExperienceRevision
            sendJson(response, 200, {
              experienceRef: { experienceId: experience.experienceId, revision: experience.revision, digest: experience.digest },
              sections: projectSections(experience, include),
              _meta: { untrusted: true, provenance: 'public_hub', contentDigest: experience.digest },
            })
          }
        }
      } else if (request.method === 'GET' && url.pathname === '/v1/revision') {
        const id = url.searchParams.get('id')
        const revision = Number(url.searchParams.get('revision'))
        if (id === null || !Number.isSafeInteger(revision) || revision < 1) {
          sendJson(response, 400, { error: 'id and positive revision are required' })
        } else {
          const value = await projection.resolveExperienceRevision(id, revision)
          sendJson(response, value === undefined ? 404 : ('tombstone' in value ? 410 : 200), value ?? { error: 'revision not found' })
        }
      } else if (request.method === 'GET' && url.pathname === '/v1/export/objects') {
        sendJson(response, 200, { protocolVersion: '0.1', objects: await projection.exportObjects() })
      } else if (request.method === 'GET' && url.pathname === '/v1/contentions') {
        const id = url.searchParams.get('experienceId')
        if (id === null) sendJson(response, 400, { error: 'experienceId is required' })
        else sendJson(response, 200, { contentions: await projection.listContentions(id) })
      } else if (request.method === 'POST' && url.pathname === '/v1/feedback') {
        const value = await body(request, options.maxBodyBytes ?? 1_048_576)
        await projection.appendFeedback(value)
        sendJson(response, 202, { accepted: true, trust: 'low', changesEvidenceLevel: false })
      } else if (request.method === 'POST' && url.pathname === '/admin/emergency-block') {
        if (!adminAllowed(request, options)) {
          sendJson(response, 401, { error: 'admin authorization required' })
        } else {
          const value = await body(request, options.maxBodyBytes ?? 1_048_576)
          if (typeof value.digest !== 'string' || typeof value.reasonCode !== 'string') {
            sendJson(response, 400, { error: 'digest and reasonCode are required' })
          } else {
            await projection.emergencyBlock(value.digest, value.reasonCode)
            sendJson(response, 200, { blocked: true, digest: value.digest, reasonCode: value.reasonCode })
          }
        }
      } else if (request.method === 'POST' && url.pathname === '/admin/revocations') {
        if (!adminAllowed(request, options)) {
          sendJson(response, 401, { error: 'admin authorization required' })
        } else {
          const value = await body(request, options.maxBodyBytes ?? 1_048_576)
          assertAuthorizedRevocation(value as unknown as Revocation, options.authorizedKeys ?? [])
          await projection.applyRevocation(value as unknown as Revocation)
          sendJson(response, 200, { applied: true, digest: value.digest })
        }
      } else {
        sendJson(response, 404, { error: 'route not found' })
      }
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}
