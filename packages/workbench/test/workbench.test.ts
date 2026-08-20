import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildLiveManifest,
  DeepSeekHarnessAdapter,
  type DshImportResult,
  type DshLiveSnapshot,
} from '@aen/adapter-dsh'
import { LocalEvidenceStore } from '@aen/local-store'
import { validateProtocolObject, type JsonRecord } from '@aen/protocol'
import {
  buildReviewPacket,
  createEditTemplate,
  distillEpisode,
  fetchExperienceSections,
  importEditedRevision,
  reviewExperience,
  searchLocalExperiences,
} from '../src/index.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tempStore(): LocalEvidenceStore {
  const directory = mkdtempSync(join(tmpdir(), 'aen-workbench-'))
  directories.push(directory)
  return new LocalEvidenceStore(join(directory, 'evidence.sqlite'))
}

async function importFixture(store: LocalEvidenceStore, name: string): Promise<DshImportResult> {
  const localPath = fileURLToPath(new URL(`../../../fixtures/dsh/${name}`, import.meta.url))
  const adapter = new DeepSeekHarnessAdapter()
  const result = await adapter.importEvidence({
    mediaType: 'application/x-ndjson',
    sourceName: name,
    schemaNamespace: 'https://github.com/deepseek-ai/DeepSeek-Harness/session-log',
    schemaVersion: '0',
    exporterVersion: '0.1.0-rc.7',
    localPath,
  })
  store.putBatch({
    session: {
      sessionDigest: result.sessionDigest,
      sourceName: name,
      importedAt: '2026-08-20T00:00:00Z',
      rawInputDigest: result.rawInputDigest,
      ...(result.localLocator === undefined ? {} : { localLocator: result.localLocator }),
    },
    objects: [
      { object: result.manifest as unknown as JsonRecord, role: 'manifest' },
      ...result.artifacts.map((object) => ({ object: object as unknown as JsonRecord, role: 'artifact' })),
      ...result.episodes.flatMap((chain) => [
        { object: chain.gapReport as unknown as JsonRecord, role: 'gap' },
        { object: chain.episode as unknown as JsonRecord, role: 'episode' },
        { object: chain.traceEvidence as unknown as JsonRecord, role: 'trace' },
        { object: chain.observation as unknown as JsonRecord, role: 'observation' },
      ]),
    ],
  })
  return result
}

