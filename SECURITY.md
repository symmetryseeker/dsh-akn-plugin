# Security Policy — Draft/Pilot

## Supported status

AEN and AEXP 0.1 are Draft/Pilot software. No release is currently designated Stable or suitable as a sole security boundary. The reference Hub must be deployed behind normal infrastructure controls, and remote Experience content must always be treated as untrusted data.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository when available (`Security` → `Advisories` → `Report a vulnerability`). If that channel is unavailable, contact the repository owner privately before filing an issue. Do not include active credentials, private traces, customer data, or an exploit against a third-party deployment in a public report.

Please include affected commit/version, impact, reproduction steps using synthetic data, and any proposed mitigation. Maintainers should acknowledge a complete report within seven days; this is a response target, not a paid support SLA.

## Urgent content incidents

For a leaked secret, license violation, unsafe recipe, or sensitive local path in a public Experience:

1. emergency-block the affected digest in the Hub so search and body reads fail immediately;
2. rotate or revoke the exposed credential outside AEN;
3. publish an authorized signed Revocation and remove redistributable content where legally required;
4. rebuild the projection from reviewed Git state and verify the tombstone survives rebuild;
5. document root cause without reproducing the secret.

An emergency block is an operational containment control; it is not a substitute for signed, auditable revocation.

## Security invariants

- Raw traces, publisher private keys, system prompts, private skill bodies, and local databases remain local by default.
- Public Promotion creates a new immutable revision and reruns schema, digest, DLP, license, consent, human-review, reference-closure, and signature checks.
- The Hub has no Harness execution capability. Clients expose no `experience_execute`; recipes are never auto-executed.
- Compatibility is a hard filter before relevance. Context reads are immutable and budgeted, and adopted feedback requires an injection observation.
- Public keys are explicitly authorized in reviewed Git state. A valid signature proves origin/integrity, not truth or safety.

The current audit and known gaps are recorded in [the M6 release audit](./docs/security/M6-pre-public-audit.md).
