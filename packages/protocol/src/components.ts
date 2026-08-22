import { Type, type Static } from '@sinclair/typebox'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type Digest = `sha256:${string}`

export const DigestSchema = Type.Unsafe<Digest>({
  type: 'string',
  pattern: '^sha256:[0-9a-f]{64}$',
  description: 'SHA-256 digest over RFC 8785 canonical JSON',
})

export const TimestampSchema = Type.String({ format: 'date-time' })
export const UriSchema = Type.String({ format: 'uri' })

// JSON Schema instances are JSON by definition. Programmatic callers receive the
// equivalent recursive guard in validation.ts before Schema evaluation.
export const JsonValueSchema = Type.Unsafe<JsonValue>({
  description: 'Any value representable by RFC 8259 JSON',
})

export const EvidenceLevelSchema = Type.Union(
  ['H0', 'H1', 'H2', 'H3', 'H4'].map((value) => Type.Literal(value)),
)
export type EvidenceLevel = Static<typeof EvidenceLevelSchema>

export const VisibilitySchema = Type.Union(
  ['private', 'team', 'public'].map((value) => Type.Literal(value)),
)

export const DataClassSchema = Type.Union(
  ['public', 'internal', 'confidential', 'restricted', 'personal', 'secret'].map((value) =>
    Type.Literal(value),
  ),
)

export const DisclosureLevelSchema = Type.Union(
  ['digest_only', 'metadata', 'redacted_excerpt', 'reproducible_bundle', 'full_content'].map(
    (value) => Type.Literal(value),
  ),
)

export const ExperienceKindSchema = Type.Union(
  [
    'execution_strategy',
    'failure_recovery',
    'harness_configuration',
    'model_capability',
    'cost_latency_tradeoff',
    'compatibility',
    'safety_constraint',
    'evaluation_method',
    'negative_result',
  ].map((value) => Type.Literal(value)),
)

export const ProtocolExtensionProperties = {
  requiredCapabilities: Type.Optional(Type.Array(UriSchema, { uniqueItems: true })),
  extensions: Type.Optional(Type.Record(Type.String(), JsonValueSchema)),
}

export const ObjectRefSchema = Type.Object({
  objectType: Type.String({ minLength: 1 }),
  refId: Type.String({ minLength: 1 }),
  revision: Type.Optional(Type.Integer({ minimum: 1 })),
  digest: DigestSchema,
  origin: Type.Optional(UriSchema),
})
export type ObjectRef = Static<typeof ObjectRefSchema>

export const ActorRefSchema = Type.Object({
  actorId: UriSchema,
  type: Type.Union(
    ['human', 'agent', 'organization', 'service', 'node'].map((value) => Type.Literal(value)),
  ),
  displayName: Type.Optional(Type.String()),
})
export type ActorRef = Static<typeof ActorRefSchema>

export const ScalarSelectorSchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  operator: Type.Union(
    ['equals', 'in', 'semver', 'digestEquals', 'exists'].map((value) => Type.Literal(value)),
  ),
  value: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
})
export type ScalarSelector = Static<typeof ScalarSelectorSchema>

export const ModelFingerprintSchema = Type.Object({
  provider: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  declaredVersion: Type.Optional(Type.String()),
  providerRevision: Type.Optional(Type.String()),
  immutableWeightsDigest: Type.Optional(DigestSchema),
  capabilityDigest: Type.Optional(DigestSchema),
  contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
  requestConfig: Type.Optional(
    Type.Object({
      reasoningEffort: Type.Optional(Type.String()),
      temperature: Type.Optional(Type.Number()),
      maxOutputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
      seed: Type.Optional(Type.Integer()),
      configDigest: DigestSchema,
    }),
  ),
  pricingSnapshotRef: Type.Optional(ObjectRefSchema),
  rateLimitSnapshotRef: Type.Optional(ObjectRefSchema),
  observedAt: TimestampSchema,
  mutability: Type.Union(
    ['immutable', 'versioned', 'provider_mutable', 'unknown'].map((value) => Type.Literal(value)),
  ),
})
export type ModelFingerprint = Static<typeof ModelFingerprintSchema>

