/**
 * seed-math-experiences.mjs — AEN 数学种子生成器
 * =================================================
 * 把 Math Agent Framework (MAF) 的真实推导 run 转换为 AEN 协议对象，
 * 蒸馏成可复用的"通用数学技巧"种子经验（generality: universal）。
 *
 * 流程:
 *   1. 读取 MAF bridge 产出的 DerivationRun JSON（seeds/runs/*.json）
 *   2. 合成 TaskEpisode + TraceEvidenceBundle + EvidenceGapReport（证据）
 *   3. 用 @aen/protocol 构建 ExperienceRevision（内容寻址、schema 校验）
 *   4. 写入 AEN 本地证据库（LocalEvidenceStore）
 *   5. 用 searchExperiences 验证可检索
 *
 * 用法:
 *   node scripts/seed-math-experiences.mjs [storePath]
 *   环境变量: MAF_RUNS_DIR 覆盖 run JSON 目录
 */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, finalizeProtocolObject, sha256, toObjectRef } from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runsDir = resolve(process.env.MAF_RUNS_DIR ?? join(repoRoot, 'seeds', 'runs'))
const storePath = resolve(process.argv[2] ?? join(repoRoot, 'seeds', 'math-experiences.sqlite'))
const namespace = 'local.aen.math.universal-techniques'
const publisher = { actorId: 'https://github.com/symmetryseeker', type: 'human', displayName: 'symmetryseeker' }

function loadRuns() {
  const runs = {}
  for (const file of readdirSync(runsDir).filter((name) => name.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(runsDir, file), 'utf8'))
    if (parsed.status !== 'ok') continue
    runs[file.replace(/\.json$/, '')] = parsed
  }
  return runs
}

const RUN_TAXONOMY = {
  derive_ces: ['math', 'symbolic-derivation', 'production-function', 'CES'],
  derive_quadratic: ['math', 'symbolic-derivation', 'quadratic-form', 'optimization'],
  verify_monte_carlo: ['math', 'numerical-verification', 'monte-carlo', 'foc'],
}

function episodeIdentity(runKey) {
  return {
    sessionDigest: sha256(canonicalJson({ scope: 'maf.derivation-run', runKey })),
    episodeId: `urn:aen:episode:maf:${runKey}`,
  }
}

function buildTaskEpisode(runKey, run, gap) {
  const { sessionDigest, episodeId } = episodeIdentity(runKey)
  const task = {
    taxonomy: RUN_TAXONOMY[runKey] ?? ['math', 'derivation'],
    intent: `Derive and verify the mathematical result of ${runKey} with the Math Agent Framework`,
    constraints: ['No external services; pure symbolic/numeric computation'],
    acceptance: [
      { id: 'steps-complete', description: 'All derivation steps execute without error', required: true },
      { id: 'provenance-present', description: 'Result carries engine version/seed/tolerance provenance', required: true },
    ],
    riskClass: 'read_only',
  }
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'task_episode',
    episodeId,
    sessionDigest,
    eventRange: { fromSeq: 0, toSeq: 1 },
    task,
    boundaryReasons: ['Single derivation run executed under fixed seed and tolerances'],
    outcome: 'success',
    evidenceGapReportRef: toObjectRef(gap),
  })
}

function buildEvidenceGapReport(runKey) {
  const { episodeId } = episodeIdentity(runKey)
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'evidence_gap_report',
    reportId: `${episodeId}#gap`,
    episodeId,
    missing: [
      {
        field: 'counterfactual',
        reason: 'not_recorded',
        consequence: 'Single-run observational evidence cannot support causal claims.',
        remediation: 'Run a baseline/treatment comparison to reach H3.',
      },
    ],
    conflicts: [],
    maximumEvidenceLevel: 'H0',
    generatedAt: new Date().toISOString(),
  })
}

