import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import {
  canonicalJson,
  toObjectRef,
  validateProtocolObject,
  verifyAttestation,
  type Attestation,
  type BenchmarkTask,
  type Contention,
  type EvaluationAggregate,
  type EvaluationTrial,
  type ExperienceRevision,
  type JsonRecord,
  type RunObservation,
  type Revocation,
} from '@aen/protocol'
import {
  assertContributionGraphClosed,
  assertMvpPublicArtifactDisclosure,
  assertNoHazardousInstructions,
  assertNoRestrictedContent,
  findUnreachableContributionObjects,
  type ContributionInventory,
} from '@aen/promotion'
import type { AuthorizedPublisherKey, IngestedContribution } from './types.js'

const MAX_CONTRIBUTION_OBJECTS = 10_000
const MAX_CONTRIBUTION_BYTES = 64 * 1024 * 1024
const MAX_OBJECT_BYTES = 4 * 1024 * 1024
const MAX_JSON_DEPTH = 64
const MAX_JSON_NODES = 100_000
const MAX_JSON_STRING_BYTES = 512 * 1024

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as JsonRecord
}

function assertJsonResourceLimits(value: unknown, label: string): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0
  while (stack.length > 0) {
    const item = stack.pop()
    if (item === undefined) break
    nodes += 1
    if (nodes > MAX_JSON_NODES) throw new Error(`${label} exceeds JSON node limit`)
    if (item.depth > MAX_JSON_DEPTH) throw new Error(`${label} exceeds JSON depth limit`)
    if (typeof item.value === 'string' && Buffer.byteLength(item.value, 'utf8') > MAX_JSON_STRING_BYTES) {
      throw new Error(`${label} exceeds JSON string limit`)
    }
    if (Array.isArray(item.value)) {
      if (item.value.length > MAX_JSON_NODES) throw new Error(`${label} exceeds JSON array limit`)
      item.value.forEach((child) => stack.push({ value: child, depth: item.depth + 1 }))
    } else if (item.value !== null && typeof item.value === 'object') {
      const entries = Object.values(item.value as JsonRecord)
      if (entries.length > 10_000) throw new Error(`${label} exceeds JSON object-key limit`)
      entries.forEach((child) => stack.push({ value: child, depth: item.depth + 1 }))
    }
  }
}

function assertPublicArtifactPolicy(objects: readonly JsonRecord[]): void {
  for (const object of objects) {
    if (object.objectType !== 'artifact') continue
    assertMvpPublicArtifactDisclosure(object)
  }
}

function inventory(value: unknown): ContributionInventory {
  const candidate = record(value, 'inventory')
  if (
    candidate.profile !== 'aen-git-contribution-v0.1' ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.targetDigest !== 'string' ||
    candidate.actor === null || typeof candidate.actor !== 'object' ||
    !Array.isArray(candidate.objects)
  ) throw new Error('contribution inventory is invalid')
  if (candidate.objects.length === 0 || candidate.objects.length > MAX_CONTRIBUTION_OBJECTS) {
    throw new Error(`contribution object count must be 1-${MAX_CONTRIBUTION_OBJECTS}`)
  }
  return candidate as unknown as ContributionInventory
}

function keyAvailableAt(key: AuthorizedPublisherKey, at: string): boolean {
  const instant = Date.parse(at)
  if (!Number.isFinite(instant)) return false
  if (key.validFrom !== undefined && instant < Date.parse(key.validFrom)) return false
  if (key.revokedAt !== undefined && instant >= Date.parse(key.revokedAt)) return false
  return true
}

export function assertAuthorizedRevocation(
  revocation: Revocation,
  authorizedKeys: readonly AuthorizedPublisherKey[],
): void {
  const validation = validateProtocolObject(revocation)
  if (!validation.ok) throw new Error(`invalid revocation: ${validation.issues.map((issue) => issue.message).join('; ')}`)
  if (revocation.attestation.issuer.actorId !== revocation.actor.actorId) {
    throw new Error('revocation actor does not match attestation issuer')
  }
  if (!revocation.affectedDigests.includes(revocation.target.digest)) {
    throw new Error('revocation affectedDigests must include its target digest')
  }
  verifySignedObject(
    revocation as unknown as JsonRecord,
    [revocation.attestation],
    revocation.actor.actorId,
    revocation.createdAt,
    authorizedKeys,
  )
}