export const EnvironmentFingerprintSchema = Type.Object({
  os: Type.Optional(
    Type.Object({
      family: Type.String({ minLength: 1 }),
      version: Type.Optional(Type.String()),
      arch: Type.Optional(Type.String()),
    }),
  ),
  runtime: Type.Optional(Type.Record(Type.String(), Type.String())),
  dependencySetDigest: Type.Optional(DigestSchema),
  containerImageDigest: Type.Optional(DigestSchema),
  region: Type.Optional(Type.String()),
  hardwareClass: Type.Optional(Type.String()),
  workspaceTraits: Type.Optional(Type.Array(Type.String())),
  externalServiceDigests: Type.Optional(Type.Array(DigestSchema)),
  capturedAt: TimestampSchema,
  disclosure: DisclosureLevelSchema,
})
export type EnvironmentFingerprint = Static<typeof EnvironmentFingerprintSchema>

export const EvidenceRefSchema = Type.Intersect([
  ObjectRefSchema,
  Type.Object({
    objectType: Type.Union(
      ['trace_evidence', 'observation', 'attestation', 'contention'].map((value) =>
        Type.Literal(value),
      ),
    ),
  }),
])

export const ArtifactKindSchema = Type.Union(
  ['skill', 'tool', 'plugin', 'preset', 'prompt_section', 'policy', 'evaluator', 'benchmark'].map(
    (value) => Type.Literal(value),
  ),
)

export const ArtifactRefSchema = Type.Intersect([
  ObjectRefSchema,
  Type.Object({
    objectType: Type.Literal('artifact'),
    kind: Type.Optional(ArtifactKindSchema),
  }),
])
export type ArtifactRef = Static<typeof ArtifactRefSchema>

export const AttachmentRefSchema = Type.Intersect([
  ObjectRefSchema,
  Type.Object({
    objectType: Type.Literal('attachment'),
    mediaType: Type.String({ minLength: 1 }),
  }),
])

export const RedactionReportSchema = Type.Object({
  scannerVersions: Type.Record(Type.String(), Type.String()),
  transformations: Type.Array(
    Type.Object({
      ruleId: Type.String({ minLength: 1 }),
      count: Type.Integer({ minimum: 0 }),
    }),
  ),
  residualRisk: Type.Union(
    ['low', 'medium', 'high', 'unknown'].map((value) => Type.Literal(value)),
  ),
  humanReviewed: Type.Boolean(),
  reviewedAt: Type.Optional(TimestampSchema),
})

export const RedactedExcerptSchema = Type.Object({
  mediaType: Type.String({ minLength: 1 }),
  content: Type.String(),
  sourceDigest: DigestSchema,
  transformationIds: Type.Array(Type.String()),
})

export const AcceptanceCriterionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  evaluatorRef: Type.Optional(Type.String()),
  required: Type.Boolean(),
})

export const RiskClassSchema = Type.Union(
  ['read_only', 'reversible_write', 'external_write', 'destructive'].map((value) =>
    Type.Literal(value),
  ),
)

export const TaskDefinitionSchema = Type.Object({
  taxonomy: Type.Array(Type.String(), { minItems: 1 }),
  intent: Type.String({ minLength: 1 }),
  constraints: Type.Array(Type.String()),
  acceptance: Type.Array(AcceptanceCriterionSchema),
  inputTraits: Type.Optional(Type.Array(Type.String())),
  outputTraits: Type.Optional(Type.Array(Type.String())),
  riskClass: RiskClassSchema,
})

export const AcceptanceResultSchema = Type.Object({
  criterionId: Type.String({ minLength: 1 }),
  passed: Type.Boolean(),
  score: Type.Optional(Type.Number()),
  evidenceRefs: Type.Array(EvidenceRefSchema),
})
export type AcceptanceResult = Static<typeof AcceptanceResultSchema>