function buildTraceEvidence(episode, run) {
  const evidenceId = `${episode.episodeId}#trace`
  const source = run.provenance?.engine_versions ?? {}
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'trace_evidence',
    evidenceId,
    source: {
      harness: 'math-agent-framework',
      sessionDigest: episode.sessionDigest,
      schemaNamespace: 'https://aen.dev/adapters/maf/v1',
      schemaVersion: '0.1',
      exporterVersion: `maf-${run.provenance?.maf_version ?? 'unknown'}`,
      mappingProfile: 'maf-derivation-run',
      mappingVersion: '0.1',
    },
    eventRange: { fromSeq: 0, toSeq: 1 },
    episodeDigest: episode.digest,
    excerpts: [
      {
        mediaType: 'application/json',
        content: JSON.stringify({ result: run.result, provenance: run.provenance }, null, 2).slice(0, 4000),
        sourceDigest: sha256(canonicalJson(run)),
        transformationIds: ['redact-locators'],
      },
    ],
    commitments: {
      rawTraceDigest: sha256(canonicalJson(run)),
      artifactDigests: Object.values(source).map((version) => sha256(canonicalJson(version))),
    },
    disclosure: 'redacted_excerpt',
    redaction: {
      scannerVersions: { 'maf-redactor': '0.1.0' },
      transformations: [{ ruleId: 'redact-locators', count: 1 }],
      residualRisk: 'low',
      humanReviewed: false,
    },
  })
}

function evidenceRefs(episode, trace) {
  return [toObjectRef(trace), toObjectRef(episode)]
}

function buildExperience(def, episode, trace, gap) {
  const experienceId = `urn:aen:experience:math:universal:${def.slug}`
  const claimId = `${experienceId}#observed`
  const traceRef = toObjectRef(trace)
  const episodeRef = toObjectRef(episode)
  // claim type 必须来自协议枚举（strategy_works/failure_cause/safety_constraint/...）
  const claimType = def.claimType ?? 'strategy_works'
  const applicability = {
    taskFamilies: def.taskFamilies,
    modelSelectors: [
      { path: 'model.provider', operator: 'equals', value: 'sympy' },
      { path: 'model.modelId', operator: 'equals', value: 'symbolic-engine' },
    ],
    excludedConditions: ['A different engine or parameterization without re-verification.'],
    revalidateOn: [{ kind: 'environment_change' }, { kind: 'contention' }],
    // generality 为一等公民字段（阶段5）：数学技巧是跨场景可迁移的通用经验。
    // 诚实标注：此为技术特性声明，非 transfer 评测证据（种子为 H0 观测性）。
    generality: 'universal',
  }
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'experience_revision',
    experienceId,
    revision: 1,
    createdAt: new Date().toISOString(),
    relations: [
      // evidenceRefs 仅限 trace_evidence/observation/attestation/contention；episode 作 relation target
      { type: 'derived_from', target: episodeRef, evidenceRefs: [traceRef] },
    ],
    kind: def.kind,
    namespace,
    publisher,
    languages: ['en'],
    title: def.title,
    summary: def.summary,
    intendedUses: def.intendedUses,
    outOfScopeUses: [
      'Claims of counterfactual improvement without a baseline/treatment comparison (H3).',
      'Applying the technique to a different Model × Harness configuration without re-verification.',
    ],
    knownLimitations: [
      ...def.limitations,
      'Single derivation-run observational evidence (H0); not counterfactual-tested.',
      'Applicability selectors are minimal; environment transferability is unmeasured.',
    ],
    knownFailureModes: def.failureModes,
    task: episode.task,
    claims: [{
      claimId,
      type: claimType,
      statement: def.claim,
      mode: 'observational',
      evidenceLevel: 'H0',
      scope: applicability,
      supportingEvidenceRefs: [traceRef],
      contradictingEvidenceRefs: [],
      falsificationConditions: [
        'A re-run of the same derivation produces a different mathematical result.',
        'The technique fails on a second model in the same task family.',
      ],
      assumptions: [
        'The MAF derivation run recorded in the evidence is representative of the technique.',
        'SymPy symbolic results are authoritative for the stated task families.',
      ],
    }],
    applicability,
    recipe: {
      strategy: def.recipe,
      preconditions: [
        { checkId: 'reproducible', description: 'A fresh derivation run reproduces the result', required: true },
        { checkId: 'scope-check', description: 'The target task matches the stated task families', required: true },
      ],
      steps: def.steps,
      checkpoints: episode.task.acceptance.map((criterion) => ({
        checkId: criterion.id,
        description: criterion.description,
        required: criterion.required,
      })),
      fallbacks: [
        { when: 'The technique yields a degenerate result', action: 'Re-derive with the completing-the-square fallback and re-verify', riskClass: 'read_only' },
      ],
      stopConditions: ['The task is outside the declared task families.', 'A verification check fails.'],
    },
    evidenceRefs: [traceRef],
    artifactRefs: [],
    governance: {
      visibility: 'private',
      owner: publisher,
      dataClasses: ['internal'],
      redistribution: 'none',
      sourcePolicy: 'aen.math-seed.v1',
      redactionReport: trace.redaction,
      safetyLabels: ['human-review-required', 'no-automatic-execution', 'observational-only'],
    },
    extensions: {
      'https://aen.dev/extensions/aen/generality': 'universal',
      'https://aen.dev/extensions/aen/seed-source': 'maf',
    },
  })
}

