# M6 pre-public engineering audit — 2026-08-20

Status: **completed for the current source tree; independent security review and live pilot remain open gates**.

## Scope and exclusions

The audit covers AEN root code, protocol schemas/fixtures, packages, apps, documentation, CI, and the empty public contribution registry. The nested upstream checkouts `deepseek-harness/` and `dsh-web-ui/`, local `.work/`/`.backups/`, `node_modules/`, build output, local SQLite files, and intentionally hostile negative fixtures are not AEN release content and were excluded from source-secret conclusions.

## Results

| Control | Command/evidence | Result |
| --- | --- | --- |
| Dependency vulnerabilities | `pnpm audit --prod` | no known vulnerabilities reported |
| Production dependency licenses | `pnpm licenses list --prod --json` | MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC; no unknown/copyleft category reported |
| Repository license | root `LICENSE` | Apache-2.0; Experience/Artifact object licenses remain independent |
| Secret signature scan | `pnpm audit:source` for PEM and common provider/GitHub/AWS token forms outside excluded fixtures/build/vendor trees | reviewed deterministic test vectors are allowlisted; no operational credential found |
| Public content scanner | promotion and Hub ingress tests | secret, PII, local path, private URL, missing license/consent, non-reviewed redaction and inline Artifact body/distribution fields fail closed |
| Dependency integrity | frozen `pnpm-lock.yaml`; CI uses `pnpm install --frozen-lockfile`; `pnpm audit:licenses` enforces the reviewed categories | repeatable dependency graph |
| Public graph integrity | schema, JCS digest, DSSE/in-toto, authorized key, closed references | tamper/unsigned/unknown-key cases rejected |
| Remote execution | client/MCP/DSH surfaces | no `experience_execute`; immutable section resources only; recipes marked untrusted |
| Revocation | emergency block and signed-revocation paths | blocked digest leaves search/body reads and tombstone survives projection rebuild |
| Whole-repository regression | `pnpm typecheck && pnpm test && pnpm conformance && pnpm build` | all workspace checks/builds passed; 108 tests passed; conformance 19 valid / 23 invalid / 19 golden, zero failures |
| Native database/process E2E | `pnpm test:postgres && pnpm test:e2e` | PostgreSQL 17 Hub suite 14/14; isolated CLI/Hub/PostgreSQL/Web flow verified 12 signed objects, exact read, public search and confirmed local deletion |
| Release boundary E2E | `pnpm test:dsh-plugin-host && pnpm test:hub-deployment` | DSH tarball passes official add/boot/remove; Hub production directory has no workspace escape and passes Git/PostgreSQL/HTTP exact-read E2E outside the repository |
| Performance/resource reports | `pnpm bench:performance && pnpm bench:dsh-hot-path`; hostile-input suites | MVP search p95 objectives pass on declared load; tool-call synchronous I/O=0; complete-Spec CPU <1% remains open |
| Empty Git projection baseline | `aen-hub verify` against `contributions/` | valid; 0 contributions, 0 objects, 0 authorized signatures |

The deterministic private key is a public test vector used only to regenerate repeatable signature fixtures. It is not trusted by the Hub registry, does not appear in `contributions/authorized-keys.json`, and must never be reused for a publisher or deployment. Real `aen init` keys are generated locally with mode `0600` under ignored local state.

## Threat review

- **Sensitive-data exfiltration:** public search sends a minimized Task Capsule after local scanning; Promotion rebuilds a public graph and removes private locators. Residual risk remains human-authored indirect disclosure, so human review is mandatory.
- **Prompt/tool injection:** all remote Experience sections are untrusted data. The Hub cannot invoke Harness tools, MCP has two non-execution tools, and native DSH consumption is opt-in.
- **Supply-chain substitution:** object digests and authorized signatures pin public content. MVP does not distribute executable artifacts and does not claim OCI/TUF equivalence.
- **False or poisoned experience:** signatures do not imply correctness. Compatibility gates, H-level derivation, negative cases, Contentions, immutable revisions, and revocation limit—but do not eliminate—poisoning.
- **Denial of service:** Protocol validation now runs a deterministic 250-case hostile JSON mutation suite under a 3-second bound. Hub ingress rejects excessive object/total bytes, JSON depth/nodes/string size, unsafe paths and symlinks; HTTP bodies are capped before projection calls. Sustained adversarial-load fuzzing, production rate limiting and deployment hardening remain operator work.
- **Artifact smuggling:** ADR-0015 applies a metadata-only public Artifact allowlist at Promotion and Hub ingress. Entrypoints, resource lists, fetch references, attachments, source URIs, unknown inline bodies and oversized/body-shaped extensions fail closed.
- **Key compromise:** reviewed authorized-key state supports revocation time. MVP has no threshold signing or transparency log; key rotation must be a reviewed Git change and compromised content must be blocked immediately.

## Open release gates

1. Obtain an independent security review before claiming a Stable release.
2. Run production-style PostgreSQL load/resource tests and define operator rate limits/backups.
3. Operate a reviewed publicly reachable Pilot Hub with TLS, monitoring, backups, rotation and incident procedures.
4. Complete the real 2×2×2 and cross-user pilot in the [pilot report](../pilot/AEN-MVP-pilot-report.md).
5. Have a non-core contributor follow both authoring guides without maintainer intervention and publish their report.

Detailed evidence:

- [MVP search performance](../performance/MVP-search-smoke-2026-08-20.md)
- [DSH hot-path benchmark](../performance/DSH-tool-call-hot-path-2026-08-20.md)
- [Hostile-input/resource limits](./MVP-hostile-input-resource-report-2026-08-20.md)

These gates do not invalidate the current engineering implementation; they prohibit overstating maturity.
