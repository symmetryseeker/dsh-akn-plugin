# MVP Hostile-Input and Resource-Limit Report — 2026-08-20

Status: **MVP-SEC-004 engineering checks pass; sustained production adversarial-load testing remains open**.

## Tested boundaries

| Layer | Bound/control | Automated evidence |
| --- | --- | --- |
| AEXP validation | default 1 MiB canonical object, depth 64, array 10,000, finite/cyclic/plain-JSON checks | fixed boundary tests plus 250 deterministic mutations |
| Hub HTTP | configurable body byte cap, default 1 MiB | oversized feedback body returns 400 before projection invocation |
| Git contribution | 10,000 objects, 64 MiB total, 4 MiB/object, JSON depth 64, 100,000 nodes, 512 KiB/string, 10,000 object keys | nested-depth and oversized-string ingress denials; path/layout/symlink/side-load controls |
| DSH trace input | 128 MiB compressed/raw input, 256 MiB root `session.jsonl`, exactly one root session file | fixed loader limits and ZIP root selection |
| DSH Skill closure | 512 files, 128 directories, 64 MiB total, 8 MiB/file; no symlink/special file | complete-package and symlink fail-closed tests |
| Public Artifact | metadata allowlist, extensions ≤32 KiB/512 nodes/4 KiB per string; body/distribution-shaped keys denied | redistributable-source projection and inline-body denial tests |

## Deterministic mutation run

The protocol test mutates a valid Task Capsule with seed `0xa3e19d27` across 250 cases:

- depth 35–84;
- strings over the configured 8 KiB fuzz limit;
- arrays over the configured 128-item fuzz limit;
- NaN, Infinity and BigInt;
- cyclic objects;
- unknown required capabilities;
- digest corruption.

Every case must return a structured failed validation with at least one issue and the entire mutation batch must finish in under 3 seconds. On the 2026-08-20 Apple M5 engineering run, the complete protocol suite (including fixtures, signatures and the mutation batch) completed in 232 ms; this is not a production throughput claim.

## Reproduction

```sh
pnpm --filter @aen/protocol test
pnpm --filter @aen/hub test
pnpm --filter @aen/hub-app test
pnpm --filter @aen/dsh-plugin test
```

## Remaining risk

- JSON parsing must still allocate a request that is within the byte cap; deployment-level connection, request-rate and concurrent-memory limits are operator responsibilities.
- The synchronous DSH ZIP loader has deterministic compressed and root-entry size limits, but sustained archive-fuzzing and memory-saturation tests are not claimed.
- These tests do not replace an independent security review, long-running fuzz infrastructure, production WAF/rate limiting, or multi-tenant isolation tests.
- Complete-Spec OCI pull/install/archive scanning is outside the MVP and cannot be inferred from the metadata-only Artifact profile.