const SEEDS = [
  {
    slug: 'ces-marginal-product-order',
    claimType: 'strategy_works',
    kind: 'execution_strategy',
    taskFamilies: ['math', 'symbolic-derivation', 'production-function', 'CES'],
    title: 'Derive CES marginal products before log-linearizing',
    summary: 'For a CES production function, differentiate the aggregator w.r.t. each input first, simplify using the CES identity, then log-linearize; the σ→1 limit collapses to Cobb-Douglas.',
    claim: 'Differentiating the CES aggregator input-by-input and simplifying before log-linearization yields the marginal product formula whose σ→1 limit reproduces the Cobb-Douglas marginal product.',
    intendedUses: ['Guiding symbolic derivation of CES marginal products in economic models.', 'Avoiding singular naive derivatives at CES boundary parameters.'],
    limitations: ['Applies to constant-elasticity aggregators; variable-elasticity forms need separate treatment.'],
    failureModes: ['Log-linearizing before simplifying introduces avoidable nested aggregator terms.', 'Applying the σ→1 limit to the raw (unsimplified) derivative yields a 0/0 form.'],
    recipe: 'Compute MPL = ∂F/∂L symbolically, simplify the CES aggregator term, then log-linearize; verify the Cobb-Douglas limit at σ→1.',
    steps: [
      { stepId: 'differentiate', instruction: 'Differentiate the CES aggregator w.r.t. each input with SymPy.', rationaleSummary: 'Symbolic differentiation of the aggregate before simplification is the reliable order.', riskClass: 'read_only' },
      { stepId: 'simplify', instruction: 'Simplify using the CES identity and the output/input ratio.', rationaleSummary: 'Simplification removes the nested aggregator term.', riskClass: 'read_only' },
      { stepId: 'limit-check', instruction: 'Verify the σ→1 limit matches the Cobb-Douglas marginal product.', rationaleSummary: 'The limit is the classic degeneration check for CES.', riskClass: 'read_only' },
    ],
  },
  {
    slug: 'quadratic-turning-point-soc',
    claimType: 'strategy_works',
    kind: 'execution_strategy',
    taskFamilies: ['math', 'symbolic-derivation', 'quadratic-form', 'optimization'],
    title: 'Classify a quadratic U-shape via FOC turning point + second derivative sign',
    summary: 'For an objective a·x+b·x², the FOC turning point is x*=-a/(2b) and the extremum type is decided by the sign of the second derivative 2b; the turning point is the anchor for the Delta-method standard error.',
    claim: 'Solving the FOC a+2b·x=0 for x*=-a/(2b) and classifying via the Hessian/second-derivative sign (2b) fully determines the U (b>0) vs inverted-U (b<0) extremum and its Delta-method SE anchor.',
    intendedUses: ['Deriving and classifying turning points in quadratic-form econometric models.', 'Obtaining the standard error anchor for a U-shaped relationship.'],
    limitations: ['Requires the objective to be genuinely quadratic in the turning-point variable.'],
    failureModes: ['Classifying by the first derivative only (sign of x*) instead of the second derivative.', 'Using a non-anchored SE when the turning point lies outside the observed support.'],
    recipe: 'Differentiate to get FOC a+2b·x=0, solve x*=-a/(2b), compute the Hessian/second derivative 2b, classify by its sign, then compute the Delta-method SE at x*.',
    steps: [
      { stepId: 'foc', instruction: 'Set the first derivative a+2b·x=0 and solve for x*.', rationaleSummary: 'FOC identifies the stationary point.', riskClass: 'read_only' },
      { stepId: 'soc', instruction: 'Evaluate the second derivative 2b to classify the extremum.', rationaleSummary: 'The sign of the curvature decides U vs inverted-U.', riskClass: 'read_only' },
      { stepId: 'se', instruction: 'Anchor the Delta-method SE at x* for inference.', rationaleSummary: 'The turning point is the natural anchor for the SE.', riskClass: 'read_only' },
    ],
  },
  {
    slug: 'ces-degenerate-boundary-parameters',
    claimType: 'failure_cause',
    kind: 'negative_result',
    taskFamilies: ['math', 'symbolic-derivation', 'production-function', 'CES'],
    title: 'CES marginal products are singular at the σ→1 / α→1 boundary',
    summary: 'At boundary parameters (σ→1, α→1), the naive CES marginal-product derivative becomes singular (0/0); use the limiting Cobb-Douglas expression and re-check numerical FOC at the boundary.',
    claim: 'The raw CES marginal product is singular at the σ→1 or α→1 boundary, and numerical FOC checks at extreme parameters must use the Cobb-Douglas limiting form to avoid false failures.',
    intendedUses: ['Handling boundary parameter grids in CES estimation.', 'Avoiding spurious numerical verification failures near degenerate parameters.'],
    limitations: ['The boundary limit is well-defined only for strictly positive inputs and elasticities.'],
    failureModes: ['Reporting a singular derivative as a model failure.', 'Running numerical FOC checks at σ=1 without the limiting form.'],
    recipe: 'Detect boundary parameters (σ→1, α→1), substitute the Cobb-Douglas limiting expression, and only then run numerical checks.',
    steps: [
      { stepId: 'detect', instruction: 'Detect σ≈1 or α≈1 in the parameter set.', rationaleSummary: 'Boundary parameters are the singular locus.', riskClass: 'read_only' },
      { stepId: 'limit', instruction: 'Substitute the Cobb-Douglas limiting expression.', rationaleSummary: 'The limit removes the 0/0 form.', riskClass: 'read_only' },
      { stepId: 'recheck', instruction: 'Re-run the numerical FOC check at the boundary.', rationaleSummary: 'Numerical checks at the boundary require the limiting form.', riskClass: 'read_only' },
    ],
  },
  {
    slug: 'monte-carlo-foc-bar',
    claimType: 'safety_constraint',
    kind: 'safety_constraint',
    taskFamilies: ['math', 'numerical-verification', 'monte-carlo', 'foc'],
    title: 'Accept a Monte Carlo FOC check only with a fixed seed, tolerance, and ≥95% pass rate',
    summary: 'Monte Carlo FOC verification must fix the seed and tolerance (1e-4) and accept only when the zero-crossing pass rate is ≥95%; a single sample is never conclusive.',
    claim: 'A reproducible Monte Carlo FOC zero-crossing check requires a fixed seed, a stated tolerance, and a ≥95% pass-rate acceptance bar; single samples are non-conclusive.',
    intendedUses: ['Setting the acceptance bar for numerical verification of stationary points.', 'Making verification reproducible across runs.'],
    limitations: ['The 95% bar is a convention; domain-specific risk may demand a stricter bar.'],
    failureModes: ['Varying the seed changes the verdict.', 'Accepting a single favorable sample as proof.'],
    recipe: 'Fix the seed and tolerance, draw the parameter grid, compute the numerical derivative at the theoretical turning point, and require the pass rate ≥95% before accepting.',
    steps: [
      { stepId: 'fix-seed', instruction: 'Fix the random seed for reproducibility.', rationaleSummary: 'A fixed seed makes the check reproducible.', riskClass: 'read_only' },
      { stepId: 'compute', instruction: 'Compute numerical derivatives at the theoretical turning point over the grid.', rationaleSummary: 'Central differences at the theoretical turning point test the FOC.', riskClass: 'read_only' },
      { stepId: 'bar', instruction: 'Require pass rate ≥95% at the stated tolerance.', rationaleSummary: 'The bar guards against flaky single-sample verdicts.', riskClass: 'read_only' },
    ],
  },
  {
    slug: 'symbolic-foc-empty-set-recovery',
    claimType: 'strategy_works',
    kind: 'failure_recovery',
    taskFamilies: ['math', 'symbolic-derivation', 'quadratic-form', 'optimization'],
    title: 'Recover from an empty FOC solution set by completing the square',
    summary: 'When an algebraic FOC solve returns an empty or degenerate solution set, complete the square and re-derive the turning point before declaring non-existence.',
    claim: 'An empty algebraic FOC solution set for a quadratic objective is usually a degeneracy artifact; completing the square yields the turning point directly and should precede any non-existence conclusion.',
    intendedUses: ['Recovering from symbolic solver failures in turning-point derivations.', 'Avoiding false non-existence conclusions.'],
    limitations: ['Completion of the square applies to quadratic objectives; non-polynomial objectives need another fallback.'],
    failureModes: ['Declaring non-existence on an empty solver result.', 'Repeating the same solve unchanged after failure.'],
    recipe: 'When the FOC solve returns an empty set, complete the square on the objective, read off the turning point, and re-verify with the second derivative.',
    steps: [
      { stepId: 'detect', instruction: 'Detect an empty or degenerate FOC solution set.', rationaleSummary: 'Empty solutions are the failure signal.', riskClass: 'read_only' },
      { stepId: 'square', instruction: 'Complete the square to expose the turning point.', rationaleSummary: 'Completion of the square is robust for quadratics.', riskClass: 'read_only' },
      { stepId: 'reverify', instruction: 'Re-verify with the second-derivative sign.', rationaleSummary: 'Confirms the extremum type after recovery.', riskClass: 'read_only' },
    ],
  },
]

