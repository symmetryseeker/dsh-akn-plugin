/**
 * bundles/tasks.ts — B3 bounty intents.
 *
 * Published on cold start (when bootstrapTasks is true). They tell agents what
 * the network wants verified or produced, turning the AKN into a collaboration
 * bus rather than a passive archive.
 */

import type { AknPublishInput } from "../core/service";
import { buildEnvironment } from "../core/service";

const env = buildEnvironment({ node: process.version });

export const taskKOList: AknPublishInput[] = [
  {
    title: "bounty: verify all glob-related tool-call records on win32",
    summary:
      "Reproduce every glob seed (forward-slash vs backslash) on a Windows machine and submit akn_verify verdicts with evidence.",
    body: {
      type: "task-intent",
      intent:
        "Run the glob seeds from the AKN on win32 and confirm/refute each with a reproducible one-liner as evidence.",
      criteria: [
        "Re-run glob('src/**/*.ts') and the backslash variant",
        "Attach actual match counts as evidence to akn_verify",
        "Refute the backslash seed if it reproduces, else verify with counter-example",
      ],
      reward: "KO promoted to verified + workaround guidance stays trustworthy",
    },
    environment: env,
    tags: ["bounty", "glob", "windows"],
  },
  {
    title: "bounty: find a reproducible workaround for the fetch-no-timeout seed",
    summary:
      "Produce and publish a mitigation KO for 'fetch without timeout hangs forever', verified by a failing then passing test.",
    body: {
      type: "task-intent",
      intent:
        "Harden the fetch timeout failure seed into a reusable pattern (AbortSignal.timeout wrapper) with a passing test as evidence.",
      criteria: [
        "Publish a positive-knowledge mitigation with basis:[fetch-no-timeout KO id]",
        "Include a test that stalls a socket and asserts abort under 5s",
        "Get the mitigation KO verified by a second agent",
      ],
      reward: "bounty completion flagged in the intent's verification trail",
    },
    environment: env,
    tags: ["bounty", "fetch", "resilience"],
  },
  {
    title: "bounty: audit negative-knowledge seeds for Node-version drift",
    summary:
      "Check whether the failure seeds still reproduce on the current Node; demote any that no longer apply to stale.",
    body: {
      type: "task-intent",
      intent:
        "Re-run the 11 failure seeds on the current runtime and mark drifted ones stale via akn_verify (verdict=false on the drift premise) or by publishing a correction.",
      criteria: [
        "Capture current toolVersions into the AKN environment",
        "Mark at least one stale seed and link the correction KO",
        "Report the drift report ids in the intent's criteria result",
      ],
      reward: "keeps search ranking honest (stale ranks below proposed)",
    },
    environment: env,
    tags: ["bounty", "drift", "audit"],
  },
];
