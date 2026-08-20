# AEN MVP Implementation Profile 0.1

Status: **Draft / Pilot**

Protocol: [AEXP 0.1](./AEXP-0.1.md)

## 1. Profile purpose

This document selects a coherent, end-to-end subset of AEXP 0.1 for the reference implementation. It is not a second protocol and MUST NOT weaken AEXP identity, digest, evidence, Promotion, privacy, or untrusted-content semantics.

The MVP is intended to answer three questions:

1. Can a Harness turn selected, high-value execution evidence into reviewed task-level Experience without building another full Trace collector?
2. Can an Experience remain correctly scoped to Model, Harness, Environment, task, cost, and observed outcome?
3. Can a different user discover, consume, evaluate, reject, and repair that Experience without automatic remote execution?

Engineering mechanism completion and product validation are separate. Synthetic fixtures and mock models can prove implementation behavior; they cannot satisfy real-model, cross-user, public-operations, or independent-review gates.

## 2. Required MVP flow

The reference implementation MUST provide this vertical path:

```text
authoritative Harness trace/export + live Harness Manifest
  → selected TaskEpisode and Evidence Gap
  → private Experience draft
  → human review/edit
  → optional explicit public Promotion
  → Git-reviewed Reference Hub ingest
  → compatibility-first search and immutable section read
  → Context Plan and injection observation
  → feedback, measured RunObservation, contention or revocation
```

The complete local/private path MUST work with no Hub or network connection.

## 3. Required components

| Component | MVP responsibility |
| --- | --- |
| Protocol SDK | Schema, validation, canonical digest, signature, capabilities, conformance |
| DSH Adapter | offline Trace import and authoritative live Manifest capture |
| DSH native plugin | installable Policy, Provider, Definition, and optional Tools roles |
| Local Store | private SQLite object/evidence storage and exact deletion |
| Workbench/CLI | distill, review, edit, search, fetch, evaluate, promote, feedback, revoke |
| Evaluator | frozen baseline/treatment cells and evidence-level derivation |
| Promotion Gate | redaction, license, consent, public projection, closure, signing |
| Reference Hub | reviewed Git ingest, PostgreSQL projection, search/read/feedback, tombstone |
| Client/MCP | Task Capsule, Experience Card, resource reads, budgets, injection observation |
| Sample Adapter | proves a second Harness can map into AEXP without changing the Schema |

The MVP does not require federation, a marketplace, global reputation, remote execution, OCI artifact distribution, TUF update infrastructure, team tenancy, a learned ranker, or an automatic public publisher.

## 4. Protocol profile

The MVP supports the persistent object types declared in [`../schemas/aexp/0.1/manifest.json`](../schemas/aexp/0.1/manifest.json) and the `search_request` / `experience_card` API payloads.

Required integrity profile:

- RFC 8785 JCS canonicalization;
- SHA-256 content digests;
- in-toto Statement v1 inside DSSE;
- Ed25519 signatures;
- published/pre-digest lifecycle separation;
- exact digest references;
- unknown required capabilities fail closed.

No MVP-only wire object may replace a required AEXP object. Internal normalized events and database rows are implementation details, not public protocol objects.

## 5. Requirement matrix

The IDs in this section are stable traceability identifiers used by development records, ADRs, tests, and the evidence ledger.

### 5.1 Functional requirements