const runs = loadRuns()
const objects = []
const experiences = []

for (const seed of SEEDS) {
  const runKey = seed.runKey ?? (seed.taskFamilies.includes('CES') ? 'derive_ces'
    : seed.taskFamilies.includes('monte-carlo') ? 'verify_monte_carlo' : 'derive_quadratic')
  const run = runs[runKey]
  if (run === undefined) {
    console.warn(`seed ${seed.slug}: missing run ${runKey}, skipping`)
    continue
  }
  const gap = buildEvidenceGapReport(runKey)
  const episode = buildTaskEpisode(runKey, run, gap)
  const trace = buildTraceEvidence(episode, run)
  const experience = buildExperience(seed, episode, trace, gap)
  objects.push(
    { object: gap, role: 'evidence_gap_report' },
    { object: episode, role: 'task_episode' },
    { object: trace, role: 'trace_evidence' },
    { object: experience, role: 'experience_seed' },
  )
  experiences.push(experience)
}

// 种子库是重建式：每次运行从零生成（删除旧文件，避免 UNIQUE 冲突）
if (existsSync(storePath)) rmSync(storePath, { force: true })

const store = new LocalEvidenceStore(storePath)
store.putBatch({ objects })
const queries = ['ces', 'quadratic foc', 'monte carlo', 'turning point']
const searchable = queries.map((query) => ({
  query,
  hits: store.searchExperiences(query, 5).map((hit) => ({ id: hit.experienceId, title: hit.title, state: hit.state })),
}))
store.close()

console.log(JSON.stringify({
  ok: true,
  storePath,
  seeds: experiences.length,
  experienceDigests: experiences.map((e) => e.digest),
  searchable,
}, null, 2))
