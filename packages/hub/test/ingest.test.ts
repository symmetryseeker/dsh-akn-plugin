import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { newDb } from 'pg-mem'
import { DeepSeekHarnessAdapter } from '@aen/adapter-dsh'
import { LocalEvidenceStore } from '@aen/local-store'
import {
  finalizeProtocolObject,
  generateNodeKeyPair,
  toObjectRef,
  type ContextInjectionObservation,
  type FeedbackEvent,
  type JsonRecord,
  type RunObservation,
} from '@aen/protocol'
import {
  createRevocationContribution,
  createObservationContribution,
  promoteExperience,
  writeContributionBundle,
  writeObjectContributionBundle,
  type ContributionInventory,
} from '@aen/promotion'
import { distillEpisode, reviewExperience } from '@aen/workbench'
import {
  loadContributionBundle,
  loadGitContributions,
  PostgresHubProjection,
  type AuthorizedPublisherKey,
  type IngestedContribution,
} from '../src/index.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function temporary(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

const actor = { actorId: 'https://github.com/jiaoyangli-shadow7day', type: 'human' as const }

async function contribution(): Promise<{
  directory: string
  key: ReturnType<typeof generateNodeKeyPair>
  authorized: AuthorizedPublisherKey[]
  inventory: ContributionInventory
}> {
  const root = temporary('aen-hub-ingest-')
  const store = new LocalEvidenceStore(join(root, 'evidence.sqlite'))
  const localPath = fileURLToPath(new URL(
    '../../../fixtures/dsh/failure-recovery-skills.session.jsonl',
    import.meta.url,
  ))
  const imported = await new DeepSeekHarnessAdapter().importEvidence({
    mediaType: 'application/x-ndjson',
    sourceName: 'fixture.jsonl',
    schemaNamespace: 'https://github.com/deepseek-ai/DeepSeek-Harness/session-log',
    schemaVersion: '0',
    exporterVersion: '0.1.0-rc.7',
    localPath,
  })
  store.putBatch({
    objects: [
      { object: imported.manifest as unknown as JsonRecord },
      ...imported.artifacts.map((object) => ({ object: object as unknown as JsonRecord })),
      ...imported.episodes.flatMap((chain) => [
        { object: chain.gapReport as unknown as JsonRecord },
        { object: chain.episode as unknown as JsonRecord },
        { object: chain.traceEvidence as unknown as JsonRecord },
        { object: chain.observation as unknown as JsonRecord },
      ]),
    ],
  })
  const chain = imported.episodes[0]
  if (chain === undefined) throw new Error('fixture produced no episode')
  const source = distillEpisode(store, chain.episode.episodeId).experience
  reviewExperience(store, source.digest, 'request-public', actor.actorId)
  const key = generateNodeKeyPair(`${actor.actorId}#test`)
  const promoted = promoteExperience(store, source.digest, {
    actor,
    key,
    consentRef: 'git:commit:pending-test',
    policyDecisionRef: 'urn:aen:policy:public-v1',
    license: 'CC-BY-4.0',
    createdAt: '2026-08-20T03:00:00Z',
  })
  const directory = join(root, 'contribution')
  const inventory = await writeContributionBundle(directory, promoted, { actor })
  store.close()
  return {
    directory,
    key,
    authorized: [{ keyid: key.keyid, publicKey: key.publicKey, actorId: actor.actorId }],
    inventory,
  }
}

function targetPath(directory: string, inventory: ContributionInventory): string {
  const entry = inventory.objects.find((object) => object.digest === inventory.targetDigest)
  if (entry === undefined) throw new Error('target entry missing')
  return join(directory, entry.path)
}

