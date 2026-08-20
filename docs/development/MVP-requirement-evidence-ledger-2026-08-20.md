# AEN MVP requirement evidence ledger — 2026-08-20

Status: **engineering implementation evidence is present for the local/reference implementation; Engineering Complete and Product Go are not yet proven**.

This ledger audits the normative IDs and milestone DoD in the [AEN MVP Implementation Profile 0.1](../../spec/AEN-MVP-implementation-profile.md). A green unit test is not accepted as proof of a broader cross-user or real-model requirement. “Engineering verified” means the requested code path and its in-scope runtime boundary were exercised. “External acceptance pending” means the Profile explicitly requires people, model runs, devices, or an independent reviewer that this repository cannot fabricate.

## Normative requirement disposition

| ID | Disposition | Authoritative evidence and boundary |
| --- | --- | --- |
| MVP-FR-001 | Engineering verified | DSH JSONL/ZIP golden imports in [`adapter.test.ts`](../../packages/adapter-dsh/test/adapter.test.ts); plugin hot-path benchmark proves no parallel tool-call capture. |
| MVP-FR-002 | Engineering verified | Offline `trace_only`, live snapshot, partial/complete Skill closure and coverage gaps in adapter/plugin composition tests; strict reconciliation in [ADR-0014](../adr/0014-local-trace-live-manifest-reconciliation.md). |
| MVP-FR-003 | Engineering verified | ModelFingerprint, Harness-only stable `HarnessManifest.configurationDigest`, exact run Manifest digest and separate Environment Configuration Cells are validated by protocol/adapter/evaluation/plugin tests. Native search obtains all axes authoritatively from the current DSH Agent rather than model-supplied hashes; the official DSH `ToolRuntime.execute()` composition verifies the outbound digests against the Provider's stored Manifest. See [ADR-0021](../adr/0021-authoritative-dsh-consumption-context.md). |
| MVP-FR-004 | Engineering verified | Ordinary tool calls yield no Episode/candidate; recovery chain does, in [`adapter.test.ts`](../../packages/adapter-dsh/test/adapter.test.ts) and [`plugin.test.ts`](../../packages/dsh-plugin/test/plugin.test.ts). |
| MVP-FR-005 | Engineering verified | Constrained draft, claim refs, falsification conditions, review/edit and immutable private revision in [`workbench.test.ts`](../../packages/workbench/test/workbench.test.ts). |
| MVP-FR-006 | Engineering verified | New public target, re-redaction, consent/license, graph closure and signature in [`promotion.test.ts`](../../packages/promotion/test/promotion.test.ts). |
| MVP-FR-007 | **External acceptance pending** | A portable production directory moved outside the workspace passes Git → PostgreSQL → HTTP search/read E2E. A publicly reachable Pilot and the required second developer/device with no shared local DB have not supplied independent evidence. |
| MVP-FR-008 | Engineering verified | Shared compatibility hard filters deny incompatible high-similarity candidates in protocol/local/Hub tests. |
| MVP-FR-009 | Engineering verified | Exact immutable card digest, Context Plan, section/token/card budgets and injection observation in [`client.test.ts`](../../packages/client/test/client.test.ts) and MCP tests. |
| MVP-FR-010 | Engineering verified | Feedback/Observation are append-only exact-revision records and do not rewrite Experience revisions; promotion/Hub conflict tests cover public contributions. |
| MVP-FR-011 | Engineering verified | Baseline/treatment trials, task-scoped Experience/analysis plans, per-Benchmark cell summaries/comparisons, comparison-free cross-task portfolio, mixed-Benchmark H3 denial and error preservation in [`evaluation.test.ts`](../../packages/evaluation/test/evaluation.test.ts). The installable official-headless DSH driver completes live-host/mock-model trials through both its library and `aen evaluate` CLI entrypoints, with a digest-bound copy fixture, correlated run Manifest and metadata-only trial evidence. This proves the mechanism, not real-model uplift. |
| MVP-FR-012 | **External acceptance pending** | Matrix-plan, 2×2×2 coverage and fail-closed frozen Pilot validation exist, but no reviewed real two-model × two-stable-Harness-configuration × two-task-family aggregate has been run. |
| MVP-FR-013 | Engineering verified | Immutable revisions, Contentions, signed Revocations, emergency body purge and tombstone precedence in promotion/Hub/native PG E2E. |
| MVP-FR-014 | Engineering verified | Network-disabled DSH import → draft/review/search/fetch/delete loop runs entirely on local SQLite. |
| MVP-FR-015 | Engineering verified | [`@aen/adapter-sample`](../../packages/adapter-sample/README.md) passes the same protocol conformance without Schema/Hub changes. Non-core usability is tracked separately under M6. |
| MVP-SEC-001 | Engineering verified | Agent surfaces expose search/feedback and resource reads only; no execute/install tool. Remote content is labelled untrusted and malicious recipes are data. Native search has no model-controlled Model/Harness digest parameters and fails closed without authoritative Agent correlation. |
| MVP-SEC-002 | Engineering verified | Schema/digest/DSSE/policy/revocation invalid vectors fail closed in protocol, promotion and Hub tests. |
| MVP-SEC-003 | Engineering verified | Hub package inventory has no DSH execution or Agent-loop dependency; Web is read-only. |
| MVP-SEC-004 | Engineering verified | 250 hostile mutations plus JSON/ZIP/Skill/HTTP resource limits are recorded in [`MVP-hostile-input-resource-report-2026-08-20.md`](../security/MVP-hostile-input-resource-report-2026-08-20.md). |
| MVP-SEC-005 | Engineering verified | MVP public Artifact projection strips/rejects entrypoints, resource lists, fetch/distribution refs and bodies; see [ADR-0015](../adr/0015-mvp-public-artifact-metadata-only.md). |
| MVP-PRIV-001 | Engineering verified | Raw trace bytes and local locators stay in the local trust domain; promotion scans and graph projection deny attempted export. |
| MVP-PRIV-002 | Engineering verified | DSH/MCP clients construct minimized Task Capsules; outbound fields and secret/path/PII denial are tested. |
| MVP-PRIV-003 | Engineering verified | Public Promotion never inherits private visibility as a mutation and reruns consent/redaction/license gates. |
| MVP-PRIV-004 | Engineering verified within stated boundary | Exact-digest local physical deletion, Hub active-body purge, cache/search removal, minimum tombstone and current-tree conflict denial are tested. Git history/external clones are explicitly non-recallable per [ADR-0016](../adr/0016-deletion-revocation-and-git-boundary.md). |
| MVP-NFR-001 | Engineering verified | Ordinary DSH tool events create 0 AEN snapshots/objects and perform no AEN I/O/network; benchmark in [`DSH-tool-call-hot-path-2026-08-20.md`](../performance/DSH-tool-call-hot-path-2026-08-20.md). |
| MVP-NFR-002 | Engineering verified for declared load | 1,000 Experience, concurrency-1 runs: local p95 3.110 ms and Hub p95 20.923 ms in [`MVP-search-smoke-2026-08-20.md`](../performance/MVP-search-smoke-2026-08-20.md), below MVP bounds. |
| MVP-NFR-003 | Engineering verified | Public Hub failure falls back to local search; the private loop has no Hub dependency. |
| MVP-NFR-004 | Engineering verified | Search/card/section/token/byte limits and refusal rather than JSON truncation are covered in client/MCP/Hub tests. |
| MVP-GOV-001 | Engineering verified | Protocol, conformance, local CLI, Git objects, PostgreSQL Hub and export run without an official cloud dependency. |
| MVP-GOV-002 | Engineering verified | Capability file, UI, README and governance documents remain Draft/Pilot and list Stable gates. |

