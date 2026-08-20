import { Type, type Static, type TSchema } from '@sinclair/typebox'
import {
  AcceptanceResultSchema,
  ActorRefSchema,
  ApplicabilitySchema,
  ArtifactKindSchema,
  ArtifactRefSchema,
  AttachmentRefSchema,
  AttestationSchema,
  CasePairSchema,
  DigestSchema,
  DisclosureLevelSchema,
  EnvironmentFingerprintSchema,
  EvidenceLevelSchema,
  EvidenceRefSchema,
  ExperienceKindSchema,
  GovernanceSchema,
  JsonValueSchema,
  MetricSummarySchema,
  ModelFingerprintSchema,
  ObjectRefSchema,
  ProtocolExtensionProperties,
  RecipeSchema,
  RedactedExcerptSchema,
  RedactionReportSchema,
  RiskClassSchema,
  RunMetricsSchema,
  ScalarSelectorSchema,
  TaskDefinitionSchema,
  TimestampSchema,
  UriSchema,
} from './components.js'

const schemaOptions = (name: string) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `https://aen.dev/schemas/aexp/0.1/${name}.schema.json`,
})

export const EvidenceGapReportSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('evidence_gap_report'),
    reportId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    episodeId: Type.String({ minLength: 1 }),
    missing: Type.Array(
      Type.Object({
        field: Type.String({ minLength: 1 }),
        reason: Type.Union(
          ['not_recorded', 'redacted', 'unavailable', 'unsupported_adapter', 'license_denied'].map(
            (value) => Type.Literal(value),
          ),
        ),
        consequence: Type.String({ minLength: 1 }),
        remediation: Type.Optional(Type.String()),
      }),
    ),
    conflicts: Type.Array(
      Type.Object({
        field: Type.String({ minLength: 1 }),
        sources: Type.Array(
          Type.Object({
            sourceRef: ObjectRefSchema,
            valueDigest: DigestSchema,
          }),
        ),
        resolution: Type.Union(
          ['unresolved', 'prefer_effective_surface', 'prefer_manifest', 'manual'].map((value) =>
            Type.Literal(value),
          ),
        ),
        note: Type.Optional(Type.String()),
      }),
    ),
    maximumEvidenceLevel: EvidenceLevelSchema,
    generatedAt: TimestampSchema,
    ...ProtocolExtensionProperties,
  },
  schemaOptions('evidence-gap-report'),
)
export type EvidenceGapReport = Static<typeof EvidenceGapReportSchema>

export const TaskEpisodeSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('task_episode'),
    episodeId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    sessionDigest: DigestSchema,
    eventRange: Type.Object({
      fromSeq: Type.Integer({ minimum: 0 }),
      toSeq: Type.Integer({ minimum: 0 }),
    }),
    task: TaskDefinitionSchema,
    boundaryReasons: Type.Array(Type.String(), { minItems: 1 }),
    outcome: Type.Union(
      ['success', 'partial', 'failure', 'unknown'].map((value) => Type.Literal(value)),
    ),
    evidenceGapReportRef: ObjectRefSchema,
    ...ProtocolExtensionProperties,
  },
  schemaOptions('task-episode'),
)
export type TaskEpisode = Static<typeof TaskEpisodeSchema>

export const TraceEvidenceBundleSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('trace_evidence'),
    evidenceId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    source: Type.Object({
      harness: Type.String({ minLength: 1 }),
      sessionDigest: DigestSchema,
      schemaNamespace: UriSchema,
      schemaVersion: Type.Optional(Type.String()),
      exporterVersion: Type.Optional(Type.String()),
      mappingProfile: Type.String({ minLength: 1 }),
      mappingVersion: Type.String({ minLength: 1 }),
    }),
    eventRange: Type.Object({
      fromSeq: Type.Integer({ minimum: 0 }),
      toSeq: Type.Integer({ minimum: 0 }),
    }),
    episodeDigest: DigestSchema,
    excerpts: Type.Array(RedactedExcerptSchema),
    commitments: Type.Optional(
      Type.Object({
        rawTraceDigest: Type.Optional(DigestSchema),
        artifactDigests: Type.Optional(Type.Array(DigestSchema)),
      }),
    ),
    localLocator: Type.Optional(Type.String()),
    disclosure: DisclosureLevelSchema,
    redaction: RedactionReportSchema,
    ...ProtocolExtensionProperties,
  },
  schemaOptions('trace-evidence'),
)
export type TraceEvidenceBundle = Static<typeof TraceEvidenceBundleSchema>