async function independentObservationContribution(
  experienceContribution: IngestedContribution,
): Promise<{
  directory: string
  key: ReturnType<typeof generateNodeKeyPair>
  authorized: AuthorizedPublisherKey[]
}> {
  if (experienceContribution.target.objectType !== 'experience_revision') {
    throw new Error('fixture target is not an Experience')
  }
  const publicManifest = experienceContribution.objects.find((object) => object.objectType === 'harness_manifest')
  const sourceObservation = experienceContribution.objects.find((object) => object.objectType === 'observation')
  if (publicManifest === undefined || sourceObservation === undefined) {
    throw new Error('public Experience contribution omitted Observation dependencies')
  }
  const injection = finalizeProtocolObject<ContextInjectionObservation>({
    protocolVersion: '0.1',
    objectType: 'context_injection_observation',
    injectionId: 'urn:aen:injection:independent-negative-transfer',
    planId: 'urn:aen:plan:independent-negative-transfer',
    experienceRef: {
      experienceId: experienceContribution.target.experienceId,
      revision: experienceContribution.target.revision,
      digest: experienceContribution.target.digest,
    },
    fetchedSections: ['card', 'recipe', 'cases'],
    injectedSections: ['card', 'recipe'],
    contentDigests: [experienceContribution.target.digest],
    estimatedTokens: 320,
    actualTokens: 301,
    createdAt: '2026-08-20T06:00:00Z',
  })
  const draft = structuredClone(sourceObservation)
  delete draft.digest
  delete draft.attestation
  delete draft.governance
  draft.observationId = 'urn:aen:observation:independent-negative-transfer'
  draft.experienceRef = {
    experienceId: experienceContribution.target.experienceId,
    revision: experienceContribution.target.revision,
    digest: experienceContribution.target.digest,
  }
  draft.treatment = 'experience_applied'
  draft.outcome = 'failure'
  draft.failureType = 'negative_transfer'
  draft.evidenceRefs = []
  draft.acceptanceResults = (draft.acceptanceResults as JsonRecord[]).map((result) => ({
    ...result,
    evidenceRefs: [],
  }))
  draft.contextInjectionRefs = [toObjectRef(injection as unknown as JsonRecord)]
  draft.independence = {
    evaluatorActor: { actorId: 'https://github.com/independent-validator', type: 'human' },
    declaredConflicts: [],
  }
  draft.createdAt = '2026-08-20T06:05:00Z'
  const observation = finalizeProtocolObject<RunObservation>(draft)
  const manifestArtifactDigests = new Set(
    ((publicManifest.artifacts as Array<{ digest: string }> | undefined) ?? []).map((ref) => ref.digest),
  )
  const dependencyObjects = [
    publicManifest,
    ...experienceContribution.objects.filter((object) => manifestArtifactDigests.has(String(object.digest))),
    injection as unknown as JsonRecord,
  ]
  const validator = { actorId: 'https://github.com/independent-validator', type: 'human' as const }
  const key = generateNodeKeyPair(`${validator.actorId}#test`)
  const contribution = createObservationContribution(observation, {
    actor: validator,
    key,
    consentRef: 'git:commit:independent-observation',
    policyDecisionRef: 'urn:aen:policy:public-observation-v1',
    license: 'CC-BY-4.0',
    dependencyObjects,
    claimId: experienceContribution.target.claims[0]!.claimId,
    relation: 'contradicting',
    scopeDifference: 'Independent validator observed failure in another declared-compatible Configuration Cell.',
    reviewedAt: '2026-08-20T06:10:00Z',
  })
  const directory = join(temporary('aen-observation-'), 'contribution')
  await writeObjectContributionBundle(directory, contribution)
  return {
    directory,
    key,
    authorized: [{ keyid: key.keyid, publicKey: key.publicKey, actorId: validator.actorId }],
  }
}

