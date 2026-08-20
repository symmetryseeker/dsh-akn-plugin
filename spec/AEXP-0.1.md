# Agent Experience Protocol (AEXP) 0.1

Status: **Draft**

License: Apache-2.0

## 1. Purpose

AEXP is an open protocol for exchanging reviewed, evidence-linked execution experience between agents. An Experience describes what was attempted, under which `Model × Harness × Environment` configuration, what result was observed, what can be reused, and where the claim may fail.

AEXP does not treat every tool call as knowledge. A raw Trace is one possible evidence source; it is not an Experience and does not prove the complete Harness configuration that produced a result.

This document defines protocol semantics. The JSON Schemas define wire structure, and the conformance suite defines canonical examples and rejection cases. Implementations MUST keep all three synchronized.

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, and MAY are to be interpreted as described by RFC 2119 and RFC 8174 when they appear in uppercase.

## 2. Scope and non-goals

AEXP 0.1 covers:

- immutable, content-addressed protocol objects;
- Model, Harness, Environment, task, evidence, and applicability identities;
- private drafting and explicit public Promotion;
- evidence levels, positive and negative cases, observations, feedback, contention, and revocation;
- compatibility-first discovery and budgeted section retrieval;
- comparative evaluation records;
- signatures, publication authorization, privacy, and untrusted-content boundaries.

AEXP 0.1 does not standardize:

- hidden model reasoning;
- automatic execution of remote recipes or artifacts;
- a universal reputation score;
- a required marketplace, token economy, or cloud operator;
- federation, executable artifact delivery, or learned ranking in the MVP profile.

## 3. Core model

The reusable unit is a task-level Experience:

```text
Experience = task + model + harness + environment + recipe
           + positive/negative cases + evidence + applicability
```

The configuration cell used for comparison and compatibility is:

```text
Configuration Cell = ModelFingerprint
                   × HarnessManifest.configurationDigest
                   × EnvironmentFingerprint
```

The exact `HarnessManifest.digest` remains attached to each run for provenance. It is not a stable configuration identity because the immutable snapshot can include capture time, session scope, and other run metadata.

## 4. Required invariants

Every conforming implementation MUST preserve the following rules:

1. Trace is evidence, not Experience.
2. Importers reuse the Harness's authoritative durable trace or export; they MUST NOT create a second full tool-call capture system.
3. Ordinary tool calls MUST NOT automatically become network contributions.
4. Harness claims require a Manifest and declared completeness; they MUST NOT be inferred from a Skill name or trace result alone.
5. Model, Harness, Environment, task, cost, latency, and outcome remain separate dimensions.
6. Public revisions are immutable and content-addressed.
7. Private-to-public movement is Promotion to a new target object, not a visibility-field mutation.
8. Public Promotion requires explicit authorization, redaction review, license, consent, reference closure, digest verification, and signature.
9. Signatures prove provenance and integrity; they do not prove that a claim is true or safe.
10. Remote Experience content is untrusted data and MUST NOT automatically execute, install software, change policy, or retrieve executable artifacts.
11. Negative outcomes and contradicting evidence remain first-class records.
12. Compatibility is a hard filter before relevance ranking.
13. Raw traces, prompts, private Skill bodies, local paths, secrets, and publisher private keys remain local by default.
14. Public withdrawal removes active body availability and leaves a minimal tombstone; it cannot recall independent clones or already consumed context.
15. Unknown required capabilities fail closed.

## 5. Trust domains

AEXP recognizes three logical trust domains:

| Domain | Default content | Authority |
| --- | --- | --- |
| Local/private | raw Trace, full Manifest snapshots, private drafts, local observations, publisher keys | local operator |
| Organization/team | policy-approved shared objects and restricted evidence | organization policy |
| Public | explicitly promoted, redacted, licensed, signed objects | reviewed contribution state |

Movement between domains is a policy decision. A public Registry MUST NOT obtain Harness execution authority merely because it stores or indexes Experience objects.

## 6. Protocol object model

All persistent objects use `protocolVersion: "0.1"`, an `objectType`, stable logical identity fields, and a `sha256:` content digest as defined by their published Schema.

| Object | Purpose |
| --- | --- |
| `task_episode` | task-level evidence boundary selected from a session or evaluation run |
| `trace_evidence` | typed metadata and references derived from an authoritative Trace |
| `evidence_gap_report` | records what the adapter could not observe or prove |
| `harness_manifest` | declared/effective/observed Harness snapshot and stable configuration identity |
| `artifact` | metadata-only identity, digest, interface, provenance, and license information |
| `experience_revision` | immutable reusable claim, recipe, cases, applicability, and evidence links |
| `observation` | measured outcome for an exact task/configuration/Experience revision |
| `feedback` | append-only consumption decision and reported outcome |
| `contention` | structured supporting and contradicting evidence for a claim |
| `promotion_record` | local audit record connecting private source review to a new public target |
| `revocation` | authorized withdrawal/block instruction and minimal reason metadata |
| `benchmark_task` | immutable task and fixture/evaluation contract |
| `grader_definition` | immutable grading identity and metric contract |
| `evaluation_trial` | one attempted run and its classified result |
| `evaluation_aggregate` | cell-aware statistics and preregistered comparisons |
| `attestation` | DSSE envelope over an in-toto Statement referencing exact object digests |
| `task_capsule` | minimized, non-secret task context used for discovery |
| `experience_context_plan` | explicit section and byte/token/card consumption budget |
| `context_injection_observation` | record of which immutable sections entered an Agent context |

