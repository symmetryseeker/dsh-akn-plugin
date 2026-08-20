# Prior art and standards landscape

Status: **non-normative research background**

Reviewed: 2026-08-20

Normative AEN behavior is defined by [AEXP 0.1](../../spec/AEXP-0.1.md), published Schemas, conformance vectors, and accepted ADRs. This document explains which existing work informed AEN and which boundaries the project deliberately does not reimplement. It is not a second specification and cannot override protocol semantics.

## 1. Research conclusion

AEN should not present itself as a replacement for tracing, Agent memory, Skill packaging, artifact distribution, identity, model context transport, or Agent-to-Agent communication. Its domain contribution is the missing exchange layer between those systems:

```text
observable run evidence
  + addressable Model / Harness / Skill / Policy configuration
  + reviewed task-level experience
  + positive and negative cases
  + applicability and comparative evaluation
  + explicit promotion, consumption, feedback and revocation
  = Agent Experience exchange
```

This leads to several durable decisions:

1. Trace is evidence input, not the Experience object.
2. Experience candidates are selected at high-value task boundaries rather than created for every tool call.
3. Harness claims combine observed Trace, effective surface, declared Manifest/artifact identity, and comparative evaluation.
4. Consumption is budgeted context engineering: cards first, immutable sections on demand, evidence only when needed.
5. Evaluation operates on `Model × Harness × Environment × Task`, preserving cost, latency, uncertainty, and negative transfer.
6. General infrastructure is adopted or profiled from open standards instead of being renamed inside AEN.
7. Federation and global reputation are not prerequisites for the local/private and single-Hub Pilot.

## 2. Trace, Harness and Skill visibility

Trace answers what was observed during one execution. It can contain model/tool events, timing, usage, errors, and content that policy allowed the trace exporter to record. It generally cannot prove the complete effective Harness configuration or the full set of capabilities that were available but unused.

