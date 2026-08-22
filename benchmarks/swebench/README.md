# SWE-bench / METR → AEN 接入

把社区标准任务集（SWE-bench、METR 等）接入 AEN，作为**可复现的 H3 transfer 评测**基准：

- **`adapter.mjs`** — SWE-bench 实例（JSONL）→ AEN `BenchmarkTask`（`suiteKind: 'transfer'`）写入本地证据库
- **`driver.mjs`** — 参考 `EvaluationDriver`：baseline（无经验）vs treatment（注入 AEN 经验），产出 `RunObservation`
- **`matrix.json`** — 预注册 2×2×2 矩阵（baseline cell + experience_applied cell）
- **`run-smoke.mjs`** — 端到端冒烟：建任务 → `aen evaluate` → 打印 uplift aggregate

## 为什么这是"价值证明"的关键路径

SWE-bench 是社区公认、可复现的标准任务集。用它跑 **baseline vs experience-applied** 的真实 2×2×2，
就能得到"**这个经验网络确实让 Agent 表现更好**"的可信数字——同时正好为 `generality: universal`
提供 transfer 评测证据（跨任务族复用增益），完成阶段 5 的语义闭环。

## 快速开始（冒烟）

```sh
node benchmarks/swebench/run-smoke.mjs --store /tmp/swebench.sqlite
# → 建立基准 → 跑 2×2×2 → 打印 baseline/treatment 对比
```

冒烟用 `synthetic_test` 模式（诚实标注，非真实模型），证明**机制**：注入经验 → 成功率提升。

## 真实 SWE-bench 运行（需要完整环境）

1. 下载 SWE-bench 数据（`swe-bench.jsonl`），按 `adapter.mjs` 转换 → 建立基准。
2. 配置模型 API（env `MATH_AGENT_API_KEY` / OpenAI 兼容端点）。
3. 实现真正的 repo checkout + test runner 作为 driver 的 solve/grade 步骤（本仓库 driver 的 solve/grade 是可替换的函数）。
4. 跑矩阵，把 `executionMode` 从 `synthetic_test` 改为 `recorded_run`/`live`。

> 真实运行需要在沙箱里 checkout repo、应用 patch、跑测试。MVP 的 driver 提供了
> solve/grade 接口与经验注入机制，真实执行器可平滑替换。