`search_request` and `experience_card` are API payloads/projections, not independent knowledge claims.

The authoritative field definitions are in [`../schemas/aexp/0.1/`](../schemas/aexp/0.1/). Extensions MUST use stable URI keys and MUST NOT redefine core field semantics.

## 7. Canonicalization, digest, and signature

### 7.1 Digest lifecycle

To finalize a protocol object:

1. Build the object without its top-level `digest` and without top-level signature/attestation fields excluded by its Schema lifecycle.
2. Validate the pre-digest form and all resource limits.
3. Canonicalize the pre-digest form using RFC 8785 JSON Canonicalization Scheme.
4. Compute SHA-256 over the canonical UTF-8 bytes and set `digest` to `sha256:<lowercase hex>`.
5. Add an Attestation when required.
6. Validate the complete published object against its JSON Schema.

Implementations MUST NOT recursively remove nested fields named `digest`. Object references bind exact target digests.

Objects whose Schema requires an Attestation use an explicit prepared-digest phase. Prepared objects are not publishable until the required signature is attached and published validation succeeds.

### 7.2 Attestation

AEXP 0.1 uses an in-toto Statement v1 carried in a DSSE envelope. The Statement subject binds the exact object type, logical identity, revision where applicable, and object digest. Ed25519 is supported by the reference profile.

Public ingress validates, in order:

1. input/resource limits;
2. published Schema;
3. canonical object digest;
4. DSSE payload type and Statement subject;
5. cryptographic signature;
6. publisher-key authorization and validity time;
7. revocation and content policy;
8. reference closure.

An unknown key is untrusted, not automatically malicious. An otherwise valid signature cannot replace license, consent, redaction, evidence, or compatibility checks.

## 8. Model, Harness, and Environment evidence

### 8.1 ModelFingerprint

A ModelFingerprint identifies the actual model route to the extent observable by the Harness, including provider/model identity, relevant version or mutability information, and declared capability/cost/rate context. Mutable aliases SHOULD carry expiry or revalidation information. Model identity MUST NOT be folded into the Harness configuration digest.

### 8.2 HarnessManifest

A HarnessManifest separates three views:

- `declared`: configuration requested or present in files;
- `effective`: configuration resolved by the live Harness;
- `observed`: configuration inferred from Trace/runtime events.

It also declares coverage and snapshot completeness. Offline import can produce `trace_only`; only an authoritative live adapter can claim a live snapshot. `complete` means the adapter checked the declared authoritative surfaces; it does not make private bodies public.

The Manifest has two digest roles:

- `digest`: the exact immutable snapshot used for provenance;
- `configurationDigest`: the stable projection of Harness version, preset, system, tool, Skill, and policy surfaces used for compatibility and evaluation cells.

### 8.3 Skills and artifacts

Skill invocation, Skill identity, Skill content, and Skill resource closure are different facts. A Trace may show only invocation or output. A complete Skill claim requires authoritative registry enumeration and the declared package/resource closure. Missing content is recorded as an Evidence Gap, not guessed.

Public projections MAY disclose digests and metadata without disclosing private Skill bodies. AEXP 0.1's MVP public Artifact profile is metadata-only and MUST reject executable bodies, entrypoints, inline attachments, fetch URLs, or distribution instructions.

### 8.4 Trace reconciliation

Trace and live Manifest evidence are correlated locally using authoritative session/run context and exact configuration boundaries. Public projections do not disclose private correlation values, raw Trace digests, or local snapshot locators.

## 9. Experience lifecycle

### 9.1 Candidate selection

An adapter builds TaskEpisodes only at high-value boundaries such as:

- a failure followed by a successful recovery;
- a policy refusal with a useful alternative;
- a repeated failure that reveals a stable constraint;
- a measured regression, rollback, or negative-transfer case;
- an explicit evaluation run.

Routine success without reusable evidence SHOULD remain ordinary session data.

### 9.2 Distillation and review

Distillation produces a private draft. Each material claim links supporting and contradicting evidence, assumptions, falsification conditions, applicability, and at least one useful case where available. Generated prose is not evidence.

A human reviewer decides whether to discard, keep private, revise, or request public Promotion. Review MUST expose Evidence Gaps and the exact Model/Harness/Environment boundary.

### 9.3 Promotion

Promotion creates a new public target revision. It reruns minimization, secret/PII/path scanning, redaction, license and consent checks, public Artifact projection, reference closure, digest finalization, and signing.