function verifySignedObject(
  object: JsonRecord,
  attestations: readonly Attestation[],
  actorId: string,
  createdAt: string,
  authorizedKeys: readonly AuthorizedPublisherKey[],
): string[] {
  const allowed = authorizedKeys.filter((key) => key.actorId === actorId && keyAvailableAt(key, createdAt))
  const verified = new Set<string>()
  for (const attestation of attestations) {
    if (attestation.issuer.actorId !== actorId) continue
    const result = verifyAttestation(attestation, {
      expectedSubject: toObjectRef(object),
      resolveKey: (keyid) => allowed.find((key) => key.keyid === keyid)?.publicKey,
      now: new Date(createdAt),
    })
    if (result.ok) result.verifiedKeyIds.forEach((keyid) => verified.add(keyid))
  }
  if (verified.size === 0) throw new Error(`no authorized signature verified for ${String(object.objectType)} ${String(object.digest)}`)
  return [...verified]
}

function highestEvidenceLevel(experience: ExperienceRevision): number {
  const order = new Map([['H0', 0], ['H1', 1], ['H2', 2], ['H3', 3], ['H4', 4]])
  return Math.max(...experience.claims.map((claim) => order.get(claim.evidenceLevel) ?? -1))
}

function assertPublicObservationGovernance(
  observation: RunObservation,
  actorId: string,
): void {
  const governance = observation.governance
  if (governance?.visibility !== 'public') throw new Error('public Observation has no public governance')
  if (governance.license === undefined || governance.license.trim().length === 0) {
    throw new Error('public Observation has no license')
  }
  if (governance.consentRef === undefined || governance.consentRef.trim().length === 0) {
    throw new Error('public Observation has no consentRef')
  }
  if (governance.redistribution !== 'public_mirrors') {
    throw new Error('public Observation does not permit public mirror redistribution')
  }
  if (governance.redactionReport.humanReviewed !== true) {
    throw new Error('public Observation was not human-reviewed')
  }
  if (governance.dataClasses.some((value) => value !== 'public')) {
    throw new Error('public Observation declares a non-public data class')
  }
  if (governance.owner.actorId !== actorId) {
    throw new Error('inventory actor does not own the public Observation')
  }
}

