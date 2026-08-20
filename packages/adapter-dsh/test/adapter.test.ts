import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  sha256,
  validateProtocolObject,
  type TraceInput,
} from '@aen/protocol'
import {
  analyzeDshTrace,
  buildEvaluationTrialEvidence,
  buildLiveManifest,
  buildTraceOnlyManifest,
  DeepSeekHarnessAdapter,
  loadDshTrace,
  normalizeDshTrace,
  type DshLiveSnapshot,
} from '../src/index.js'

const root = resolve(import.meta.dirname, '../../..')

async function fixture(name: string): Promise<Uint8Array> {
  return readFile(resolve(root, 'fixtures/dsh', name))
}

function input(name: string, bytes: Uint8Array, extra: Partial<TraceInput> = {}): TraceInput {
  return {
    mediaType: 'application/x-ndjson',
    sourceName: name,
    schemaNamespace: 'https://github.com/deepseek-ai/DeepSeek-Harness/session-log',
    schemaVersion: '0',
    bytes,
    ...extra,
  }
}

function baseLiveSnapshot(): DshLiveSnapshot {
  return {
    capturedAt: '2026-08-19T00:00:00.000Z',
    harness: { version: '0.1.0-rc.7', commit: 'abc123' },
    model: {
      provider: 'deepseek',
      modelId: 'deepseek-chat',
      observedAt: '2026-08-19T00:00:00.000Z',
      mutability: 'versioned',
    },
    preset: { id: 'coding', composition: { plugins: ['tools', 'skills'] }, trust: 'system' },
    systemPrompt: 'You are a coding agent.',
    toolSchemas: [{ name: 'bash', description: 'Run a command' }],
    skills: [
      {
        name: 'documents',
        description: 'Work with documents',
        provider: 'filesystem',
        invocation: { modelInvocable: true, userInvocable: true },
        content: 'Document instructions',
        closure: 'partial_snapshot',
        redistributable: false,
      },
    ],
    skillRegistryComplete: true,
    policies: { sandbox: { mode: 'workspace-write' }, approval: { mode: 'ask' } },
    environment: {
      os: { family: 'darwin', arch: 'arm64' },
      runtime: { node: '24.0.0' },
      capturedAt: '2026-08-19T00:00:00.000Z',
      disclosure: 'metadata',
    },
  }
}

describe('DSH session loader', () => {
  it('loads direct JSONL and ZIP exports with the same logical session digest', async () => {
    const bytes = await fixture('ordinary-success.session.jsonl')
    const direct = await loadDshTrace(input('ordinary-success.session.jsonl', bytes))
    const zip = zipSync({
      'session.jsonl': bytes,
      'subagents/ignored.jsonl': strToU8('not imported'),
    })
    const archived = await loadDshTrace(
      input('ordinary-success.zip', zip, { mediaType: 'application/zip' }),
    )
    expect(direct.sessionDigest).toBe(archived.sessionDigest)
    expect(direct.rawInputDigest).not.toBe(archived.rawInputDigest)
    expect(direct.events).toHaveLength(9)
  })

  it('expands packed chunk storage rows with explicit inferred provenance', async () => {
    const loaded = await loadDshTrace(
      input('packed-chunks.session.jsonl', await fixture('packed-chunks.session.jsonl')),
    )
    const normalized = normalizeDshTrace(loaded)
    expect(normalized.slice(1, 3).map((event) => event.seq)).toEqual([0, 1])
    expect(normalized[1]?.provenance).toMatchObject({
      inferred: true,
      inferenceRuleId: 'dsh.storage.chunk-row.v0',
    })
  })

  it('rejects unsupported versions, broken sequence continuity, and input digest mismatch', async () => {
    const valid = new TextDecoder().decode(await fixture('packed-chunks.session.jsonl'))
    await expect(
      loadDshTrace(input('bad-version.jsonl', new TextEncoder().encode(valid.replace('"version":0', '"version":1')))),
    ).rejects.toThrow('unsupported DSH session format version')
    await expect(
      loadDshTrace(input('bad-sequence.jsonl', new TextEncoder().encode(valid.replace('"seq":2', '"seq":3')))),
    ).rejects.toThrow('sequence is not contiguous')
    await expect(
      loadDshTrace(
        input('bad-digest.jsonl', new TextEncoder().encode(valid), {
          expectedDigest: sha256('different'),
        }),
      ),
    ).rejects.toThrow('digest mismatch')
  })
})

