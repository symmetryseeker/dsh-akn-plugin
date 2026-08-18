/**
 * tools/index.ts — register the AKN tool set into the harness.
 *
 * The tool objects are built as plain descriptors ({ name, description,
 * parameters, execute }) and normalized with an `output` shape so they are
 * compatible with `ctx.tools.register` across DSH releases.
 */

import type { Context } from "@deepseek-ai/cordis";
import { z } from "zod";

import { AknService } from "../core/service";
import { buildSearchTool } from "./search.tool";
import { buildPublishTool } from "./publish.tool";
import { buildVerifyTool } from "./verify.tool";

/** A registered tool must expose an output schema + render for the UI. */
interface AknTool {
  name: string;
  description: string;
  parameters: z.ZodType;
  output: {
    schema: z.ZodType;
    render: (args: unknown, value: unknown) => Array<{ type: "text"; text: string }>;
  };
  execute(args: unknown): Promise<unknown>;
}

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
  const raw = [
    buildSearchTool(service, {
      defaultLimit: options.searchDefaultLimit,
      statusRank: options.statusRank,
      defaultDriftCheck: options.driftCheckOnSearch,
    }),
    buildPublishTool(service),
    buildVerifyTool(service),
  ];

  const tools: AknTool[] = raw.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    output: {
      schema: z.unknown(),
      render: (_args, value) => [
        { type: "text", text: `${t.name} -> ${JSON.stringify(value)}` },
      ],
    },
    execute: t.execute,
  }));

  // ctx.tools is the harness tool registry injected by dsh at runtime; the
  // cordis Context type doesn't know about it, so access it via a structural
  // cast. A tool that already exists (same name) is replaced — idempotent for
  // hot reloads.
  const withTools = ctx as unknown as { tools?: { register(tool: AknTool): unknown } };
  const registry = withTools.tools ?? { register: () => undefined };
  for (const tool of tools) registry.register(tool);
}
