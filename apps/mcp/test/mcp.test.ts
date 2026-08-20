import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExperienceCard, FeedbackEvent, JsonRecord, SearchRequest } from '@aen/protocol'
import type { ExperienceSectionRead } from '@aen/client'
import { createAenMcpServer, type McpExperienceBackend } from '../src/server.js'

const digest = `sha256:${'1'.repeat(64)}` as const
const cards: ExperienceCard[] = [{
  experienceId: 'urn:aen:experience:test',
  revision: 2,
  digest,
  title: 'Recover a failed tool call',
  summary: 'Observed recovery in an exact Model × Harness cell.',
  intendedUseSummary: ['human-reviewed recovery'],
  outOfScopeSummary: ['automatic destructive retry'],
  knownFailureSummary: ['unchanged retry'],
  taskFamilies: ['software-engineering', 'failure-recovery'],
  compatibility: 'exact',
  maxEvidenceLevel: 'H1',
  positiveCaseSummary: 'recovered',
  negativeCaseSummary: 'initial failure',
  safetyLabels: ['no-automatic-execution'],
  sourceSummary: 'signed public publisher',
  availableSections: ['card', 'recipe', 'cases', 'evidence'],
  estimatedSectionTokens: { card: 100, recipe: 200, cases: 100, evidence: 100 },
  scoreExplanation: ['exact Model × Harness match'],
}]

const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

async function connected(): Promise<{ client: Client; searches: SearchRequest[]; feedback: FeedbackEvent[] }> {
  const searches: SearchRequest[] = []
  const feedback: FeedbackEvent[] = []
  const backend: McpExperienceBackend = {
    search: async (request) => { searches.push(request); return cards },
    read: async (ref, sections): Promise<ExperienceSectionRead> => ({
      experienceRef: ref,
      sections: Object.fromEntries(sections.map((section) => [section, { section, untrusted: true }])) as JsonRecord,
      provenance: { source: 'public_hub', untrusted: true, contentDigest: digest },
    }),
    feedback: async (event) => { feedback.push(event) },
    resolveRevision: async (experienceId, revision) => ({ experienceId, revision, digest }),
    readObject: async () => ({ objectType: 'harness_manifest', digest }),
  }
  const server = createAenMcpServer(backend)
  const client = new Client({ name: 'aen-test-client', version: '0.0.1' })
  clients.push(client)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, searches, feedback }
}

describe('AEN MCP surface budget', () => {
  it('exposes exactly search/feedback tools and resource reads, with no execute or fetch tool', async () => {
    const { client, searches } = await connected()
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual(['experience_search', 'experience_feedback'])
    expect(tools.tools.map((tool) => tool.name)).not.toContain('experience_execute')
    expect(tools.tools.map((tool) => tool.name)).not.toContain('experience_fetch')
    const resources = await client.listResourceTemplates()
    expect(resources.resourceTemplates.map((resource) => resource.uriTemplate)).toContain(
      'aexp://experiences/{id}/revisions/{revision}/{section}',
    )

    const result = await client.callTool({
      name: 'experience_search',
      arguments: {
        taxonomy: ['software-engineering', 'failure-recovery'],
        abstractIntent: 'Recover a failed operation.',
        constraints: ['no destructive retry'],
        acceptanceTraits: ['verified output'],
        riskClass: 'reversible_write',
        modelProvider: 'deepseek',
        modelId: 'deepseek-reasoner',
        harnessManifestDigest: `sha256:${'2'.repeat(64)}`,
        maxCards: 3,
      },
    })
    expect(result.isError).not.toBe(true)
    expect(searches).toHaveLength(1)
    expect(searches[0]?.responseBudget?.maxCards).toBe(3)
    expect(JSON.stringify(result)).toContain('untrusted')

    const resource = await client.readResource({
      uri: 'aexp://experiences/urn%3Aaen%3Aexperience%3Atest/revisions/2/cases',
    })
    expect(resource.contents[0]?.text).toContain('"untrusted":true')
  })

  it('refuses adopted feedback without a recorded ContextInjectionObservation', async () => {
    const { client, feedback } = await connected()
    const result = await client.callTool({
      name: 'experience_feedback',
      arguments: {
        experienceId: 'urn:aen:experience:test',
        revision: 2,
        digest,
        decision: 'adopted',
        outcome: 'helpful',
      },
    })
    expect(result.isError).toBe(true)
    expect(feedback).toEqual([])
  })
})
