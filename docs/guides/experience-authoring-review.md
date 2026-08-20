# Experience authoring and review guide — AEXP 0.1 Draft/Pilot

An AEN Experience is a reviewed, immutable claim-and-action package scoped to a task and a `Model × Harness × Environment` boundary. It is not a raw trace, transcript summary, tool-call log, skill package, or popularity post.

## 1. Start from verified evidence

The private Distiller consumes a validated `TaskEpisode`, `HarnessManifest`, `TraceEvidenceBundle`, `RunObservation`, referenced `ArtifactDescriptor` objects, and an `EvaluationAggregate` when making comparative claims. Missing inputs must appear in an `EvidenceGapReport`; do not replace them with model reflection.

Good candidates capture a reusable strategy, failure recovery, Harness configuration, Model capability/cost/latency tradeoff, or a Model–Harness interaction. Skip routine tool calls and outcomes that have no actionable boundary.

## 2. Write the revision

Every claim needs:

- a narrow statement and mode (`observational`, `associational`, or `causal`);
- resolvable supporting and contradicting evidence refs;
- falsification conditions;
- an evidence level no higher than the source gap report allows.

Define intended uses, out-of-scope uses, known limitations, known failure modes, applicability selectors, and revalidation triggers. A useful recipe includes preconditions, reviewable steps, checkpoints, fallbacks, stop conditions, and risk classes. Include a positive case and a close negative case or explicit invalid condition; both must refer back to actual evidence.

H1 shows an observed use/outcome but not causality. H2 adds sufficiently identified Model/Harness configuration evidence. Causal wording requires eligible non-synthetic baseline/treatment evidence at H3. Feedback, votes, signatures, or LLM confidence never raise H-level.

## 3. Review locally

```sh
aen import dsh <session-export>
aen episode list
aen distill <episode-id>
aen review <experience-id>
aen review <experience-id> --decision keep-private
```

Review claim/evidence links, Model fingerprint, Harness coverage, Evidence Gaps, negative cases, private fields removed, license/redistribution, risk, and whether the recipe could be misread as executable instructions. Use `--export-edit` and `--replace` to create a new immutable revision; never edit an existing digest in place.

## 4. Request public Promotion

Before public publication, confirm you have the right and consent to distribute the Experience text and every included artifact section. A repository license does not grant rights to customer content, model output, or third-party skill bodies.

```sh
aen init --actor https://github.com/<account> --display-name <name>
aen review <experience-id> --decision request-public
aen promote <experience-id> --public --out contributions/<candidate> --consent <audit-ref>
aen-hub verify --git-root contributions --keys contributions/authorized-keys.json
```

Promotion creates a new public target revision, removes local locators and unlicensed bodies, reruns secret/PII/path/license/consent gates, signs the target and public observations, and emits a closed Git contribution graph. It never mutates the private source. The source-to-target `PromotionRecord` remains in the private audit domain because it can reveal a private digest.

Inspect the generated target and inventory, but do not hand-edit their digest-bearing JSON. Submit the directory through a pull request. A merge means the host accepted distribution; it does not certify the claim as true.

## 5. Consumption and repair

Consumers search with a minimized Task Capsule. Incompatible Model/Harness candidates are excluded before similarity ranking. Clients receive at most three cards, build a budgeted Context Plan, fetch immutable sections just in time, and create a `ContextInjectionObservation` only after successful injection.

Use `viewed`, `rejected`, or `rolled_back` freely as low-trust local feedback. `adopted` requires the injection observation. Helpful/harmful feedback still does not change H-level. A measured post-injection `RunObservation` can support or contradict a claim; preserve both through Contention or a superseding revision.

## Reviewer checklist

- [ ] Model, Harness Manifest, environment, and task scope are explicit.
- [ ] Trace limitations and skill/package visibility are not overstated.
- [ ] Claims resolve to real supporting/contradicting evidence and have falsification conditions.
- [ ] Causal wording has eligible baseline/treatment evidence.
- [ ] Recipe steps are reviewable data and cannot auto-execute.
- [ ] Positive and negative boundaries are visible.
- [ ] Raw prompts, tool payloads, paths, secrets, PII, and private locators are absent.
- [ ] Experience and artifact licenses/consent permit the target visibility.
- [ ] Public target is a new immutable revision with signed, closed references.
- [ ] Revocation and rollback paths are understood.