describe('Reference Hub contribution ingress', () => {
  it('accepts a valid signed contribution and returns the verified public target', async () => {
    const fixture = await contribution()
    const loaded = await loadContributionBundle(fixture.directory, fixture.authorized)
    expect(loaded.target.governance.visibility).toBe('public')
    expect(loaded.target.governance.license).toBe('CC-BY-4.0')
    expect(loaded.objects).toHaveLength(fixture.inventory.objects.length)
    expect(loaded.verifiedKeyIds).toEqual([fixture.key.keyid])
  })

  it('rejects a digest-tampered object', async () => {
    const fixture = await contribution()
    const path = targetPath(fixture.directory, fixture.inventory)
    const target = JSON.parse(readFileSync(path, 'utf8')) as JsonRecord
    target.title = 'Tampered after signing'
    writeFileSync(path, `${JSON.stringify(target, null, 2)}\n`)
    await expect(loadContributionBundle(fixture.directory, fixture.authorized)).rejects.toThrow('expected sha256:')
  })

  it('rejects an unsigned public target even when its content digest is unchanged', async () => {
    const fixture = await contribution()
    const path = targetPath(fixture.directory, fixture.inventory)
    const target = JSON.parse(readFileSync(path, 'utf8')) as JsonRecord
    delete target.attestations
    writeFileSync(path, `${JSON.stringify(target, null, 2)}\n`)
    await expect(loadContributionBundle(fixture.directory, fixture.authorized)).rejects.toThrow('no authorized signature')
  })

  it('rejects secrets hidden in digest-excluded inline attestation data', async () => {
    const fixture = await contribution()
    const path = targetPath(fixture.directory, fixture.inventory)
    const target = JSON.parse(readFileSync(path, 'utf8')) as JsonRecord
    const attestations = target.attestations as JsonRecord[]
    const issuer = attestations[0]?.issuer as JsonRecord
    issuer.displayName = 'sk-abcdefghijklmnopqrstuvwxyz012345'
    writeFileSync(path, `${JSON.stringify(target, null, 2)}\n`)
    await expect(loadContributionBundle(fixture.directory, fixture.authorized)).rejects.toThrow('provider-api-key')
  })

  it('rejects a valid signature from a key that is not authorized for the publisher', async () => {
    const fixture = await contribution()
    await expect(loadContributionBundle(fixture.directory, [])).rejects.toThrow('no authorized signature')
  })

  it('rejects an unlisted archive or side-loaded file in a contribution', async () => {
    const fixture = await contribution()
    writeFileSync(join(fixture.directory, 'payload.zip'), 'not part of the signed inventory')
    await expect(loadContributionBundle(fixture.directory, fixture.authorized)).rejects.toThrow(
      'outside the signed inventory layout',
    )
  })

  it('rejects deeply nested and oversized-string JSON before signature or graph processing', async () => {
    const deep = await contribution()
    const deepPath = targetPath(deep.directory, deep.inventory)
    const deepTarget = JSON.parse(readFileSync(deepPath, 'utf8')) as JsonRecord
    const root: JsonRecord = {}
    let cursor = root
    for (let depth = 0; depth < 70; depth += 1) {
      const child: JsonRecord = {}
      cursor.child = child
      cursor = child
    }
    deepTarget.extensions = { hostile: root }
    writeFileSync(deepPath, `${JSON.stringify(deepTarget)}\n`)
    await expect(loadContributionBundle(deep.directory, deep.authorized)).rejects.toThrow('JSON depth limit')

    const wide = await contribution()
    const widePath = targetPath(wide.directory, wide.inventory)
    const wideTarget = JSON.parse(readFileSync(widePath, 'utf8')) as JsonRecord
    wideTarget.extensions = { hostile: 'x'.repeat(512 * 1024 + 1) }
    writeFileSync(widePath, `${JSON.stringify(wideTarget)}\n`)
    await expect(loadContributionBundle(wide.directory, wide.authorized)).rejects.toThrow('JSON string limit')
  })

  it('accepts an independently signed revocation contribution without redistributing the withdrawn body', async () => {
    const fixture = await contribution()
    const experience = await loadContributionBundle(fixture.directory, fixture.authorized)
    if (experience.target.objectType !== 'experience_revision') throw new Error('fixture target mismatch')
    const revoked = createRevocationContribution(experience.target as unknown as JsonRecord, {
      actor,
      key: fixture.key,
      reasonCode: 'license',
      severity: 'urgent',
      createdAt: '2026-08-20T04:00:00Z',
    })
    const directory = join(temporary('aen-revocation-'), 'contribution')
    await writeObjectContributionBundle(directory, {
      target: revoked.revocation as unknown as JsonRecord,
      objects: revoked.contributionObjects,
      actor,
      createdAt: revoked.revocation.createdAt,
    })
    const loaded = await loadContributionBundle(directory, fixture.authorized)
    expect(loaded.target).toMatchObject({
      objectType: 'revocation',
      target: { digest: experience.target.digest },
      affectedDigests: [experience.target.digest],
    })
    expect(loaded.objects).toHaveLength(1)
  })

  it('rejects a Git registry current tree that still contains a formally revoked body', async () => {
    const fixture = await contribution()
    const experience = await loadContributionBundle(fixture.directory, fixture.authorized)
    if (experience.target.objectType !== 'experience_revision') throw new Error('fixture target mismatch')
    const revoked = createRevocationContribution(experience.target as unknown as JsonRecord, {
      actor,
      key: fixture.key,
      reasonCode: 'author_request',
      createdAt: '2026-08-20T04:30:00Z',
    })
    const registry = temporary('aen-git-revocation-tree-')
    cpSync(fixture.directory, join(registry, 'original'), { recursive: true })
    await writeObjectContributionBundle(join(registry, 'revocation'), {
      target: revoked.revocation as unknown as JsonRecord,
      objects: revoked.contributionObjects,
      actor,
      createdAt: revoked.revocation.createdAt,
    })
    await expect(loadGitContributions(registry, fixture.authorized)).rejects.toThrow(
      'current tree still distributes revoked body',
    )
    rmSync(join(registry, 'original'), { recursive: true })
    const current = await loadGitContributions(registry, fixture.authorized)
    expect(current.map((item) => item.target.objectType)).toEqual(['revocation'])
  })

  it('accepts a licensed independent Observation and signed Contention contribution', async () => {
    const fixture = await contribution()
    const experience = await loadContributionBundle(fixture.directory, fixture.authorized)
    const independent = await independentObservationContribution(experience)
    const loaded = await loadContributionBundle(independent.directory, independent.authorized)
    expect(loaded.target).toMatchObject({
      objectType: 'observation',
      experienceRef: { digest: experience.target.digest },
      governance: {
        visibility: 'public',
        license: 'CC-BY-4.0',
        consentRef: 'git:commit:independent-observation',
      },
    })
    expect(loaded.objects.filter((object) => object.objectType === 'contention')).toHaveLength(1)
    expect(loaded.verifiedKeyIds).toEqual([independent.key.keyid])
  })
})

