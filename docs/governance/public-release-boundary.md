# Public release boundary

Status: clean public import reviewed on 2026-08-20; one repository-setting hardening item remains

## Purpose

The private development repository historically contained product drafts and internal design-review material. Removing those files from its current tree would not remove them from its existing Git commits. Publishing that repository directly would therefore expose deleted historical content.

For the first public release, the reviewed source tree was exported without the private repository's `.git` directory and imported into the already-public `symmetryseeker/dsh-akn-plugin` repository. That public repository preserves only its own pre-existing plugin history. This document does not authorize changing the private development repository's visibility.

## Public source set

The intended public project contains:

- `spec/`, published Schemas, and conformance vectors;
- source, tests, fixtures that contain only synthetic/reviewed data, and lockfiles;
- README, architecture, concepts, ADRs, guides, Roadmap, contribution and security policy;
- honest engineering evidence and Pilot reports that clearly distinguish mock/synthetic work from live results;
- empty or reviewed public contribution objects and public keys only.

The public project excludes:

- raw product-development drafts, brainstorming, private architecture reviews, and coding-agent instructions;
- raw Trace, prompts, private Skill bodies/resources, local paths, personal/customer data, and SQLite databases;
- publisher private keys, tokens, `.env` files, backups, build output, local upstream checkouts, and release scratch directories;
- unlicensed third-party documents or copied proprietary content.

## Required publication procedure

Choose exactly one approach:

### Option A: clean public repository

1. Export the reviewed `main` tree without `.git` history.
2. Run source-secret, license, link, build, test, conformance, and hostile-input checks on the exported tree.
3. Initialize a new public repository, or import into a reviewed existing public repository whose own history is safe, with a reviewed import commit.
4. Preserve private development history only in the private repository.
5. Record the source commit digest in the public import message and release note.

This is the recommended first-public-release path because it does not rewrite the private audit history and does not expose removed drafts.

### Option B: reviewed history rewrite

1. Inventory every sensitive or non-public path across all refs and tags.
2. Back up the private repository and record the old ref tips.
3. Rewrite history to remove the approved paths and leaked values.
4. expire/repack local and remote objects as permitted by the hosting platform;
5. force-push only after explicit owner approval;
6. clone the rewritten repository into a new directory and repeat the full release audit.

History rewriting is destructive to existing clones and MUST NOT be inferred from a request to “make public.”

## Visibility-change gate

The 2026-08-20 clean import produced the following review record. An unchecked item is an operational follow-up, not an invitation to weaken the source boundary:

- [x] the clean-tree publication procedure is complete and the private `.git` history was not imported;
- [x] no excluded path or operational secret was found in the reviewed public source set or the pre-existing public plugin history;
- [x] all relative Markdown links resolve in the clean import (`pnpm audit:links`);
- [x] `pnpm install --frozen-lockfile`, typecheck, tests, conformance, and build pass;
- [x] source-secret, production-license, and production-vulnerability audits pass;
- [x] fixtures are synthetic or explicitly redistributable;
- [x] README and releases say Draft/Pilot and list real external gates;
- [ ] GitHub private vulnerability reporting is enabled; until the repository owner enables it, [SECURITY.md](../../SECURITY.md) documents the private maintainer fallback;
- [x] repository name, description, topics, default branch, branch protection/rulesets, secret scanning, push protection, and Actions permissions were reviewed;
- [x] no release claims Stable, Product Go, or real-model uplift without published evidence.

## Ongoing rule

Future private design work stays outside the public repository. Accepted decisions enter through a focused ADR, specification change, test, or implementation PR; the private discussion transcript is not required public project content.