| ID | Requirement | Minimum evidence |
| --- | --- | --- |
| MVP-FR-001 | Import authoritative Harness Trace/export without a second full capture system. | DSH fixed fixtures and no-parallel-hook test |
| MVP-FR-002 | Capture declared, effective, and observed Harness views, completeness, and Evidence Gaps. | trace-only/live/partial fixtures |
| MVP-FR-003 | Form cells from ModelFingerprint, stable Harness configuration digest, and Environment while retaining exact Manifest provenance. | digest-delta and cell-binding tests |
| MVP-FR-004 | Create Episodes/candidates only at high-value boundaries. | ordinary-call versus recovery/evaluation fixtures |
| MVP-FR-005 | Produce private Experience revisions with per-claim evidence, assumptions, falsification, and applicability. | review transcript and Schema validation |
| MVP-FR-006 | Use Promotion to create a newly redacted, licensed, signed public target. | source/target diff, consent, closure, signature |
| MVP-FR-007 | Support cross-user publish, search, and immutable read through the Reference Hub. | isolated-user/device end-to-end transcript |
| MVP-FR-008 | Apply Model/Harness/Environment compatibility as a hard filter before relevance. | incompatible high-similarity denial |
| MVP-FR-009 | Use Task Capsule, Context Plan, and budgeted section retrieval/injection. | byte/token/card boundary and injection tests |
| MVP-FR-010 | Append feedback and RunObservation without rewriting the referenced Experience revision. | append-only and conflict tests |
| MVP-FR-011 | Implement baseline/treatment evaluation and evidence-level derivation. | repeated cell comparison fixtures |
| MVP-FR-012 | Execute a real 2 Model × 2 Harness configuration × 2 task-family Pilot matrix. | reviewed Pilot aggregate report |
| MVP-FR-013 | Support immutable revisions, Contention, emergency block, and signed Revocation. | lifecycle and projection-rebuild tests |
| MVP-FR-014 | Keep the complete private loop operational without a Hub. | network-disabled end-to-end transcript |
| MVP-FR-015 | Let a community Harness Adapter pass the same open interface and conformance suite. | sample plus non-core adapter report |

### 5.2 Security requirements

| ID | Requirement | Minimum evidence |
| --- | --- | --- |
| MVP-SEC-001 | Remote Experience has no execute/install/policy-changing capability. | malicious-recipe and surface-inventory tests |
| MVP-SEC-002 | Public ingress verifies limits, Schema, digest, DSSE, key authorization, policy, revocation, and closure. | invalid vector for every stage |
| MVP-SEC-003 | The Hub has no Harness execution authority. | dependency and runtime capability inventory |
| MVP-SEC-004 | Hostile inputs have byte, depth, item, archive, string, and time limits. | mutation/fuzz/resource report |
| MVP-SEC-005 | Public Artifact content is metadata/digest/license only. | executable, body, URL, and attachment rejection |

### 5.3 Privacy requirements

| ID | Requirement | Minimum evidence |
| --- | --- | --- |
| MVP-PRIV-001 | Raw Trace, prompts, private Skill content, user data, local paths, and secrets remain local/restricted by default. | attempted-export denial |
| MVP-PRIV-002 | Public search uses a minimized Task Capsule. | captured outbound request audit |
| MVP-PRIV-003 | Every public Promotion reruns consent, redaction, minimization, and license checks. | policy-inheritance and regression tests |
| MVP-PRIV-004 | Local exact-digest deletion removes local body; public withdrawal removes active Hub/current-tree/cache body and retains only a minimal tombstone. | lifecycle test that does not claim recall of Git history or external clones |

### 5.4 Non-functional requirements

| ID | Requirement | Minimum evidence |
| --- | --- | --- |
| MVP-NFR-001 | Ordinary DSH tool calls perform zero synchronous AEN I/O; representative whole-workload CPU is measured separately. | before/after hot-path report |
| MVP-NFR-002 | Declared-load local search p95 is below 100 ms and first Hub cards p95 below 800 ms. | reproducible hardware/load report |
| MVP-NFR-003 | Hub failure does not break the private loop. | offline/fallback end-to-end test |
| MVP-NFR-004 | Search and resource reads enforce card, section, byte, and token budgets without invalid JSON truncation. | boundary tests |

### 5.5 Governance requirements

| ID | Requirement | Minimum evidence |
| --- | --- | --- |
| MVP-GOV-001 | Protocol, Schemas, conformance, verification, and export do not depend on an official cloud. | self-hosted validate/read/export demonstration |
| MVP-GOV-002 | Every artifact and UI labels the project Draft/Pilot until independent maturity gates are met. | release and documentation audit |

## 6. DeepSeek Harness profile

### 6.1 Offline Adapter

The offline Adapter consumes existing durable DSH JSONL/ZIP exports. It maps known events into typed evidence, preserves source/mapping version, pairs calls/results where possible, records gaps, and never claims a complete live configuration.

### 6.2 Live Manifest Adapter

The live Adapter reads authoritative DSH Agent, preset, system, tool, Skill, and policy surfaces at configuration boundaries. It captures stable configuration identity separately from exact run snapshots and correlates them locally with Trace evidence.

