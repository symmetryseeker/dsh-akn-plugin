# ADR-0006: EvaluationAggregate 必须保留 cell 与对照结构

> Maturity: AEXP 0.1 Draft / AEN Pilot.

- 状态：Accepted
- 日期：2026-08-20

## 问题

早期 `EvaluationAggregate` 只有全局 trial 数和成功率，没有 `cellId` 分组、baseline/treatment 对照、差值区间、confounder 或 counterfactual eligibility。在 2 Model × 2 Harness 或 no-experience baseline/treatment 中，这会把不同配置混成无意义平均数，却仍可被误用来生成 H3 claim。

## 决策

- Aggregate 保留总体摘要，同时必须含至少一个 `cellSummaries` 条目。
- 每个 cell summary 引用该 cell 的 Trial，分报 valid/excluded、per-trial success、`pass@k`、`pass^k` 与 metrics。
- Aggregate 和 cell 同时保存所有 trial status 计数；排除数只用于 infra/grader/aborted 等预声明非有效 trial。
- 预声明对照写入 `comparisons`：保存 comparison kind、baseline/treatment cell、primary metric、绝对/相对差、区间方法、结论、confounders 与 eligibility reason codes。
- H3 派生只读取 `counterfactualEligibility.status=eligible` 且区间支持的 comparison；没有对照时最高 H2。
- 所有统计均是 trial/observation 的派生投影，不覆盖原始对象。
