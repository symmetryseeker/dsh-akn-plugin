/**
 * core/types.ts — the AKN "constitution".
 *
 * Every Knowledge Object (KO) must pass a strict Zod schema before it may be
 * stored. There is no free-form JSON in the AKN. Content is content-addressed
 * and immutable: `ko.id = sha256(JSON.stringify(ko.body))`. A change to the
 * body produces a new id; the old version is retained forever for provenance.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ *
 * status — lifecycle state of a knowledge object
 * ------------------------------------------------------------------ */

export const AKN_STATUS = [
  "draft",
  "proposed",
  "verified",
  "refuted",
  "stale",
  "needs_verification",
] as const;

export const AknStatusSchema = z.enum(AKN_STATUS);

export type AknStatus = z.infer<typeof AknStatusSchema>;

/* ------------------------------------------------------------------ *
 * environment — under which conditions a fact was observed
 * ------------------------------------------------------------------ */

export const AknEnvironmentSchema = z.object({
  /** Human-readable OS description, e.g. "win32 10.0.26200" */
  os: z.string(),
  /** Tool name -> version snapshot, e.g. { node: "v24.14.1", glob: "10.4.0" } */
  toolVersions: z.record(z.string(), z.string()),
  /** Optional ISO timestamp captured at observation time */
  dataTime: z.string().optional(),
});

export type AknEnvironment = z.infer<typeof AknEnvironmentSchema>;

/* ------------------------------------------------------------------ *
 * verification — trust comes from reproducible verification records,
 * never from the publisher's authority.
 * ------------------------------------------------------------------ */

export const VerificationV1 = z.object({
  /** DID / verifier identity — who performed the check */
  verifierDid: z.string(),
  /** true = verified, false = refuted (triggers cascade invalidation) */
  verdict: z.boolean(),
  /** Reproducible evidence (repro steps, logs, artifact link) */
  evidence: z.string(),
  /** ISO timestamp */
  createdAt: z.string(),
});

export type VerificationV1 = z.infer<typeof VerificationV1>;

/* ------------------------------------------------------------------ *
 * links — the dependency graph of the AKN
 * ------------------------------------------------------------------ */

export const AknLinksSchema = z.object({
  /** Upstream KO ids this object's claim depends on (truth inherited from). */
  basis: z.array(z.string()).default([]),
  /** KO ids this object directly refutes (counter-evidence targets). */
  refutes: z.array(z.string()).default([]),
});

export type AknLinks = z.infer<typeof AknLinksSchema>;

/* ------------------------------------------------------------------ *
 * body variants — discriminated by `type`
 * ------------------------------------------------------------------ */

/** A successful or failed tool invocation (auto-captured by listeners). */
export const ToolCallRecordV1 = z.object({
  type: z.literal("tool-call"),
  toolName: z.string().min(1),
  /** Serialized tool input (args). Must be JSON-serializable. */
  input: z.unknown(),
  /** Serialized tool output (result). Must be JSON-serializable. */
  output: z.unknown(),
  /** Wall-clock duration in milliseconds. */
  durationMs: z.number().nonnegative(),
  ok: z.boolean(),
  /** Present when ok === false. */
  error: z.string().optional(),
});

export type ToolCallRecordV1 = z.infer<typeof ToolCallRecordV1>;

/** Simplified record for failures — "don't do this" knowledge. */
export const NegativeKnowledgeV1 = z.object({
  type: z.literal("negative-knowledge"),
  toolName: z.string().min(1),
  error: z.string(),
  stack: z.string().optional(),
  /** Known workaround / mitigation, if discovered. */
  mitigation: z.string().optional(),
});

export type NegativeKnowledgeV1 = z.infer<typeof NegativeKnowledgeV1>;

/** A bounty / intent the network wants an agent to satisfy. */
export const TaskIntentV1 = z.object({
  type: z.literal("task-intent"),
  intent: z.string().min(1),
  /** Machine-checkable acceptance criteria. */
  criteria: z.array(z.string()).min(1),
  /** Optional reward description. */
  reward: z.string().optional(),
});

export type TaskIntentV1 = z.infer<typeof TaskIntentV1>;

export const AknBodySchema = z.discriminatedUnion("type", [
  ToolCallRecordV1,
  NegativeKnowledgeV1,
  TaskIntentV1,
]);

export type AknBody = z.infer<typeof AknBodySchema>;

/* ------------------------------------------------------------------ *
 * provenance — who/what produced this KO
 * ------------------------------------------------------------------ */

export const AknSourceSchema = z.object({
  agentId: z.string().optional(),
  /** Cordis event source, e.g. "tool/after" or "tool/error". */
  capture: z.string().optional(),
});

export type AknSource = z.infer<typeof AknSourceSchema>;

/* ------------------------------------------------------------------ *
 * KO — the full knowledge object (meta + body + verification trail)
 * ------------------------------------------------------------------ */

export const AknCommonMeta = z.object({
  /** Content hash: sha256(JSON.stringify(body)). 64 lowercase hex chars. */
  id: z.string().regex(/^[0-9a-f]{64}$/, "KO.id must be a sha256 hex digest"),
  title: z.string().min(1),
  summary: z.string().min(1),
  body: AknBodySchema,
  status: AknStatusSchema,
  environment: AknEnvironmentSchema,
  links: AknLinksSchema,
  /** Append-only verification trail. */
  verifications: z.array(VerificationV1).default([]),
  /** Optional classifier tags used by akn_search multi-field filters. */
  tags: z.array(z.string()).default([]),
  source: AknSourceSchema.optional(),
  /** ISO timestamp of creation. */
  createdAt: z.string(),
  /** ISO timestamp of last mutation (status/verifications only; never body). */
  updatedAt: z.string(),
});

/** The canonical Knowledge Object type. */
export type KO = z.infer<typeof AknCommonMeta>;

/* ------------------------------------------------------------------ *
 * query / filter shapes
 * ------------------------------------------------------------------ */

export interface AknSearchFilters {
  type?: AknBody["type"];
  status?: AknStatus | AknStatus[];
  tags?: string[];
}

export interface AknSearchQuery {
  filters: AknSearchFilters;
  /** Substring match against title and summary (case-insensitive). */
  keyword?: string;
}

/** The hard ordering used by akn_search (lower = surfaces first). */
export const STATUS_RANK: Record<AknStatus, number> = {
  verified: 0,
  proposed: 1,
  needs_verification: 2,
  stale: 3,
  draft: 4,
  refuted: 5,
};
