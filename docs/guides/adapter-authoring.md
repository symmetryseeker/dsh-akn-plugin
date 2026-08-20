# Harness Adapter authoring guide — AEXP 0.1 Draft/Pilot

An Adapter translates a Harness's authoritative, versioned evidence into shared AEXP objects. It does not invent a new trace recorder, a new Experience schema, or a reason to upload every tool call.

## 1. Choose an authoritative source

Document the Harness name/version, source schema namespace/version, exporter version, event ordering guarantees, redaction behavior, and the exact Adapter mapping profile/version. Fail closed on unsupported source versions. Preserve source paths and whether each mapped field was observed or inferred.

Prefer an existing durable session/export or standard telemetry profile. A live plugin is justified only for fields the trace cannot establish, such as the effective registry, skill package closure, preset composition, system-prompt digest, policy state, or model route. Snapshot those at low-frequency configuration boundaries, not on each tool call.

## 2. Implement the stable interface

Implement `HarnessAdapter` from `@aen/protocol`:

```ts
interface HarnessAdapter {
  identify(): Promise<HarnessIdentity>
  importTrace(input: TraceInput): AsyncIterable<NormalizedEvent>
  deriveEpisodes(events: AsyncIterable<NormalizedEvent>): AsyncIterable<TaskEpisode>
  snapshotManifest?(context: ManifestContext): Promise<HarnessManifest>
  resolveArtifacts?(refs: ArtifactRef[]): Promise<ArtifactDescriptor[]>
}
```

`NormalizedEvent` is an internal mapping boundary, not a public knowledge object. Shared Experience objects remain the protocol types from `@aen/protocol`. Do not put Harness-specific fields at the top level; use a namespaced `extensions` URI only where [AEXP 0.1](../../spec/AEXP-0.1.md) permits it.

The minimal teaching implementation is [`@aen/adapter-sample`](../../packages/adapter-sample/README.md). The production-oriented DSH mapping is [`@aen/adapter-dsh`](../../packages/adapter-dsh/src/adapter.ts).

## 3. Preserve Model + Harness semantics

Trace can show observed behavior but frequently cannot show:

- all available, loaded, or user-invoked skills and their scripts/references/assets;
- declared versus effective tool schemas;
- preset/plugin composition and policy configuration;
- stable Model revision, request configuration, pricing, or rate-limit snapshot;
- an artifact's license and redistributable package closure.

Do not fill those gaps from guesswork. Emit an `EvidenceGapReport`, lower `maximumEvidenceLevel`, and set Manifest coverage per surface. A trace-only manifest must use `coverage.mode=trace_only`. A visible `SKILL.md` without its package closure is partial; it is never a complete skill identity.

Model identity belongs in `RunObservation.configurationCell.model`. Harness configuration belongs in an immutable `HarnessManifest`, and environment belongs in the same configuration cell. Changing the Model must not silently change Harness identity; changing Harness composition must change its stable configuration identity.

## 4. Select high-value episodes

MVP candidate triggers are acceptance/evaluator pass, failure→recovery→retest, controlled comparison, repeated strategy, explicit user pin, or a high-risk failure with a concrete prevention/recovery rule. Ordinary success/failure, turn end, tool-call completion, and LLM self-evaluation are not candidates.

Episode boundaries must be reconstructable from the source. Copy the minimum redacted excerpt necessary for evidence and retain a digest commitment to the local raw trace; never copy full arguments/results into Hub-ready objects.

## 5. Build honest manifests and artifacts

For every source surface, classify coverage as none, partial, surface-only/catalog-only/invoked-only, or complete as the Schema permits. Record limitations. Artifact descriptors require stable identity and digest semantics; do not publish skill bodies without explicit redistribution rights. Use digest/interface metadata when license or confidentiality blocks content.

A native Harness plugin must:

- use official composition/registry/session seams and dispose cleanly;
- snapshot on first effective request and real configuration changes;
- deduplicate by stable configuration digest, not snapshot timestamp;
- perform zero AEN synchronous I/O on ordinary tool-call paths;
- hold no public-promotion signing authority and never auto-upload private evidence.

For DSH, follow the existing [native plugin boundary](../../packages/dsh-plugin/README.md); do not duplicate its session trace.

## 6. Conformance checklist

Add valid and invalid fixtures for source version, ordering, missing fields, partial skill visibility, preset/model/config changes, compaction, secrets/PII, and a normal run that must not produce a candidate. Then verify:

```sh
pnpm --filter @aen/protocol build
pnpm --filter @aen/adapter-sample test
pnpm --filter <your-adapter-package> typecheck
pnpm --filter <your-adapter-package> test
pnpm conformance
```

Every emitted persistable object must pass `validateProtocolObject`. Digests must be created with `finalizeProtocolObject`; public objects must later pass Promotion and Hub signature/reference/license gates. Adapter tests must not modify protocol schemas to make a proprietary payload pass.

## 7. Pull-request evidence

Include the source/mapping version table, declared inference rules, coverage matrix, limitations, privacy threat analysis, ordinary-call no-candidate proof, configuration-change identity proof, secret fixture, performance impact, rollback/uninstall behavior, and commands/output from a real Harness runtime when claiming native integration.
