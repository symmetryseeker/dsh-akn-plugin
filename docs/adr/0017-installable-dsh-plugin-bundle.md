# ADR-0017: Installable DeepSeek Harness Plugin Bundle

- Status: Accepted
- Date: 2026-08-20
- Scope: AEN MVP DeepSeek Harness packaging and local SQLite runtime

## Context

Loading `packages/dsh-plugin/dist/index.js` by absolute path proved the Cordis module surface, but it did not prove the user requirement that AEN work as a DeepSeek Harness plugin. A source-only path has no portable dependency closure, does not participate in `dsh plugin add/remove`, and cannot automatically contribute a profile layer.

The first tarball attempt exposed a second distribution failure. `better-sqlite3` requires an install script, while pnpm and the DSH plugin manager correctly reject unapproved dependency builds. Installation therefore wrote a partial profile and exited nonzero until the user changed `allowBuilds`. This was unnecessary for the MVP because its supported Node and DSH versions already provide SQLite.

The optional Consumer tools also cannot share the lifecycle of Manifest capture. Requiring `tools` in the top-level `inject` list would keep capture pending in a valid headless/custom composition that exposes authoritative agents and skills but no model tool registry. A combined plugin also made local policy, network permission and capture configuration needlessly inseparable.

## Decision

1. `@aen/dsh-plugin` is a DSH bundle package. Its manifest declares `dsh.bundle.patch`, and `cordis.patch.yml` inserts separate `aen-policy`, `aen` provider and disabled-by-default `aen-tools` rows with privacy-preserving local-only defaults.
2. The release tarball bundles AEN workspace runtime code into its exported ESM entry. Audited third-party packages and DSH capability packages remain normal dependencies/peers; consumers never resolve unpublished `workspace:*` runtime dependencies.
3. The Local Evidence Store uses Node 22+ `node:sqlite` rather than a native addon. It retains schema versioning, foreign keys, WAL, FTS5, explicit transactions, `secure_delete`, WAL truncation and vacuum behavior.
4. The bundle exports four role modules: `./definition` is the opaque `aen` service contract; `./policy` provides immutable capture/network policy; `./provider` injects `agents`, `skills` and `aenPolicy`, performs low-frequency capture, and provides `aen`; `./tools` injects `aen`, `aenPolicy` and `tools`, then registers exactly `experience_search` and `experience_feedback`. Definition is a service contract instantiated by the Provider; Policy, Provider and Tools are independent Cordis fibers.
5. The default bundle does not access a Hub, capture full Skill resource trees, expose model tools, publish, install or execute Experience content. Hub search requires both explicit Tools enablement and `aenPolicy.allowHubSearch=true`; public publishing remains disabled in plugin policy.
6. Host acceptance is pack → official `dsh plugin add` → role-module and profile-bundle inspection → official Web boot with all three fibers → HTTP 200 → SQLite schema check → graceful SIGTERM → official `dsh plugin remove`. An absolute-path source composition test remains a development check, not release proof.

## Consequences

- A user can install and remove the MVP through the official DSH plugin workflow without editing pnpm build approvals.
- The packaged plugin is portable across checkouts and does not rely on the AEN monorepo's workspace symlinks at runtime.
- Headless/custom DSH compositions can keep Policy + Provider while omitting model tools; disabling or unloading Tools does not dispose the evidence provider.
- Network permission is an explicit Policy decision rather than an incidental consequence of a URL field.
- Node 22+ is a hard local-runtime requirement, consistent with the current AEN and DeepSeek Harness engine ranges.
- Current Node releases may print an `ExperimentalWarning` for `node:sqlite`. The API and required SQLite features are covered by local-store and installed-host tests; its Node stability status must be reviewed before a Stable release.
- `node:sqlite` changes the driver, not the AEXP storage model or wire protocol. Existing schema-v3 databases remain SQLite files and are exercised by the same migration/search/deletion tests.