[Agent Skills](https://agentskills.io/specification) uses progressive disclosure: metadata is discoverable first, `SKILL.md` is loaded when a Skill is activated, and scripts/references/assets are loaded as needed. Consequently, a trace may show an invocation or result without proving the exact Skill package identity, complete resource closure, license, dependency boundary, unused capabilities, or causal contribution.

AEN therefore separates four evidence layers:

| Layer | Question | AEN representation |
| --- | --- | --- |
| Observed Trace | What happened? | TraceEvidence and TaskEpisode |
| Effective surface | What did the model actually see? | observed/effective Manifest view |
| Declared Harness/artifact | What capability/configuration existed? | HarnessManifest, Artifact and Evidence Gap |
| Comparative evaluation | Which change affected the result? | Benchmark, Trial, Observation and Aggregate |

An Adapter records missing layers as an Evidence Gap. It must not ask a model to guess them.

## 3. Experience learning and memory research

Work such as [Reflexion](https://papers.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html), [ExpeL](https://arxiv.org/abs/2308.10144), [Voyager](https://voyager.minedojo.org/), [Agent Workflow Memory](https://arxiv.org/abs/2409.07429), [Generative Agents](https://research.google/pubs/generative-agents-interactive-simulacra-of-human-behavior/), and [MemGPT](https://arxiv.org/abs/2310.08560) supports a common pattern: retain selected episodes, derive reflections or reusable procedures, retrieve selectively, and revise with later evidence.

AEN maps that pattern to a shared protocol while preserving provenance:

- raw session events remain local evidence;
- TaskEpisodes select task-level boundaries;
- generated reflection is a draft, not independent evidence;
- Experience claims link exact supporting and contradicting evidence;
- later outcomes append Observations or Contentions rather than rewriting history;
- cross-user publication requires a separate Promotion decision.

A single Agent's self-reflection is useful private memory but does not automatically become a public fact.

## 4. Standards reuse map

| Concern | Adopt/profile | AEN-specific responsibility |
| --- | --- | --- |
| Wire validation | JSON Schema 2020-12 | AEXP object fields and semantic invariants |
| Canonical bytes | [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785) | exact object digest lifecycle |
| Attestation envelope | [in-toto Attestation](https://github.com/in-toto/attestation/blob/main/spec/README.md) and DSSE | Experience object subjects, issuer roles and policy |
| Observability import | [OpenTelemetry GenAI/OTLP](https://opentelemetry.io/docs/specs/semconv/gen-ai/) and [OpenInference](https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md) | versioned mappings into partial AEN evidence |
| Skill packaging | [Agent Skills](https://agentskills.io/specification) | Skill identity/closure evidence and applicability |
| Harness-neutral consumption | [Model Context Protocol](https://modelcontextprotocol.io/specification/latest) | two non-execution tools and immutable Experience resources |
| Agent interoperability | [A2A Protocol](https://a2a-protocol.org/v0.3.0/specification/) as a possible transport mapping | Experience exchange semantics remain AEXP |
| Provenance | [W3C PROV-O](https://www.w3.org/TR/prov-o/) and [RO-Crate](https://www.researchobject.org/ro-crate/specification.html) | task/configuration/evidence relations and optional repro profile |
| Artifact distribution | [OCI Distribution](https://github.com/opencontainers/distribution-spec/blob/main/spec.md) and ORAS, later profile | no MVP executable artifact distribution |
| Software identity/license | SPDX, SLSA and Sigstore where applicable | public Artifact disclosure and policy gates |
| Secure update metadata | [The Update Framework](https://theupdateframework.github.io/specification/latest/), later profile | Schema/adapter/trust-state release policy |
| Federation event envelope | [CloudEvents](https://github.com/cloudevents/spec), only if federation demand exists | signed AEXP domain payload and conflict semantics |
| Retrieval baseline | BM25/dense/structured signals with [Reciprocal Rank Fusion](https://cormack.uwaterloo.ca/cormacksigir09-rrf) | compatibility gates and task-scoped utility |
| Risk management | OWASP, NIST AI RMF/Privacy Framework, Google SAIF and MITRE ATLAS | AEN threat controls, tests and incident procedures |

Upstream standards evolve independently. A production profile must pin the version it implements and use an ADR plus compatibility fixtures when changing versions. A link to a standard does not claim conformance by itself.

## 5. Build / adopt / map / reject decisions

| Capability | Decision | Reason |
| --- | --- | --- |
| Experience, Claim, Applicability, Case, Observation, Contention and Promotion semantics | Build | this is AEN's domain layer |
| General Trace collection | Reject | use authoritative Harness exports and observability formats |
| Trace-to-AEXP Adapter | Map | source formats remain source-specific; output uses AEXP |
| Full Skill/package inventory from Trace alone | Reject | unused or undisclosed configuration is not observable evidence |
| JSON canonicalization, signatures and provenance primitives | Adopt | mature standards already define the generic mechanisms |
| MCP tools/resources | Adopt/profile | reusable transport; AEN limits its surface to search, feedback and immutable reads |
| A2A communication | Map later | possible carrier for Agent interaction, not a substitute for Experience semantics |
| OCI/ORAS, RO-Crate and TUF | Adopt later | useful after real artifact/reproduction/update requirements exist |
| Automatic remote Experience execution | Reject | violates the untrusted-content and local-policy boundary |
| Global reputation or paid evidence level | Reject | evidence must remain task/configuration/time scoped and reproducible |
| Learned ranking in the Pilot | Reject | begin with explainable compatibility filters and reversible baselines |
| Federation in the MVP | Reject | wait for multiple independent operators and real synchronization requirements |

## 6. Evaluation foundations

Agent evaluations must keep task, trial, grader, transcript reference, outcome and aggregate separate. The [METR Task Standard](https://github.com/METR/task-standard) is relevant to executable task packaging, while work on [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/), [Model Cards](https://research.google/pubs/model-cards-for-model-reporting/), and [Datasheets for Datasets](https://www.microsoft.com/en-us/research/publication/datasheets-for-datasets/) reinforces the need for reviewed tasks, transparent limitations and reproducible reporting.

AEN adds the domain requirements that an Experience evaluation must include a no-Experience baseline, exact Model/Harness/Environment cells, immutable treatment references, repeated trials, uncertainty, failure classification, cost/latency, and negative-transfer reporting. Mock-model runs prove mechanics only.

## 7. Retrieval, reputation and governance

Retrieval quality and claim truth are separate. Compatibility, license, risk and evidence eligibility are hard filters; relevance ranking operates only on eligible candidates. Public popularity signals do not raise evidence level.

The project follows a conservative governance posture informed by open-source lifecycle and community-health work such as the [CNCF project lifecycle](https://contribute.cncf.io/projects/lifecycle/) and [CHAOSS](https://www.chaoss.community/about-chaoss/): maturity claims require independent implementations, adopters, security practice and evidence, not object or star counts.

## 8. Security and privacy sources

The threat model draws on:

- [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/);
- [OWASP Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/);
- [Google Secure AI Framework](https://saif.google/);
- [MITRE ATLAS](https://atlas.mitre.org/);
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework);
- [NIST Privacy Framework](https://www.nist.gov/privacy-framework/privacy-framework);
- [OpenTelemetry security guidance](https://opentelemetry.io/docs/security/).

These sources motivate controls; the enforceable AEN requirements remain the protocol, Profile, Schemas, tests and Security Policy.

## 9. Additional reading

### Agent and context engineering

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427)

### Interoperability and software supply chain

- [MCP specification](https://modelcontextprotocol.io/specification/latest)
- [A2A specification](https://a2a-protocol.org/v0.3.0/specification/)
- [Agent Skills specification](https://agentskills.io/specification)
- [OTLP specification](https://opentelemetry.io/docs/specs/otlp/)
- [SLSA provenance](https://github.com/slsa-framework/slsa/blob/main/spec/build-provenance.md)
- [Sigstore bundle format](https://docs.sigstore.dev/about/bundle/)
- [SPDX specifications](https://spdx.dev/use/specifications/)

### Distributed systems and open governance

- [ActivityPub](https://www.w3.org/TR/activitypub/)
- [Matrix federation](https://spec.matrix.org/latest/server-server-api/)
- [AT Protocol repository](https://atproto.com/specs/repository)
- [RFC 7282: On Consensus and Humming in the IETF](https://www.rfc-editor.org/info/rfc7282/)

These are research references, not bundled dependencies and not an assertion that every listed standard belongs in the MVP.
