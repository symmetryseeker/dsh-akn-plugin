# @dsh/akn-plugin

**Agent Knowledge Network (AKN) for DeepSeek Harness** — a Cordis plugin that
makes every tool call a knowledge event. Content-addressed, immutable knowledge
objects, pluggable verification, and cascade invalidation turn the AKN into the
shared memory substrate and collaboration bus for all DSH agents.

## Install

```sh
cd <your-dsh-profile-dir>          # e.g. D:/dsh/profiles/web
dsh plugin --profile web add @dsh/akn-plugin
dsh web
```

The `cordis.patch.yml` layer auto-registers the plugin with defaults
(`autoPublish: true`, `bootstrapTasks: true`, `bootstrapSeeds: true`).

## What it does

| Capability | Mechanism |
|---|---|
| Tool-call-as-knowledge | `ctx.on('tool/after'/'tool/error')` auto-harvests every call into a KO (never breaks the main loop) |
| Content-addressed immutability | `ko.id = sha256(canonical(JSON.stringify(body)))` — edits fork new ids, old versions kept |
| Trust over authority | `akn_verify` appends reproducible `VerificationV1` records |
| Cascade invalidation | refuting a KO demotes every direct/indirect dependent to `needs_verification` via the reverse index |
| Token economy | `akn_search` returns slim `{id,title,summary,status,environment}` unless `includeBody:true` |
| Collaboration bus | exposed as `ctx.akn` so other plugins call `ctx.akn.search()` directly |

## Configuration (`cordis.patch.yml`)

```yaml
- apply:
    plugins:
      akn:
        autoPublish: true          # harvest tool calls
        bootstrapTasks: true       # publish 3 bounty intents on cold start
        bootstrapSeeds: true       # inject 20+ adversarial seeds when empty
        searchDefaultLimit: 20     # akn_search default cap
        driftCheckOnSearch: false  # auto-mark drifted results stale
        statusRank: { verified: 0, proposed: 1, needs_verification: 2, stale: 3, draft: 4, refuted: 5 }
```

## API

- **`akn_search`** — query `{ filters:{type,status,tags}, keyword }`, `options:{ limit, includeBody, driftCheck }`
- **`akn_publish`** — `{ title, summary, body, environment?, links?, tags?, status? }` → `{ id, status, inheritedInvalidation }`
- **`akn_verify`** — `{ targetId, verifierDid, verdict, evidence }` → `{ status, invalidated[] }`

Other plugins: `const akn = ctx.akn; akn.search({...})`.

## Development

```sh
npm install
npm run build        # tsc -> lib/
npm run typecheck
node smoke-test.js   # 14 runtime checks (content addressing / cascade / truncation)
```

## Iron rules (enforced by Zod + service logic)

1. **Structured first** — every KO passes `PublishInputSchema`; no loose JSON.
2. **Content-addressed** — body drives the id; verification/status live in meta.
3. **High signal-to-noise** — slim search projection by default.
4. **Verification ≠ content** — trust from reproducible records, not publishers.
5. **Cascade invalidation** — the reverse index makes refutations propagate.

## License

MIT
