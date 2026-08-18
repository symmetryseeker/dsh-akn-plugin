/**
 * core/service.ts — the AKN business brain.
 *
 * Owns the four iron rules:
 *   1. Structured-first        — every publish is Zod-validated.
 *   2. Content-addressed       — id = sha256(canonical(body)); edits fork new ids.
 *   3. Token economy           — search truncation lives in tools/, ordering here.
 *   4. Verification/content separation + cascade invalidation.
 *
 * The service is framework-agnostic (depends only on IAknStorage + types), so
 * it can be unit-tested in isolation; cordis wiring happens in src/index.ts.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

import {
  AknBodySchema,
  AknEnvironment,
  AknEnvironmentSchema,
  AknLinksSchema,
  AknSourceSchema,
  AknStatus,
  AknStatusSchema,
  KO,
  STATUS_RANK,
  VerificationV1,
} from "./types";
import { IAknStorage } from "./storage";

/* ------------------------------------------------------------------ *
 * public shapes
 * ------------------------------------------------------------------ */

export type AknPublishInput = z.infer<typeof PublishInputSchema>;

export interface PublishResult {
  id: string;
  status: AknStatus;
  /** True when an upstream refutation forced the status to needs_verification. */
  inheritedInvalidation: boolean;
  ko: KO;
}

export interface InvalidationChange {
  id: string;
  from: AknStatus;
  to: AknStatus;
}

export interface VerifyResult {
  ko: KO;
  verification: VerificationV1;
  invalidated: InvalidationChange[];
}

export interface DriftMismatch {
  tool: string;
  recorded: string;
  current: string;
}

export interface DriftReport {
  id: string;
  mismatches: DriftMismatch[];
}

export interface SearchOptions {
  limit?: number;
  statusRank?: Record<AknStatus, number>;
  /** When true, environment drift auto-marks results as stale. */
  driftCheck?: boolean;
  currentEnv?: AknEnvironment;
}

/* ------------------------------------------------------------------ *
 * schema for what a caller may submit
 * ------------------------------------------------------------------ */

const PublishInputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  body: AknBodySchema,
  environment: AknEnvironmentSchema,
  links: AknLinksSchema.optional(),
  tags: z.array(z.string()).optional(),
  source: AknSourceSchema.optional(),
  status: AknStatusSchema.optional(),
});

/** Deterministic key-sorted JSON — makes content addressing order-independent. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue; // drop undefined → stable hash
      out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function hashBody(body: KO["body"]): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Best-effort environment snapshot from the current process. */
export function buildEnvironment(
  extraTools: Record<string, string> = {},
): AknEnvironment {
  return {
    os: `${process.platform}${process.arch ? " " + process.arch : ""}${
      process.version ? " (node " + process.version + ")" : ""
    }`,
    toolVersions: { node: process.version, ...extraTools },
    dataTime: nowIso(),
  };
}

/* ------------------------------------------------------------------ *
 * AknService
 * ------------------------------------------------------------------ */

export class AknService {
  constructor(
    private readonly storage: IAknStorage,
    /** Injected by the cordis assembly; falls back to process defaults. */
    private readonly resolveEnvironment: () => AknEnvironment = buildEnvironment,
  ) {}

  /** Total KO count — used for cold-start detection. */
  size(): number {
    return this.storage.size();
  }

  /** Snapshot of the current runtime environment (OS + tool versions). */
  currentEnvironment(): AknEnvironment {
    return this.resolveEnvironment();
  }

