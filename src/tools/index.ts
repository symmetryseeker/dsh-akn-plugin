/**
 * tools/index.ts — register the AKN tool set into the harness.
 *
 * Tools are built with `defineTool` from @deepseek-ai/dsh-tools (the same
 * helper the harness itself uses), so the compiled JSON-Schema parameters and
 * output are guaranteed to satisfy `ctx.tools.register`. Registration is
 * wrapped in `ctx.effect` for proper dispose-on-unload.
 */

import type { Context } from "@deepseek-ai/cordis";

import { AknService } from "../core/service";
import { buildSearchTool } from "./search.tool";
import { buildPublishTool } from "./publish.tool";
import { buildVerifyTool } from "./verify.tool";

export interface RegisterToolsOptions {
  /** Default result limit for akn_search when the agent omits it. */
  searchDefaultLimit?: number;
  /** Hard ordering override from config. */
  statusRank?: Record<string, number>;
  /** Default drift check for akn_search when the agent omits it. */
  driftCheckOnSearch?: boolean;
}

export function registerAknTools(
  ctx: Context,
  service: AknService,
  options: RegisterToolsOptions = {},
): void {
  const tools = [
    buildSearchTool(service, {
      defaultLimit: options.searchDefaultLimit,
      statusRank: options.statusRank,
      defaultDriftCheck: options.driftCheckOnSearch,
    }),
    buildPublishTool(service),
    buildVerifyTool(service),
  ];

  // ctx.tools is the harness tool registry injected by dsh at runtime; the
  // cordis Context type doesn't know about it, so access it via a structural
  // cast. Registering under an existing name replaces it (hot-reload safe).
  // The effect callback runs on apply and its returned disposer (from register)
  // runs on unload; we ignore the value, so the callback returns void.
  const withTools = ctx as unknown as { tools?: { register(tool: unknown): any } };
  const registry = withTools.tools ?? { register: () => undefined };
  for (const tool of tools) {
    // The effect callback's return value is the disposer; register() returns
    // one, which cordis runs on unload to unregister the tool.
    ctx.effect(() => registry.register(tool));
  }
}