describe('trace-only Harness configuration identity', () => {
  it('excludes the Model axis and normalizes visible workspace/model-route prompt variables', async () => {
    const loaded = await loadDshTrace(input(
      'ordinary-success.session.jsonl',
      await fixture('ordinary-success.session.jsonl'),
    ))
    const events = normalizeDshTrace(loaded)
    const firstAnalysis = analyzeDshTrace(events)
    const firstPrompt = 'Workspace: /private/a\nProvider: deepseek\nModel: deepseek-chat\nSame policy.'
    firstAnalysis.effectiveHeader = {
      ...(firstAnalysis.effectiveHeader ?? {}),
      system: firstPrompt,
    }
    firstAnalysis.systemPromptDigest = sha256(firstPrompt)
    firstAnalysis.requestConfigDigest = sha256('first-request-config')
    const firstTrace = { ...loaded, header: { ...loaded.header, cwd: '/private/a' } }

    const secondAnalysis = structuredClone(firstAnalysis)
    const secondPrompt = 'Workspace: /private/b\nProvider: another-provider\nModel: another-model\nSame policy.'
    secondAnalysis.model = {
      ...secondAnalysis.model,
      provider: 'another-provider',
      modelId: 'another-model',
      observedAt: '2026-08-20T01:00:00.000Z',
    }
    secondAnalysis.environment = {
      ...secondAnalysis.environment,
      os: { family: 'linux', arch: 'x64' },
      runtime: { node: '26.0.0' },
      capturedAt: '2026-08-20T01:00:00.000Z',
    }
    secondAnalysis.effectiveHeader = {
      ...(secondAnalysis.effectiveHeader ?? {}),
      system: secondPrompt,
    }
    secondAnalysis.systemPromptDigest = sha256(secondPrompt)
    secondAnalysis.requestConfigDigest = sha256('second-request-config')
    const secondTrace = { ...loaded, header: { ...loaded.header, cwd: '/private/b' } }

    const first = buildTraceOnlyManifest(firstTrace, events, firstAnalysis)
    const second = buildTraceOnlyManifest(secondTrace, events, secondAnalysis)
    expect(first.configurationDigest).toBe(second.configurationDigest)
    expect(first.digest).not.toBe(second.digest)
    expect(first.modelSurface.systemPromptDigest).not.toBe(second.modelSurface.systemPromptDigest)
    expect(first.modelSurface.requestConfigDigest).not.toBe(second.modelSurface.requestConfigDigest)
  })
})

describe('DSH evidence import', () => {
  it('returns a reference-closed Episode/Gap pair through the standard Adapter interface', async () => {
    const adapter = new DeepSeekHarnessAdapter()
    const events = adapter.importTrace(
      input('failure-recovery-skills.session.jsonl', await fixture('failure-recovery-skills.session.jsonl')),
    )
    const pairs = []
    for await (const pair of adapter.deriveEpisodes(events)) pairs.push(pair)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.episode.evidenceGapReportRef.digest).toBe(pairs[0]?.gapReport.digest)
  })

  it('does not turn an ordinary successful tool call into an Episode', async () => {
    const adapter = new DeepSeekHarnessAdapter()
    const result = await adapter.importEvidence(
      input('ordinary-success.session.jsonl', await fixture('ordinary-success.session.jsonl')),
    )
    expect(result.episodes).toEqual([])
    expect(result.manifest.coverage.mode).toBe('trace_only')
    expect(result.manifest.coverage.tools).toBe('surface_only')
    expect(result.manifest.coverage.skills).toBe('none')
    expect(result.manifest.coverage.models).not.toBe('complete')
  })

  it('creates one metadata-only H2 episode for an explicitly scheduled evaluation trial', async () => {
    const imported = await new DeepSeekHarnessAdapter().importEvidence(
      input('ordinary-success.session.jsonl', await fixture('ordinary-success.session.jsonl')),
    )
    expect(imported.episodes).toEqual([])
    const result = buildEvaluationTrialEvidence({
      runId: 'urn:aen:evaluation-run:adapter-test',
      task: {
        taxonomy: ['software-engineering'],
        intent: 'Complete the preregistered fixture.',
        constraints: ['Use only the fixture.'],
        acceptance: [{ id: 'accepted', description: 'The fixture passes.', required: true }],
        riskClass: 'read_only',
      },
      outcome: 'success',
      imported,
      liveManifestDigest: imported.manifest.digest,
    })
    expect(result.gapReport.maximumEvidenceLevel).toBe('H2')
    expect(result.episode.boundaryReasons).toContain('high_value_trigger:explicit_evaluation_trial')
    expect(result.traceEvidence.commitments?.rawTraceDigest).toBe(imported.rawTraceDigest)
    expect(result.traceEvidence.disclosure).toBe('metadata')
    expect(canonicalJson(result.traceEvidence)).not.toContain('private command')
    for (const object of [result.gapReport, result.episode, result.traceEvidence]) {
      expect(validateProtocolObject(object)).toMatchObject({ ok: true, issues: [] })
    }
  })

  it('builds a relationally valid failure-to-recovery evidence chain without raw payloads', async () => {
    const adapter = new DeepSeekHarnessAdapter()
    const sourcePath = resolve(root, 'fixtures/dsh/failure-recovery-skills.session.jsonl')
    const result = await adapter.importEvidence({
      mediaType: 'application/x-ndjson',
      sourceName: 'failure-recovery-skills.session.jsonl',
      schemaNamespace: 'https://github.com/deepseek-ai/DeepSeek-Harness/session-log',
      localPath: sourcePath,
    })
    expect(result.episodes).toHaveLength(1)
    const chain = result.episodes[0]
    expect(chain).toBeDefined()
    if (chain === undefined) return
    for (const object of [
      result.manifest,
      ...result.artifacts,
      chain.gapReport,
      chain.episode,
      chain.traceEvidence,
      chain.observation,
    ]) {
      expect(validateProtocolObject(object)).toMatchObject({ ok: true, issues: [] })
    }
    expect(chain.gapReport.episodeId).toBe(chain.episode.episodeId)
    expect(chain.episode.evidenceGapReportRef.digest).toBe(chain.gapReport.digest)
    expect(chain.traceEvidence.episodeDigest).toBe(chain.episode.digest)
    expect(chain.observation.configurationCell.harnessManifestDigest).toBe(result.manifest.digest)
    expect(chain.gapReport.maximumEvidenceLevel).toBe('H1')
    expect(chain.traceEvidence.localLocator).toBe(sourcePath)
    const publicReadyProjection = canonicalJson({
      manifest: result.manifest,
      artifacts: result.artifacts,
      episode: chain.episode,
      observation: chain.observation,
    })
    expect(publicReadyProjection).not.toContain(sourcePath)
    expect(publicReadyProjection).not.toContain('/Users/private/repository')
    expect(canonicalJson(chain.traceEvidence)).not.toContain('private command')
    expect(canonicalJson(chain.traceEvidence)).not.toContain('secret failure details')
  })

  it('distinguishes catalog-visible, model-loaded, and user-invoked skills without claiming package closure', async () => {
    const result = await new DeepSeekHarnessAdapter().importEvidence(
      input(
        'failure-recovery-skills.session.jsonl',
        await fixture('failure-recovery-skills.session.jsonl'),
      ),
    )
    const skills = result.artifacts.filter((artifact) => artifact.kind === 'skill')
    const documents = skills.find((artifact) => artifact.name === 'documents')
    const security = skills.find((artifact) => artifact.name === 'security-review')
    expect(documents?.snapshotCompleteness).toBe('content_only')
    expect(documents?.treeDigest).toBeUndefined()
    expect(documents?.extensions?.['https://aen.dev/extensions/dsh/trace-state']).toMatchObject({
      states: ['catalog', 'model_loaded'],
      packageClosureObserved: false,
    })
    expect(security?.extensions?.['https://aen.dev/extensions/dsh/trace-state']).toMatchObject({
      states: ['catalog', 'user_invoked'],
      packageClosureObserved: false,
    })
    expect(result.manifest.coverage.skills).toBe('invoked_only')
    expect(result.manifest.coverage.skills).not.toBe('complete')
  })
})