export const RunMetricsSchema = Type.Object({
  qualityScore: Type.Optional(Type.Number()),
  totalCostUsd: Type.Optional(Type.Number({ minimum: 0 })),
  latencyMs: Type.Optional(Type.Number({ minimum: 0 })),
  ttftMs: Type.Optional(Type.Number({ minimum: 0 })),
  throughputTokensPerSecond: Type.Optional(Type.Number({ minimum: 0 })),
  inputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  outputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  cachedTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  reasoningTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  retries: Type.Optional(Type.Integer({ minimum: 0 })),
  approvals: Type.Optional(Type.Integer({ minimum: 0 })),
  toolCalls: Type.Optional(Type.Integer({ minimum: 0 })),
  toolFailures: Type.Optional(Type.Integer({ minimum: 0 })),
})
export type RunMetrics = Static<typeof RunMetricsSchema>

export const MetricSummarySchema = Type.Object({
  sampleSize: Type.Integer({ minimum: 0 }),
  successRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  quality: Type.Optional(
    Type.Object({
      mean: Type.Number(),
      lower: Type.Optional(Type.Number()),
      upper: Type.Optional(Type.Number()),
    }),
  ),
  costUsd: Type.Optional(
    Type.Object({
      mean: Type.Number({ minimum: 0 }),
      lower: Type.Optional(Type.Number({ minimum: 0 })),
      upper: Type.Optional(Type.Number({ minimum: 0 })),
    }),
  ),
  latencyMs: Type.Optional(
    Type.Object({
      p50: Type.Optional(Type.Number({ minimum: 0 })),
      p95: Type.Optional(Type.Number({ minimum: 0 })),
    }),
  ),
  negativeTransferRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  method: Type.String({ minLength: 1 }),
})
export type MetricSummary = Static<typeof MetricSummarySchema>

export const DsseSignatureSchema = Type.Object({
  keyid: UriSchema,
  sig: Type.String({ contentEncoding: 'base64' }),
  algorithm: Type.Optional(
    Type.Union(['Ed25519', 'ES256', 'RS256'].map((value) => Type.Literal(value))),
  ),
})

export const InTotoStatementSchema = Type.Object({
  _type: Type.Literal('https://in-toto.io/Statement/v1'),
  subject: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1 }),
      digest: Type.Object({ sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }) }),
    }),
    { minItems: 1 },
  ),
  predicateType: UriSchema,
  predicate: JsonValueSchema,
})

export const DsseEnvelopeSchema = Type.Object({
  payloadType: Type.Literal('application/vnd.in-toto+json'),
  payload: Type.String({ contentEncoding: 'base64' }),
  signatures: Type.Array(DsseSignatureSchema, { minItems: 1 }),
})

export const AttestationSchema = Type.Object(
  {
    protocolVersion: Type.Literal('0.1'),
    objectType: Type.Literal('attestation'),
    attestationId: Type.String({ minLength: 1 }),
    digest: DigestSchema,
    statementDigest: DigestSchema,
    envelope: DsseEnvelopeSchema,
    issuer: ActorRefSchema,
    issuedAt: TimestampSchema,
    expiresAt: Type.Optional(TimestampSchema),
    ...ProtocolExtensionProperties,
  },
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://aen.dev/schemas/aexp/0.1/attestation.schema.json',
  },
)
export type Attestation = Static<typeof AttestationSchema>

export const GovernanceSchema = Type.Object({
  visibility: VisibilitySchema,
  owner: ActorRefSchema,
  organization: Type.Optional(Type.String()),
  license: Type.Optional(Type.String()),
  dataClasses: Type.Array(DataClassSchema),
  redistribution: Type.Union(
    ['none', 'same_acl', 'federation_peers', 'public_mirrors'].map((value) => Type.Literal(value)),
  ),
  retention: Type.Optional(
    Type.Object({
      expiresAt: Type.Optional(TimestampSchema),
      maxDays: Type.Optional(Type.Integer({ minimum: 0 })),
      legalHold: Type.Optional(Type.Boolean()),
    }),
  ),
  residency: Type.Optional(
    Type.Object({
      allowedRegions: Type.Optional(Type.Array(Type.String())),
      deniedRegions: Type.Optional(Type.Array(Type.String())),
    }),
  ),
  consentRef: Type.Optional(Type.String()),
  sourcePolicy: Type.String({ minLength: 1 }),
  redactionReport: RedactionReportSchema,
  safetyLabels: Type.Array(Type.String()),
  acl: Type.Optional(Type.Array(Type.String())),
})

