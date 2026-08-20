#!/usr/bin/env node

import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { DeepSeekHarnessAdapter } from '@aen/adapter-dsh'
import { HubHttpExperienceSource, createFeedbackEvent, createTaskCapsule } from '@aen/client'
import { LocalEvidenceStore } from '@aen/local-store'
import {
  validateProtocolObject,
  verifyAttestation,
  type JsonRecord,
  type NodeKeyPair,
  type ObjectRef,
  type ContextInjectionObservation,
  type ExperienceRevision,
} from '@aen/protocol'
import {
  createRevocationContribution,
  createObservationContributionFromStore,
  promoteExperience,
  writeContributionBundle,
  writeObjectContributionBundle,
} from '@aen/promotion'
import {
  buildReviewPacket,
  createEditTemplate,
  distillEpisode,
  fetchExperienceSections,
  importEditedRevision,
  reviewExperience,
  searchLocalExperiences,
  type ReviewDecision,
} from '@aen/workbench'
import {
  comparisonEvidenceDecision,
  parseEvaluationMatrixPlan,
  parsePilotPreregistration,
  runEvaluationMatrix,
  validatePilotPreregistration,
  type EvaluationDriver,
  type PilotPreregistration,
} from '@aen/evaluation'
import {
  createDshEvaluationDriver,
  parseDshEvaluationDriverConfig,
  type DshEvaluationGrader,
} from '@aen/dsh-plugin/evaluation-driver'
import { inspectDshPluginBundle, type DoctorCheck } from './dsh-plugin-doctor.js'

const program = new Command()
  .name('aen')
  .description('Agent Experience Network local workbench (AEXP 0.1 Draft)')
  .version('0.0.1')

const defaultStorePath = (): string => resolve('.aen/evidence.sqlite')
const defaultDshPluginPath = (): string => fileURLToPath(
  new URL('../../../packages/dsh-plugin', import.meta.url),
)

program
  .command('doctor')
  .description('Check the local AEN runtime, evidence store, publisher key, plugin build, and optional Hub')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .option('--config <path>', 'local publisher configuration', '.aen/publisher.json')
  .option('--plugin <path>', 'DeepSeek Harness plugin package directory or package.json', defaultDshPluginPath())
  .option('--hub <url>', 'optional Reference Hub health endpoint')
  .action(async (options: { store: string; config: string; plugin: string; hub?: string }) => {
    const checks: DoctorCheck[] = []
    const nodeMajor = Number(process.versions.node.split('.')[0])
    checks.push({
      name: 'node',
      status: nodeMajor >= 22 ? 'pass' : 'fail',
      detail: `Node ${process.versions.node}; AEN requires >=22`,
    })
    try {
      const store = new LocalEvidenceStore(resolve(options.store))
      const objects = store.listObjects().length
      store.close()
      checks.push({ name: 'local-store', status: 'pass', detail: `${resolve(options.store)}; ${objects} objects` })
    } catch (error) {
      checks.push({ name: 'local-store', status: 'fail', detail: error instanceof Error ? error.message : String(error) })
    }
    try {
      const configPath = resolve(options.config)
      const config = parsePublisherConfig(JSON.parse(await readFile(configPath, 'utf8')))
      const directory = dirname(configPath)
      createPrivateKey(await readFile(resolve(directory, config.key.privateKeyPath), 'utf8'))
      createPublicKey(await readFile(resolve(directory, config.key.publicKeyPath), 'utf8'))
      checks.push({ name: 'publisher-key', status: 'pass', detail: `${config.actor.actorId}; ${config.key.keyid}` })
    } catch (error) {
      checks.push({ name: 'publisher-key', status: 'warn', detail: `run aen init before public contribution: ${error instanceof Error ? error.message : String(error)}` })
    }
    checks.push(await inspectDshPluginBundle(options.plugin))
    if (options.hub !== undefined) {
      try {
        const response = await fetch(`${options.hub.replace(/\/$/, '')}/health`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        checks.push({ name: 'hub', status: 'pass', detail: JSON.stringify(await response.json()) })
      } catch (error) {
        checks.push({ name: 'hub', status: 'warn', detail: `local workflow remains available: ${error instanceof Error ? error.message : String(error)}` })
      }
    }
    const ok = checks.every((check) => check.status !== 'fail')
    process.stdout.write(`${JSON.stringify({ ok, checks }, null, 2)}\n`)
    if (!ok) process.exitCode = 1
  })

interface PublisherConfig {
  profile: 'aen-local-publisher-v0.1'
  actor: {
    actorId: string
    type: 'human' | 'agent' | 'organization' | 'service' | 'node'
    displayName?: string
  }
  key: {
    keyid: string
    privateKeyPath: string
    publicKeyPath: string
  }
}

function parsePublisherConfig(value: unknown): PublisherConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('publisher config must be an object')
  }
  const config = value as Partial<PublisherConfig>
  if (
    config.profile !== 'aen-local-publisher-v0.1' ||
    config.actor === undefined || typeof config.actor.actorId !== 'string' ||
    config.key === undefined || typeof config.key.keyid !== 'string' ||
    typeof config.key.privateKeyPath !== 'string' || typeof config.key.publicKeyPath !== 'string'
  ) throw new Error('publisher config is invalid')
  return config as PublisherConfig
}

