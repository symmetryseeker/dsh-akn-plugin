# M3 Comparative Evaluation 实现记录 — Draft/Pilot

对应 MVP-FR-011、MVP-FR-012，以及 AEXP 0.1 的 Model × Harness × Environment 对照评测和 H-level 语义。

## 已实现

- BenchmarkTask、RunObservation、EvaluationTrial、EvaluationAggregate 全部分层保存；
- `EvaluationDriver` 只返回一次实际运行的 Observation、status、grader results 与可选 TraceEvidence；runner 不从异常或 LLM 文本伪造 Observation；
- 每个 trial 强制校验 experiment/cell/trial/attempt、Benchmark、Model、稳定 Harness 配置摘要、代表 Manifest、treatment 与 Experience ref；
- cell-aware aggregate，按 cell 分报 status、valid/excluded、success、metrics、`pass@1`、`pass@k`、`pass^k`；
- success rate 使用 Wilson interval；两组差值使用 Newcombe-style Wilson 差区间；连续指标使用显式标注的 normal Welch-style 近似；
- success/agent_failure/policy_refusal/infra_error/grader_error/aborted 全部进入 `statusCounts`；只允许预注册排除 infra_error、grader_error、aborted；
- baseline/treatment comparison 保存 comparison kind、primary metric、绝对/相对差、uncertainty、conclusion、confounders 与 eligibility reason codes；
- Experience uplift 强制相同 Model、稳定 Harness 配置、Environment，baseline 不得带 Experience，treatment 必须带 Experience；
- Model effect 与 Harness effect 分别检查另一轴固定；pairwise comparison 不冒充 factorial interaction；
- synthetic test evidence 自动失去 counterfactual eligibility；无 eligible comparison 时 causal H3 被拒绝；
- 2 Model × 2 Harness × 2 task-family coverage report。
- 每个 BenchmarkTask 独立生成保留 comparisons 的 Aggregate；多任务运行另生成 comparison-free portfolio，不能把任务族混成一个 H3；底层直接混合比较也以 `MULTIPLE_BENCHMARKS_MIXED` 失败关闭（ADR-0018）。
- multi-task plan 按 Benchmark 解析 `experienceRefsByBenchmark` 与 `comparisonsByBenchmark`；不同任务可使用各自 Experience revision、grader 指标和 comparison，单任务旧写法保持兼容（ADR-0019）。
- plan 只允许排除 infra/grader/aborted，CLI 不会把命令行 Benchmark 偷偷追加到已解析的预注册矩阵。
- 内置 `@aen/dsh-plugin/evaluation-driver` 通过官方 `dsh --profile headless` 执行真实 Harness 主机，要求插件已经安装并启用；每个 trial 使用独立 workspace、严格 fixture/patch 映射、权威 JSONL 和 session-correlated live Manifest。
- cell 同时冻结 `harnessConfigurationDigest` 和 reviewed representative `harnessManifestDigest`。运行 Manifest 可以因 session/time scope 得到新 digest，但其稳定配置摘要必须完全相同。
- 显式评测 trial 会生成 metadata-only 的 TaskEpisode/TraceEvidence；原始 prompt、tool arguments/results 和 trace bytes 保留本地。

## CLI driver 边界

```sh
aen evaluate <benchmark-id> \
  --matrix /absolute/path/matrix.json \
  --driver /absolute/path/trusted-driver.mjs
```

driver 是用户显式选择的本地可信模块，必须导出：

```js
export const driver = {
  name: 'my-dsh-evaluator',
  executionMode: 'live', // live | recorded_run | synthetic_test
  async run(input) {
    return { observation, status, graderResults, transcript }
  },
}
```

CLI 不会从 Hub、Experience 或 Artifact 自动下载/执行 driver。driver 返回的 RunObservation 必须已经是合法 AEXP 对象并声明相同 execution mode。

内置 DSH driver 使用：

```sh
aen evaluate <benchmark-id> \
  --matrix /absolute/path/matrix.json \
  --dsh-driver-config /absolute/path/dsh-driver.json \
  --grader /absolute/path/trusted-grader.mjs \
  --store /absolute/path/.aen/evidence.sqlite
```

driver config 只接受绝对路径、`profile=headless`、显式 `harnessVersion`、按 Benchmark digest 闭合的 fixture 映射、按稳定 Harness configuration digest 闭合的 patch 映射及 context/output budgets。trusted grader 必须是本地显式模块；不得由 Hub 或 Experience 提供。

`<benchmark-id>` 必须已经存在于 matrix 的 `benchmarkSelectors[]`；它是执行确认，不是修改计划的入口。

CLI 的 `benchmarkAggregates[]` 是逐 Benchmark 的对照结果；多 Benchmark 时顶层 `aggregate` 只是无 comparisons 的 portfolio。单 Benchmark 时两者指向同一个协议对象。

matrix JSON 是本地 runner 配置，不是新的交换协议对象，包含：

- `experimentId`
- `benchmarkSelectors[]`
- `cells[]`：cellId、treatment、完整 ModelFingerprint、稳定 `harnessConfigurationDigest`、reviewed representative `harnessManifestDigest`；单任务 treatment 使用 `experienceRef`，多任务 treatment 必须使用按 selector 闭合的 `experienceRefsByBenchmark`
- `repetitions`、`reliabilityK`、`confidenceLevel`、`minValidTrialsPerCell`
- `excludedStatuses[]`
- 单任务 `comparisons[]`，或多任务按 selector 闭合的 `comparisonsByBenchmark`

真实 Pilot 在执行前还必须通过：

```sh
aen pilot validate /absolute/path/pilot-preregistration.json \
  --store /absolute/path/.aen/evidence.sqlite
```

该校验覆盖 reviewed freeze、三方隔离、公开 Hub 运维控制、预算/隐私、exact 2×2×2、任务级 public Experience 与每任务 comparison；通过只表示设计可运行，不表示已有 uplift。

## 尚未满足的真实试点 DoD

单元测试使用 synthetic/recorded fixtures 验证矩阵和统计语义；另外，官方 DSH headless 主机、安装后的 AEN 插件和本地 mock 模型已经完成端到端机制验收，覆盖 driver 库入口、`aen evaluate --dsh-driver-config` CLI 入口及由 Benchmark Artifact tree digest 绑定的非空 copy fixture。该验收不声称运行了真实 DeepSeek 模型，也不产生 uplift 证据。要完成 M3 试点仍需：

- 两个实际可用 ModelFingerprint；
- 两个实际不同的 DSH HarnessManifest；
- 两个 validated task families 与真实 grader；
- 用户授权的模型预算/凭据；
- 实际重复运行后得到 H3 uplift，或诚实记录 no significant difference。

在这些条件满足前，Capability 可以开发和验证，但项目状态不得写成“已完成真实 H3 试点”。

任务切片决策见 [ADR-0018](../adr/0018-benchmark-sliced-evaluation-aggregates.md)，任务级 treatment/analysis 决策见 [ADR-0019](../adr/0019-task-scoped-evaluation-plans.md)，官方 DSH driver 与证据边界见 [ADR-0020](../adr/0020-official-dsh-headless-evaluation-driver.md)，Pilot 输入协议见 [真实 Pilot 预注册协议](../pilot/AEN-MVP-pilot-preregistration.md)。