describe('offline private Experience loop', () => {
  it('distills a conservative H1 draft, reviews it, searches it, and fetches sections', async () => {
    const store = tempStore()
    const imported = await importFixture(store, 'failure-recovery-skills.session.jsonl')
    const source = imported.episodes[0]
    expect(source).toBeDefined()
    if (source === undefined) return

    const distilled = distillEpisode(store, source.episode.episodeId)
    expect(validateProtocolObject(distilled.experience)).toMatchObject({ ok: true, issues: [] })
    expect(distilled.experience.kind).toBe('failure_recovery')
    expect(distilled.experience.claims[0]).toMatchObject({
      mode: 'observational',
      evidenceLevel: 'H1',
      contradictingEvidenceRefs: [],
    })
    expect(distilled.experience.claims[0]?.supportingEvidenceRefs).toHaveLength(2)
    expect(distilled.experience.cases).toHaveLength(1)
    expect(distilled.experience.recipe?.steps).toHaveLength(4)
    expect(imported.localLocator).toBeDefined()
    if (imported.localLocator !== undefined) {
      expect(JSON.stringify(distilled.experience)).not.toContain(imported.localLocator)
    }

    const packet = buildReviewPacket(store, distilled.experience.digest)
    expect(packet.configuration.manifest.coverage.mode).toBe('trace_only')
    expect(packet.evidenceGap.maximumEvidenceLevel).toBe('H1')
    expect(packet.redaction.hiddenOrRemoved).toContain('remove-tool-arguments')
    expect(packet.publication.targetGenerated).toBe(false)

    const review = reviewExperience(
      store,
      distilled.experience.digest,
      'keep-private',
      'urn:aen:actor:reviewer',
      'Useful locally; comparative evidence is still missing.',
    )
    expect(review.state).toBe('approved_private')
    expect(store.listExperienceReviewEvents(distilled.experience.digest)).toHaveLength(2)

    const search = searchLocalExperiences(store, {
      query: 'failed bash',
      context: {
        model: source.observation.configurationCell.model,
        harnessConfigurationDigest: imported.manifest.configurationDigest,
        harnessManifestDigest: `sha256:${'9'.repeat(64)}`,
      },
      responseBudget: { maxCards: 3 },
    })
    expect(search.cards).toHaveLength(1)
    expect(search.cards[0]).toMatchObject({ compatibility: 'exact', maxEvidenceLevel: 'H1' })

    const incompatible = searchLocalExperiences(store, {
      query: 'failed bash',
      context: {
        model: { ...source.observation.configurationCell.model, modelId: 'different-model' },
        harnessConfigurationDigest: imported.manifest.configurationDigest,
        harnessManifestDigest: `sha256:${'9'.repeat(64)}`,
      },
    })
    expect(incompatible.cards).toEqual([])

    const fetched = fetchExperienceSections(store, distilled.experience.experienceId, [
      'recipe',
      'cases',
      'evidence',
    ])
    expect(fetched.experienceRef.digest).toBe(distilled.experience.digest)
    expect(fetched.sections).toHaveProperty('recipe')
    expect(fetched.sections).toHaveProperty('cases')
    expect(fetched.sections).toHaveProperty('evidence')

    store.close()
  })

  it('imports an edit as a new immutable private revision', async () => {
    const store = tempStore()
    const imported = await importFixture(store, 'failure-recovery-skills.session.jsonl')
    const source = imported.episodes[0]
    expect(source).toBeDefined()
    if (source === undefined) return
    const first = distillEpisode(store, source.episode.episodeId).experience
    const template = createEditTemplate(store, first.digest, '2026-08-20T01:00:00Z')
    template.title = 'Human-edited recovery experience'
    const second = importEditedRevision(store, first.digest, template, 'urn:aen:actor:reviewer')
    expect(second.revision).toBe(2)
    expect(second.supersedes).toEqual({
      experienceId: first.experienceId,
      revision: 1,
      digest: first.digest,
    })
    expect(store.getByDigest(first.digest)?.title).toBe(first.title)
    expect(store.inspect(first.experienceId)?.summary.revision).toBe(2)
    const cards = searchLocalExperiences(store, { query: '' }).cards
    expect(cards).toHaveLength(1)
    expect(cards[0]?.revision).toBe(2)
    store.close()
  })

  it('correlates an exact pre-episode Live Manifest and raises only the configuration evidence to H2', async () => {
    const store = tempStore()
    const imported = await importFixture(store, 'failure-recovery-skills.session.jsonl')
    const source = imported.episodes[0]
    expect(source).toBeDefined()
    if (source === undefined) return
    const correlation = imported.manifest.extensions?.['https://aen.dev/extensions/dsh/session-correlation-digest']
    expect(correlation).toMatch(/^sha256:/)
    const snapshot: DshLiveSnapshot = {
      capturedAt: imported.manifest.capturedAt,
      harness: { version: '0.1.0-rc.7', distribution: 'DSH test plugin' },
      model: source.observation.configurationCell.model,
      sessionCorrelationDigest: correlation as `sha256:${string}`,
      sequenceRange: { toSeq: source.episode.eventRange.fromSeq - 1 },
      systemPrompt: 'You are a coding agent.',
      toolSchemas: [
        { name: 'skill', description: 'Load a skill', parameters: { type: 'object' } },
        { name: 'bash', description: 'Run a command', parameters: { type: 'object' } },
      ],
      skills: [
        {
          name: 'documents', description: 'Work with documents', provider: 'filesystem',
          source: 'project-dsh', content: 'Document workflow', entrypoint: 'SKILL.md',
          resources: [{ logicalName: 'references/format.md', digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
          closure: 'complete_package', redistributable: false,
        },
        {
          name: 'security-review', description: 'Review security', provider: 'filesystem',
          source: 'project-dsh', content: 'Security workflow', entrypoint: 'SKILL.md',
          resources: [], closure: 'complete_package', redistributable: false,
        },
      ],
      skillRegistryComplete: true,
      policies: {},
      environment: {
        capturedAt: imported.manifest.capturedAt,
        disclosure: 'metadata',
      },
    }
    const live = buildLiveManifest(snapshot)
    store.putBatch({
      objects: [
        ...live.artifacts.map((artifact) => ({ object: artifact as unknown as JsonRecord, role: 'live_artifact' })),
        { object: live.manifest as unknown as JsonRecord, role: 'live_manifest' },
      ],
    })

    const distilled = distillEpisode(store, source.episode.episodeId)
    expect(distilled.experience.claims[0]?.evidenceLevel).toBe('H2')
    expect(distilled.inputRefs.manifest.digest).toBe(live.manifest.digest)
    expect(distilled.experience.applicability.harnessSelectors).toContainEqual({
      path: 'harness.configurationDigest', operator: 'digestEquals', value: live.manifest.configurationDigest,
    })
    expect(distilled.experience.relations).toContainEqual(expect.objectContaining({
      type: 'derived_from', target: expect.objectContaining({ digest: live.manifest.digest }),
    }))
    expect(distilled.experience.knownLimitations.join(' ')).toContain('does not establish')
    const packet = buildReviewPacket(store, distilled.experience.digest)
    expect(packet.configuration.manifest.digest).toBe(live.manifest.digest)
    expect(packet.configuration.manifest.coverage.skills).toBe('complete')
    store.close()
  })

  it('does not manufacture a candidate from ordinary successful tool calls', async () => {
    const store = tempStore()
    const imported = await importFixture(store, 'ordinary-success.session.jsonl')
    expect(imported.episodes).toEqual([])
    expect(store.listEpisodes()).toEqual([])
    store.close()
  })
})