Ordinary `tool/call` and `tool/result` events return before registry lookup, snapshotting, SQLite, or network work. Manifest recapture occurs on configuration boundaries, explicit evaluation, or other declared high-value events.

### 6.3 Installable plugin

The release bundle exposes independent Definition, Policy, Provider, and Tools roles. Policy, Provider, and Tools have separate lifecycles. Disabling optional search tools MUST NOT disable Manifest capture. Network access requires both local policy permission and a configured Hub. Public publishing is never enabled by search configuration.

Official acceptance uses package → `dsh plugin add` → real profile boot → schema/runtime check → graceful exit → `dsh plugin remove`. Absolute-path loading is development evidence only.

### 6.4 Headless evaluation

The evaluation driver uses the official headless DSH profile, an installed plugin bundle, a digest-bound fixture, a frozen Harness configuration, an operator-selected local grader, and one isolated workspace/private Trace directory per trial. Treatment injects only reviewed, budgeted Experience sections and never executes downloaded code.

## 7. Evaluation profile

Before a real Pilot, freeze:

- two task families and exact fixture revisions;
- two ModelFingerprints including cost/rate context;
- two stable Harness configuration digests and representative Manifests;
- baseline/treatment assignments and exact Experience revisions;
- graders, primary metrics, repeats, stopping rules, exclusions, privacy limits, and hard budget.

Every trial remains visible. Agent, policy, infrastructure, grader, and aborted statuses are reported separately. Aggregates are sliced by Benchmark and cell; cross-Benchmark portfolios are descriptive and cannot claim causal comparisons.

Product Go does not require every task to improve. It requires at least one preregistered, reproducible positive result whose value is not offset by negative transfer, added cost, unacceptable latency, or a critical security/privacy incident.

## 8. Milestones and Definition of Done

| Milestone | Engineering exit | External/product evidence |
| --- | --- | --- |
| M0 Protocol Profile | Schemas, digest/signature lifecycle, capabilities, conformance, CLI validation | independent implementation remains a later maturity gate |
| M1 Model + Harness Capture | DSH offline/live Adapter, installable plugin, stable config identity, zero-I/O ordinary hot path | representative real workloads |
| M2 Private Experience Loop | import → episode → distill → review/edit → local search/read/delete | independent author usability |
| M3 Comparative Evaluation | frozen runner, cell-aware aggregates, official DSH mechanism run | real 2×2×2 result |
| M4 Promotion + Hub | signed public projection, Git ingress, PostgreSQL rebuild, search/read, revocation | public operated Hub and isolated users |
| M5 Consumption + Repair | Task Capsule, budgets, immutable read, injection observation, feedback/rollback | real cross-user adoption and repair |
| M6 Open-source Pilot | license, CI, security policy, guides, sample Adapter, honest status ledger | non-core contributor and independent security review |

## 9. End-to-end acceptance scenarios

1. **Trace is not Harness:** a trace-only import exposes partial evidence and gaps; a live Manifest is required for stronger configuration claims.
2. **Configuration comparison:** fixed tasks compare two models and two Harness configurations without conflating exact snapshots with stable configuration identity.
3. **Cross-user reuse:** one isolated user promotes; another discovers, reads exact sections, injects, adopts or rejects, and records a measured outcome.
4. **Negative transfer:** harmful or incompatible use remains visible as Observation/Contention and does not mutate the original revision.
5. **Privacy and withdrawal:** attempted secret/path/body publication fails; emergency block and signed Revocation remove active body while preserving a tombstone.
6. **Composable extension:** a non-core developer implements an Adapter without changing AEXP Schema or Hub internals.

## 10. Completion language

The repository may claim an **MVP engineering dry run** when local mechanisms and release checks pass. It MUST NOT claim **Engineering Complete**, **Product Go**, **Stable**, or a successful public experience network until the corresponding external evidence exists.

The current evidence disposition is maintained in [`../docs/development/MVP-requirement-evidence-ledger-2026-08-20.md`](../docs/development/MVP-requirement-evidence-ledger-2026-08-20.md). That ledger records implementation status; it cannot override this Profile or manufacture missing external evidence.
