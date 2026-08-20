# AEN reference architecture

This document describes the current reference implementation. Protocol semantics are defined by [AEXP 0.1](../spec/AEXP-0.1.md); implementation requirements are selected by the [MVP Profile](../spec/AEN-MVP-implementation-profile.md).

## System flow

```text
DeepSeek Harness / other Harness
  ├─ authoritative trace/export ──→ Adapter ──→ TaskEpisode + TraceEvidence
  └─ authoritative live config ───→ Manifest Provider ──→ HarnessManifest
                                                   │
                                                   ▼
Local Evidence Store ←→ Workbench/CLI ←→ Evaluator
        │                       │
        │                       └─ human review/edit
        ▼
Promotion Gate ──→ signed public contribution ──→ reviewed Git Registry
                                                        │
                                                        ▼
                                               PostgreSQL projection
                                                        │
                                      ┌─────────────────┴───────────────┐
                                      ▼                                 ▼
                                Hub HTTP/Web                      DSH native / MCP
                                      │                                 │
                                      └──── card/read/feedback ─────────┘
```

## Trust and authority boundaries

| Component | May access private evidence | May publish | May execute Harness tools |
| --- | --- | --- | --- |
| Adapter / Manifest Provider | yes, under local policy | no | no |
| Local Store / Workbench | yes | no direct public write | no |
| Promotion Gate | reviewed source subset | creates signed contribution candidate | no |
| Git review/Registry | public target graph only | accepts reviewed changes | no |
| Hub / Web | public indexed objects | no independent author action | no |
| DSH consumer / MCP | minimized task context and selected remote sections | feedback only under policy | no remote Experience execution |

Publisher private keys, raw Trace, local Manifest correlation, private Skill bodies, prompts, and private Promotion source references stay outside the public Registry.

## Package responsibilities

| Surface | Responsibility |
| --- | --- |
| `packages/protocol` | Schema source, validation, JCS/SHA-256, DSSE/in-toto, ranking compatibility primitives |
| `packages/adapter-dsh` | DSH export parsing, episode derivation, evidence gaps, live snapshots |
| `packages/adapter-sample` | Harness-neutral Adapter example and conformance proof |
| `packages/local-store` | private SQLite storage, retrieval, and exact deletion |
| `packages/workbench` | constrained distillation, review/edit, private search |
| `packages/evaluation` | frozen plans, trials, aggregates, evidence-level gates |
| `packages/promotion` | public projection, scanners, graph closure, signing, revocation |
| `packages/hub` | Git verification, authorized keys, PostgreSQL projection and search |
| `packages/client` | Task Capsule, Context Plan, injection, observation, feedback |
| `packages/dsh-plugin` | native DSH Definition/Policy/Provider/Tools and headless evaluation driver |
| `apps/cli` | local operator workflows and Doctor |
| `apps/hub` | Hub process, HTTP API, minimal Web, portable deployment |
| `apps/mcp` | Harness-neutral search/feedback tools and immutable resources |

## DeepSeek Harness plugin composition

The installable DSH bundle contains four logical roles:

- **Definition:** typed service contract shared by the bundle;
- **Policy:** local decisions for capture depth, Skill/resource visibility, and network permission;
- **Provider:** authoritative Manifest capture and local evidence coordination;
- **Tools:** disabled-by-default search/feedback consumer surface.

Policy, Provider, and Tools use separate Cordis fibers. Tools can be removed or disabled without stopping Manifest capture. Configuring a Hub URL does not grant network access unless Policy also allows it, and neither setting grants public publishing authority.

## Data ownership

The private SQLite store is the source of truth for local evidence and Promotion audit records. Reviewed Git state is the source of truth for public contribution membership and authorized keys. PostgreSQL is a rebuildable Hub projection, not an authoring database.

Experience objects are immutable. Search cards, rankings, aggregates, and Web views are projections. Rebuilding a projection must not change object digests or invent author actions.

## Evaluation boundary

The evaluator invokes only built-in release drivers or operator-selected trusted local modules. Drivers and graders are never downloaded from Experience content. Every official DSH trial uses an isolated workspace, digest-bound fixture, installed plugin, frozen configuration, and private Trace location.

Mock-model runs validate mechanics. Real Model × Harness effectiveness requires preregistered live trials and remains outside local engineering proof.

## Extension boundary

New Harness integrations implement the Adapter interface and emit standard AEXP objects. Harness-specific fields remain internal or use namespaced extensions. A new Adapter must not require Hub, Schema, or core digest changes unless the protocol itself genuinely lacks a cross-Harness concept; such a change requires an ADR and conformance update.