program
  .command('init')
  .description('Initialize a local AEN publisher identity and Ed25519 signing key')
  .option('--directory <path>', 'AEN local state directory', '.aen')
  .option('--actor <uri>', 'publisher actor URI', 'urn:aen:actor:local-publisher')
  .option('--display-name <name>', 'publisher display name')
  .action(async (options: { directory: string; actor: string; displayName?: string }) => {
    const directory = resolve(options.directory)
    const keyDirectory = join(directory, 'keys')
    const configPath = join(directory, 'publisher.json')
    const privateKeyPath = join(keyDirectory, 'aen-ed25519-private.pem')
    const publicKeyPath = join(keyDirectory, 'aen-ed25519-public.pem')
    await mkdir(keyDirectory, { recursive: true })
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    await writeFile(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), {
      encoding: 'utf8',
      mode: 0o644,
      flag: 'wx',
    })
    const config: PublisherConfig = {
      profile: 'aen-local-publisher-v0.1',
      actor: {
        actorId: options.actor,
        type: 'human',
        ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
      },
      key: {
        keyid: `${options.actor}#aen-ed25519`,
        privateKeyPath: relative(directory, privateKeyPath),
        publicKeyPath: relative(directory, publicKeyPath),
      },
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o644,
      flag: 'wx',
    })
    process.stdout.write(`${JSON.stringify({ initialized: true, directory, config: configPath, keyid: config.key.keyid }, null, 2)}\n`)
  })

