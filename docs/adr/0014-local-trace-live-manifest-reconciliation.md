# ADR-0014: Trace and Live Manifest are reconciled locally, never conflated

- Status: Accepted for AEXP 0.1 Draft
- Date: 2026-08-20
- Affects: DSH Adapter, DSH plugin, Workbench distillation, H-level, Promotion privacy

## Context

A DeepSeek Harness session trace is authoritative for durable behavior and outcomes, but it cannot prove the installed Skill package, scripts, references, assets, shadowed registry entries, or full Harness configuration. A live plugin can read the effective request surface and authoritative Skill registry, but it is not a second trace recorder and does not by itself prove task outcome. Treating either source as the other creates false Harness identity or false causality.

The previous implementation also marked `coverage.skills=complete` when the registry enumeration was complete even though each Skill artifact was only `partial_snapshot`. That contradicted the complete Spec and could improperly raise an Experience to H2.

## Decision

1. Offline Trace and the native DSH plugin remain separate evidence authorities.
2. Both locally derive `sha256(session.id)` as a private session-correlation digest. Workbench may reconcile them only when the digest matches, the Live Manifest is the nearest configuration boundary at or before the TaskEpisode, and at least two of system prompt, tool schema set, and request configuration digests match exactly.
3. Every Skill observed in Trace must exist in the correlated live registry snapshot. Name is used only to connect the same-session invocation fact to an exact live Artifact ref; shared Experience identity is the Artifact id/digest plus Manifest scope, not a global name guess.
4. `captureSkillResources` is an explicit local authorization. A directory Skill is `complete_package` only when its regular in-directory `SKILL.md` and every other regular file under that resource base are read within fixed file/directory/byte limits. Symlinks, special files, a single-file shared root, unreadable entries, unsupported resource bases, or limit violations fail closed to `partial_snapshot`.
5. `coverage.skills=complete` requires both a complete authoritative registry enumeration and `complete_package` for every listed Skill. Otherwise it is `catalog_only` (or `none`).
6. Workbench may raise an observational candidate from H1 to H2 only after this complete reconciliation. It adds an exact `derived_from` relation to the Live Manifest and retains the original Trace/Observation. It must state that configuration identity does not prove the Skill or Harness caused the outcome; H3 still requires controlled comparison.
7. The correlation digest, raw trace digest, session scope, and local resource paths are local-only. Distilled applicability uses the stable Harness configuration digest, while the exact Manifest remains provenance through Observation/typed relation. Promotion strips local correlation data, preserves the configuration commitment, and rewrites every exact top-level or claim-scope Manifest snapshot selector/ref to the public projected Manifest.

## Consequences

Trace alone still yields conservative H1 evidence. The DSH plugin can supply the Harness-level facts that Trace cannot see without creating another tool-call capture pipeline. Complete Skill identity is available when explicitly authorized, while ambiguous or unsafe packages remain partial. Public contributions retain auditable Model × Harness scope without disclosing a local session identifier or private Manifest digest.