## Milestone and end-to-end DoD

| Scope | Disposition | Missing proof, if any |
| --- | --- | --- |
| M0 Protocol Profile | Engineering DoD verified | None inside the MVP engineering boundary. |
| M1 Model + Harness Capture | Engineering DoD verified | Installable DSH tarball, four role modules, three independent fibers, real host boot/remove and zero-I/O tool hot path are exercised. |
| M2 Private Experience Loop | Engineering DoD verified | None inside the local engineering boundary. |
| M3 Comparative Evaluation | **Not complete** | Official DSH headless + installed plugin + mock-model mechanism acceptance passes, but real 2 models × 2 stable Harness configurations × 2 task families and a reviewed H3/no-uplift result are absent. |
| M4 Promotion + Reference Hub | **Not complete** | Technical portable Git/PG/network path is real, but no reviewed public deployment or independent developer B/device evidence exists. |
| M5 Consumption + Repair | Engineering mechanism verified; product loop pending | Real cross-user adoption/rollback and measured follow-up Observation are absent. |
| M6 Open-source Pilot | **Not complete** | A non-core contributor usability transcript and independent security review are absent. |
| Scenario A: Trace is not Harness | Engineering runtime verified | Real Pilot replay remains useful but is not needed to prove the semantic distinction. |
| Scenario B: Model × Harness matrix | **Not complete** | Real model/task runs are absent. |
| Scenario C: Cross-user reuse | **Not complete** | Independent users/devices and adoption evidence are absent. |
| Scenario D: Negative transfer/contention | Engineering semantics verified; product evidence pending | Synthetic/runtime paths preserve opposing evidence; no real cross-user negative-transfer case yet. |
| Scenario E: Privacy/revocation | Engineering runtime verified | Independent security review still pending. |
| Scenario F: Community extension | Sample verified; **non-core acceptance pending** | Maintainer-authored sample is not evidence that a new contributor can finish unaided. |

## DeepSeek Harness plugin release proof

The MVP plugin requirement is proven by more than an importable file:

1. `@aen/dsh-plugin` exports typed `definition`, `policy`, `provider`, and `tools` role modules.
2. The bundle patch mounts independent Policy and Provider fibers plus disabled-by-default Tools.
3. Official `dsh plugin add` installs the tarball into the Web profile; the real host returns HTTP 200, creates schema-v3 SQLite, exits with SIGTERM code 0, and official remove cleans the profile.
4. `aen doctor` validates the same package surface and rejects a legacy single-JS entry, missing role, missing build artifact, missing patch, or unpublished `@aen/*` runtime/type dependency.
5. Default policy disables Hub access, full Skill resource capture, model tools and public publishing.
6. The package exports a self-contained `@aen/dsh-plugin/evaluation-driver`; `pnpm test:dsh-evaluation-driver` installs the tarball into the official headless profile and proves library + CLI live trials, a Benchmark Artifact tree-digest-bound copy fixture, and correlated Manifests with a mock model. This is host-mechanism evidence only.

The reproducible acceptance command is `pnpm test:dsh-plugin-host`; the packaging decision is [ADR-0017](../adr/0017-installable-dsh-plugin-bundle.md).

## Honest completion decision

The repository may claim **MVP engineering dry run substantially complete**, but it must not claim Spec-defined Engineering Complete or Product Go. The remaining evidence requires external state rather than more local mocks:

1. reviewed real 2×2×2 model/harness/task results;
2. a publicly reachable Reference Hub Pilot with TLS, monitoring, backups and key rotation;
3. three developers with isolated local stores and real publish/discover/inject/adopt-or-rollback/observation transcripts;
4. one non-core contributor completing Adapter and Experience authoring from the guides;
5. independent security review and remediation;
6. representative whole-workload DSH CPU measurement before claiming the complete-Spec `<1%` overhead target.