export const HarnessManifestSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('harness_manifest'),
    manifestId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    /** Stable identity of the effective Harness configuration across run-local snapshots. */
    configurationDigest: DigestSchema,
    capturedAt: TimestampSchema,
    adapter: Type.Object({ name: Type.String({ minLength: 1 }), version: Type.String({ minLength: 1 }) }),
    harness: Type.Object({
      name: Type.String({ minLength: 1 }),
      version: Type.String({ minLength: 1 }),
      commit: Type.Optional(Type.String()),
      distribution: Type.Optional(Type.String()),
    }),
    sessionScope: Type.Object({
      sessionDigest: Type.Optional(DigestSchema),
      fromSeq: Type.Optional(Type.Integer({ minimum: 0 })),
      toSeq: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    preset: Type.Optional(
      Type.Object({
        id: Type.String({ minLength: 1 }),
        compositionDigest: Type.Optional(DigestSchema),
        trust: Type.Optional(
          Type.Union(['system', 'user', 'unknown'].map((value) => Type.Literal(value))),
        ),
      }),
    ),
    modelSurface: Type.Object({
      systemPromptDigest: Type.Optional(DigestSchema),
      toolSchemaSetDigest: Type.Optional(DigestSchema),
      skillCatalogDigest: Type.Optional(DigestSchema),
      memorySurfaceDigest: Type.Optional(DigestSchema),
      requestConfigDigest: Type.Optional(DigestSchema),
    }),
    artifacts: Type.Array(ArtifactRefSchema),
    policies: Type.Object({
      sandbox: Type.Optional(JsonValueSchema),
      approval: Type.Optional(JsonValueSchema),
      filesystem: Type.Optional(JsonValueSchema),
      network: Type.Optional(JsonValueSchema),
      compaction: Type.Optional(JsonValueSchema),
      retry: Type.Optional(JsonValueSchema),
      subagents: Type.Optional(JsonValueSchema),
      memory: Type.Optional(JsonValueSchema),
      contextSelection: Type.Optional(JsonValueSchema),
      toolTimeout: Type.Optional(JsonValueSchema),
    }),
    environment: EnvironmentFingerprintSchema,
    coverage: Type.Object({
      mode: Type.Union(['trace_only', 'live_snapshot'].map((value) => Type.Literal(value))),
      models: Type.Union(['none', 'partial', 'complete'].map((value) => Type.Literal(value))),
      tools: Type.Union(
        ['none', 'surface_only', 'complete'].map((value) => Type.Literal(value)),
      ),
      skills: Type.Union(
        ['none', 'catalog_only', 'invoked_only', 'complete'].map((value) => Type.Literal(value)),
      ),
      preset: Type.Union(
        ['none', 'id_only', 'composition_digest', 'complete'].map((value) => Type.Literal(value)),
      ),
      policies: Type.Union(['none', 'partial', 'complete'].map((value) => Type.Literal(value))),
      effectiveSurface: Type.Union(
        ['none', 'partial', 'complete'].map((value) => Type.Literal(value)),
      ),
      limitations: Type.Array(Type.String()),
    }),
    attestation: Type.Optional(AttestationSchema),
    ...ProtocolExtensionProperties,
  },
  schemaOptions('harness-manifest'),
)
export type HarnessManifest = Static<typeof HarnessManifestSchema>

