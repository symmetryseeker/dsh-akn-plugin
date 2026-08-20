# ADR-0016: Deletion, Revocation, Tombstones, and the Git Boundary

- Status: Accepted
- Date: 2026-08-20
- Scope: Local evidence deletion and MVP public registry withdrawal

## Context

AEXP revisions are content-addressed and immutable, but privacy and safety requirements allow body deletion. The MVP also uses a reviewed Git tree as its public source of truth. “Delete” therefore cannot mean one identical operation everywhere:

- a private SQLite owner can erase local bytes;
- a Hub can stop serving and purge its active projection;
- a Registry maintainer can remove a contribution body from the current Git tree;
- no operator can recall bytes already copied into an independent clone, backup, screenshot or model context.

Treating an API tombstone alone as deletion left body JSON in the active PostgreSQL projection. Treating a revocation contribution as sufficient also left the old contribution in the Registry current tree, so a new clone still received the withdrawn body.

## Decision

1. Local deletion is an explicit cold-path action requiring an exact digest confirmation and reason. It removes object JSON, FTS rows, links, session associations and review data, uses SQLite `secure_delete`, truncates WAL, vacuums the database, and retains only digest/type/ID/revision/reason/time.
2. A Hub revocation or emergency block has precedence over reads and search. The active PostgreSQL `canonical_json` body is removed; a separate minimal tombstone table preserves immutable lookup by digest and Experience ID/revision.
3. Rebuild always reapplies revocations and emergency blocks before making the projection readable. A Hub tombstone is itself a permanent local deny/purge input, so a stale rebuild that accidentally omits the Revocation cannot resurrect a body on that Hub.
4. The Registry current tree must not contain both a Revocation and any body named by its `affectedDigests`. The reviewed revocation change removes the affected source contribution(s) from current HEAD. CI/Hub Git loading fails closed if the current tree still distributes one.
5. For a secret leak or affected evidence closure, the author/operator must enumerate every sensitive digest in `affectedDigests`; revoking only the Experience target cannot infer which otherwise reusable dependencies must also be erased.
6. Audit state retains only non-recoverable tombstone metadata. Backup retention and physical storage/WAL guarantees outside the application remain operator policy.

## Limits

Git history and independent clones are copyable. Removing a body from current HEAD prevents new ordinary clones/exports from receiving it but cannot recall prior copies or erase every historical object from all remotes. A fresh Hub also needs the reviewed Revocation/current-tree state; the local tombstone anti-rollback property applies only after that Hub has observed the withdrawal. Secret-bearing content must therefore be blocked immediately, credentials rotated, and never treated as safe merely because a deletion commit exists.

This is an explicit feasibility boundary, not a relaxation of redaction or consent requirements.
