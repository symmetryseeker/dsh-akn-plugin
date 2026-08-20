# AEN MVP pilot report — preregistration and reproducibility record

Status: **Draft / engineering dry run complete on the declared machine; real cross-user pilot not yet run**

Profile: `aen-mvp/0.1`

Recorded: 2026-08-20

Protocol: AEXP `0.1 Draft`

## 1. What this report does and does not prove

The repository currently provides reproducible protocol, adapter, native DSH plugin, local store, private Experience, evaluation, Promotion, Hub, MCP, and client contract/integration tests. Those tests prove engineering invariants on synthetic or recorded fixtures.

They do **not** prove that a public experience improves a live model, that three independent developers can use the workflow without maintainer help, or that the project has completed its required 2 Model × 2 stable Harness configuration × 2 task-family pilot. Exact per-run Manifest snapshots remain part of that evidence. No H3 result is reported here. The machine-checked freeze contract is defined in [AEN-MVP-pilot-preregistration.md](./AEN-MVP-pilot-preregistration.md); this report remains the human-readable execution/result record.

## 2. Reproduce the engineering dry run

Environment used for the current record:

- macOS arm64;
- Node.js 22+ required;
- pnpm 11.19.0;
- DSH compatibility target `0.1.0-rc.7`;
- SQLite for local data; `pg-mem` for fast contract tests; isolated native PostgreSQL 17 for integration, multi-process E2E and performance smoke tests.

From a clean checkout:

```sh
pnpm install --frozen-lockfile
pnpm schemas:generate
pnpm typecheck
pnpm test
pnpm conformance
pnpm test:postgres
pnpm test:e2e
pnpm test:dsh-plugin-host
pnpm test:hub-deployment
pnpm bench:performance
pnpm bench:dsh-hot-path
pnpm --filter @aen/hub-app start verify \
  --git-root ../../contributions \
  --keys ../../contributions/authorized-keys.json
```

The last command validates reviewed public contributions if any exist; an empty authorized-key registry is expected before a publisher key is added by review.

Current implementation evidence:

| Boundary | Automated evidence | Important limitation |
| --- | --- | --- |
| AEXP schemas/digests/signatures | valid, invalid, golden and tamper fixtures | one reference implementation only |
| DSH capture | JSONL/ZIP mapping, real DSH service composition, and installed official-headless host trial with a mock model | no real DeepSeek model result or H3 claim |
| Candidate selection | ordinary-call denial and failure→recovery trigger | recorded/synthetic fixture |
| Community extensibility | sample Adapter emits valid Manifest/Episode/Gap objects | teaching format is intentionally H0 |
| Private loop | SQLite create/search/fetch/review | single local user |
| Evaluation | cell-aware aggregate, causal eligibility gates, and official DSH headless execution mechanism | synthetic/mock-model modes cannot produce H3 |
| Promotion/Hub | signed closed graph, ingress denials, native PostgreSQL projection rebuild, exact read and active-body purge on revocation | automated second process/user boundary, not an independent participant |
| Consumption | compatibility hard filter, budget, immutable read, injection and feedback gates | no live adoption outcome yet |
| Safety | secret/path/license checks, hostile-input mutation/resource limits, metadata-only Artifact profile, no execute tool, tombstone/body purge survives rebuild | external security review pending |

Measured engineering smoke evidence on the declared Apple M5 machine:

- 1,000 synthetic Experiences, concurrency 1: Node built-in SQLite search p95 `3.110 ms`; native PostgreSQL + loopback HTTP first cards p95 `20.923 ms`.
- Official DSH registry composition: ordinary tool events created `0` AEN objects. The isolated append microbenchmark added about `0.857 µs/event`, but its relative `+46.73%` diagnostic delta does **not** establish the complete-Spec whole-tool-workload CPU `<1%` target.
- Full workspace: 108 tests passed; the conditional native-PostgreSQL test also passed under `pnpm test:postgres`; conformance 19 valid / 23 invalid / 19 golden, zero failures. The DSH tarball, official ToolRuntime consumer/cancellation pipeline, official-headless evaluation mechanism and portable Hub deployment each pass their real-host boundary tests.

