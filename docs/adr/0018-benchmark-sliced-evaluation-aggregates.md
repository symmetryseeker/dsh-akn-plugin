# ADR-0018: Benchmark-sliced Evaluation Aggregates

- Status: Accepted
- Date: 2026-08-20
- Scope: AEXP evaluation runner, causal evidence and multi-task Pilot reporting

## Context

The MVP must run at least two task families, while every product-value claim is scoped to a task and its validated BenchmarkTask/grader. The initial runner scheduled multiple BenchmarkTasks through the same Model × Harness cell IDs and then produced one aggregate by grouping only on `cellId`. This mixed task families inside each cell summary. A strong uplift in one family could therefore hide harm in another and still feed a nominally eligible H3 comparison.

The protocol already permits an EvaluationAggregate to reference one or more BenchmarkTasks, so this defect does not require a parallel wire object or a breaking Schema field. It requires a stricter aggregation and evidence rule.

## Decision

1. The runner always creates one `EvaluationAggregate` per BenchmarkTask. These aggregates retain the preregistered baseline/treatment comparisons and are the only runner outputs that may become H3-eligible.
2. When a run contains more than one BenchmarkTask, the runner additionally creates a portfolio aggregate over all trials. It is descriptive only and contains no comparisons.
3. The runtime result and CLI expose both `benchmarkAggregates[]` and the single `aggregate` portfolio/single-task convenience value. Every per-Benchmark aggregate has exactly one `benchmarkRef`.
4. Defense in depth applies below the runner: if any caller directly asks `aggregateExperiment` to compare cells whose trials reference multiple Benchmark digests, the comparison receives `MULTIPLE_BENCHMARKS_MIXED`, is counterfactually ineligible, and cannot support H3.
5. Two-task-family coverage remains computed across all trials. Coverage proves matrix completeness, not that cross-task averaging is causal evidence.

## Consequences

- Product Go can inspect uplift, harm, cost and latency separately for each preregistered task family.
- A portfolio summary remains available for inventory and overall status counts without concealing its non-causal boundary.
- Existing AEXP `EvaluationAggregate`, `EvaluationTrial`, `RunObservation` and digest semantics remain valid; no MVP-only wire object is introduced.
- Consumers that previously read only `result.aggregate` must use `benchmarkAggregates` for multi-Benchmark comparisons. For a single Benchmark, `aggregate` and the sole array entry are the same object.
