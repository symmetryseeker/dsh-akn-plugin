/**
 * tools/search.tool.ts — akn_search.
 *
 * Token economy: the default result shape is a slim projection
 * `{ id, title, summary, status, environment }`. The bulky `body` is only
 * fetched and merged when `options.includeBody === true`.
 */

import { z } from "zod";
import { AknService } from "../core/service";
import { AknStatusSchema } from "../core/types";

const BODY_TYPES = ["tool-call", "negative-knowledge", "task-intent"] as const;

export const SearchToolParams = z.object({
  query: z.object({
    filters: z
      .object({
        type: z.enum(BODY_TYPES).optional(),
        status: z.union([AknStatusSchema, z.array(AknStatusSchema)]).optional(),
        tags: z.array(z.string()).optional(),
      })
      .optional(),
    keyword: z.string().optional(),
  }),
  options: z
    .object({
      limit: z.number().int().positive().max(500).optional(),
      includeBody: z.boolean().optional(),
      driftCheck: z.boolean().optional(),
    })
    .optional(),
});

export type SearchToolArgs = z.infer<typeof SearchToolParams>;

/** Slim projection returned by default — never includes the body. */
export interface AknSearchHit {
  id: string;
  title: string;
  summary: string;
  status: string;
  environment: Record<string, unknown>;
}

export interface SearchToolOptions {
  /** Applied when the agent omits options.limit (token economy default). */
  defaultLimit?: number;
  /** Hard ordering override from config (defaults to the built-in STATUS_RANK). */
  statusRank?: Record<string, number>;
  /** Default drift check when the agent omits options.driftCheck. */
  defaultDriftCheck?: boolean;
}

export function buildSearchTool(service: AknService, toolOptions: SearchToolOptions = {}) {
  const { defaultLimit = 20, statusRank, defaultDriftCheck = false } = toolOptions;
  return {
    name: "akn_search",
    description:
      "Search the Agent Knowledge Network. Returns content-addressed knowledge objects ranked by trust (verified first). By default only slim fields (id/title/summary/status/environment) are returned to save tokens; pass options.includeBody=true to fetch full bodies.",
    parameters: SearchToolParams,
    execute: async (args: SearchToolArgs) => {
      const { items, truncated } = service.searchWithMeta(
        {
          filters: args.query.filters ?? {},
          keyword: args.query.keyword,
        },
        {
          limit: args.options?.limit ?? defaultLimit,
          statusRank,
          driftCheck: args.options?.driftCheck ?? defaultDriftCheck,
          currentEnv: service.currentEnvironment(),
        },
      );

      const includeBody = args.options?.includeBody === true;
      const hits: Array<AknSearchHit | (AknSearchHit & { body: unknown })> = items.map((ko) => {
        const slim: AknSearchHit = {
          id: ko.id,
          title: ko.title,
          summary: ko.summary,
          status: ko.status,
          environment: {
            os: ko.environment.os,
            toolVersions: ko.environment.toolVersions,
            dataTime: ko.environment.dataTime,
          },
        };
        if (includeBody) return { ...slim, body: ko.body };
        return slim;
      });

      return {
        count: hits.length,
        truncated,
        hits,
      };
    },
  };
}
