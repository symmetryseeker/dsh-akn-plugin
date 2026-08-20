# Migration to the Agent Experience Network

On 2026-08-20 this repository replaced its original proof-of-concept implementation with the reviewed public source tree of the Agent Experience Network (AEN) and AEXP 0.1 reference implementation.

## Provenance

- Last commit of the original `dsh-akn-plugin` implementation: `e442db09d48bc42efa4dfff1e696cf068487d1ad`.
- Reviewed AEN source snapshot: `0f37ae78dc9e95dd6ff01529ea770034950a31fd`.
- Import method: tracked files from the reviewed source commit were exported without its `.git` directory, then committed on top of this repository's existing public history.

The private development repository and its deleted drafts were not imported. The original plugin remains recoverable from this repository's Git history.

## Conceptual change

The original proof of concept treated each tool call as a knowledge object. AEN deliberately does not do that. The current design:

- reuses DeepSeek Harness durable Trace as one evidence source instead of building a second full Trace collector;
- captures low-frequency live Harness Manifest data that Trace alone cannot establish, including effective Skill, tool, prompt, model-route, policy, and environment configuration;
- selects task-level episodes and distills only high-value, reviewed experiences with positive and negative cases;
- scopes claims to `Model × Harness × Environment`, with cost, latency, evidence strength, and applicability boundaries;
- keeps evidence private by default and requires explicit human review and Promotion before public contribution.

## Packaging compatibility

The repository root is still an installable DeepSeek Harness bundle named `dsh-akn-plugin`. Its root Cordis patch maps the public package subpaths to the AEN Policy, Provider, and optional Tools roles. The monorepo remains available for protocol, CLI, Hub, evaluation, conformance, and adapter development.

## Licensing

The original implementation remains available in earlier history under the MIT license that accompanied it. The imported AEN source tree and subsequent work are licensed under Apache-2.0 as stated in the current [LICENSE](./LICENSE).
