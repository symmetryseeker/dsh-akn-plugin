# Public AEN contributions — Draft/Pilot

This directory is the Git review surface for public AEXP objects. It is not a new wire format.

Each contribution is a directory containing:

- `inventory.json` and its byte-exact RFC 8785 form `inventory.jcs.json`;
- an `objects/` directory containing only the objects named by the inventory;
- a public `ExperienceRevision` created by explicit private-to-public Promotion;
- a closed public evidence graph and authorized Ed25519 attestations.

The reference Hub rejects digest mismatches, unsupported capabilities, unresolved references, unsigned targets, unauthorized or revoked keys, missing public licenses/consent, non-reviewed redaction, secrets, PII, local paths, and public H3 claims without an eligible non-synthetic controlled comparison.

Add publisher public keys through review in `authorized-keys.json`; private keys must never enter this repository. A pull request and Git commit provide audit context but do not replace AEXP object digests or DSSE attestations.

Generate a candidate locally with `aen promote ... --public --out <new-directory> --consent <audit-ref>`. CI only validates; it never promotes or publishes private evidence automatically.
