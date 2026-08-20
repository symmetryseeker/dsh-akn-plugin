# AEN MVP Engineering Status — 2026-08-20

Status: **implementation dry run substantially complete; Spec-defined Engineering Complete and Product Go remain blocked by external real-pilot gates**.

This status follows the complete Spec and the MVP profile. It does not redefine a smaller product after implementation.

The requirement-by-requirement disposition and exact boundary between engineering evidence and external acceptance are maintained in [`MVP-requirement-evidence-ledger-2026-08-20.md`](./MVP-requirement-evidence-ledger-2026-08-20.md).

## Delivered system

- AEXP 0.1 Draft: 19 persistable Protocol Object schemas, two API payload schemas, JCS/SHA-256, DSSE/in-toto, fixtures and conformance runner.
- Authoritative DSH JSONL/ZIP Adapter and installable native Cordis bundle with separate definition, policy, provider and optional-tools roles. Trace remains execution evidence; low-frequency live registry/config snapshots reconstruct the Harness surface.
- Strict local Trace ↔ Live Manifest correlation. Complete Model/tool/Skill closure can raise a correlated observational claim from H1 to H2, never to causal H3.
- SQLite private Experience loop: Episode selection, constrained distillation, immutable edit/review, search/sections, feedback, exact-digest secure deletion and offline operation.
- Comparative evaluation: Benchmark/Grader/Trial/Aggregate, stable Configuration Cells plus exact run snapshots, baseline/treatment, validity gates, pass@k/pass^k and H-level policy; the installable plugin also exports an official DSH headless driver.
- Public Promotion: new public revision, redaction/consent/license, closed evidence graph, public Observation governance, Ed25519 signatures and Git contribution.
- Reference Hub: authorized Git ingress, native PostgreSQL projection, search/read/feedback/export, immutable revision reads, Contentions, revocation/emergency tombstone and active-body purge; portable production directory plus non-root container/Compose starting point.
- Shared deterministic MVP retrieval: hard compatibility/evidence/risk/license/cost/latency filters, FTS recall, evidence/freshness/negative-transfer/quality/cost/latency rerank, digest tie-break and three-card diversity.
- Read-only Web Detail: evidence boundary, Manifest coverage/gaps, metrics, negative observations, source/risk and no execute/install action.
- Consumption: minimized Task Capsule, immutable cards, Context Plan/section/token budgets, ContextInjectionObservation, measured RunObservation, native DSH and MCP search/feedback surfaces with no execute tool.
- Open-source materials: sample Adapter, author/reviewer guides, governance/security files, preregistered Pilot report and Draft/Pilot labels.

## Fatal contradictions corrected during development

| Problem found | Correction |
| --- | --- |
| Trace-only and Live Harness data could be mixed by name and overclaim Skill completeness | ADR-0014: private session correlation + configuration-boundary matching + complete Skill package closure; H2 only, no causality |
| Public H3 aggregate/revision links formed an unresolved or cyclic lifecycle | ADR-0013: acyclic prior-revision treatment and closed projected evaluation graph |
| Promotion could retain private Live Manifest digests in claim scopes | Rewrite top-level applicability and every claim scope to projected public digests; regression denies the private digest |
| Redistributable Skill Promotion kept entrypoint/resources/distribution but Hub rejected them | ADR-0015: MVP always publishes metadata/digest/license only; inline body/distribution fields fail closed |
| API tombstone left body JSON in active PostgreSQL; Git current tree could still distribute it | ADR-0016: local secure deletion, Hub active-body purge, minimal tombstones, and current-tree revocation/body conflict denial |
| Local and Hub ranking drifted; cost/latency were display-only | Shared deterministic reranker and fail-closed hard budget filters in protocol/local/Hub/CLI/Web |
| Web exposed only a few text filters and hid the Harness/evidence boundary | Complete MVP filters, score role/negative case/metrics cards, referenced Manifest and what-proves/does-not-prove detail |
| Absolute-path Cordis loading was described as an installable plugin; native SQLite addon builds made official installation fail closed; capture/policy/tools initially shared one lifecycle | ADR-0017: portable DSH bundle/tarball, bundled AEN runtime closure, Node built-in SQLite, split definition/policy/provider/tools roles and official add/boot/remove host acceptance |
| Hub ran from workspace builds but legacy deploy symlinked `@aen/*` back into the monorepo | pnpm injected workspace packages, production `files` boundary and out-of-workspace deployment E2E; container uses the same closed directory |
| Multi-task evaluation grouped trials only by cell ID, allowing one task family to hide harm in another | ADR-0018: one causal Aggregate per Benchmark, comparison-free cross-task portfolio, and fail-closed mixed-Benchmark comparisons |
| Multi-task plans reused one Experience and one analysis across every task family | ADR-0019: task-scoped immutable Experience refs and comparisons/primary metrics, no runtime Benchmark mutation, and fail-closed outcome exclusions |
| A Manifest snapshot digest was used as a stable Harness cell, and the runner had no production DSH execution seam | ADR-0004/0020: core stable `configurationDigest` plus exact run snapshot, prompt-template normalization, official headless driver, authoritative transcript/session correlation and local trusted grader |
| Distilled Experience used an exact run Manifest as its default compatibility selector, preventing reuse across sessions; Hub accepted a configuration filter but indexed only snapshot selectors | Default applicability now uses stable `harness.configurationDigest`; exact Manifest remains typed provenance or an explicitly stricter selector. Local, Web, CLI, MCP and PostgreSQL paths index/filter both identities without conflating them |
| Native DSH search asked the model to provide invisible Model/Harness digests, so compatibility context was usually absent or forgeable; Harness identity also accidentally absorbed Environment and plugin dedup missed Model changes | ADR-0004/0021: Harness digest now excludes both Model and Environment; Provider maintains the current Agent's complete Configuration Cell, and Tools derives it from `ToolRunContext.agent`. Model-facing hashes were removed and missing authoritative correlation fails closed |
| Repeated identical DSH `request/header` events were deduplicated only after a full Skill snapshot, turning a nominal config boundary into repeated registry I/O | Provider now hashes effective header plus request context before I/O, coalesces equivalent pending requests without extending the debounce deadline, and advances the covered sequence without recapture; registry/policy changes remain forced boundaries |
| Native PostgreSQL interpreted no-query `ORDER BY 0` as an invalid positional column | Hub now orders by the named `text_rank` projection; real PG regression covers digest-only search |