See the reports under `docs/performance/` and `docs/security/`. Synthetic performance/load data is not pilot outcome evidence.

## 3. Frozen preregistration fields for the real pilot

Fill these fields in a reviewed commit before the first live trial, encode them in the preregistration JSON, and require `aen pilot validate ...` to exit 0. Do not edit them after seeing outcomes; amendments require a new commit and reason.

- Participants: at least three developers who do not share a local database; IDs: `TBD`.
- Task family A and fixture revision: `TBD`.
- Task family B and fixture revision: `TBD`.
- ModelFingerprint A, pricing/rate-limit snapshot: `TBD`.
- ModelFingerprint B, pricing/rate-limit snapshot: `TBD`.
- DSH stable Harness configuration A digest, representative Manifest digest and declared difference: `TBD`.
- DSH stable Harness configuration B digest, representative Manifest digest and declared difference: `TBD`.
- Primary outcome and grader version per task family: `TBD`.
- Secondary metrics: quality, total cost, latency, input/output/reasoning tokens, retries, approvals, tool calls/failures, negative transfer.
- Repetitions per cell and minimum valid trials: `TBD` based on budget and expected variance.
- Reliability `k`, confidence method, and stopping rule: `TBD`.
- Predeclared excluded statuses: only explicitly listed infrastructure/grader/aborted statuses; agent failures and policy refusals remain outcomes.
- Privacy boundary: raw trace/local database stays with its participant; only reviewed Promotion output enters the public Git contribution.
- Budget owner and hard limit: `TBD`.

Required cells cover both task families across two Models and two Harness Manifests, with no-experience baseline and Experience-applied treatment. Each task resolves its own immutable public Experience through `experienceRefsByBenchmark` and its own primary analysis through `comparisonsByBenchmark`; a cell shared for scheduling does not make treatment task-independent. Comparisons must hold Model, Harness, environment, and task constant except for treatment. A factorial interaction claim requires its own predeclared analysis; pairwise differences cannot be relabeled as interaction.

Results must use the runner's per-Benchmark aggregates. The cross-Benchmark portfolio is descriptive and intentionally has no comparisons; it cannot be cited for H3 or used to let one task family's uplift hide another family's harm (ADR-0018).

## 4. Cross-user runtime transcript to collect

1. Developer A captures a live Manifest, imports an authoritative DSH export, distills and reviews a private Experience.
2. A requests public Promotion, inspects source/target diff, signs the closed graph, and opens a Git contribution.
3. CI rejects one deliberately invalid disposable contribution, then accepts the corrected reviewed contribution.
4. Developer B, with no copy of A's SQLite database, searches the Reference Hub under a compatible and an incompatible configuration.
5. B reads the immutable card and selected sections, records actual injection, chooses adopted/rejected/rollback, and runs the task.
6. B contributes a measured RunObservation. Supporting and contradicting observations remain simultaneously visible.
7. A disposable secret/license incident is emergency-blocked, formally revoked, and remains unreadable after Git projection rebuild.

Record commands, commit/digests, participant boundaries, HTTP status codes, timestamps, and redacted screenshots/logs. Do not include raw prompts, credentials, local paths, or private traces.

## 5. Result tables (intentionally empty)

| Task family | Model | Harness digest | Baseline n | Treatment n | Primary delta + interval | Cost delta | Latency delta | Negative transfer | Conclusion |
| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | 0 | 0 | not run | not run | not run | not run | no result |

Cross-user funnel: contributors `0`; independent consumers `0`; searches `0`; injections `0`; measured adoptions `0`; rollbacks `0`; unhandled critical incidents `0`.

## 6. Go / no-go rule

Engineering completion and product validation are separate. Product Go requires at least one preregistered task family to show reproducible positive uplift on its primary metric without being canceled by negative transfer, extra cost, or a security incident. It also requires multiple real cross-user adoptions and zero unresolved critical secret/remote-execution incidents. “No significant improvement” is a valid honest pilot outcome.

Until the tables contain reviewed real evidence, the project remains Draft/Pilot and this report must not be cited as proof of effectiveness.
