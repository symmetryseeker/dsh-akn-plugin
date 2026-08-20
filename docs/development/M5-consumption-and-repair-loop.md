# M5 implementation record: Agent consumption and repair loop — Draft/Pilot

## Task minimization and discovery

- `@aen/client` creates short-lived protocol-valid Task Capsules with explicit omitted-sensitive-field inventory.
- Secret, PII, local path and private-network scanning runs before public search.
- Search cards now carry the immutable ExperienceRevision digest (ADR-0008), so Context Plans cannot race a mutable latest lookup.
- Both local and Hub search hard-filter incompatible Model/Harness candidates and cap normal results at three cards.
- Local SQLite and Hub PostgreSQL use the same deterministic MVP reranker, so evidence, freshness, negative transfer, cost, latency and digest tie-breaking do not drift across surfaces.
- Cost/latency policies fail closed: if the caller supplies a maximum budget, candidates missing that observed metric are not eligible.
- The three-card diversity policy retains a primary result, a nearby negative/boundary result when available, and a non-dominated quality/cost/latency alternative before using a ranked fallback.

## Context engineering

- Deterministic ExperienceContextPlan ordering is compatibility-first by default.
- `card` is mandatory; a declared negative case pulls `cases` into the required selection.
- `recipe` and `evidence` are just-in-time; `repro` and `artifacts` never enter normal context automatically.
- A section read that exceeds its per-selection or total byte/token budget fails with `AEXP_CONTEXT_BUDGET_EXCEEDED`. JSON is never truncated.
- Successful injection produces one immutable ContextInjectionObservation per selected Experience and records exact fetched/injected sections plus content digests.

## Feedback and measured repair

- `adopted` feedback is rejected without a matching ContextInjectionObservation containing at least one injected section.
- Helpful/harmful feedback stays a low-trust FeedbackEvent and has no H-level field.
- `createConsumptionObservation` creates a measured post-injection RunObservation with the exact ContextInjectionObservation ref and Configuration Cell. This, rather than a vote, can later support or contradict a claim.
- Hub Contentions expose both supporting and contradicting refs; the Web detail view does not hide negative observations.

## Harness surfaces

- Native DSH plugin optionally registers exactly `experience_search` and `experience_feedback`.
- Native `experience_search` has no model-supplied Model/Harness digest fields. Its Tools role resolves the current `ToolRunContext.agent` through the Provider service, waits for the corresponding low-frequency request/config snapshot, and attaches authoritative Model, stable Harness configuration, exact Manifest snapshot, and Environment coordinates. Missing correlation fails closed.
- The DSH ToolRunContext AbortSignal reaches both the Provider wait and Hub fetch. Cancellation never becomes a local fallback; cancelling one waiter leaves the shared Provider snapshot alive for later searches.
- MCP registers the same two tools plus immutable section/Manifest resources.
- Both surfaces use `LocalStoreExperienceSource`: Hub is optional, failed Hub discovery falls back to local SQLite, immutable reads require the exact id/revision/digest, and feedback remains local.
- Neither surface registers `experience_execute` or a third `experience_fetch` tool.
- Native simplified feedback intentionally excludes `adopted`; the full client path must record injection first.

## Verification

Tests prove incompatible high-evidence cards are excluded, selections cap at three, negative cases survive planning, over-budget content is not injected or recorded, adoption requires injection evidence, feedback does not alter H-level, MCP surface budget is exact, and DSH rejects private path leakage before network access. DSH consumer tests also prove that the model-facing schema contains no compatibility hashes, the outbound request receives all four authoritative axes from the Agent runtime, Model changes refresh context without changing Harness identity, missing Agent context is denied, and cancellation is propagated without fallback or shared-snapshot loss. The same assertions run through the official DSH `ToolRuntime.execute()` pipeline, not only by invoking the registered definition directly.