## Verification record

| Evidence | Result |
| --- | --- |
| Schema generation | 21 schemas and 19 protocol fixtures regenerated |
| Full workspace tests | 108 passed; one conditional PG test skipped only in the ordinary no-DB run |
| Native PostgreSQL 17 | Hub suite 14/14 passed, including JSONB cost/latency hard filters and revocation body purge |
| Conformance | 19 valid, 23 invalid, 19 golden digests; zero failures |
| Multi-process E2E | DSH import → private draft/review → signed public Promotion → Git verify → PostgreSQL Hub/Web → CLI public search/exact read → confirmed local deletion |
| Portable Hub deployment | production directory moved outside workspace; no escaping symlinks/source/tests; environment-configured Git ingress → PostgreSQL → HTTP/Web/exact read passes |
| Promotion/Hub graph | 12 authorized signed objects projected; exact target revision/digest read succeeds |
| Search performance | 1,000 Experiences, concurrency 1: Node built-in SQLite p95 3.110 ms; Hub first cards p95 20.923 ms |
| DSH tool hot path | 0 AEN objects/snapshots for ordinary tool calls; optimized diagnostic delta ≈0.857 µs/event |
| Installed DSH host | tarball with 4 role modules + self-contained evaluation-driver library → official `dsh plugin add` → 3 independent Cordis fibers → Web HTTP 200 (12,076-byte shell) → SQLite schema v3 → SIGTERM 0 → official remove; Tools enabled while Hub/public publishing stayed policy-disabled. An official in-process `ToolRuntime.execute()` composition separately proves authoritative Agent-context search and agent-less denial |
| Official DSH headless evaluation | installed tarball + official headless profile + local mock model → successful library and `aen evaluate` CLI trials; non-empty copy fixture is bound by Benchmark Artifact tree digest; representative/run Manifest digests differ while stable Harness configuration digest matches; raw trace remains local. Mechanism evidence only, no real-model/H3 claim |
| Hostile input | 250 deterministic mutations fail closed under a 3-second test bound; HTTP/Git/Skill/Artifact resource limits tested |
| Audits | no operational source secret; accepted production licenses; no known production dependency vulnerabilities |

## MVP traceability disposition

- `MVP-FR-001`–`011`, `013`–`015`: implementation and automated/runtime evidence present.
- `MVP-FR-012`: runner and 2×2×2 coverage validation exist, but the required **real** two-model × two-stable-Harness-configuration × two-task-family data has not been run.
- `MVP-SEC-001`–`005`, `MVP-PRIV-001`–`004`, `MVP-NFR-001`–`004`, `MVP-GOV-001`–`002`: MVP-profile engineering evidence present, subject to the explicit boundaries in the linked reports.
- Complete-Spec NFR-001 CPU `<1%`, NFR-003 production SLI, NFR-005 100k/1M capacity, federation/OCI/TUF/enterprise controls and Stable gates are not claimed by the MVP.
- The installable plugin no longer depends on native addon build approval. Node 22+ built-in SQLite currently emits an `ExperimentalWarning`; schema/FTS/transaction/deletion and installed-host paths are tested, but its Node stability status remains a Stable-release review item (ADR-0017).

## Open blockers that code cannot honestly fabricate

1. A preregistered real 2 Model × 2 stable Harness configuration × 2 task-family evaluation with exact per-run Manifest snapshots and actual cost, latency, token and negative-transfer results.
2. A publicly reachable Reference Hub Pilot deployment with reviewed operator configuration, TLS, monitoring, backups and key rotation.
3. Three developers who do not share a local database, including real publish/discover/inject/adopt-or-rollback/measured-observation transcripts.
4. One non-core developer completing Adapter and Experience authoring from the guides without maintainer intervention.
5. An independent security review and remediation record.
6. A representative whole-tool-workload benchmark before claiming complete-Spec DSH CPU overhead `<1%`.

Until those are supplied, UI/docs must remain Draft/Pilot and neither Engineering Complete nor Product Go may be declared.
