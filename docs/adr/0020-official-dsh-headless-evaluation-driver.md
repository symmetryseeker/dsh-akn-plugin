# ADR-0020: Official DSH headless evaluation driver and evidence boundary

> Maturity: AEXP 0.1 Draft / AEN Pilot
>
> Status: Accepted
>
> Date: 2026-08-20

## Context

The comparative runner previously accepted only synthetic, recorded, or user-authored driver modules. It could validate statistical semantics but did not itself invoke DeepSeek Harness. A live driver also cannot treat every evaluation run as an ordinary high-value recovery candidate: a valid scheduled baseline may contain no failure/recovery chain, yet its result is still required experiment evidence.

A second conflict appeared when a matrix cell used a complete `HarnessManifest.digest` as its Harness coordinate. Live capture includes session and time scope, so the representative Manifest and the actual trial Manifest are expected to differ even when the effective Harness configuration is identical.

## Decision

1. `@aen/dsh-plugin/evaluation-driver` is an installable, self-contained library subpath. `aen evaluate` can select it with `--dsh-driver-config` and a user-selected local trusted grader; arbitrary trusted driver modules remain supported.
2. The driver invokes only the official `dsh --profile headless` executable with argument arrays, never a shell. It requires the AEN bundle to be installed and enabled in that profile.
3. Each trial gets a fresh temporary workspace, an exact Benchmark-digest fixture mapping and an exact stable Harness-configuration-digest patch mapping. Copy fixtures reject symlinks and their source-tree digest must be bound by a Benchmark Artifact.
4. The driver forces the authoritative DSH plaintext JSONL session exporter and the AEN Provider to a durable private trial directory/store. Exactly one `session.jsonl` is imported; its session ID must correlate with exactly one live Manifest whose `configurationDigest` equals the scheduled cell.
5. A cell freezes both `harnessConfigurationDigest` and a reviewed representative `harnessManifestDigest`. The actual RunObservation records the stable configuration digest plus the new run-local Manifest digest. Changing only time, session, cwd, or Model route cannot create a new Harness cell.
6. Treatment resolves one exact immutable task-scoped Experience, builds a Task Capsule and Context Plan, and records a `ContextInjectionObservation`. Only card, recipe and cases may enter the prompt. Evidence bodies, artifacts, repro commands and remote content are not injected or executed.
7. The grader is a local module explicitly selected by the operator. Its returned grader digest must be declared by the Benchmark and resolve to a local `GraderDefinition`; criterion results must exactly cover the frozen acceptance criteria.
8. An explicitly scheduled evaluation trial is itself a high-value task episode. The adapter may therefore create a metadata-only TaskEpisode/TraceEvidence pair for it even when normal recovery triggers do not fire. Raw prompt, tool arguments/results and trace bytes stay local; the protocol evidence carries commitments and a local locator only.
9. Timeout, output, model-call, tool-call and cost gates fail closed into distinct trial statuses. Missing cost measurement under a declared maximum is a grader error, not zero cost.

## Consequences

- The repository now has a production-shaped DeepSeek Harness execution seam instead of only a runner interface.
- A real official DSH-host smoke with a local mock OpenAI-compatible model proves installation, capture, digest-bound fixture copying, correlation, grading, direct library use and the user-facing `aen evaluate --dsh-driver-config` path. It does **not** prove real-model quality, causal uplift, H3, or the external 2×2×2 Pilot.
- Public promotion remains separate and explicit. The driver cannot turn private trace data into public Experience content.
- Harness configuration comparisons remain reproducible across trial-local Manifest snapshots without discarding exact audit provenance.
