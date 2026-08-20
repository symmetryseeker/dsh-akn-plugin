# ADR-0015: MVP Public Artifacts Are Metadata/Digest/License Only

- Status: Accepted
- Date: 2026-08-20
- Scope: AEN MVP Promotion and Hub ingress

## Context

The protocol-level `ArtifactDescriptor` can describe a complete Skill/package, including entrypoint, resource commitments, distribution metadata and attachment references. The MVP security profile, however, explicitly excludes public package distribution, automatic pull, installation and execution.

The first implementation stripped those fields only when `redistributable=false`. For a redistributable Skill, Promotion could therefore retain `entrypoint`, `resources` and `distribution`, while Hub ingress rejected executable entrypoints. A locally valid Promotion could produce a contribution that the same reference implementation refused to ingest.

Redistribution permission and MVP distribution capability are different facts. A license permits an action; it does not require the MVP to expose a package body or fetch location.

## Decision

For the `aen-mvp/0.1` public profile:

1. Promotion always removes `entrypoint`, `resources`, `distribution`, attachment/security/build refs, and `source.uri` from public Artifact projections, regardless of `redistributable`.
2. Public Artifacts may retain identity, kind/name/version/provider, format and snapshot-completeness labels, interface/content/tree/dependency/presentation digests, description, invocation flags, source type/revision, requested-permission labels, license, and bounded namespaced metadata.
3. `disclosure` is forced to `metadata` during Promotion.
4. Hub ingress reapplies an allowlist-based metadata policy. Unknown top-level/nested body or distribution fields fail closed.
5. Namespaced extensions are bounded by bytes, node count and individual string length; body/blob/bytes/content/data/payload/archive/executable/entrypoint/attachment/resource/URI-shaped keys are rejected.
6. No public Artifact endpoint in the MVP returns bytes, an installable archive, or an executable fetch reference.

## Consequences

- A redistributable Artifact remains discoverable and comparable by immutable digests and license, but cannot be installed from the MVP Hub.
- Future OCI/HTTPS package distribution requires a later capability/profile, threat model, digest/signature/license/archive verification, and an ADR. It cannot be enabled by merely setting `redistributable=true`.
- Promotion and Hub ingress now implement the same profile and no longer contradict each other.
- Complete local Skill closure still matters for H2 Harness reconstruction; public metadata can commit to its content/tree identity without exposing the package.