export const GeneralitySchema = Type.Union(
  ['universal', 'domain', 'scene_specific'].map((value) => Type.Literal(value)),
)
export type Generality = Static<typeof GeneralitySchema>

export const ApplicabilitySchema = Type.Object({
  taskFamilies: Type.Array(Type.String(), { minItems: 1 }),
  modelSelectors: Type.Optional(Type.Array(ScalarSelectorSchema)),
  harnessSelectors: Type.Optional(Type.Array(ScalarSelectorSchema)),
  environmentSelectors: Type.Optional(Type.Array(ScalarSelectorSchema)),
  requiredCapabilities: Type.Optional(Type.Array(ScalarSelectorSchema)),
  excludedConditions: Type.Optional(Type.Array(Type.String())),
  dataSensitivityClasses: Type.Optional(Type.Array(DataClassSchema)),
  jurisdictions: Type.Optional(Type.Array(Type.String())),
  revalidateOn: Type.Optional(
    Type.Array(
      Type.Object({
        kind: Type.Union(
          [
            'model_change',
            'harness_change',
            'artifact_change',
            'environment_change',
            'evaluator_change',
            'time',
            'contention',
          ].map((value) => Type.Literal(value)),
        ),
        selector: Type.Optional(ScalarSelectorSchema),
        intervalSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
    ),
  ),
  /**
   * 经验的可迁移度轴（通用/领域/场景专属），将"共进化指导自进化"固化为协议事实。
   * 派生不声明：`universal` 应由跨任务族 transfer 评测（H3）证据支持，而非作者自报。
   * 注：Optional 字段不影响既有对象 digest（valid fixture 只填 required）。
   */
  generality: Type.Optional(GeneralitySchema),
  expiresAt: Type.Optional(TimestampSchema),
})
export type Applicability = Static<typeof ApplicabilitySchema>

export const CheckSchema = Type.Object({
  checkId: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  evaluatorRef: Type.Optional(ObjectRefSchema),
  required: Type.Boolean(),
})

export const RecipeSchema = Type.Object({
  strategy: Type.String({ minLength: 1 }),
  preconditions: Type.Array(CheckSchema),
  steps: Type.Array(
    Type.Object({
      stepId: Type.String({ minLength: 1 }),
      instruction: Type.String({ minLength: 1 }),
      rationaleSummary: Type.Optional(Type.String()),
      requiredCapabilities: Type.Optional(Type.Array(ScalarSelectorSchema)),
      riskClass: RiskClassSchema,
      evidenceRefs: Type.Optional(Type.Array(EvidenceRefSchema)),
    }),
    { minItems: 1 },
  ),
  checkpoints: Type.Array(CheckSchema),
  fallbacks: Type.Array(
    Type.Object({
      when: Type.String({ minLength: 1 }),
      action: Type.String({ minLength: 1 }),
      riskClass: RiskClassSchema,
    }),
  ),
  stopConditions: Type.Array(Type.String()),
})

export const CasePairSchema = Type.Object({
  positive: Type.Object({
    caseId: Type.String({ minLength: 1 }),
    contextSummary: Type.String({ minLength: 1 }),
    actionSummary: Type.String({ minLength: 1 }),
    outcomeSummary: Type.String({ minLength: 1 }),
    failureSignals: Type.Optional(Type.Array(Type.String())),
    traceEvidenceRefs: Type.Array(EvidenceRefSchema),
    redaction: RedactionReportSchema,
  }),
  negative: Type.Object({
    caseId: Type.String({ minLength: 1 }),
    contextSummary: Type.String({ minLength: 1 }),
    actionSummary: Type.String({ minLength: 1 }),
    outcomeSummary: Type.String({ minLength: 1 }),
    failureSignals: Type.Optional(Type.Array(Type.String())),
    traceEvidenceRefs: Type.Array(EvidenceRefSchema),
    redaction: RedactionReportSchema,
  }),
  difference: Type.String({ minLength: 1 }),
})