function enforceEvidencePolicy(experience: ExperienceRevision, objects: readonly JsonRecord[]): void {
  const byDigest = new Map(objects.map((object) => [String(object.digest), object]))
  for (const claim of experience.claims) {
    if (claim.evidenceLevel === 'H3' && claim.mode !== 'causal') {
      throw new Error(`H3 claim must be causal: ${claim.claimId}`)
    }
    if (claim.evidenceLevel === 'H4') {
      throw new Error(`public H4 claims require the post-MVP independent-replication policy: ${claim.claimId}`)
    }
    for (const ref of claim.supportingEvidenceRefs) {
      if (!byDigest.has(ref.digest)) throw new Error(`claim evidence does not resolve: ${claim.claimId} ${ref.digest}`)
    }
  }
  if (highestEvidenceLevel(experience) < 3) return

  const aggregateRelations = experience.relations.filter((relation) =>
    relation.type === 'evaluated_on' && relation.target.objectType === 'evaluation_aggregate')
  if (aggregateRelations.length === 0) throw new Error('H3 public Experience requires an evaluated_on aggregate relation')
  let eligible = false
  for (const relation of aggregateRelations) {
    const aggregate = byDigest.get(relation.target.digest) as unknown as EvaluationAggregate | undefined
    if (aggregate?.objectType !== 'evaluation_aggregate') continue
    const trials = aggregate.trialRefs.map((ref) => byDigest.get(ref.digest) as unknown as EvaluationTrial | undefined)
    if (trials.some((trial) => trial?.objectType !== 'evaluation_trial')) {
      throw new Error(`EvaluationAggregate trialRefs do not resolve: ${aggregate.aggregateId}`)
    }
    if (aggregate.totalTrials !== trials.length) {
      throw new Error(`EvaluationAggregate totalTrials is inconsistent: ${aggregate.aggregateId}`)
    }
    const concreteTrials = trials as EvaluationTrial[]
    const observations = concreteTrials.map((trial) =>
      byDigest.get(trial.runObservationRef.digest) as unknown as RunObservation | undefined)
    const benchmarks = concreteTrials.map((trial) =>
      byDigest.get(trial.benchmarkRef.digest) as unknown as BenchmarkTask | undefined)
    if (observations.some((observation) => observation?.objectType !== 'observation')) {
      throw new Error(`EvaluationTrial RunObservation refs do not resolve: ${aggregate.aggregateId}`)
    }
    if (benchmarks.some((benchmark) => benchmark?.objectType !== 'benchmark_task')) {
      throw new Error(`EvaluationTrial Benchmark refs do not resolve: ${aggregate.aggregateId}`)
    }
    concreteTrials.forEach((trial, index) => {
      const observation = observations[index]!
      if (
        trial.experimentId !== aggregate.experimentId ||
        observation.experiment?.experimentId !== aggregate.experimentId ||
        observation.experiment.cellId !== trial.cellId ||
        observation.experiment.trialIndex !== trial.trialIndex ||
        observation.experiment.attemptIndex !== trial.attemptIndex
      ) throw new Error(`EvaluationTrial coordinates disagree with RunObservation: ${trial.trialId}`)
    })
    const actualStatusCounts = concreteTrials.reduce<Record<string, number>>((counts, trial) => {
      counts[trial.status] = (counts[trial.status] ?? 0) + 1
      return counts
    }, {})
    for (const [status, count] of Object.entries(aggregate.statusCounts)) {
      if ((actualStatusCounts[status] ?? 0) !== count) {
        throw new Error(`EvaluationAggregate statusCounts are inconsistent: ${aggregate.aggregateId}`)
      }
    }
    for (const [status, count] of Object.entries(actualStatusCounts)) {
      if (aggregate.statusCounts[status] !== count) {
        throw new Error(`EvaluationAggregate omitted an observed status: ${aggregate.aggregateId}`)
      }
    }
    const aggregateTrialDigests = new Set(concreteTrials.map((trial) => trial.digest))
    const cellTrialDigests = aggregate.cellSummaries.flatMap((cell) => cell.trialRefs.map((ref) => ref.digest))
    if (
      cellTrialDigests.length !== aggregateTrialDigests.size ||
      cellTrialDigests.some((digest) => !aggregateTrialDigests.has(digest))
    ) throw new Error(`EvaluationAggregate cell trial partition is inconsistent: ${aggregate.aggregateId}`)
    const modes = trials.map((trial) => trial?.extensions?.['https://aen.dev/extensions/aen/evaluation-execution-mode'])
    if (modes.some((mode) => mode === 'synthetic_test' || mode === undefined)) continue
    const eligibleComparisons = aggregate.comparisons.filter((comparison) =>
      comparison.counterfactualEligibility.status === 'eligible')
    if (eligibleComparisons.length > 0 && benchmarks.some((benchmark) => benchmark!.validity.status !== 'validated')) {
      throw new Error(`eligible comparison uses a BenchmarkTask that is not validated: ${aggregate.aggregateId}`)
    }
    for (const comparison of eligibleComparisons) {
      const baseline = aggregate.cellSummaries.find((cell) => cell.cellId === comparison.baselineCellId)
      const treatment = aggregate.cellSummaries.find((cell) => cell.cellId === comparison.treatmentCellId)
      if (baseline === undefined || treatment === undefined) {
        throw new Error(`eligible comparison references a missing cell: ${comparison.comparisonId}`)
      }
      if (comparison.comparisonKind === 'experience_uplift') {
        if (baseline.treatment !== 'baseline' || treatment.treatment !== 'experience_applied') {
          throw new Error(`experience_uplift comparison has invalid treatment labels: ${comparison.comparisonId}`)
        }
        if (experience.supersedes === undefined) {
          throw new Error('public H3 experience_uplift requires a prior public supersedes revision')
        }
        const predecessor = experience.supersedes
        const treatmentDigests = new Set(treatment.trialRefs.map((ref) => ref.digest))
        concreteTrials.forEach((trial, index) => {
          if (!treatmentDigests.has(trial.digest)) return
          const ref = observations[index]!.experienceRef
          if (
            ref?.experienceId !== predecessor.experienceId ||
            ref?.revision !== predecessor.revision ||
            ref?.digest !== predecessor.digest
          ) throw new Error('H3 treatment Observation does not reference the exact prior public revision')
        })
      }
    }
    if (eligibleComparisons.length > 0) {
      eligible = true
    }
  }
  if (!eligible) throw new Error('H3 public Experience has no eligible non-synthetic controlled comparison')
}

