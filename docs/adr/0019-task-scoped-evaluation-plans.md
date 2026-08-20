# ADR-0019: Multi-task evaluation plans bind treatments and analyses per Benchmark

> Maturity: AEXP 0.1 Draft / AEN Pilot
>
> Status: Accepted
>
> Date: 2026-08-20

## Context

The first MVP runner reused one `cells[]` array and one `comparisons[]` array for every selected BenchmarkTask. `MatrixCell.experienceRef` therefore forced all task families to receive the same Experience revision, while one primary metric/comparison plan was silently reused across tasks. That is not a valid test of task-level experience: an Experience appropriate for software recovery need not be the treatment for document analysis, and each Benchmark may have its own grader and primary outcome.

The defect remained even after ADR-0018 separated the resulting Aggregates. Slicing statistics by Benchmark prevents mixed-task aggregation, but it does not repair a treatment that was assigned at the wrong level.

## Decision

1. Model and Harness remain reusable configuration coordinates in `cells[]`.
2. A multi-Benchmark `experience_applied` cell MUST use `experienceRefsByBenchmark`, keyed by the exact preregistered Benchmark selectors and containing immutable Experience ID/revision/digest triples. A single `experienceRef` remains valid only for a single-Benchmark plan.
3. A multi-Benchmark causal plan MUST use `comparisonsByBenchmark`. This permits task-specific metrics and analysis declarations. The legacy `comparisons[]` form remains valid for one Benchmark or a comparison-free descriptive matrix.
4. The runner resolves a plain single-Experience `MatrixCell` before invoking a driver. It validates the exact revision locally and requires the returned RunObservation to reference that same revision.
5. Baselines cannot reference an Experience. `experience_applied` cells cannot omit one. Agent failure and policy refusal remain outcomes; only predeclared infrastructure, grader, and aborted statuses may be excluded.
6. CLI execution cannot add a Benchmark to a parsed plan. The command-line selector must already be present in the preregistration.
7. These fields are local runner configuration, not new AEXP wire objects. Protocol Trial, Observation and Aggregate schemas remain unchanged.

## Consequences

- Each task family can evaluate its own relevant Experience while holding Model, Harness and task environment fixed.
- Negative transfer cannot be hidden by assigning an unrelated task the wrong treatment or by reusing another task's primary metric.
- Existing single-task plans remain compatible; ambiguous multi-task causal plans fail closed and require an explicit migration.
- ADR-0018 still governs output aggregation: each Benchmark has its own causal Aggregate and the cross-Benchmark portfolio is descriptive only.
