# ADR-0008: ExperienceCard carries the immutable revision digest

- Status: accepted
- Date: 2026-08-20

## Problem

`ExperienceContextPlan.selections[].experienceRef` requires `experienceId`, `revision`, and `digest`, while the original `ExperienceCard` API projection exposed only the first two. A client could not build a plan from search results without a second mutable “latest” lookup, creating a revision/digest race and making the later ContextInjectionObservation ambiguous.

## Decision

`ExperienceCard.digest` is a required AEXP `Digest`. Search responses identify one immutable revision. Detail and section reads use that exact triple; a changed latest revision requires a new search/plan.

## Consequences

- Search → Context Plan is deterministic and race-free.
- Cards remain projections rather than Protocol Objects; the digest refers to the underlying `ExperienceRevision`, not to the card JSON.
- API schema, Hub, local search, MCP metadata and conformance evolve together before the 0.1 Draft is frozen.
