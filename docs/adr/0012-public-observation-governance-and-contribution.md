# ADR-0012: Public RunObservation governance and contribution boundary

- Status: Accepted for AEXP 0.1 Draft
- Date: 2026-08-20
- Affects: RunObservation, public Promotion, Git contribution ingress, contention projection

## Context

The early design draft required independently produced public RunObservation contributions and said that public objects remain subject to license, consent, redaction, and withdrawal policy. The RunObservation wire object had only an optional attestation. A signature proves origin and integrity; it does not grant publication or redistribution rights, record consent, or state the redaction boundary. A Git inventory is transport metadata and cannot repair this once an object is mirrored by digest.

This made the cross-user repair loop impossible to implement without either accepting unlicensed observations or inventing an MVP-only envelope.

## Decision

RunObservation gains an optional `governance: Governance` field.

- Local/restricted observations may omit it.
- A standalone public Observation contribution MUST set `visibility=public`, a non-empty license and consentRef, `redistribution=public_mirrors`, public-only data classes, and a human-reviewed redaction report.
- Its owner, evaluator actor, Git inventory actor, and authorized attestation issuer MUST identify the same contributor for the MVP single-Hub profile.
- Observation dependencies remain immutable digest references. A public contribution must include and validate any new Manifest/evidence/context-injection objects it introduces.
- A Contention may reference an already-ingested ExperienceRevision by exact ObjectRef without redistributing the author’s complete contribution graph. Hub projection MUST resolve that external claim ref before accepting the contribution.
- A public Observation does not mutate the referenced Experience revision and does not change H-level by itself.

## Consequences

Mirrors can enforce license and consent from the protocol object rather than transport state. Existing local observations remain valid. Public observations produced as evidence during Experience Promotion also receive explicit governance. Public ingress fails closed when governance, exact Experience identity, dependency closure, or authorized signatures are missing.