program
  .command('delete-local')
  .description('Permanently delete one local object body after exact digest confirmation')
  .argument('<selector>', 'local object digest or stable id to inspect')
  .requiredOption('--confirm-digest <digest>', 'exact sha256 digest that authorizes deletion')
  .requiredOption('--reason <reason>', 'audit reason, for example author_request or retention_expired')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .action((selector: string, options: { confirmDigest: string; reason: string; store: string }) => {
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      const inspected = store.inspect(selector)
      if (inspected === undefined) throw new Error(`local object not found: ${selector}`)
      if (inspected.summary.digest !== options.confirmDigest) {
        throw new Error(`confirmation digest mismatch: resolved ${inspected.summary.digest}`)
      }
      const tombstone = store.deleteObjectBody({
        digest: inspected.summary.digest,
        reason: options.reason,
      })
      process.stdout.write(`${JSON.stringify({ deleted: true, tombstone }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

const importCommand = program.command('import').description('Import Harness evidence into the local store')

importCommand
  .command('dsh')
  .description('Import a DeepSeek Harness session JSONL or export ZIP')
  .argument('<session-export>', 'path to DSH session.jsonl or export ZIP')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .option('--exporter-version <version>', 'declared DSH exporter/Harness version')
  .action(
    async (
      sessionExport: string,
      options: { store: string; exporterVersion?: string },
    ) => {
      const absolutePath = resolve(sessionExport)
      const zip = extname(absolutePath).toLowerCase() === '.zip'
      const adapter = new DeepSeekHarnessAdapter()
      const result = await adapter.importEvidence({
        mediaType: zip ? 'application/zip' : 'application/x-ndjson',
        sourceName: basename(absolutePath),
        schemaNamespace: 'https://github.com/deepseek-ai/DeepSeek-Harness/session-log',
        schemaVersion: '0',
        ...(options.exporterVersion === undefined
          ? {}
          : { exporterVersion: options.exporterVersion }),
        localPath: absolutePath,
      })
      const store = new LocalEvidenceStore(resolve(options.store))
      try {
        const objects: Array<{ object: JsonRecord; role: string }> = [
          { object: result.manifest as unknown as JsonRecord, role: 'manifest' },
          ...result.artifacts.map((object) => ({
            object: object as unknown as JsonRecord,
            role: `artifact:${object.kind}`,
          })),
          ...result.episodes.flatMap((chain) => [
            { object: chain.gapReport as unknown as JsonRecord, role: 'evidence_gap_report' },
            { object: chain.episode as unknown as JsonRecord, role: 'episode' },
            { object: chain.traceEvidence as unknown as JsonRecord, role: 'trace_evidence' },
            { object: chain.observation as unknown as JsonRecord, role: 'observation' },
          ]),
        ]
        const stored = store.putBatch({
          session: {
            sessionDigest: result.sessionDigest,
            sourceName: basename(absolutePath),
            importedAt: new Date().toISOString(),
            rawInputDigest: result.rawInputDigest,
            ...(result.localLocator === undefined ? {} : { localLocator: result.localLocator }),
          },
          objects,
        })
        process.stdout.write(
          `${JSON.stringify(
            {
              imported: true,
              store: store.path,
              sessionDigest: result.sessionDigest,
              normalizedEventCount: result.normalizedEvents.length,
              episodeCount: result.episodes.length,
              objectCount: stored.length,
              manifest: {
                digest: result.manifest.digest,
                mode: result.manifest.coverage.mode,
                limitations: result.manifest.coverage.limitations,
              },
            },
            null,
            2,
          )}\n`,
        )
      } finally {
        store.close()
      }
    },
  )

const manifestCommand = program.command('manifest').description('Inspect authoritative Harness Manifest snapshots')

manifestCommand
  .command('snapshot')
  .description('Show the latest live snapshot captured by the DeepSeek Harness plugin; never synthesize one from trace')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .option('--allow-trace-only', 'fall back to the latest trace-only Manifest when no live snapshot exists')
  .action((options: { store: string; allowTraceOnly?: boolean }) => {
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      const manifests = store.listObjects('harness_manifest')
        .map((summary) => store.getByDigest(summary.digest))
        .filter((object): object is JsonRecord => object !== undefined)
      const live = manifests.find((manifest) =>
        (manifest.coverage as JsonRecord | undefined)?.mode === 'live_snapshot')
      const selected = live ?? (options.allowTraceOnly === true ? manifests[0] : undefined)
      if (selected === undefined) {
        throw new Error('no live Harness Manifest snapshot exists; load @aen/dsh-plugin in DeepSeek Harness and run one effective request')
      }
      process.stdout.write(`${JSON.stringify({
        authoritative: (selected.coverage as JsonRecord).mode === 'live_snapshot',
        manifest: selected,
        note: (selected.coverage as JsonRecord).mode === 'live_snapshot'
          ? 'Captured from the DSH live registry/configuration seam.'
          : 'Trace-only fallback; gaps and partial coverage remain binding.',
      }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

const episode = program.command('episode').description('Inspect locally derived TaskEpisodes')

episode
  .command('list')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .action(({ store: storePath }: { store: string }) => {
    const store = new LocalEvidenceStore(resolve(storePath))
    try {
      process.stdout.write(`${JSON.stringify({ episodes: store.listEpisodes() }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

episode
  .command('inspect')
  .argument('<id-or-digest>', 'episode id or content digest')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .action((selector: string, { store: storePath }: { store: string }) => {
    const store = new LocalEvidenceStore(resolve(storePath))
    try {
      const inspected = store.inspect(selector)
      if (inspected === undefined || inspected.summary.objectType !== 'task_episode') {
        process.stderr.write(`${JSON.stringify({ found: false, selector }, null, 2)}\n`)
        process.exitCode = 1
        return
      }
      process.stdout.write(`${JSON.stringify({ found: true, ...inspected }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

program
  .command('inspect')
  .description('Inspect any locally stored AEXP object and its references')
  .argument('<id-or-digest>', 'object id or content digest')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .action((selector: string, { store: storePath }: { store: string }) => {
    const store = new LocalEvidenceStore(resolve(storePath))
    try {
      const inspected = store.inspect(selector)
      if (inspected === undefined) {
        process.stderr.write(`${JSON.stringify({ found: false, selector }, null, 2)}\n`)
        process.exitCode = 1
        return
      }
      process.stdout.write(`${JSON.stringify({ found: true, ...inspected }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

program
  .command('distill')
  .description('Create a constrained private Experience draft from a high-value TaskEpisode')
  .argument('<episode-id>', 'TaskEpisode id or digest')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .option('--publisher <actor-id>', 'private draft publisher actor id', 'urn:aen:actor:local-reviewer')
  .option('--namespace <namespace>', 'Experience namespace', 'local.aen.dsh.failure-recovery')
  .action((episodeId: string, options: { store: string; publisher: string; namespace: string }) => {
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      const result = distillEpisode(store, episodeId, {
        publisher: { actorId: options.publisher, type: 'human' },
        namespace: options.namespace,
      })
      process.stdout.write(`${JSON.stringify({
        created: true,
        store: store.path,
        experience: {
          experienceId: result.experience.experienceId,
          revision: result.experience.revision,
          digest: result.experience.digest,
          visibility: result.experience.governance.visibility,
          maxEvidenceLevel: result.experience.claims[0]?.evidenceLevel,
        },
        review: result.review,
        inputRefs: result.inputRefs,
      }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

program
  .command('review')
  .description('Inspect, edit, or record a decision for a private Experience revision')
  .argument('<draft-id>', 'Experience id or digest')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .option('--decision <decision>', 'keep-private | reject | request-public | reset-draft')
  .option('--reviewer <actor-id>', 'reviewer actor id', 'urn:aen:actor:local-reviewer')
  .option('--note <text>', 'review audit note')
  .option('--export-edit <path>', 'write a digest-free next-revision template for human editing')
  .option('--replace <path>', 'import an edited next revision from JSON')
  .action(async (
    draftId: string,
    options: {
      store: string
      decision?: string
      reviewer: string
      note?: string
      exportEdit?: string
      replace?: string
    },
  ) => {
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      let selector = draftId
      let edited: unknown
      if (options.exportEdit !== undefined) {
        const path = resolve(options.exportEdit)
        const template = createEditTemplate(store, selector)
        await writeFile(path, `${JSON.stringify(template, null, 2)}\n`, 'utf8')
        edited = { exported: path, nextRevision: template.revision }
      }
      if (options.replace !== undefined) {
        const path = resolve(options.replace)
        const value: unknown = JSON.parse(await readFile(path, 'utf8'))
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('edited revision JSON must be an object')
        }
        const revision = importEditedRevision(
          store,
          selector,
          value as JsonRecord,
          options.reviewer,
        )
        selector = revision.digest
        edited = { imported: path, revision: revision.revision, digest: revision.digest }
      }
      let decision
      if (options.decision !== undefined) {
        const allowed: ReviewDecision[] = ['keep-private', 'reject', 'request-public', 'reset-draft']
        if (!allowed.includes(options.decision as ReviewDecision)) {
          throw new Error(`unsupported review decision: ${options.decision}`)
        }
        decision = reviewExperience(
          store,
          selector,
          options.decision as ReviewDecision,
          options.reviewer,
          options.note,
        )
      }
      process.stdout.write(`${JSON.stringify({
        reviewPacket: buildReviewPacket(store, selector),
        ...(edited === undefined ? {} : { edit: edited }),
        ...(decision === undefined ? {} : { decision }),
      }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

program
  .command('promote')
  .description('Create a signed public target and a reviewable Git contribution directory')
  .argument('<experience-id>', 'private Experience id or digest in public_requested state')
  .requiredOption('--public', 'confirm that the target disclosure is public')
  .requiredOption('--out <path>', 'new contribution directory')
  .requiredOption('--consent <ref>', 'explicit consent or Git audit reference')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .option('--config <path>', 'local publisher configuration', '.aen/publisher.json')
  .option('--license <expression>', 'public Experience SPDX/license expression', 'CC-BY-4.0')
  .option('--policy-decision <ref>', 'promotion policy decision reference', 'urn:aen:policy-decision:public-v1')
  .action(async (experienceId: string, options: {
    public: boolean
    out: string
    consent: string
    store: string
    config: string
    license: string
    policyDecision: string
  }) => {
    if (options.public !== true) throw new Error('only explicit --public Promotion is supported')
    const configPath = resolve(options.config)
    const config = parsePublisherConfig(JSON.parse(await readFile(configPath, 'utf8')))
    const configDirectory = dirname(configPath)
    const privateKey = createPrivateKey(await readFile(resolve(configDirectory, config.key.privateKeyPath), 'utf8'))
    const publicKey = createPublicKey(await readFile(resolve(configDirectory, config.key.publicKeyPath), 'utf8'))
    const key: NodeKeyPair = { keyid: config.key.keyid, privateKey, publicKey }
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      const result = promoteExperience(store, experienceId, {
        actor: config.actor,
        key,
        consentRef: options.consent,
        policyDecisionRef: options.policyDecision,
        license: options.license,
      })
      const outputDirectory = resolve(options.out)
      const inventory = await writeContributionBundle(outputDirectory, result, { actor: config.actor })
      process.stdout.write(`${JSON.stringify({
        promoted: true,
        source: {
          experienceId: result.source.experienceId,
          revision: result.source.revision,
          digest: result.source.digest,
          visibility: result.source.governance.visibility,
        },
        target: {
          experienceId: result.target.experienceId,
          revision: result.target.revision,
          digest: result.target.digest,
          visibility: result.target.governance.visibility,
        },
        localPromotionRecord: result.promotion.digest,
        contribution: {
          directory: outputDirectory,
          objectCount: inventory.objects.length,
          inventory: join(outputDirectory, 'inventory.json'),
        },
      }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

program
  .command('revoke')
  .description('Create a signed Git contribution that revokes one immutable public revision')
  .argument('<experience-id>', 'local Experience id or digest to revoke')
  .requiredOption('--reason <code>', 'author_request | secret_leak | license | unsafe | superseded | other')
  .requiredOption('--out <path>', 'new revocation contribution directory')
  .option('--severity <level>', 'routine | urgent | critical')
  .option('--affected-digest <digests...>', 'additional closure digests whose public bodies must be withdrawn')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .option('--config <path>', 'local publisher configuration', '.aen/publisher.json')
  .action(async (experienceId: string, options: {
    reason: string
    out: string
    severity?: string
    affectedDigest?: string[]
    store: string
    config: string
  }) => {
    const reasons = ['author_request', 'secret_leak', 'license', 'unsafe', 'superseded', 'other'] as const
    const severities = ['routine', 'urgent', 'critical'] as const
    if (!reasons.includes(options.reason as typeof reasons[number])) throw new Error('unsupported revocation reason')
    if (options.severity !== undefined && !severities.includes(options.severity as typeof severities[number])) {
      throw new Error('unsupported revocation severity')
    }
    const configPath = resolve(options.config)
    const config = parsePublisherConfig(JSON.parse(await readFile(configPath, 'utf8')))
    const configDirectory = dirname(configPath)
    const key: NodeKeyPair = {
      keyid: config.key.keyid,
      privateKey: createPrivateKey(await readFile(resolve(configDirectory, config.key.privateKeyPath), 'utf8')),
      publicKey: createPublicKey(await readFile(resolve(configDirectory, config.key.publicKeyPath), 'utf8')),
    }
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      const inspected = store.inspect(experienceId)
      if (inspected === undefined || inspected.summary.objectType !== 'experience_revision') {
        throw new Error(`ExperienceRevision not found: ${experienceId}`)
      }
      const createdAt = new Date().toISOString()
      const result = createRevocationContribution(inspected.object, {
        actor: config.actor,
        key,
        reasonCode: options.reason as typeof reasons[number],
        ...(options.severity === undefined ? {} : { severity: options.severity as typeof severities[number] }),
        affectedDigests: [...new Set([
          inspected.summary.digest,
          ...(options.affectedDigest ?? []).map((digest) => {
            if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`invalid affected digest: ${digest}`)
            return digest as `sha256:${string}`
          }),
        ])],
        createdAt,
      })
      const directory = resolve(options.out)
      const inventory = await writeObjectContributionBundle(directory, {
        target: result.revocation as unknown as JsonRecord,
        objects: result.contributionObjects,
        actor: config.actor,
        createdAt,
      })
      process.stdout.write(`${JSON.stringify({
        revoked: true,
        target: result.revocation.target,
        revocation: { id: result.revocation.revocationId, digest: result.revocation.digest },
        contribution: { directory, objectCount: inventory.objects.length },
        requiredRegistryAction: 'In the same reviewed Git change, remove every contribution body named by affectedDigests from the registry current tree. Historical clones cannot be recalled.',
      }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

const observationCommand = program
  .command('observation')
  .description('Import measured RunObservations and create reviewable public contributions')

observationCommand
  .command('import')
  .description('Import a measured RunObservation and optional immutable dependencies into the local store')
  .argument('<path>', 'RunObservation JSON file')
  .option('--dependency <paths...>', 'additional AEXP Manifest/artifact/injection dependency JSON files')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .action(async (path: string, options: { dependency?: string[]; store: string }) => {
    const inputs = [path, ...(options.dependency ?? [])]
    const objects: JsonRecord[] = []
    for (const input of inputs) {
      const value: unknown = JSON.parse(await readFile(resolve(input), 'utf8'))
      const validation = validateProtocolObject(value)
      if (!validation.ok) {
        throw new Error(`${input} is not a valid AEXP object: ${validation.issues.map((issue) => issue.message).join('; ')}`)
      }
      objects.push(value as JsonRecord)
    }
    if (objects[0]?.objectType !== 'observation') throw new Error('primary input is not a RunObservation')
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      const stored = store.putBatch({
        objects: objects.map((object, index) => ({
          object,
          role: index === 0 ? 'consumption_observation' : 'observation_dependency',
        })),
      })
      process.stdout.write(`${JSON.stringify({ imported: true, objects: stored }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

observationCommand
  .command('contribute')
  .description('Promote one local measured Observation into a signed Git contribution')
  .argument('<observation-id>', 'local RunObservation id or digest')
  .requiredOption('--public', 'confirm that the target disclosure is public')
  .requiredOption('--out <path>', 'new contribution directory')
  .requiredOption('--consent <ref>', 'explicit consent or Git audit reference')
  .option('--claim <id>', 'exact Experience claim ID; required for contradicting relation')
  .option('--relation <kind>', 'supporting | contradicting', 'contradicting')
  .option('--scope-difference <text>', 'specific Model/Harness/task scope difference')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .option('--config <path>', 'local publisher configuration', '.aen/publisher.json')
  .option('--license <expression>', 'public Observation SPDX/license expression', 'CC-BY-4.0')
  .option('--policy-decision <ref>', 'public Observation policy decision reference', 'urn:aen:policy-decision:public-observation-v1')
  .action(async (observationId: string, options: {
    public: boolean
    out: string
    consent: string
    claim?: string
    relation: string
    scopeDifference?: string
    store: string
    config: string
    license: string
    policyDecision: string
  }) => {
    if (options.public !== true) throw new Error('only explicit --public Observation contribution is supported')
    if (!['supporting', 'contradicting'].includes(options.relation)) throw new Error('unsupported Observation relation')
    if (options.relation === 'contradicting' && options.claim === undefined) {
      throw new Error('--claim is required for a contradicting Observation')
    }
    const configPath = resolve(options.config)
    const config = parsePublisherConfig(JSON.parse(await readFile(configPath, 'utf8')))
    const configDirectory = dirname(configPath)
    const key: NodeKeyPair = {
      keyid: config.key.keyid,
      privateKey: createPrivateKey(await readFile(resolve(configDirectory, config.key.privateKeyPath), 'utf8')),
      publicKey: createPublicKey(await readFile(resolve(configDirectory, config.key.publicKeyPath), 'utf8')),
    }
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      const result = createObservationContributionFromStore(store, observationId, {
        actor: config.actor,
        key,
        consentRef: options.consent,
        policyDecisionRef: options.policyDecision,
        license: options.license,
        ...(options.claim === undefined ? {} : { claimId: options.claim }),
        relation: options.relation as 'supporting' | 'contradicting',
        ...(options.scopeDifference === undefined ? {} : { scopeDifference: options.scopeDifference }),
      })
      const directory = resolve(options.out)
      const inventory = await writeObjectContributionBundle(directory, result)
      process.stdout.write(`${JSON.stringify({
        contributed: true,
        observation: {
          id: result.observation.observationId,
          digest: result.observation.digest,
          experienceRef: result.observation.experienceRef,
        },
        ...(result.contention === undefined ? {} : {
          contention: { id: result.contention.contentionId, digest: result.contention.digest },
        }),
        contribution: { directory, objectCount: inventory.objects.length },
      }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

program
  .command('search')
  .description('Search local/private and/or public Experience cards without executing or installing anything')
  .argument('[query]', 'search text', '')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .option('--local', 'search local private store')
  .option('--public', 'search a public Hub')
  .option('--hub <url>', 'Reference Hub base URL; required with --public')
  .option('--taxonomy <tags>', 'comma-separated task-family tags for local filtering/public Task Capsule')
  .option('--limit <count>', 'maximum cards (1-3)', '3')
  .option('--model-provider <provider>', 'effective model provider for compatibility filtering')
  .option('--model-id <model>', 'effective model id for compatibility filtering')
  .option('--harness-config-digest <digest>', 'stable Harness configuration digest for compatibility filtering')
  .option('--harness-digest <digest>', 'HarnessManifest digest for compatibility filtering')
  .option('--allowed-licenses <licenses>', 'comma-separated license allowlist')
  .option('--min-evidence <level>', 'H0 | H1 | H2 | H3 | H4')
  .option('--max-risk <class>', 'read_only | reversible_write | external_write | destructive')
  .option('--max-mean-cost-usd <amount>', 'reject Experiences with unknown or higher mean cost')
  .option('--max-p95-latency-ms <milliseconds>', 'reject Experiences with unknown or higher p95 latency')
  .action(async (query: string, options: {
    store: string
    local?: boolean
    public?: boolean
    hub?: string
    taxonomy?: string
    limit: string
    modelProvider?: string
    modelId?: string
    harnessConfigDigest?: `sha256:${string}`
    harnessDigest?: `sha256:${string}`
    allowedLicenses?: string
    minEvidence?: string
    maxRisk?: string
    maxMeanCostUsd?: string
    maxP95LatencyMs?: string
  }) => {
    if (options.public === true && options.hub === undefined) throw new Error('--hub is required with --public')
    const limit = Number(options.limit)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw new Error('--limit must be 1, 2, or 3')
    if ((options.modelProvider === undefined) !== (options.modelId === undefined)) {
      throw new Error('--model-provider and --model-id must be supplied together')
    }
    const evidenceLevels = ['H0', 'H1', 'H2', 'H3', 'H4'] as const
    const riskClasses = ['read_only', 'reversible_write', 'external_write', 'destructive'] as const
    if (options.minEvidence !== undefined && !evidenceLevels.includes(options.minEvidence as typeof evidenceLevels[number])) {
      throw new Error('--min-evidence must be H0, H1, H2, H3, or H4')
    }
    if (options.maxRisk !== undefined && !riskClasses.includes(options.maxRisk as typeof riskClasses[number])) {
      throw new Error('--max-risk is invalid')
    }
    const maxMeanCostUsd = options.maxMeanCostUsd === undefined ? undefined : Number(options.maxMeanCostUsd)
    const maxP95LatencyMs = options.maxP95LatencyMs === undefined ? undefined : Number(options.maxP95LatencyMs)
    if (maxMeanCostUsd !== undefined && (!Number.isFinite(maxMeanCostUsd) || maxMeanCostUsd < 0)) {
      throw new Error('--max-mean-cost-usd must be non-negative')
    }
    if (maxP95LatencyMs !== undefined && (!Number.isFinite(maxP95LatencyMs) || maxP95LatencyMs < 0)) {
      throw new Error('--max-p95-latency-ms must be non-negative')
    }
    const taxonomy = options.taxonomy?.split(',').map((value) => value.trim()).filter(Boolean)
    const allowedLicenses = options.allowedLicenses?.split(',').map((value) => value.trim()).filter(Boolean)
    const policy = {
      ...(allowedLicenses === undefined ? {} : { allowedLicenses }),
      ...(options.minEvidence === undefined ? {} : { minEvidenceLevel: options.minEvidence as typeof evidenceLevels[number] }),
      ...(options.maxRisk === undefined ? {} : { maxRiskClass: options.maxRisk as typeof riskClasses[number] }),
      ...(maxMeanCostUsd === undefined ? {} : { maxMeanCostUsd }),
      ...(maxP95LatencyMs === undefined ? {} : { maxP95LatencyMs }),
    }
    const context = options.modelProvider === undefined && options.harnessConfigDigest === undefined && options.harnessDigest === undefined
        ? undefined
        : {
            ...(options.modelProvider === undefined ? {} : {
              model: {
                provider: options.modelProvider,
                modelId: options.modelId!,
                observedAt: new Date().toISOString(),
                mutability: 'unknown' as const,
              },
            }),
            ...(options.harnessConfigDigest === undefined ? {} : { harnessConfigurationDigest: options.harnessConfigDigest }),
            ...(options.harnessDigest === undefined ? {} : { harnessManifestDigest: options.harnessDigest }),
          }
    const request = {
      query,
      ...(taxonomy === undefined || taxonomy.length === 0 ? {} : { task: { taxonomy } }),
      ...(context === undefined ? {} : { context }),
      ...(Object.keys(policy).length === 0 ? {} : { policy }),
      responseBudget: { maxCards: limit },
      limit,
    }
    const results: Array<{ source: string; cards?: unknown[]; error?: string }> = []
    const useLocal = options.local === true || options.public !== true
    if (useLocal) {
      const store = new LocalEvidenceStore(resolve(options.store))
      try {
        results.push({ source: 'local', cards: searchLocalExperiences(store, request).cards })
      } finally {
        store.close()
      }
    }
    if (options.public === true) {
      const capsule = createTaskCapsule({
        taxonomy: taxonomy === undefined || taxonomy.length === 0 ? ['general'] : taxonomy,
        ...(query.length === 0 ? {} : { abstractIntent: query }),
        constraints: [],
        acceptanceTraits: [],
        riskClass: 'read_only',
        omittedSensitiveFields: ['rawPrompt', 'repositoryUrl', 'filePaths', 'artifactNames', 'sessionId'],
      })
      try {
        const cards = await new HubHttpExperienceSource(options.hub!).search({
          ...(capsule.abstractIntent === undefined ? {} : { query: capsule.abstractIntent }),
          task: { taxonomy: capsule.taxonomy, riskClass: capsule.riskClass },
          ...(context === undefined ? {} : { context }),
          policy: { visibility: ['public'], ...policy },
          responseBudget: { maxCards: limit },
          limit,
        })
        results.push({ source: 'public_hub', cards })
      } catch (error) {
        if (!useLocal) throw error
        results.push({ source: 'public_hub', error: error instanceof Error ? error.message : String(error) })
      }
    }
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`)
  })

program
  .command('fetch')
  .description('Fetch selected sections from a private local Experience')
  .argument('<experience-id>', 'Experience id or digest')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .option('--include <sections>', 'comma-separated sections', 'recipe,cases,evidence')
  .action((experienceId: string, options: { store: string; include: string }) => {
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      const include = options.include.split(',').map((value) => value.trim()).filter(Boolean)
      process.stdout.write(`${JSON.stringify(fetchExperienceSections(store, experienceId, include), null, 2)}\n`)
    } finally {
      store.close()
    }
  })

program
  .command('feedback')
  .description('Append local low-trust feedback without changing Experience evidence level')
  .argument('<experience-id>', 'local immutable Experience id or digest')
  .requiredOption('--decision <decision>', 'viewed | adopted | rejected | rolled_back')
  .option('--outcome <outcome>', 'helpful | neutral | harmful | unknown')
  .option('--reason <codes>', 'comma-separated reason codes')
  .option('--injection <path>', 'ContextInjectionObservation JSON; required for adopted')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .action(async (experienceId: string, options: {
    decision: string
    outcome?: string
    reason?: string
    injection?: string
    store: string
  }) => {
    const decisions = ['viewed', 'adopted', 'rejected', 'rolled_back'] as const
    const outcomes = ['helpful', 'neutral', 'harmful', 'unknown'] as const
    if (!decisions.includes(options.decision as typeof decisions[number])) throw new Error('unsupported feedback decision')
    if (options.outcome !== undefined && !outcomes.includes(options.outcome as typeof outcomes[number])) {
      throw new Error('unsupported feedback outcome')
    }
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      const inspected = store.inspect(experienceId)
      if (inspected === undefined || inspected.summary.objectType !== 'experience_revision') {
        throw new Error(`ExperienceRevision not found: ${experienceId}`)
      }
      const experience = inspected.object as unknown as ExperienceRevision
      let injectionObservation: ContextInjectionObservation | undefined
      if (options.injection !== undefined) {
        const value: unknown = JSON.parse(await readFile(resolve(options.injection), 'utf8'))
        const validation = validateProtocolObject(value)
        if (!validation.ok || (value as JsonRecord).objectType !== 'context_injection_observation') {
          throw new Error('injection JSON is not a valid ContextInjectionObservation')
        }
        injectionObservation = value as ContextInjectionObservation
      }
      const event = createFeedbackEvent({
        experienceRef: {
          experienceId: experience.experienceId,
          revision: experience.revision,
          digest: experience.digest,
        },
        decision: options.decision as typeof decisions[number],
        ...(options.outcome === undefined ? {} : { outcome: options.outcome as typeof outcomes[number] }),
        ...(options.reason === undefined ? {} : { reasonCodes: options.reason.split(',').map((value) => value.trim()).filter(Boolean) }),
        ...(injectionObservation === undefined ? {} : { injectionObservation }),
        sharingScope: 'local',
      })
      store.putBatch({ objects: [{ object: event as unknown as JsonRecord, role: 'local_consumer_feedback' }] })
      process.stdout.write(`${JSON.stringify({
        recorded: true,
        feedbackId: event.feedbackId,
        digest: event.digest,
        sharingScope: event.sharingScope,
        changesEvidenceLevel: false,
      }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

program
  .command('evaluate')
  .description('Run a preregistered matrix through a trusted module or the built-in official DSH headless driver')
  .argument('<benchmark-id>', 'primary local BenchmarkTask id or digest')
  .requiredOption('--matrix <path>', 'local JSON matrix plan')
  .option('--driver <path>', 'trusted local ESM module exporting an EvaluationDriver as driver or default')
  .option('--dsh-driver-config <path>', 'strict local JSON configuration for the built-in DSH headless driver')
  .option('--grader <path>', 'trusted local ESM module exporting a DshEvaluationGrader; required with --dsh-driver-config')
  .option('--store <path>', 'SQLite local evidence store', defaultStorePath())
  .action(async (benchmarkId: string, options: {
    matrix: string
    driver?: string
    dshDriverConfig?: string
    grader?: string
    store: string
  }) => {
    const matrixValue: unknown = JSON.parse(await readFile(resolve(options.matrix), 'utf8'))
    const plan = parseEvaluationMatrixPlan(matrixValue)
    if (!plan.benchmarkSelectors.includes(benchmarkId)) {
      throw new Error('benchmark-id must already be present in the preregistered matrix; runtime mutation is forbidden')
    }
    if ((options.driver === undefined) === (options.dshDriverConfig === undefined)) {
      throw new Error('select exactly one of --driver or --dsh-driver-config')
    }
    if (options.dshDriverConfig !== undefined && options.grader === undefined) {
      throw new Error('--grader is required with --dsh-driver-config')
    }
    if (options.driver !== undefined && options.grader !== undefined) {
      throw new Error('--grader is only valid with --dsh-driver-config')
    }
    const storePath = resolve(options.store)
    const store = new LocalEvidenceStore(storePath)
    try {
      let driver: EvaluationDriver
      if (options.driver !== undefined) {
        const loaded = await import(pathToFileURL(resolve(options.driver)).href) as {
          driver?: unknown
          default?: unknown
        }
        const candidate = loaded.driver ?? loaded.default
        if (
          candidate === null || typeof candidate !== 'object' ||
          typeof (candidate as { name?: unknown }).name !== 'string' ||
          typeof (candidate as { run?: unknown }).run !== 'function' ||
          !['live', 'recorded_run', 'synthetic_test'].includes(String((candidate as { executionMode?: unknown }).executionMode))
        ) throw new Error('driver module does not export a valid EvaluationDriver')
        driver = candidate as EvaluationDriver
      } else {
        const loadedGrader = await import(pathToFileURL(resolve(options.grader!)).href) as {
          grader?: unknown
          default?: unknown
        }
        const grader = loadedGrader.grader ?? loadedGrader.default
        if (
          grader === null || typeof grader !== 'object' ||
          typeof (grader as { name?: unknown }).name !== 'string' ||
          typeof (grader as { grade?: unknown }).grade !== 'function' ||
          !Array.isArray((grader as { graderRefDigests?: unknown }).graderRefDigests)
        ) throw new Error('grader module does not export a valid DshEvaluationGrader')
        const config = parseDshEvaluationDriverConfig(
          JSON.parse(await readFile(resolve(options.dshDriverConfig!), 'utf8')),
        )
        driver = await createDshEvaluationDriver({
          config,
          store,
          storePath,
          grader: grader as DshEvaluationGrader,
        }) as unknown as EvaluationDriver
      }
      const result = await runEvaluationMatrix(store, plan, driver)
      process.stdout.write(`${JSON.stringify({
        experimentId: plan.experimentId,
        driver: { name: driver.name, executionMode: driver.executionMode },
        trialCount: result.trials.length,
        observationCount: result.observations.length,
        aggregate: {
          aggregateId: result.aggregate.aggregateId,
          digest: result.aggregate.digest,
          totalTrials: result.aggregate.totalTrials,
          validTrials: result.aggregate.validTrials,
          statusCounts: result.aggregate.statusCounts,
          cellSummaries: result.aggregate.cellSummaries,
          comparisons: result.aggregate.comparisons.map((comparison) => ({
            ...comparison,
            evidenceDecision: comparisonEvidenceDecision(result.aggregate, comparison.comparisonId),
          })),
        },
        benchmarkAggregates: result.benchmarkAggregates.map((aggregate) => ({
          aggregateId: aggregate.aggregateId,
          digest: aggregate.digest,
          benchmarkRefs: aggregate.benchmarkRefs,
          totalTrials: aggregate.totalTrials,
          validTrials: aggregate.validTrials,
          statusCounts: aggregate.statusCounts,
          cellSummaries: aggregate.cellSummaries,
          comparisons: aggregate.comparisons.map((comparison) => ({
            ...comparison,
            evidenceDecision: comparisonEvidenceDecision(aggregate, comparison.comparisonId),
          })),
        })),
        coverage: result.coverage,
        pilotClaim: driver.executionMode === 'synthetic_test'
          ? 'Synthetic test mode cannot satisfy M3 real-pilot DoD or support H3.'
          : 'Eligibility is comparison-specific; inspect counterfactualEligibility and provenance before making a claim.',
      }, null, 2)}\n`)
    } finally {
      store.close()
    }
  })

const pilot = program.command('pilot').description('Validate and operate the frozen external MVP Pilot protocol')

pilot
  .command('validate')
  .description('Fail closed unless a frozen preregistration can support the real 2×2×2 cross-user Pilot')
  .argument('<path>', 'pilot preregistration JSON')
  .option('--store <path>', 'SQLite local evidence store containing exact Benchmark, Manifest, and Experience revisions', defaultStorePath())
  .action(async (path: string, options: { store: string }) => {
    let preregistration: PilotPreregistration
    try {
      preregistration = parsePilotPreregistration(JSON.parse(await readFile(resolve(path), 'utf8')))
    } catch (error) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        errors: [`PREREGISTRATION_INVALID: ${error instanceof Error ? error.message : String(error)}`],
      }, null, 2)}\n`)
      process.exitCode = 1
      return
    }
    const store = new LocalEvidenceStore(resolve(options.store))
    try {
      const report = validatePilotPreregistration(store, preregistration)
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      if (!report.ok) process.exitCode = 1
    } finally {
      store.close()
    }
  })

program
  .command('validate')
  .description('Validate one AEXP protocol object')
  .argument('<path>', 'path to a JSON object')
  .action(async (path: string) => {
    const absolutePath = resolve(path)
    const value: unknown = JSON.parse(await readFile(absolutePath, 'utf8'))
    const result = validateProtocolObject(value)
    if (!result.ok) {
      process.stderr.write(`${JSON.stringify({ valid: false, issues: result.issues }, null, 2)}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write(`${JSON.stringify({ valid: true }, null, 2)}\n`)
  })

const conformance = program.command('conformance').description('Run AEXP conformance checks')

conformance
  .command('run')
  .option('--root <path>', 'repository root containing conformance fixtures', process.cwd())
  .action(async ({ root }: { root: string }) => {
    const base = resolve(root)
    const readJson = async (relativePath: string): Promise<JsonRecord> =>
      JSON.parse(await readFile(resolve(base, relativePath), 'utf8')) as JsonRecord
    const failures: string[] = []

    const validFiles = (await readdir(resolve(base, 'conformance/valid')))
      .filter((name) => name.endsWith('.json'))
      .sort()
    for (const file of validFiles) {
      const result = validateProtocolObject(await readJson(`conformance/valid/${file}`))
      if (!result.ok) failures.push(`valid/${file}: ${JSON.stringify(result.issues)}`)
    }

    const invalidFiles = (await readdir(resolve(base, 'conformance/invalid')))
      .filter((name) => name.endsWith('.json'))
      .sort()
    for (const file of invalidFiles) {
      if (file === 'attestation-signature-tampered.json') continue
      const result = validateProtocolObject(await readJson(`conformance/invalid/${file}`))
      if (result.ok) failures.push(`invalid/${file}: unexpectedly accepted`)
    }

    const publicKey = createPublicKey(
      await readFile(resolve(base, 'conformance/keys/fixture-ed25519-public.pem'), 'utf8'),
    )
    const subject = (await readJson('conformance/keys/fixture-subject.json')) as unknown as ObjectRef
    const resolveFixtureKey = (keyid: string) =>
      keyid === 'https://aen.dev/conformance/keys/fixture-ed25519' ? publicKey : undefined
    const validAttestation = await readJson('conformance/valid/attestation.json')
    const validSignature = verifyAttestation(validAttestation, {
      expectedSubject: subject,
      resolveKey: resolveFixtureKey,
    })
    if (!validSignature.ok) failures.push(`valid/attestation.json: ${validSignature.errors.join('; ')}`)

    const tamperedAttestation = await readJson(
      'conformance/invalid/attestation-signature-tampered.json',
    )
    if (verifyAttestation(tamperedAttestation, { expectedSubject: subject, resolveKey: resolveFixtureKey }).ok) {
      failures.push('invalid/attestation-signature-tampered.json: unexpectedly accepted')
    }

    const golden = await readJson('conformance/golden-digests/aexp-0.1.json')
    for (const file of validFiles) {
      const object = await readJson(`conformance/valid/${file}`)
      const objectType = String(object.objectType)
      if (golden[objectType] !== object.digest) {
        failures.push(`golden/${objectType}: digest does not match valid fixture`)
      }
    }

    const summary = {
      validFixtures: validFiles.length,
      invalidFixtures: invalidFiles.length,
      goldenDigests: Object.keys(golden).length,
      failures,
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    if (failures.length > 0) process.exitCode = 1
  })

await program.parseAsync(process.argv)