export const ArtifactDescriptorSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('artifact'),
    artifactId: Type.String({ minLength: 1 }),
    kind: ArtifactKindSchema,
    name: Type.String({ minLength: 1 }),
    version: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    formatProfile: Type.Optional(
      Type.Union(
        ['agent_skills', 'mcp_tool', 'a2a_agent_card', 'oci_artifact', 'native', 'unknown'].map(
          (value) => Type.Literal(value),
        ),
      ),
    ),
    formatVersion: Type.Optional(Type.String()),
    snapshotCompleteness: Type.Optional(
      Type.Union(
        ['interface_only', 'content_only', 'partial_snapshot', 'complete_package'].map((value) =>
          Type.Literal(value),
        ),
      ),
    ),
    digest: DigestSchema,
    interfaceDigest: Type.Optional(DigestSchema),
    contentDigest: Type.Optional(DigestSchema),
    treeDigest: Type.Optional(DigestSchema),
    dependencySetDigest: Type.Optional(DigestSchema),
    presentationDigest: Type.Optional(DigestSchema),
    description: Type.Optional(Type.String()),
    invocation: Type.Optional(
      Type.Object({
        modelInvocable: Type.Optional(Type.Boolean()),
        userInvocable: Type.Optional(Type.Boolean()),
      }),
    ),
    entrypoint: Type.Optional(Type.String()),
    source: Type.Optional(
      Type.Object({
        type: Type.Union(
          ['package', 'git', 'filesystem', 'remote', 'runtime'].map((value) => Type.Literal(value)),
        ),
        uri: Type.Optional(Type.String()),
        revision: Type.Optional(Type.String()),
      }),
    ),
    licenseExpression: Type.Optional(Type.String()),
    redistributable: Type.Boolean(),
    distribution: Type.Optional(
      Type.Object({
        transport: Type.Union(['oci', 'https', 'local_only'].map((value) => Type.Literal(value))),
        reference: Type.Optional(Type.String()),
        manifestDigest: Type.Optional(DigestSchema),
        artifactType: Type.Optional(Type.String()),
      }),
    ),
    requestedPermissions: Type.Optional(Type.Array(Type.String())),
    sbomRef: Type.Optional(AttachmentRefSchema),
    vulnerabilityAttestationRefs: Type.Optional(Type.Array(EvidenceRefSchema)),
    buildProvenanceRef: Type.Optional(EvidenceRefSchema),
    securityScanRefs: Type.Optional(Type.Array(EvidenceRefSchema)),
    resources: Type.Optional(
      Type.Array(
        Type.Object({
          pathOrUriDigest: DigestSchema,
          mediaType: Type.Optional(Type.String()),
          digest: Type.Optional(DigestSchema),
        }),
      ),
    ),
    disclosure: DisclosureLevelSchema,
    attachmentRefs: Type.Optional(Type.Array(AttachmentRefSchema)),
    ...ProtocolExtensionProperties,
  },
  schemaOptions('artifact'),
)
export type ArtifactDescriptor = Static<typeof ArtifactDescriptorSchema>

export const RunObservationSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('observation'),
    observationId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    experienceRef: Type.Optional(
      Type.Object({
        experienceId: Type.String({ minLength: 1 }),
        revision: Type.Integer({ minimum: 1 }),
        digest: DigestSchema,
      }),
    ),
    taskRef: Type.String({ minLength: 1 }),
    evaluatorRef: Type.String({ minLength: 1 }),
    configurationCell: Type.Object({
      model: ModelFingerprintSchema,
      /** Stable Harness configuration identity used for cross-trial comparisons. */
      harnessConfigurationDigest: DigestSchema,
      /** Immutable Manifest snapshot that evidenced this particular run. */
      harnessManifestDigest: DigestSchema,
      environment: EnvironmentFingerprintSchema,
    }),
    experiment: Type.Optional(
      Type.Object({
        experimentId: Type.String({ minLength: 1 }),
        cellId: Type.String({ minLength: 1 }),
        trialIndex: Type.Integer({ minimum: 0 }),
        attemptIndex: Type.Integer({ minimum: 0 }),
        randomization: Type.Optional(Type.String()),
        seedPolicy: Type.Optional(Type.String()),
      }),
    ),
    treatment: Type.Union(
      ['baseline', 'experience_applied', 'alternative'].map((value) => Type.Literal(value)),
    ),
    outcome: Type.Union(
      ['success', 'partial', 'failure', 'aborted'].map((value) => Type.Literal(value)),
    ),
    acceptanceResults: Type.Array(AcceptanceResultSchema),
    metrics: RunMetricsSchema,
    failureType: Type.Optional(Type.String()),
    evidenceRefs: Type.Array(EvidenceRefSchema),
    contextInjectionRefs: Type.Optional(Type.Array(ObjectRefSchema)),
    independence: Type.Object({
      evaluatorActor: ActorRefSchema,
      organizationIdHash: Type.Optional(DigestSchema),
      modelFamily: Type.Optional(Type.String()),
      fixtureOriginHash: Type.Optional(DigestSchema),
      declaredConflicts: Type.Optional(Type.Array(Type.String())),
    }),
    createdAt: TimestampSchema,
    governance: Type.Optional(GovernanceSchema),
    attestation: Type.Optional(AttestationSchema),
    ...ProtocolExtensionProperties,
  },
  schemaOptions('observation'),
)
export type RunObservation = Static<typeof RunObservationSchema>