describe('DSH live manifest', () => {
  it('marks a SKILL.md-only observation partial and withholds tree identity', () => {
    const result = buildLiveManifest(baseLiveSnapshot())
    const skill = result.artifacts.find((artifact) => artifact.kind === 'skill')
    expect(result.manifest.coverage.mode).toBe('live_snapshot')
    expect(skill?.snapshotCompleteness).toBe('partial_snapshot')
    expect(skill?.contentDigest).toBeDefined()
    expect(skill?.treeDigest).toBeUndefined()
  })

  it('changes stable Harness identity when Harness configuration changes', () => {
    const first = buildLiveManifest(baseLiveSnapshot())
    const changed = baseLiveSnapshot()
    changed.skills = [...changed.skills, {
      name: 'security-review',
      description: 'Review security',
      closure: 'interface_only',
      redistributable: false,
    }]
    const second = buildLiveManifest(changed)
    expect(first.manifest.configurationDigest).not.toBe(second.manifest.configurationDigest)
    expect(first.manifest.digest).not.toBe(second.manifest.digest)
  })

  it('keeps Harness identity stable when only Model identity changes, while the configuration cell changes', () => {
    const firstSnapshot = baseLiveSnapshot()
    const secondSnapshot = baseLiveSnapshot()
    secondSnapshot.model = { ...secondSnapshot.model, modelId: 'deepseek-reasoner' }
    const first = buildLiveManifest(firstSnapshot)
    const second = buildLiveManifest(secondSnapshot)
    expect(first.manifest.configurationDigest).toBe(second.manifest.configurationDigest)
    expect(first.manifest.digest).toBe(second.manifest.digest)
    expect(
      sha256(canonicalJson({ model: firstSnapshot.model, harnessManifestDigest: first.manifest.digest })),
    ).not.toBe(
      sha256(canonicalJson({ model: secondSnapshot.model, harnessManifestDigest: second.manifest.digest })),
    )
  })

  it('keeps Harness configuration identity independent from the Environment axis', () => {
    const firstSnapshot = baseLiveSnapshot()
    const secondSnapshot = baseLiveSnapshot()
    secondSnapshot.capturedAt = '2026-08-20T00:00:00.000Z'
    secondSnapshot.environment = {
      os: { family: 'linux', arch: 'x64' },
      runtime: { node: '26.0.0' },
      capturedAt: '2026-08-20T00:00:00.000Z',
      disclosure: 'metadata',
    }
    const first = buildLiveManifest(firstSnapshot)
    const second = buildLiveManifest(secondSnapshot)
    expect(first.manifest.configurationDigest).toBe(second.manifest.configurationDigest)
    expect(first.manifest.digest).not.toBe(second.manifest.digest)
  })
})
