# AEN concepts

This guide explains the project model without duplicating the normative [AEXP 0.1 specification](../spec/AEXP-0.1.md).

## Experience is not a log entry

A tool call answers “what event occurred?” An Experience answers “what reusable task-level lesson is supported, for which configuration, under which limits?” Most calls are routine and should never enter an experience network.

AEN selects high-value TaskEpisodes such as failure/recovery chains, repeated constraints, policy-safe alternatives, regressions, rollbacks, negative transfer, or explicit evaluations. Distillation proposes a private Experience; it does not automatically publish one.

## Trace is one evidence source

A Harness Trace can usually show requests, model or tool events, timing, outputs, and some activated configuration. It often cannot prove:

- the full effective system prompt;
- every installed and eligible Skill;
- Skill package contents and resources that were never loaded;
- policy and permission state;
- the exact preset/tool registry composition;
- whether the observed success was caused by a Skill or merely correlated with it.

AEN therefore combines authoritative Trace/export evidence with a live Harness Manifest and explicit evaluation. Missing visibility becomes an Evidence Gap instead of an invented fact.

## Model × Harness × Environment

Model quality cannot be evaluated independently of the execution Harness. The same model can behave differently when the Harness changes its system instructions, tools, Skills, memory, context assembly, policy, retry behavior, or orchestration.

Environment remains separate because repository state, dependencies, platform, network, and fixture differences can change the result without any Model or Harness change.

An Experience records all three axes and the task. Cost, latency, rate context, and variability are outcomes/constraints, not hidden inside a single quality score.

## Manifest snapshot versus configuration identity

Each run retains an exact immutable `HarnessManifest.digest`. That snapshot may include time or session scope, so it naturally changes between runs.

Compatibility and evaluation use `HarnessManifest.configurationDigest`, a stable projection of the effective Harness configuration. This lets two runs belong to the same configuration cell without erasing their exact provenance.

## Skill visibility

Four statements have different evidence strength:

1. a Trace mentions a Skill name;
2. a Skill was invoked;
3. a particular Skill identity/version was active;
4. the full Skill package and resource closure was inspected.

AEN never treats these as equivalent. Public Experience can match on artifact identity and digests without publishing private Skill bodies.

## Claims need boundaries and counterexamples

A useful Experience states:

- intended use and non-goals;
- Model/Harness/Environment applicability;
- a recipe or constraint;
- supporting and contradicting evidence;
- positive and near-neighbor negative cases;
- assumptions and falsification conditions;
- cost, latency, risk, and Evidence Gaps.

This makes “do not use this here” as reusable as “this worked here.”

## Promotion is deliberate publication

Private drafts can contain local identifiers and stronger evidence than it is safe to publish. Promotion creates a separate public revision after human review, minimization, redaction, license/consent checks, safe Artifact projection, reference closure, digest finalization, and signing.

A signature identifies the approved bytes and publisher. It does not guarantee that the Experience is correct, current, or safe for another Agent.

## Consumption is budgeted and observable

Discovery sends a minimized Task Capsule, not the raw prompt or workspace. Search first rejects incompatible content, then ranks eligible cards. The Agent reads only selected immutable sections under a Context Plan and records what entered context.

Feedback records decisions such as adoption, rejection, or rollback. A measured result becomes a RunObservation. Neither a view nor a like is treated as proof.

## The network improves through disagreement

New observations append to an existing history. Negative transfer creates contradicting evidence or Contention; it does not overwrite the original revision. A revised Experience can narrow applicability, improve cases, or supersede an older revision while preserving provenance.