  /**
   * Publish a validated input. id is always derived from the body:
   * `id = sha256(canonical(JSON.stringify(body)))`. When any upstream in
   * links.basis is `refuted`, the new KO is forced to `needs_verification`
   * (verification & content stay separate; trust is inherited, not owned).
   */
  publish(input: unknown): PublishResult {
    const parsed = PublishInputSchema.parse(input);
    const id = hashBody(parsed.body);

    // Trust-model gate: a publisher may only declare `draft` or `proposed`.
    // `verified` / `refuted` / `stale` / `needs_verification` are state
    // transitions owned by verify()/drift/cascade — never settable at publish
    // time, otherwise any agent could self-certify a KO as verified.
    let status: AknStatus = "proposed";
    if (parsed.status === "draft") status = "draft";

    let inheritedInvalidation = false;

    for (const basisId of parsed.links?.basis ?? []) {
      const upstream = this.storage.get(basisId);
      if (upstream && upstream.status === "refuted") {
        status = "needs_verification";
        inheritedInvalidation = true;
        break;
      }
    }

    const ko: KO = {
      id,
      title: parsed.title,
      summary: parsed.summary,
      body: parsed.body,
      status,
      environment: parsed.environment,
      links: parsed.links ?? { basis: [], refutes: [] },
      verifications: [],
      tags: parsed.tags ?? [],
      source: parsed.source,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.storage.save(ko);
    return { id, status, inheritedInvalidation, ko };
  }

  get(id: string): KO | undefined {
    return this.storage.get(id);
  }

  /**
   * Search with the hard ordering:
   * verified > proposed > needs_verification > stale > draft (refuted lowest).
   * Optional environment-drift check marks stale results before returning.
   */
  search(
    query: Parameters<IAknStorage["search"]>[0],
    options: SearchOptions = {},
  ): KO[] {
    return this.searchWithMeta(query, options).items;
  }

  /** search + a real `truncated` signal so tools can report cut results. */
  searchWithMeta(
    query: Parameters<IAknStorage["search"]>[0],
    options: SearchOptions = {},
  ): { items: KO[]; truncated: boolean } {
    const results = this.storage.search(query);
    const rank = options.statusRank ?? STATUS_RANK;

    if (options.driftCheck && options.currentEnv) {
      for (const ko of results) this.detectDrift(ko.id, options.currentEnv);
    }

    // Hard rank first; newest-first as a secondary key so same-rank results
    // keep a stable order regardless of Map insertion order.
    results.sort((a, b) => {
      const byRank = (rank[a.status] ?? 99) - (rank[b.status] ?? 99);
      return byRank !== 0 ? byRank : b.createdAt.localeCompare(a.createdAt);
    });

    const limit = options.limit ?? Infinity;
    const truncated = limit !== Infinity && results.length > limit;
    const items = limit === Infinity ? results : results.slice(0, limit);
    return { items, truncated };
  }

  /**
   * Append a VerificationV1 record and flip status. A `false` verdict makes
   * the target `refuted` and cascades invalidation to every direct & indirect
   * dependent through the reverse index.
   */
  verify(
    targetId: string,
    verifierDid: string,
    verdict: boolean,
    evidence: string,
  ): VerifyResult {
    const ko = this.storage.get(targetId);
    if (!ko) {
      throw new Error(`akn: no KO with id ${targetId}`);
    }

    const verification: VerificationV1 = {
      verifierDid,
      verdict,
      evidence,
      createdAt: nowIso(),
    };
    const updated: KO = {
      ...ko,
      status: verdict ? "verified" : "refuted",
      verifications: [...ko.verifications, verification],
      updatedAt: nowIso(),
    };
    this.storage.save(updated);

    const invalidated = verdict
      ? []
      : this.propagateInvalidation(targetId);

    return { ko: updated, verification, invalidated };
  }

  /**
   * Cascade invalidation: BFS over the reverse index so indirect dependents
   * (a depends on b, b depends on refuted c) are also demoted. Returns a
   * change log of every demotion.
   */
  propagateInvalidation(rootId: string): InvalidationChange[] {
    const changes: InvalidationChange[] = [];
    const queue: string[] = [rootId];
    const visited = new Set<string>([rootId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dependentId of this.storage.dependents(current)) {
        if (visited.has(dependentId)) continue;
        visited.add(dependentId);

        const downstream = this.storage.get(dependentId);
        if (!downstream || downstream.status === "needs_verification") continue;

        const change: InvalidationChange = {
          id: downstream.id,
          from: downstream.status,
          to: "needs_verification",
        };
        this.storage.save({
          ...downstream,
          status: "needs_verification",
          updatedAt: nowIso(),
        });
        changes.push(change);
        queue.push(dependentId);
      }
    }
    return changes;
  }

  /**
   * Environment drift detection: when the recorded toolVersions differ from
   * the current runtime, the KO is demoted to `stale` (opt-in).
   */
  detectDrift(id: string, currentEnv: AknEnvironment): DriftReport | undefined {
    const ko = this.storage.get(id);
    if (!ko) return undefined;

    const mismatches: DriftMismatch[] = [];
    for (const [tool, recorded] of Object.entries(ko.environment.toolVersions)) {
      const current = currentEnv.toolVersions[tool];
      if (current !== undefined && current !== recorded) {
        mismatches.push({ tool, recorded, current });
      }
    }
    if (mismatches.length === 0) return undefined;

    this.storage.save({ ...ko, status: "stale", updatedAt: nowIso() });
    return { id, mismatches };
  }

  /** Iterate all KOs (drift scans / stats / export). */
  values(): IterableIterator<KO> {
    return this.storage.values();
  }
}
