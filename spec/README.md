# AEN specifications

This directory contains the public, reviewable specification surface for Agent Experience Network.

- [`AEXP-0.1.md`](./AEXP-0.1.md) defines the protocol semantics and invariants.
- [`AEN-MVP-implementation-profile.md`](./AEN-MVP-implementation-profile.md) selects the required subset for the reference Pilot implementation and preserves its requirement IDs.
- [`../schemas/aexp/0.1/`](../schemas/aexp/0.1/) contains the normative JSON wire schemas.
- [`../conformance/`](../conformance/) contains valid, invalid, and canonical-digest vectors.

The specification, schemas, and conformance vectors are versioned together. A change to a wire field, digest rule, evidence meaning, capability, or trust boundary requires an ADR and synchronized changes to every affected normative artifact.

Historical product drafts, private design reviews, brainstorming notes, and coding-agent instructions are intentionally not part of this public specification surface.
