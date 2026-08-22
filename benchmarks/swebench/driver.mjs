/**
 * driver.mjs — 参考 EvaluationDriver（SWE-bench 风格）
 * =====================================================
 * baseline（无经验）vs experience_applied（注入 AEN 经验）的 2×2×2 驱动。
 *
 * 本参考实现用 `synthetic_test` 模式（诚实标注）证明机制：
 *   - 求解器在合成任务（palindrome 边界）上，baseline 漏掉边界 bug，treatment
 *     注入"边界验证"经验后正确 → 成功率提升。
 *   - 真实 SWE-bench 运行 = 替换 solve/grade 为 repo checkout + 真实 test runner，
 *     并把 executionMode 改为 recorded_run/live。
 *
 * 注入的经验内容（recipe）代表 AEN 种子中的通用验证技巧
 * （如 seeds/ 的 monte-carlo-foc-bar / 边界检查类经验）。
 */
import { canonicalJson, finalizeProtocolObject } from '@aen/protocol'

// 注入的通用验证技巧（代表 AEN universal 经验中的验证类 recipe）
const EDGE_CASE_RECIPE = [
  'Check the empty input, single-element input, and boundary values before assuming the general case.',
  'Verify your solution against at least one negative and one boundary test case.',
  'Prefer an explicit guard for degenerate inputs over relying on the general path.',
]

// 合成求解器：对 palindrome 任务，baseline 用朴素实现（漏掉大小写/空格归一化），
// treatment 注入"边界与归一化验证"经验后正确。
export function solve(problemStatement, injected) {
  if (injected) {
    return `function isPalindrome(s) {
  if (s.length <= 1) return true;
  const t = s.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return t === t.split('').reverse().join('');
}`
  }
  return `function isPalindrome(s) {
  return s === s.split('').reverse().join('');
}`
}

// 合成评分器：跑测试套件
export function grade(code) {
  const tests = [
    { name: 'empty', fn: 'isPalindrome("")', expect: true },
    { name: 'single', fn: 'isPalindrome("a")', expect: true },
    { name: 'case-and-space', fn: 'isPalindrome("A man, a plan, a canal: Panama")', expect: true },
    { name: 'not-palindrome', fn: 'isPalindrome("hello")', expect: false },
  ]
  let passed = 0
  let failed = 0
  try {
    // eslint-disable-next-line no-new-func
    const isPalindrome = new Function(`${code}\nreturn isPalindrome;`)()
    for (const test of tests) {
      // eslint-disable-next-line no-new-func
      const actual = new Function('isPalindrome', `return (${test.fn});`)(isPalindrome)
      if (actual === test.expect) passed += 1
      else failed += 1
    }
  } catch {
    failed = tests.length
  }
  return { passed, failed }
}

export const driver = {
  name: 'swebench-reference-driver',
  executionMode: 'synthetic_test',

  async run(input) {
    const applied = input.cell.treatment === 'experience_applied'
    const experienceRef = input.cell.experienceRef
    // 有 experience_applied cell 但无经验 ref → 视为未注入（诚实反映配置）
    const injected = applied && experienceRef !== undefined
      ? EDGE_CASE_RECIPE.join(' ')
      : null

    const problem = input.benchmark.task.intent
    const code = solve(problem, injected)
    const { passed, failed } = grade(code)
    const success = passed > 0 && failed === 0
    const status = success ? 'success' : 'agent_failure'

    const observation = finalizeProtocolObject({
      protocolVersion: '0.1',
      objectType: 'observation',
      observationId: `urn:aen:observation:${input.experimentId}:${input.benchmark.benchmarkId}:${input.cell.cellId}:${input.trialIndex}`,
      ...(input.cell.experienceRef === undefined ? {} : {
        experienceRef: {
          experienceId: input.cell.experienceRef.experienceId,
          revision: input.cell.experienceRef.revision,
          digest: input.cell.experienceRef.digest,
        },
      }),
      taskRef: input.benchmark.benchmarkId,
      evaluatorRef: 'urn:aen:grader:swebench-synthetic',
      configurationCell: {
        model: input.cell.model,
        harnessConfigurationDigest: input.cell.harnessConfigurationDigest,
        harnessManifestDigest: input.cell.harnessManifestDigest,
        environment: { capturedAt: new Date().toISOString(), disclosure: 'metadata', runtime: { driver: 'swebench-reference' } },
      },
      experiment: {
        experimentId: input.experimentId,
        cellId: input.cell.cellId,
        trialIndex: input.trialIndex,
        attemptIndex: input.attemptIndex,
        randomization: 'interleaved_cells',
        seedPolicy: 'synthetic-index',
      },
      treatment: input.cell.treatment,
      outcome: success ? 'success' : 'failure',
      acceptanceResults: [
        { criterionId: 'fail-to-pass', passed: success, evidenceRefs: [] },
        { criterionId: 'pass-to-pass', passed: success, evidenceRefs: [] },
      ],
      metrics: {
        qualityScore: passed / (passed + failed),
        totalCostUsd: injected ? 0.02 : 0.01,
        latencyMs: 100,
        inputTokens: 200,
        outputTokens: 40,
      },
      ...(success ? {} : { failureType: 'edge-case-failure' }),
      evidenceRefs: [],
      independence: {
        evaluatorActor: { actorId: 'urn:aen:grader:swebench-synthetic', type: 'service' },
        modelFamily: input.cell.model.modelId,
      },
      createdAt: new Date().toISOString(),
      extensions: {
        'https://aen.dev/extensions/aen/evaluation-execution-mode': this.executionMode,
        ...(injected === null ? {} : {
          'https://aen.dev/extensions/aen/injected-recipe': { present: true, recipe: injected.slice(0, 120) },
        }),
      },
    })

    return {
      observation,
      status,
      graderResults: observation.acceptanceResults,
    }
  },
}

export default driver