const ClaimSchema = Type.Object({
  claimId: Type.String({ minLength: 1 }),
  type: Type.Union(
    [
      'strategy_works',
      'failure_cause',
      'compatibility',
      'configuration_effect',
      'cost_effect',
      'latency_effect',
      'safety_constraint',
    ].map((value) => Type.Literal(value)),
  ),
  statement: Type.String({ minLength: 1 }),
  mode: Type.Union(['observational', 'causal', 'constraint'].map((value) => Type.Literal(value))),
  evidenceLevel: EvidenceLevelSchema,
  scope: ApplicabilitySchema,
  supportingEvidenceRefs: Type.Array(EvidenceRefSchema, { minItems: 1 }),
  contradictingEvidenceRefs: Type.Array(EvidenceRefSchema),
  artifactRefs: Type.Optional(Type.Array(ArtifactRefSchema)),
  falsificationConditions: Type.Array(Type.String(), { minItems: 1 }),
  assumptions: Type.Array(Type.String()),
  confidence: Type.Optional(
    Type.Object({
      estimate: Type.Number(),
      lower: Type.Optional(Type.Number()),
      upper: Type.Optional(Type.Number()),
      method: Type.String({ minLength: 1 }),
    }),
  ),
})

export const ExperienceRevisionSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('experience_revision'),
    experienceId: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    digest: DigestSchema,
    createdAt: TimestampSchema,
    supersedes: Type.Optional(
      Type.Object({
        experienceId: Type.String({ minLength: 1 }),
        revision: Type.Integer({ minimum: 1 }),
        digest: DigestSchema,
      }),
    ),
    relations: Type.Array(
      Type.Object({
        type: Type.Union(
          [
            'requires',
            'derived_from',
            'contradicts',
            'supersedes',
            'evaluated_on',
            'compatible_with',
            'incompatible_with',
          ].map((value) => Type.Literal(value)),
        ),
        target: ObjectRefSchema,
        scope: Type.Optional(ApplicabilitySchema),
        evidenceRefs: Type.Optional(Type.Array(EvidenceRefSchema)),
      }),
    ),
    kind: ExperienceKindSchema,
    namespace: Type.String({ minLength: 1 }),
    publisher: ActorRefSchema,
    languages: Type.Array(Type.String(), { minItems: 1 }),
    title: Type.String({ minLength: 1 }),
    summary: Type.String({ minLength: 1 }),
    intendedUses: Type.Array(Type.String(), { minItems: 1 }),
    outOfScopeUses: Type.Array(Type.String()),
    knownLimitations: Type.Array(Type.String()),
    knownFailureModes: Type.Array(Type.String()),
    task: TaskDefinitionSchema,
    claims: Type.Array(ClaimSchema, { minItems: 1 }),
    applicability: ApplicabilitySchema,
    recipe: Type.Optional(RecipeSchema),
    cases: Type.Optional(Type.Array(CasePairSchema)),
    evidenceRefs: Type.Array(EvidenceRefSchema, { minItems: 1 }),
    artifactRefs: Type.Array(ArtifactRefSchema),
    metricSummary: Type.Optional(MetricSummarySchema),
    governance: GovernanceSchema,
    attestations: Type.Optional(Type.Array(AttestationSchema)),
    ...ProtocolExtensionProperties,
  },
  schemaOptions('experience-revision'),
)
export type ExperienceRevision = Static<typeof ExperienceRevisionSchema>

export const PromotionRecordSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('promotion_record'),
    promotionId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    sourceRef: ObjectRefSchema,
    targetRef: ObjectRefSchema,
    from: Type.Union(['private', 'team'].map((value) => Type.Literal(value))),
    to: Type.Union(['team', 'public'].map((value) => Type.Literal(value))),
    transformations: Type.Array(
      Type.Object({
        transformationId: Type.String({ minLength: 1 }),
        ruleId: Type.String({ minLength: 1 }),
        action: Type.Union(
          ['remove', 'redact', 'generalize', 'replace_ref', 'change_disclosure'].map((value) =>
            Type.Literal(value),
          ),
        ),
        sourcePath: Type.String({ minLength: 1 }),
        targetPath: Type.Optional(Type.String()),
        beforeDigest: Type.Optional(DigestSchema),
        afterDigest: Type.Optional(DigestSchema),
      }),
    ),
    policyDecisionRef: Type.String({ minLength: 1 }),
    consentRef: Type.String({ minLength: 1 }),
    actor: ActorRefSchema,
    createdAt: TimestampSchema,
    attestation: AttestationSchema,
    ...ProtocolExtensionProperties,
  },
  schemaOptions('promotion-record'),
)
export type PromotionRecord = Static<typeof PromotionRecordSchema>