describe('PostgreSQL Hub projection', () => {
  it('rebuilds from an accepted Git contribution and gives emergency blocks precedence', async () => {
    const fixture = await contribution()
    const loaded = await loadContributionBundle(fixture.directory, fixture.authorized)
    const memoryPostgres = newDb()
    const adapter = memoryPostgres.adapters.createPg()
    const pool = new adapter.Pool()
    const projection = new PostgresHubProjection(
      pool as unknown as ConstructorParameters<typeof PostgresHubProjection>[0],
      { textSearch: 'portable_test' },
    )
    await projection.migrate()
    await projection.rebuild([loaded])

    const cards = await projection.search({
      query: 'failed bash',
      modelProvider: 'deepseek',
      modelId: 'deepseek-reasoner',
      harnessConfigurationDigest: loaded.target.applicability.harnessSelectors
        ?.find((selector) => selector.path === 'harness.configurationDigest')?.value as string,
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      digest: loaded.target.digest,
      revision: 2,
      maxEvidenceLevel: 'H1',
      blocked: false,
    })
    expect(await projection.search({ taskFamilies: ['unrelated-family'] })).toEqual([])
    expect(await projection.search({ allowedLicenses: ['MIT'] })).toEqual([])
    expect(await projection.search({ minEvidenceLevel: 'H2' })).toEqual([])
    expect(await projection.search({ maxRiskClass: 'read_only' })).toEqual([])
    const mutable = await projection.search({
      modelProvider: 'deepseek',
      modelId: 'deepseek-reasoner',
      harnessConfigurationDigest: loaded.target.applicability.harnessSelectors
        ?.find((selector) => selector.path === 'harness.configurationDigest')?.value as string,
      modelMutability: 'provider_mutable',
    })
    expect(mutable[0]?.compatibility).toBe('compatible')
    expect(mutable[0]?.scoreExplanation.join(' ')).toContain('Provider-mutable')
    const feedback = finalizeProtocolObject<FeedbackEvent>({
      protocolVersion: '0.1',
      objectType: 'feedback',
      feedbackId: 'urn:aen:feedback:hub-exact-ref',
      experienceRef: {
        experienceId: loaded.target.experienceId,
        revision: loaded.target.revision,
        digest: loaded.target.digest,
      },
      decision: 'viewed',
      sharingScope: 'public_aggregate',
      createdAt: '2026-08-20T03:30:00Z',
    })
    await expect(projection.appendFeedback(feedback as unknown as JsonRecord)).resolves.toBeUndefined()
    const wrong = finalizeProtocolObject<FeedbackEvent>({
      ...feedback,
      feedbackId: 'urn:aen:feedback:hub-wrong-ref',
      experienceRef: { ...feedback.experienceRef, digest: `sha256:${'f'.repeat(64)}` },
    } as unknown as JsonRecord)
    await expect(projection.appendFeedback(wrong as unknown as JsonRecord)).rejects.toThrow('digest-mismatched')
    expect(await projection.status()).toMatchObject({ experiences: 1, latestExperiences: 1 })
    expect(await projection.getExperience(loaded.target.experienceId)).toMatchObject({
      digest: loaded.target.digest,
      governance: { visibility: 'public' },
    })

    await projection.emergencyBlock(loaded.target.digest, 'secret_leak')
    expect(await projection.getObject(loaded.target.digest)).toMatchObject({
      tombstone: true,
      digest: loaded.target.digest,
      reasonCode: 'secret_leak',
    })
    expect(await projection.getExperience(loaded.target.experienceId)).toMatchObject({ tombstone: true })
    expect((await projection.pool.query('SELECT canonical_json FROM hub_objects WHERE digest = $1', [loaded.target.digest])).rows).toEqual([])
    expect(await projection.search({ query: 'failed bash' })).toEqual([])

    // Operational emergency blocks survive a Git-derived projection rebuild.
    await projection.rebuild([loaded])
    expect(await projection.getObject(loaded.target.digest)).toMatchObject({ tombstone: true })
    expect((await projection.pool.query('SELECT canonical_json FROM hub_objects WHERE digest = $1', [loaded.target.digest])).rows).toEqual([])
    expect(await projection.search()).toEqual([])
    await projection.close()
  })

  it('rebuilds a formal Git revocation and returns only a non-recoverable tombstone', async () => {
    const fixture = await contribution()
    const experience = await loadContributionBundle(fixture.directory, fixture.authorized)
    if (experience.target.objectType !== 'experience_revision') throw new Error('fixture target mismatch')
    const revoked = createRevocationContribution(experience.target as unknown as JsonRecord, {
      actor,
      key: fixture.key,
      reasonCode: 'secret_leak',
      severity: 'critical',
      createdAt: '2026-08-20T05:00:00Z',
    })
    const directory = join(temporary('aen-revocation-rebuild-'), 'contribution')
    await writeObjectContributionBundle(directory, {
      target: revoked.revocation as unknown as JsonRecord,
      objects: revoked.contributionObjects,
      actor,
      createdAt: revoked.revocation.createdAt,
    })
    const revocation = await loadContributionBundle(directory, fixture.authorized)
    const memoryPostgres = newDb()
    const adapter = memoryPostgres.adapters.createPg()
    const pool = new adapter.Pool()
    const projection = new PostgresHubProjection(
      pool as unknown as ConstructorParameters<typeof PostgresHubProjection>[0],
      { textSearch: 'portable_test' },
    )
    await projection.migrate()
    await projection.rebuild([experience, revocation])
    expect(await projection.search()).toEqual([])
    expect(await projection.getObject(experience.target.digest)).toMatchObject({
      tombstone: true,
      digest: experience.target.digest,
      reasonCode: 'secret_leak',
    })
    expect(await projection.getExperience(experience.target.experienceId)).toMatchObject({
      tombstone: true,
      digest: experience.target.digest,
    })
    expect(await projection.getExperienceRevision(
      experience.target.experienceId,
      experience.target.revision,
      experience.target.digest,
    )).toMatchObject({ tombstone: true })
    expect(await projection.listExperienceRevisions(experience.target.experienceId)).toEqual([
      expect.objectContaining({ tombstone: true, digest: experience.target.digest }),
    ])
    expect((await projection.pool.query('SELECT canonical_json FROM hub_objects WHERE digest = $1', [experience.target.digest])).rows).toEqual([])
    const exported = await projection.exportObjects()
    expect(exported.some((object) => object.digest === experience.target.digest)).toBe(false)
    // A stale rebuild input that omits the Revocation cannot resurrect a body
    // once this Hub has recorded its non-recoverable tombstone.
    await projection.rebuild([experience])
    expect(await projection.search()).toEqual([])
    expect(await projection.getObject(experience.target.digest)).toMatchObject({ tombstone: true })
    expect((await projection.pool.query('SELECT canonical_json FROM hub_objects WHERE digest = $1', [experience.target.digest])).rows).toEqual([])
    await projection.close()
  })

  it('keeps the original Experience and an independent contradicting Observation simultaneously visible', async () => {
    const fixture = await contribution()
    const experience = await loadContributionBundle(fixture.directory, fixture.authorized)
    if (experience.target.objectType !== 'experience_revision') throw new Error('fixture target mismatch')
    const independent = await independentObservationContribution(experience)
    const observation = await loadContributionBundle(independent.directory, independent.authorized)
    const memoryPostgres = newDb()
    const adapter = memoryPostgres.adapters.createPg()
    const pool = new adapter.Pool()
    const projection = new PostgresHubProjection(
      pool as unknown as ConstructorParameters<typeof PostgresHubProjection>[0],
      { textSearch: 'portable_test' },
    )
    await projection.migrate()
    await projection.rebuild([observation, experience])
    expect(await projection.getExperience(experience.target.experienceId)).toMatchObject({
      digest: experience.target.digest,
    })
    const contentions = await projection.listContentions(experience.target.experienceId)
    expect(contentions).toHaveLength(1)
    expect(contentions[0]).toMatchObject({
      claimRef: { claimId: experience.target.claims[0]!.claimId },
      supporting: [],
      contradicting: [{ objectType: 'observation', refId: 'urn:aen:observation:independent-negative-transfer:public' }],
    })
    expect(contentions[0]).not.toHaveProperty('resolvedAt')
    const contradictingDigest = contentions[0]!.contradicting[0]!.digest
    expect(await projection.getObject(contradictingDigest)).toMatchObject({
      objectType: 'observation',
      outcome: 'failure',
      failureType: 'negative_transfer',
    })
    await projection.close()
  })
})
