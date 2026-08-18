/**
 * src/index.ts — the single entry point.
 *
 * Assembly order (fixed by the blueprint):
 *   Storage → Service → Tools → Listeners → seed bootstrap
 *
 * The service is exposed to the rest of DSH via `ctx.provide('akn', service)`
 * so any other plugin can call `ctx.akn.search()` directly.
 */

import type { Context } from "@deepseek-ai/cordis";

import { MemoryStorage } from "./core/storage";
import { AknService } from "./core/service";
import { buildEnvironment } from "./core/service";
import { registerAknTools } from "./tools";
import { mountAutoCapture } from "./listeners/auto-capture";
import { seedKOList } from "./bundles/seed";
import { taskKOList } from "./bundles/tasks";
import { STATUS_RANK, type AknStatus } from "./core/types";

export const name = "akn";

export interface AknPluginConfig {
  /** Harvest every tool call into a content-addressed KO (default true). */
  autoPublish: boolean;
  /** Publish the 3 bounty intents on cold start (default true). */
  bootstrapTasks: boolean;
  /** Inject the 20+ adversarial seeds when storage is empty (default true). */
  bootstrapSeeds: boolean;
  /** Default result cap for akn_search (default 20). */
  searchDefaultLimit: number;
  /** Auto-demote drifted results to stale on search (default false). */
  driftCheckOnSearch: boolean;
  /** Hard ordering for search; lower rank surfaces first. */
  statusRank: Record<AknStatus, number>;
}

export type { AknService, AknPublishInput, PublishResult, VerifyResult, InvalidationChange } from "./core/service";
export type { KO, AknStatus, AknBody, VerificationV1, ToolCallRecordV1, NegativeKnowledgeV1 } from "./core/types";
export { MemoryStorage } from "./core/storage";
export { STATUS_RANK } from "./core/types";

const DEFAULTS: AknPluginConfig = {
  autoPublish: true,
  bootstrapTasks: true,
  bootstrapSeeds: true,
  searchDefaultLimit: 20,
  driftCheckOnSearch: false,
  statusRank: STATUS_RANK,
};

/** Make `ctx.akn` type-safe for every other DSH plugin. */
declare module "@deepseek-ai/cordis" {
  interface Context {
    akn: AknService;
  }
}

export function apply(ctx: Context, rawConfig: Partial<AknPluginConfig> = {}): void {
  const config: AknPluginConfig = { ...DEFAULTS, ...rawConfig };

  // ---- 1. storage -----------------------------------------------------
  const storage = new MemoryStorage();

  // ---- 2. service -----------------------------------------------------
  // Environment is resolved from the harness runtime when available, with a
  // process-based fallback so the service works outside DSH too.
  const resolveEnvironment = (): ReturnType<typeof buildEnvironment> => {
    const runtime = (ctx as unknown as { runtime?: unknown }).runtime as
      | { os?: string; toolVersions?: Record<string, string>; versions?: Record<string, string> }
      | undefined;
    if (runtime) {
      if (!runtime.os && !runtime.toolVersions && !runtime.versions) {
        console.debug("[akn] ctx.runtime present but missing os/toolVersions — falling back to process");
      }
      return {
        os: runtime.os ?? `${process.platform}${process.arch ? " " + process.arch : ""}`,
        toolVersions: runtime.toolVersions ?? runtime.versions ?? { node: process.version },
        dataTime: new Date().toISOString(),
      };
    }
    console.debug("[akn] ctx.runtime unavailable — using process-based environment");
    return buildEnvironment();
  };

  const service = new AknService(storage, resolveEnvironment);

  // ---- 3. tools -------------------------------------------------------
  registerAknTools(ctx, service, {
    searchDefaultLimit: config.searchDefaultLimit,
    statusRank: config.statusRank,
    driftCheckOnSearch: config.driftCheckOnSearch,
  });

  // ---- 4. listeners ---------------------------------------------------
  mountAutoCapture(ctx, service, { autoPublish: config.autoPublish });

  // ---- 5. seed bootstrap (idempotent, cold-start only) ---------------
  if (config.bootstrapSeeds && storage.size() === 0) {
    for (const seed of seedKOList) {
      try {
        service.publish(seed);
      } catch (error) {
        console.warn("[akn] failed to publish seed:", (error as Error).message);
      }
    }
  }
  if (config.bootstrapTasks) {
    for (const task of taskKOList) {
      try {
        service.publish(task);
      } catch (error) {
        console.warn("[akn] failed to publish task:", (error as Error).message);
      }
    }
  }

  // ---- 6. expose to other plugins -------------------------------------
  // Both paths: the spec'd `ctx.provide('akn', service)` and a direct
  // assignment, so `ctx.akn.search()` works regardless of provide semantics.
  const disposable = ctx.provide("akn", service) as { dispose?: () => void } | undefined;
  (ctx as unknown as { akn: AknService }).akn = service;

  // cordis types ctx.on against its known event map; "dispose" is a runtime
  // lifecycle event not present in every published type surface — cast the
  // registrar to keep the source compatible across dsh releases.
  (ctx.on as (event: string, handler: () => void) => void)("dispose", () => {
    if (disposable && typeof disposable.dispose === "function") disposable.dispose();
  });
}