export const FeedbackEventSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('feedback'),
    feedbackId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    experienceRef: Type.Object({
      experienceId: Type.String({ minLength: 1 }),
      revision: Type.Integer({ minimum: 1 }),
      digest: DigestSchema,
    }),
    sessionDigest: Type.Optional(DigestSchema),
    decision: Type.Union(
      ['viewed', 'adopted', 'rejected', 'rolled_back'].map((value) => Type.Literal(value)),
    ),
    outcome: Type.Optional(
      Type.Union(['helpful', 'neutral', 'harmful', 'unknown'].map((value) => Type.Literal(value))),
    ),
    reasonCodes: Type.Optional(Type.Array(Type.String())),
    observationId: Type.Optional(Type.String()),
    sharingScope: Type.Union(
      ['local', 'team', 'public_aggregate'].map((value) => Type.Literal(value)),
    ),
    createdAt: TimestampSchema,
    ...ProtocolExtensionProperties,
  },
  schemaOptions('feedback'),
)
export type FeedbackEvent = Static<typeof FeedbackEventSchema>

export const ContentionSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('contention'),
    contentionId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    claimRef: Type.Object({
      experienceRef: Type.Intersect([
        ObjectRefSchema,
        Type.Object({ objectType: Type.Literal('experience_revision') }),
      ]),
      claimId: Type.String({ minLength: 1 }),
    }),
    supporting: Type.Array(EvidenceRefSchema),
    contradicting: Type.Array(EvidenceRefSchema),
    scopeDifference: Type.Optional(Type.String()),
    openedAt: TimestampSchema,
    resolvedAt: Type.Optional(TimestampSchema),
    resolution: Type.Optional(
      Type.Union(
        ['claim_narrowed', 'superseded', 'evidence_rejected', 'unresolved'].map((value) =>
          Type.Literal(value),
        ),
      ),
    ),
    attestations: Type.Optional(Type.Array(AttestationSchema)),
    ...ProtocolExtensionProperties,
  },
  schemaOptions('contention'),
)
export type Contention = Static<typeof ContentionSchema>

export const RevocationSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('revocation'),
    revocationId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    target: ObjectRefSchema,
    reasonCode: Type.Union(
      ['author_request', 'secret_leak', 'license', 'unsafe', 'superseded', 'other'].map((value) =>
        Type.Literal(value),
      ),
    ),
    scope: Type.Union(
      ['revision', 'attachment', 'experience', 'publisher_key'].map((value) => Type.Literal(value)),
    ),
    severity: Type.Union(['routine', 'urgent', 'critical'].map((value) => Type.Literal(value))),
    affectedDigests: Type.Array(DigestSchema, { minItems: 1 }),
    createdAt: TimestampSchema,
    actor: ActorRefSchema,
    attestation: AttestationSchema,
    ...ProtocolExtensionProperties,
  },
  schemaOptions('revocation'),
)
export type Revocation = Static<typeof RevocationSchema>

export const GraderDefinitionSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('grader_definition'),
    graderId: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    digest: DigestSchema,
    type: Type.Union(['code', 'model', 'human', 'hybrid'].map((value) => Type.Literal(value))),
    target: Type.Union(
      ['outcome', 'transcript', 'safety', 'efficiency'].map((value) => Type.Literal(value)),
    ),
    rubricRef: Type.Optional(ObjectRefSchema),
    implementationRef: Type.Optional(ObjectRefSchema),
    modelFingerprint: Type.Optional(ModelFingerprintSchema),
    calibrationSetRef: Type.Optional(ObjectRefSchema),
    calibrationMetrics: Type.Optional(Type.Record(Type.String(), Type.Number())),
    ...ProtocolExtensionProperties,
  },
  schemaOptions('grader-definition'),
)
export type GraderDefinition = Static<typeof GraderDefinitionSchema>

