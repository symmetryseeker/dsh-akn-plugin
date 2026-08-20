# ADR-0007: Keep the private-to-public source link outside the public graph

> Maturity: AEXP 0.1 Draft / AEN Pilot.

- Status: accepted
- Date: 2026-08-20

## Problem

The Spec simultaneously requires Promotion to create a new public target revision, keep the private source immutable, prevent private identifiers/digests from entering the target, maintain public reference completeness, and keep `PromotionRecord` in the source trust domain by default.

Copying `supersedes = private source ref` into the public target violates the last three requirements: it discloses a private digest and creates a reference that a public Hub cannot resolve. Publishing the `PromotionRecord` has the same disclosure problem because it contains `sourceRef`.

## Decision

For a private-to-public boundary crossing:

1. the public target keeps the stable `experienceId` and receives the next revision number;
2. the first public target omits `supersedes` when its predecessor is not publicly resolvable;
3. the signed `PromotionRecord` is stored in the local/source trust domain and is the authoritative source-to-target audit link;
4. the public Git contribution excludes both the `PromotionRecord` and its attestation;
5. later public revisions may use `supersedes` normally when the predecessor is part of the public graph.

The public target also strips private source-episode/gap extension digests and rewrites all published evidence, Episode, Manifest, and Artifact references to a closed public graph.

## Consequences

- A public Hub can validate and rebuild a contribution without access to the contributor's local database.
- The contributor retains a signed, local proof of which private revision produced the public target.
- Public revision numbers can begin above `1`; consumers must not assume all lower revisions are public.
- A future selective-disclosure proof may expose the source-to-target relationship without changing this boundary rule.