export async function loadContributionBundle(
  directory: string,
  authorizedKeys: readonly AuthorizedPublisherKey[],
): Promise<IngestedContribution> {
  const root = await realpath(resolve(directory))
  const inventoryPath = resolve(root, 'inventory.json')
  const inventoryJcsPath = resolve(root, 'inventory.jcs.json')
  const rootEntries = await readdir(root, { withFileTypes: true })
  const allowedRootEntries = new Set(['inventory.json', 'inventory.jcs.json', 'objects'])
  if (rootEntries.some((entry) => !allowedRootEntries.has(entry.name))) {
    throw new Error('contribution root contains files outside the signed inventory layout')
  }
  if (!rootEntries.some((entry) => entry.name === 'objects' && entry.isDirectory())) {
    throw new Error('contribution objects directory is missing')
  }
  if ((await stat(inventoryPath)).size > MAX_OBJECT_BYTES || (await stat(inventoryJcsPath)).size > MAX_OBJECT_BYTES) {
    throw new Error('contribution inventory exceeds byte limit')
  }
  const inventoryValue: unknown = JSON.parse(await readFile(inventoryPath, 'utf8'))
  assertJsonResourceLimits(inventoryValue, 'inventory.json')
  const parsedInventory = inventory(inventoryValue)
  const inventoryJcs = await readFile(inventoryJcsPath, 'utf8')
  if (inventoryJcs !== canonicalJson(parsedInventory)) throw new Error('inventory.jcs.json is not the canonical inventory')
  const listedPaths = new Set<string>()
  const objects: JsonRecord[] = []
  let totalBytes = 0
  for (const entry of parsedInventory.objects) {
    if (listedPaths.has(entry.path)) throw new Error(`duplicate inventory path: ${entry.path}`)
    listedPaths.add(entry.path)
    if (!/^objects\/[A-Za-z0-9._-]+\.json$/.test(entry.path) || entry.path.includes('\\') || entry.path.split('/').includes('..')) {
      throw new Error(`unsafe inventory path: ${entry.path}`)
    }
    const absolutePath = resolve(root, entry.path)
    if (!absolutePath.startsWith(`${root}${sep}`)) throw new Error(`inventory path escapes contribution: ${entry.path}`)
    const linkCheck = await lstat(absolutePath)
    if (linkCheck.isSymbolicLink() || !linkCheck.isFile()) throw new Error(`object path must be a regular file: ${entry.path}`)
    const resolvedPath = await realpath(absolutePath)
    if (!resolvedPath.startsWith(`${root}${sep}`)) throw new Error(`object resolves outside contribution: ${entry.path}`)
    const objectBytes = (await stat(resolvedPath)).size
    if (objectBytes > MAX_OBJECT_BYTES) throw new Error(`${entry.path} exceeds per-object byte limit`)
    totalBytes += objectBytes
    if (totalBytes > MAX_CONTRIBUTION_BYTES) throw new Error('contribution exceeds byte limit')
    const parsed: unknown = JSON.parse(await readFile(resolvedPath, 'utf8'))
    assertJsonResourceLimits(parsed, entry.path)
    const object = record(parsed, entry.path)
    const validation = validateProtocolObject(object)
    if (!validation.ok) throw new Error(`${entry.path} is invalid: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`)
    const ref = toObjectRef(object)
    if (
      ref.objectType !== entry.objectType || ref.refId !== entry.refId ||
      ref.revision !== entry.revision || ref.digest !== entry.digest
    ) throw new Error(`inventory metadata does not match ${entry.path}`)
    assertNoRestrictedContent(object, entry.path)
    objects.push(object)
  }
  const objectFiles = await readdir(resolve(root, 'objects'), { withFileTypes: true })
  const listedNames = new Set([...listedPaths].map((path) => path.slice('objects/'.length)))
  if (
    objectFiles.length !== listedNames.size ||
    objectFiles.some((entry) => !entry.isFile() || !listedNames.has(entry.name))
  ) throw new Error('objects directory contains files absent from inventory')
  assertContributionGraphClosed(objects)
  assertPublicArtifactPolicy(objects)

  const target = objects.find((object) => object.digest === parsedInventory.targetDigest)
  if (target === undefined) throw new Error('inventory target does not resolve')
  let targetKeys: string[]
  let observationKeys: string[] = []
  let typedTarget: ExperienceRevision | Revocation | RunObservation
  if (target.objectType === 'experience_revision') {
    const experience = target as unknown as ExperienceRevision
    if (experience.governance.visibility !== 'public') throw new Error('Hub only ingests public Experience targets')
    if (experience.governance.license === undefined || experience.governance.license.trim().length === 0) {
      throw new Error('public Experience has no license')
    }
    if (experience.governance.consentRef === undefined) throw new Error('public Experience has no consentRef')
    if (experience.governance.redactionReport.humanReviewed !== true) throw new Error('public Experience was not human-reviewed')
    if (experience.publisher.actorId !== parsedInventory.actor.actorId || experience.governance.owner.actorId !== parsedInventory.actor.actorId) {
      throw new Error('inventory actor does not own and publish the Experience')
    }
    assertNoHazardousInstructions(experience, 'public Experience')
    targetKeys = verifySignedObject(
      target,
      experience.attestations ?? [],
      parsedInventory.actor.actorId,
      experience.createdAt,
      authorizedKeys,
    )
    observationKeys = objects
      .filter((object) => object.objectType === 'observation')
      .flatMap((object) => {
        const observation = object as unknown as RunObservation
        assertPublicObservationGovernance(observation, parsedInventory.actor.actorId)
        return verifySignedObject(
          object,
          [observation.attestation].filter((value): value is Attestation => value !== undefined),
          parsedInventory.actor.actorId,
          observation.createdAt,
          authorizedKeys,
        )
      })
    enforceEvidencePolicy(experience, objects)
    typedTarget = experience
  } else if (target.objectType === 'revocation') {
    const revocation = target as unknown as Revocation
    if (revocation.actor.actorId !== parsedInventory.actor.actorId) {
      throw new Error('inventory actor does not match the Revocation actor')
    }
    assertAuthorizedRevocation(revocation, authorizedKeys)
    targetKeys = verifySignedObject(
      target,
      [revocation.attestation],
      parsedInventory.actor.actorId,
      revocation.createdAt,
      authorizedKeys,
    )
    typedTarget = revocation
  } else if (target.objectType === 'observation') {
    const observation = target as unknown as RunObservation
    if (observation.experienceRef === undefined) {
      throw new Error('standalone public Observation requires an exact Experience ref')
    }
    assertPublicObservationGovernance(observation, parsedInventory.actor.actorId)
    if (observation.independence.evaluatorActor.actorId !== parsedInventory.actor.actorId) {
      throw new Error('standalone Observation evaluator does not match inventory actor')
    }
    const unreachable = findUnreachableContributionObjects(observation.digest, objects, ['contention'])
    if (unreachable.length > 0) {
      throw new Error(`standalone Observation contribution contains unreferenced objects: ${unreachable.map((object) => String(object.digest)).join(', ')}`)
    }
    targetKeys = verifySignedObject(
      target,
      [observation.attestation].filter((value): value is Attestation => value !== undefined),
      parsedInventory.actor.actorId,
      observation.createdAt,
      authorizedKeys,
    )
    const observationRef = toObjectRef(target)
    observationKeys = objects
      .filter((object) => object.objectType === 'contention')
      .flatMap((object) => {
        const contention = object as unknown as Contention
        const claimExperience = contention.claimRef.experienceRef
        if (
          claimExperience.refId !== observation.experienceRef?.experienceId ||
          claimExperience.revision !== observation.experienceRef?.revision ||
          claimExperience.digest !== observation.experienceRef?.digest
        ) throw new Error('Contention claim ref does not match standalone Observation Experience ref')
        const evidence = [...contention.supporting, ...contention.contradicting]
        if (!evidence.some((ref) => ref.digest === observationRef.digest && ref.refId === observationRef.refId)) {
          throw new Error('Contention does not reference the standalone Observation')
        }
        return verifySignedObject(
          object,
          contention.attestations ?? [],
          parsedInventory.actor.actorId,
          contention.openedAt,
          authorizedKeys,
        )
      })
    typedTarget = observation
  } else {
    throw new Error(`unsupported contribution target type: ${String(target.objectType)}`)
  }
  return {
    root,
    inventory: parsedInventory,
    target: typedTarget,
    objects,
    verifiedKeyIds: [...new Set([...targetKeys, ...observationKeys])],
  }
}