export const BenchmarkTaskSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('benchmark_task'),
    benchmarkId: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    digest: DigestSchema,
    suiteKind: Type.Union(
      ['capability', 'regression', 'safety', 'transfer'].map((value) => Type.Literal(value)),
    ),
    task: TaskDefinitionSchema,
    environment: Type.Object({
      containerImageDigest: Type.Optional(DigestSchema),
      vmImageDigest: Type.Optional(DigestSchema),
      fixtureRefs: Type.Array(ObjectRefSchema),
      setupCommandRef: Type.Optional(ObjectRefSchema),
      networkMode: Type.Union(
        ['none', 'recorded_fixture', 'allowlisted', 'live'].map((value) => Type.Literal(value)),
      ),
      externalServiceSnapshotRefs: Type.Optional(Type.Array(ObjectRefSchema)),
    }),
    graderRefs: Type.Array(ObjectRefSchema, { minItems: 1 }),
    resourceLimits: Type.Object({
      timeoutMs: Type.Integer({ minimum: 1 }),
      maxCostUsd: Type.Optional(Type.Number({ minimum: 0 })),
      maxModelCalls: Type.Optional(Type.Integer({ minimum: 0 })),
      maxToolCalls: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    trialPlan: Type.Object({
      repetitions: Type.Integer({ minimum: 1 }),
      randomization: Type.Union(
        ['none', 'random_order', 'interleaved_cells', 'blocked'].map((value) => Type.Literal(value)),
      ),
      seedPolicy: Type.Optional(Type.String()),
      primaryMetric: Type.String({ minLength: 1 }),
    }),
    allowedSideEffects: Type.Array(Type.String()),
    validity: Type.Object({
      status: Type.Union(
        ['draft', 'reviewed', 'validated', 'deprecated', 'retired'].map((value) => Type.Literal(value)),
      ),
      issueClarityReviewed: Type.Boolean(),
      acceptanceAlignmentReviewed: Type.Boolean(),
      solvabilityReviewed: Type.Boolean(),
      reviewerRefs: Type.Array(ActorRefSchema),
      reviewedAt: Type.Optional(TimestampSchema),
      contaminationRisk: Type.Union(
        ['low', 'medium', 'high', 'unknown'].map((value) => Type.Literal(value)),
      ),
      replacementRef: Type.Optional(ObjectRefSchema),
    }),
    ...ProtocolExtensionProperties,
  },
  schemaOptions('benchmark-task'),
)
export type BenchmarkTask = Static<typeof BenchmarkTaskSchema>

export const EvaluationTrialSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('evaluation_trial'),
    trialId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    experimentId: Type.String({ minLength: 1 }),
    benchmarkRef: ObjectRefSchema,
    cellId: Type.String({ minLength: 1 }),
    runObservationRef: ObjectRefSchema,
    transcriptRef: Type.Optional(EvidenceRefSchema),
    attemptIndex: Type.Integer({ minimum: 0 }),
    trialIndex: Type.Integer({ minimum: 0 }),
    status: Type.Union(
      ['success', 'agent_failure', 'policy_refusal', 'infra_error', 'grader_error', 'aborted'].map(
        (value) => Type.Literal(value),
      ),
    ),
    graderResults: Type.Array(AcceptanceResultSchema),
    ...ProtocolExtensionProperties,
  },
  schemaOptions('evaluation-trial'),
)
export type EvaluationTrial = Static<typeof EvaluationTrialSchema>

const PassKSummarySchema = Type.Object({
  k: Type.Integer({ minimum: 1 }),
  estimate: Type.Number({ minimum: 0, maximum: 1 }),
})

const SuccessRateSummarySchema = Type.Object({
  estimate: Type.Number({ minimum: 0, maximum: 1 }),
  lower: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  upper: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  method: Type.String({ minLength: 1 }),
})

export const EvaluationAggregateSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('evaluation_aggregate'),
    aggregateId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    experimentId: Type.String({ minLength: 1 }),
    benchmarkRefs: Type.Array(ObjectRefSchema, { minItems: 1 }),
    trialRefs: Type.Array(ObjectRefSchema, { minItems: 1 }),
    totalTrials: Type.Integer({ minimum: 0 }),
    validTrials: Type.Integer({ minimum: 0 }),
    passAt1: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    passAtK: Type.Optional(PassKSummarySchema),
    passPowerK: Type.Optional(PassKSummarySchema),
    perTrialSuccessRate: Type.Optional(SuccessRateSummarySchema),
    metricSummary: MetricSummarySchema,
    statusCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    excludedTrialCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    cellSummaries: Type.Array(
      Type.Object({
        cellId: Type.String({ minLength: 1 }),
        treatment: Type.Union(
          ['baseline', 'experience_applied', 'alternative'].map((value) => Type.Literal(value)),
        ),
        trialRefs: Type.Array(ObjectRefSchema, { minItems: 1 }),
        totalTrials: Type.Integer({ minimum: 0 }),
        validTrials: Type.Integer({ minimum: 0 }),
        successes: Type.Integer({ minimum: 0 }),
        passAt1: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        passAtK: Type.Optional(PassKSummarySchema),
        passPowerK: Type.Optional(PassKSummarySchema),
        perTrialSuccessRate: Type.Optional(SuccessRateSummarySchema),
        metricSummary: MetricSummarySchema,
        statusCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
        excludedTrialCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
      }),
      { minItems: 1 },
    ),
    comparisons: Type.Array(
      Type.Object({
        comparisonId: Type.String({ minLength: 1 }),
        comparisonKind: Type.Union(
          [
            'experience_uplift',
            'model_effect',
            'harness_effect',
            'model_harness_interaction',
            'alternative',
          ].map((value) => Type.Literal(value)),
        ),
        baselineCellId: Type.String({ minLength: 1 }),
        treatmentCellId: Type.String({ minLength: 1 }),
        primaryMetric: Type.String({ minLength: 1 }),
        baselineEstimate: Type.Number(),
        treatmentEstimate: Type.Number(),
        absoluteDifference: Type.Number(),
        relativeDifference: Type.Optional(Type.Number()),
        uncertainty: Type.Object({
          method: Type.String({ minLength: 1 }),
          confidenceLevel: Type.Number({ minimum: 0, maximum: 1 }),
          lower: Type.Optional(Type.Number()),
          upper: Type.Optional(Type.Number()),
        }),
        conclusion: Type.Union(
          ['improved', 'harmed', 'no_significant_difference', 'inconclusive'].map((value) =>
            Type.Literal(value),
          ),
        ),
        counterfactualEligibility: Type.Object({
          status: Type.Union(['eligible', 'ineligible'].map((value) => Type.Literal(value))),
          reasonCodes: Type.Array(Type.String()),
        }),
        confounders: Type.Array(Type.String()),
      }),
    ),
    ...ProtocolExtensionProperties,
  },
  schemaOptions('evaluation-aggregate'),
)
export type EvaluationAggregate = Static<typeof EvaluationAggregateSchema>

