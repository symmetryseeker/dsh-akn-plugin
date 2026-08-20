# AEN Sample Harness Adapter — Draft/Pilot

This package is a deliberately small, non-production implementation of the public `HarnessAdapter` interface. It demonstrates that a community Harness can map a versioned authoritative export into AEXP objects without changing `@aen/protocol` or the Hub.

The sample format accepts ordinary `activity` rows but only creates a `TaskEpisode` for an explicit `learning/candidate` row with one of the MVP high-value reasons. It emits an H0 `EvidenceGapReport` because the teaching format does not contain trace evidence, Model identity, skill closure, or an effective Harness surface. This downgrade is intentional.

Run its conformance checks with:

```sh
pnpm --filter @aen/adapter-sample test
```

Use [the Adapter authoring guide](../../docs/guides/adapter-authoring.md) before adapting the example to a real Harness.
