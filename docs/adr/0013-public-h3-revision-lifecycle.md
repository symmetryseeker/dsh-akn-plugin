# ADR-0013: Public H3 requires evaluation of a prior public revision

- Status: Accepted for AEXP 0.1 Draft
- Date: 2026-08-20
- Affects: Experience revision lifecycle, RunObservation, EvaluationAggregate Promotion, Workbench follow-up drafts

## Context

A causal public Experience points to an EvaluationAggregate; its trials point to RunObservations; treatment observations require an exact Experience id/revision/digest. If the first public H3 revision is also the treatment target, the graph becomes `Experience → Aggregate → Trial → Observation → Experience`. A content-addressed cycle has no computable SHA-256 fixed point. Removing the Observation experienceRef would make the public evidence unable to prove which immutable Experience was applied.

## Decision

Public H3 deepening uses an acyclic revision lifecycle:

1. publish an evaluable public revision (normally H1/H2);
2. run baseline/treatment trials whose treatment observations reference that exact public revision;
3. create a new private follow-up draft that supersedes the evaluated public revision;
4. attach the aggregate and causal claim, review it, and promote a new public revision;
5. the new public revision preserves `supersedes` to the prior public revision, while the intermediate private draft remains disclosed only in the local Promotion audit.

A public treatment Observation MUST retain its exact prior-public Experience ref. Promotion may remove an Experience ref only when it points to a private source. Hub projection resolves all retained refs and rejects missing or digest-mismatched predecessors.

## Consequences

The public evidence graph is acyclic and independently resolvable. Initial publication cannot jump directly to a self-referential H3 claim. Workbench can derive a private follow-up draft from a public revision without mutating it, and global revision numbers remain collision-free.