export const TaskCapsuleSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('task_capsule'),
    capsuleId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    taxonomy: Type.Array(Type.String(), { minItems: 1 }),
    abstractIntent: Type.Optional(Type.String()),
    constraints: Type.Array(Type.String()),
    acceptanceTraits: Type.Array(Type.String()),
    riskClass: RiskClassSchema,
    modelSelector: Type.Optional(ScalarSelectorSchema),
    harnessCapabilities: Type.Optional(Type.Array(ScalarSelectorSchema)),
    environmentTraits: Type.Optional(Type.Array(Type.String())),
    omittedSensitiveFields: Type.Array(Type.String()),
    expiresAt: TimestampSchema,
    ...ProtocolExtensionProperties,
  },
  schemaOptions('task-capsule'),
)
export type TaskCapsule = Static<typeof TaskCapsuleSchema>

const ExperienceContextSelectionSchema = Type.Object({
  experienceRef: Type.Object({
    experienceId: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    digest: DigestSchema,
  }),
  sections: Type.Array(
    Type.Union(['card', 'recipe', 'cases', 'evidence'].map((value) => Type.Literal(value))),
    { minItems: 1, uniqueItems: true },
  ),
  maxEstimatedTokens: Type.Integer({ minimum: 1 }),
  reasonCodes: Type.Array(Type.String()),
  requiredNegativeCase: Type.Boolean(),
  fetchMode: Type.Union(['now', 'just_in_time'].map((value) => Type.Literal(value))),
})

export const ExperienceContextPlanSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('experience_context_plan'),
    planId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    taskCapsuleDigest: DigestSchema,
    totalBudget: Type.Object({
      maxBytes: Type.Optional(Type.Integer({ minimum: 1 })),
      estimatedMaxTokens: Type.Integer({ minimum: 1 }),
      maxExperiences: Type.Integer({ minimum: 1, maximum: 3 }),
    }),
    selections: Type.Array(ExperienceContextSelectionSchema, { maxItems: 3 }),
    ordering: Type.Union(
      ['compatibility_first', 'evidence_first', 'cost_first', 'custom'].map((value) =>
        Type.Literal(value),
      ),
    ),
    stopRules: Type.Array(Type.String()),
    generatedBy: Type.Union(
      ['deterministic_policy', 'agent', 'human'].map((value) => Type.Literal(value)),
    ),
    policyDigest: DigestSchema,
    ...ProtocolExtensionProperties,
  },
  schemaOptions('experience-context-plan'),
)
export type ExperienceContextPlan = Static<typeof ExperienceContextPlanSchema>

export const ContextInjectionObservationSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('context_injection_observation'),
    injectionId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    planId: Type.String({ minLength: 1 }),
    experienceRef: Type.Object({
      experienceId: Type.String({ minLength: 1 }),
      revision: Type.Integer({ minimum: 1 }),
      digest: DigestSchema,
    }),
    fetchedSections: Type.Array(Type.String()),
    injectedSections: Type.Array(Type.String()),
    contentDigests: Type.Array(DigestSchema),
    estimatedTokens: Type.Integer({ minimum: 0 }),
    actualTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    effectiveSurfaceDigest: Type.Optional(DigestSchema),
    createdAt: TimestampSchema,
    ...ProtocolExtensionProperties,
  },
  schemaOptions('context-injection-observation'),
)
export type ContextInjectionObservation = Static<typeof ContextInjectionObservationSchema>

