# M4 implementation record: Public Promotion and Reference Hub — Draft/Pilot

## Delivered

### Promotion

- `@aen/promotion` requires the current immutable private revision to have an append-only `public_requested` review event.
- Promotion creates a new public revision/digest; it never changes source visibility.
- The public evidence graph is rebuilt as `EvidenceGapReport → TaskEpisode → TraceEvidenceBundle → RunObservation → ExperienceRevision`.
- Session identifiers are pseudonymized; local locators, private source/gap extensions, unpromoted attachment refs, local-only distribution and filesystem URIs are removed.
- Harness Manifest and Artifact descriptors receive public identities/digests. Exact Manifest snapshot selectors/refs are rewritten; stable Harness configuration commitments are preserved and indexed separately from object provenance.
- The public Manifest explicitly states that its metadata-only projection cannot independently recompute the preserved source `configurationDigest`.
- Public Artifact projection follows ADR-0015: redistributable permission never enables MVP package distribution; entrypoint, resources, distribution/fetch references, attachments and source URI are removed, while immutable interface/content/tree digests and license remain.
- Secret, token, PII, private URL and user-path scanning runs before output and again during Hub ingress.
- Public Experience and Observations receive Ed25519 DSSE/in-toto attestations. The PromotionRecord is separately signed and retained locally.
- `inventory.json`, canonical `inventory.jcs.json`, and immutable AEXP object files form the Git contribution directory.

### Reference Hub ingress

- Each inventory path is confined to the contribution directory; symlinks, traversal, unlisted files, excessive object/byte counts and metadata mismatches are rejected.
- Schema, digest, required-capability, secret/path, closed-reference, public license/consent, human-redaction and authorized-key gates are reapplied.
- Public H4 is rejected in the MVP. H3 additionally requires a causal claim and a closed `evaluated_on` aggregate with an eligible non-synthetic comparison.
- Merge/ingest means “hosted and policy-valid,” not “claim proven true.”

### PostgreSQL projection and API

- Git contributions rebuild immutable object and Experience projections.
- Search supports task family, Model provider/ID, exact Harness Manifest digest, minimum evidence, maximum risk, allowed license, maximum mean cost, and maximum p95 latency filters.
- Cost and latency budgets are hard filters. An Experience with an unknown requested metric is excluded rather than treated as zero or silently admitted.
- PostgreSQL FTS supplies a bounded candidate pool; the shared MVP reranker deterministically combines compatibility, evidence, lexical position, freshness, negative/boundary evidence, and observed quality/cost/latency. It returns at most a primary, nearby negative, and Pareto alternative, with explanations on every card.
- Read, Git-data export and low-trust public aggregate feedback APIs do not mutate Experience revisions.
- Emergency blocks are operational state with precedence over Git projection and survive rebuilds.
- Formal Revocation objects require protocol validity, affected target coverage and an authorized Ed25519 signature; fetch returns only a minimal tombstone.
- Revocation/emergency block also purges active PostgreSQL body JSON and preserves only a minimal identity tombstone. Tombstones permanently participate in local purge/search/export/feedback gates, so a stale rebuild cannot resurrect a body after that Hub observed the withdrawal.
- Git registry loading rejects a current tree that contains both a Revocation and an affected body. The reviewed revocation change must remove the old source contribution from current HEAD; historical clones cannot be recalled (ADR-0016).
- The minimal Web exposes all MVP hard filters. Cards show compatibility, evidence, ranking role, measured cost/latency and nearby negative cases.
- Detail renders the evidence boundary (what the maximum H-level supports and does not prove), referenced public Harness Manifest coverage/limitations, metrics, contentions, source and risk. Recipes remain untrusted text and the Hub has no execute/install endpoint.

### Portable deployment

- pnpm injected workspace packages produce a self-contained production directory; no `@aen/*` symlink points back to the monorepo.
- The deployed app includes only `dist`, package metadata, production dependencies and its dedicated lock/workspace metadata; source and tests are excluded.
- `Dockerfile` uses the same portable directory in a non-root Node 24 runtime. `compose.yaml` mounts reviewed contributions read-only and provides PostgreSQL 17, required separate database/admin secrets, health checks, read-only root filesystem and `no-new-privileges`.
- Git root/key registry can be supplied as CLI options or the paired `AEN_GIT_ROOT`/`AEN_AUTHORIZED_KEYS` environment variables. A half-configured pair fails closed.
- This is a single-node Pilot deployment artifact, not evidence of a publicly reachable service, production SLI, federation or Stable security.

## Commands

```sh
aen init --actor https://github.com/<user>
aen review <experience-id> --decision request-public
aen promote <experience-id> --public --out contributions/<candidate> --consent <audit-ref>

aen-hub verify --git-root contributions --keys contributions/authorized-keys.json
aen-hub rebuild --git-root contributions --keys contributions/authorized-keys.json
aen-hub serve --git-root contributions --keys contributions/authorized-keys.json
```

The Hub requires PostgreSQL through `DATABASE_URL`. `AEN_HUB_ADMIN_TOKEN` authorizes emergency moderation only; it is not a publisher signing key.

## Verification evidence

- Promotion integration: private source immutability, public target signing/redaction/reference closure, bundle output, request-public gate and secret rejection.
- Hub ingress: valid contribution, digest tamper, unsigned target, hidden secret and unauthorized key cases.
- PostgreSQL contract: Git rebuild, Model/Harness search, cost/latency hard filters, read, emergency block/tombstone and rebuild precedence using both the portable test engine and a separately started real PostgreSQL process.
- Web/API: meaningful read-only surface, strict CSP, complete filter forwarding, evidence/Manifest boundary rendering and admin bearer-token gate.
- Portable release: `pnpm test:hub-deployment` moves the generated directory outside the workspace, denies escaping symlinks/source/test files, boots the deployed CLI, and runs Git → real PostgreSQL → HTTP/Web/exact-read E2E through that copy.

No test publishes a contribution, pushes Git, executes a downloaded recipe, or treats synthetic evaluation as real evidence.

The declared MVP search latency evidence is recorded in
[`docs/performance/MVP-search-smoke-2026-08-20.md`](../performance/MVP-search-smoke-2026-08-20.md).
