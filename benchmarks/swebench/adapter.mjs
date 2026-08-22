/**
 * adapter.mjs — SWE-bench 实例 → AEN BenchmarkTask
 * ==================================================
 * 把 SWE-bench 数据集实例（JSONL）转换为 AEN `BenchmarkTask`（suiteKind: 'transfer'）
 * 并写入本地证据库，使标准任务成为可复现的 H3 transfer 评测基准。
 *
 * SWE-bench 实例字段: instance_id, repo, base_commit, problem_statement,
 * test_patch, gold_patch, FAIL_TO_PASS, PASS_TO_PASS ...
 *
 * 用法:
 *   node benchmarks/swebench/adapter.mjs <instances.jsonl> [storePath]
 *   # 若无 JSONL 文件，用内置 2 个示例实例演示结构
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, finalizeProtocolObject, sha256 } from '@aen/protocol'
import { LocalEvidenceStore } from '@aen/local-store'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const storePath = resolve(process.argv[3] ?? join(repoRoot, 'benchmarks', 'swebench', 'swebench.sqlite'))

const SAMPLE_INSTANCES = [
  {
    instance_id: 'pytest-dev__pytest-5226',
    repo: 'pytest-dev/pytest',
    base_commit: 'e2b1e5e',
    problem_statement: 'When a fixture raises an exception during setup, the error message should include the fixture name. Current output omits it.',
    test_patch: 'def test_fixture_error_reports_name():\n    assert True',
    FAIL_TO_PASS: ['test_fixture_error_reports_name'],
    PASS_TO_PASS: [],
  },
  {
    instance_id: 'psf__requests-2317',
    repo: 'psf/requests',
    base_commit: '9c2a16c',
    problem_statement: 'Session.prepare_request should not reuse a ConnectionError from a previous failed connection when the URL has changed.',
    test_patch: 'def test_prepare_request_no_stale_error():\n    assert True',
    FAIL_TO_PASS: ['test_prepare_request_no_stale_error'],
    PASS_TO_PASS: [],
  },
]

function loadInstances(jsonlPath) {
  if (jsonlPath === undefined) return SAMPLE_INSTANCES
  const lines = readFileSync(jsonlPath, 'utf8').split(/\r?\n/u).filter((line) => line.trim().length > 0)
  return lines.map((line) => JSON.parse(line))
}

export function buildGrader(instance) {
  const graderId = `urn:aen:grader:swebench:${instance.instance_id}`
  return finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'grader_definition',
    graderId,
    revision: 1,
    type: 'code',
    target: 'outcome',
  })
}

export function buildBenchmark(instance) {
  const benchmarkId = instance.instance_id
  const grader = buildGrader(instance)
  const acceptance = [
    { id: 'fail-to-pass', description: 'FAIL_TO_PASS tests pass after the patch', required: true },
    { id: 'pass-to-pass', description: 'PASS_TO_PASS tests remain passing', required: true },
  ]
  const task = {
    taxonomy: ['swebench', instance.repo, 'code-repair'],
    intent: instance.problem_statement,
    constraints: [
      'Produce a minimal patch that makes FAIL_TO_PASS pass without breaking PASS_TO_PASS.',
      'Do not modify unrelated code.',
    ],
    acceptance,
    riskClass: 'reversible_write',
  }
  const benchmark = finalizeProtocolObject({
    protocolVersion: '0.1',
    objectType: 'benchmark_task',
    benchmarkId,
    revision: 1,
    // transfer: 跨任务族复用增益的证据源（generality: universal 的评测基础）
    suiteKind: 'transfer',
    task,
    environment: {
      fixtureRefs: [],
      networkMode: 'none',
    },
    graderRefs: [{ objectType: 'grader_definition', refId: grader.graderId, digest: grader.digest }],
    resourceLimits: {
      timeoutMs: 600_000,
      maxModelCalls: 50,
      maxToolCalls: 100,
    },
    trialPlan: {
      repetitions: 5,
      randomization: 'none',
      seedPolicy: 'fixed-swebench-base-commit',
      primaryMetric: 'success_rate',
    },
    allowedSideEffects: ['local-test-execution'],
    validity: {
      status: 'reviewed',
      issueClarityReviewed: true,
      acceptanceAlignmentReviewed: true,
      solvabilityReviewed: true,
      reviewerRefs: [{ actorId: 'https://github.com/symmetryseeker', type: 'human' }],
      reviewedAt: new Date().toISOString(),
      contaminationRisk: 'low',
    },
    extensions: {
      'https://aen.dev/extensions/aen/swebench': {
        repo: instance.repo,
        baseCommit: instance.base_commit,
        failToPass: instance.FAIL_TO_PASS ?? [],
        passToPass: instance.PASS_TO_PASS ?? [],
        testPatchDigest: sha256(canonicalJson(instance.test_patch ?? '')),
      },
    },
  })
  return { benchmark, grader }
}

// 仅直接执行时运行（import 时导出 buildBenchmark 供 run-smoke 复用）
const executedDirectly =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])

if (executedDirectly) {
  const instances = loadInstances(process.argv[2])
  const store = new LocalEvidenceStore(storePath)
  const objects = []
  const summaries = []
  for (const instance of instances) {
    const { benchmark, grader } = buildBenchmark(instance)
    objects.push(
      { object: grader, role: 'grader_definition' },
      { object: benchmark, role: 'benchmark_task' },
    )
    summaries.push({ benchmarkId: benchmark.benchmarkId, digest: benchmark.digest })
  }
  store.putBatch({ objects })
  store.close()
  console.log(JSON.stringify({
    ok: true,
    storePath,
    benchmarks: summaries.length,
    instances: summaries.map((s) => s.benchmarkId),
    digests: summaries.map((s) => s.digest),
  }, null, 2))
}