export const SearchRequestSchema = Type.Object(
  {
    query: Type.Optional(Type.String()),
    task: Type.Optional(Type.Partial(TaskDefinitionSchema)),
    context: Type.Optional(
      Type.Object({
        model: Type.Optional(ModelFingerprintSchema),
        harnessConfigurationDigest: Type.Optional(DigestSchema),
        harnessManifestDigest: Type.Optional(DigestSchema),
        capabilities: Type.Optional(Type.Array(ScalarSelectorSchema)),
        environment: Type.Optional(EnvironmentFingerprintSchema),
      }),
    ),
    policy: Type.Optional(
      Type.Object({
        visibility: Type.Optional(
          Type.Array(
            Type.Union(['private', 'team', 'public'].map((value) => Type.Literal(value))),
          ),
        ),
        maxRiskClass: Type.Optional(RiskClassSchema),
        allowedLicenses: Type.Optional(Type.Array(Type.String())),
        minEvidenceLevel: Type.Optional(EvidenceLevelSchema),
        maxMeanCostUsd: Type.Optional(Type.Number({ minimum: 0 })),
        maxP95LatencyMs: Type.Optional(Type.Number({ minimum: 0 })),
      }),
    ),
    responseBudget: Type.Optional(
      Type.Object({
        maxCards: Type.Integer({ minimum: 1, maximum: 3 }),
        maxBytes: Type.Optional(Type.Integer({ minimum: 1 })),
        estimatedMaxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
    cursor: Type.Optional(Type.String()),
  },
  schemaOptions('search-request'),
)
export type SearchRequest = Static<typeof SearchRequestSchema>

export const ExperienceCardSchema = Type.Object(
  {
    experienceId: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    digest: DigestSchema,
    title: Type.String({ minLength: 1 }),
    summary: Type.String({ minLength: 1 }),
    intendedUseSummary: Type.Array(Type.String()),
    outOfScopeSummary: Type.Array(Type.String()),
    knownFailureSummary: Type.Array(Type.String()),
    taskFamilies: Type.Array(Type.String()),
    compatibility: Type.Union(
      ['exact', 'compatible', 'unknown', 'incompatible'].map((value) => Type.Literal(value)),
    ),
    maxEvidenceLevel: EvidenceLevelSchema,
    metricSummary: Type.Optional(MetricSummarySchema),
    positiveCaseSummary: Type.Optional(Type.String()),
    negativeCaseSummary: Type.Optional(Type.String()),
    safetyLabels: Type.Array(Type.String()),
    sourceSummary: Type.String(),
    availableSections: Type.Array(Type.String()),
    estimatedSectionTokens: Type.Optional(Type.Record(Type.String(), Type.Integer({ minimum: 0 }))),
    scoreExplanation: Type.Array(Type.String(), { minItems: 1 }),
  },
  schemaOptions('experience-card'),
)
export type ExperienceCard = Static<typeof ExperienceCardSchema>

export const protocolObjectSchemas = {
  attestation: AttestationSchema,
  evidence_gap_report: EvidenceGapReportSchema,
  task_episode: TaskEpisodeSchema,
  trace_evidence: TraceEvidenceBundleSchema,
  harness_manifest: HarnessManifestSchema,
  artifact: ArtifactDescriptorSchema,
  observation: RunObservationSchema,
  experience_revision: ExperienceRevisionSchema,
  promotion_record: PromotionRecordSchema,
  feedback: FeedbackEventSchema,
  contention: ContentionSchema,
  revocation: RevocationSchema,
  grader_definition: GraderDefinitionSchema,
  benchmark_task: BenchmarkTaskSchema,
  evaluation_trial: EvaluationTrialSchema,
  evaluation_aggregate: EvaluationAggregateSchema,
  task_capsule: TaskCapsuleSchema,
  experience_context_plan: ExperienceContextPlanSchema,
  context_injection_observation: ContextInjectionObservationSchema,
} as const satisfies Record<string, TSchema>

export const apiPayloadSchemas = {
  search_request: SearchRequestSchema,
  experience_card: ExperienceCardSchema,
} as const satisfies Record<string, TSchema>

export type ProtocolObjectType = keyof typeof protocolObjectSchemas