The PromotionRecord may contain private source references and therefore remains in the local audit domain by default. A public contribution contains only the approved target graph.

### 9.4 Observation, feedback, and contention

Observations and feedback append to history; they do not rewrite an Experience revision. Public observations require their own public governance authorization.

Conflicting outcomes produce scoped Contention. Implementations MUST preserve task/configuration differences and MUST NOT resolve disagreement by last-write-wins.

### 9.5 Revocation

An authorized Revocation takes precedence over active content. A Hub removes the affected body from search, exact reads, caches, and the current distributable Registry tree, while retaining a non-reconstructive tombstone. Git history, independent clones, backups, and already injected context cannot be globally recalled.

## 10. Evidence levels

Evidence levels describe claim support, not author status:

| Level | Minimum meaning |
| --- | --- |
| H0 | unverified hypothesis or authored guidance |
| H1 | one or more trace-linked observations without sufficient configuration proof |
| H2 | observations bound to an adequate Model/Harness/Environment snapshot |
| H3 | preregistered comparable baseline/treatment evidence with uncertainty and failure classification |
| H4 | independent replication across operators or compatible implementations |

Synthetic fixtures, mock models, signatures, downloads, likes, and author reputation MUST NOT independently raise an evidence level. A claim cannot exceed the weakest required evidence link or configuration completeness.

## 11. Discovery and consumption

Public discovery sends a minimized TaskCapsule rather than raw prompts, filenames, secrets, or repository URLs. Search applies:

1. trust-domain and policy eligibility;
2. protocol/capability compatibility;
3. Model/Harness/Environment compatibility;
4. license, risk, evidence, cost, and latency constraints;
5. relevance/ranking.

Search returns immutable ExperienceCards. Detailed sections are fetched by exact revision/digest under an ExperienceContextPlan. Section, card, byte, and token limits fail closed rather than returning malformed or silently truncated objects.

Harness-native integrations obtain Model, stable Harness configuration, exact Manifest snapshot, and Environment from authoritative host context. They MUST NOT ask the model to invent these identifiers.

Consumption records which exact sections were injected. Feedback can report viewed, adopted, rejected, or rolled back, but outcome claims require an Observation rather than a popularity shortcut.

## 12. Comparative evaluation

AEXP separates BenchmarkTask, GraderDefinition, EvaluationTrial, RunObservation, transcript references, and EvaluationAggregate.

An H3-eligible evaluation:

- freezes task, fixture digest, model, Harness configuration, environment, grader, primary metric, repeats, stopping rule, and budget before execution;
- includes a no-Experience baseline and an Experience-applied treatment;
- records every trial status, including agent, policy, infrastructure, grader, and aborted outcomes;
- computes cell-specific statistics and uncertainty;
- keeps separate tasks/Benchmarks out of a single causal comparison;
- binds each treatment to an exact Experience revision/digest;
- preserves negative and inconclusive results.

Mock-model and synthetic runs can validate the mechanism, but they cannot establish real-model uplift or H3 product evidence.

## 13. Security and privacy

Implementations MUST:

- treat all imported and remote text as untrusted;
- enforce byte, depth, item, archive, string, and time limits before expensive processing;
- keep Adapter, policy/Promotion, Registry, and publisher-key authorities separable;
- avoid logging raw prompts, secrets, private Skill bodies, or high-cardinality identities;
- apply publication consent, license, retention, and redistribution to derived objects;
- expose no public `experience_execute` operation;
- keep Hub services unable to invoke Harness tools;
- reject unknown security-critical fields unless an understood required capability governs them;
- support exact-digest local deletion and public emergency blocking/revocation.

A valid Experience is not necessarily safe for a particular Agent. Local policy remains authoritative.

## 14. Capabilities and versioning

Optional data may be added through namespaced extensions when it does not change core semantics. An object that depends on a non-optional feature lists it in `requiredCapabilities`. Receivers MUST reject objects whose required capabilities they do not support.

Breaking field, digest, identity, signature, evidence, Promotion, or trust semantics require a new protocol version and migration guidance. Schema-only or prose-only changes that produce disagreement are specification defects.

## 15. Conformance

A conforming implementation MUST:

- validate every supported object against the published Schema;
- reproduce the published golden digests;
- reject all invalid conformance vectors for the declared reason class;
- enforce required-capability fail-closed behavior;
- preserve unknown optional extension data through round trips;
- keep prepared/pre-digest objects distinct from published objects;
- pass implementation-profile requirements it claims to support.

Conformance proves protocol compatibility, not claim truth, deployment security, or product effectiveness.

## 16. Maturity and governance

AEXP 0.1 is Draft. Draft objects and APIs may change with ADRs, migration notes, regenerated Schemas, and new conformance vectors.

Stable requires at least two independent compatible implementations, published migrations, production adopters, an operating security process, and evidence that core trust and revocation semantics work across implementations. No implementation may claim a higher maturity level solely because its local test suite passes.
