/**
 * tools/search.tool.ts — akn_search.
 *
 * Token economy: the default result shape is a slim projection
 * `{ id, title, summary, status, environment }`. The bulky `body` is only
 * fetched and merged when `options.includeBody === true`.
 *
 * Schemas use the dsh-tools JSON-Schema dialect (property-map DSL), not Zod —
 * the harness tool registry only accepts JSON Schema.
 */

import { defineTool, type JsonValue } from "@deepseek-ai/dsh-tools";
import { AknService } from "../core/service";
import type { AknBody, AknStatus } from "../core/types";

const BODY_TYPES = ["tool-call", "negative-knowledge", "task-intent"] as const;

export interface SearchToolArgs {
  query: {
    filters?: {
      type?: (typeof BODY_TYPES)[number];
      status?: string[];
      tags?: string[];
    };
    keyword?: string;
  };
  options?: {
    limit?: number;
    includeBody?: boolean;
    driftCheck?: boolean;
  };
}

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

  return defineTool({
    name: "akn_search",
    description:
      "Search the Agent Knowledge Network. Returns content-addressed knowledge objects ranked by trust (verified first). By default only slim fields (id/title/summary/status/environment) are returned to save tokens; pass options.includeBody=true to fetch full bodies.",
    parameters: {
      query: {
        type: "object",
        required: true,
        additionalProperties: false,
        description: "Query filters and keyword.",
        properties: {
          filters: {
            type: "object",
            additionalProperties: false,
            description: "Filters.",
            properties: {
              type: {
                type: "string",
                description: "Body type to restrict to.",
                enum: [...BODY_TYPES],
              },
              status: {
                type: "array",
                description: "Statuses to include (verified/proposed/needs_verification/stale/draft/refuted).",
                items: { type: "string" },
              },
              tags: {
                type: "array",
                description: "Tags to match (any-of).",
                items: { type: "string" },
              },
            },
          },
          keyword: {
            type: "string",
            description: "Case-insensitive substring match against title and summary.",
          },
        },
      },
      options: {
        type: "object",
        additionalProperties: false,
        description: "Search options.",
        properties: {
          limit: { type: "number", description: "Maximum number of results." },
          includeBody: {
            type: "boolean",
            description: "Include the full body of each KO (more tokens).",
          },
          driftCheck: {
            type: "boolean",
            description: "Auto-demote environment-drifted results to stale.",
          },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          count: { type: "number", required: true },
          truncated: { type: "boolean", required: true },
          hits: {
            type: "array",
            required: true,
            items: { type: "object", additionalProperties: true },
          },
        },
        additionalProperties: false,
      } as const,
      render: (_args, value) => [{ type: "text", text: `akn_search -> ${JSON.stringify(value)}` }],
    },

    async execute(args: unknown) {
      const a = args as SearchToolArgs;
      const filters = a.query?.filters;
      const { items, truncated } = service.searchWithMeta(
        {
          filters: {
            type: filters?.type as AknBody["type"] | undefined,
            status: filters?.status as AknStatus | AknStatus[] | undefined,
            tags: filters?.tags,
          },
          keyword: a.query?.keyword,
        },
        {
          limit: a.options?.limit ?? defaultLimit,
          statusRank,
          driftCheck: a.options?.driftCheck ?? defaultDriftCheck,
          currentEnv: service.currentEnvironment(),
        },
      );

      const includeBody = a.options?.includeBody === true;
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

      // Cast to the model-facing output type declared by output.schema (hits
      // are JSON objects per the contract; the concrete AknSearchHit shape is
      // a refinement of that).
      return {
        count: hits.length,
        truncated,
        hits,
      } as unknown as {
        count: number;
        truncated: boolean;
        hits: Array<Record<string, JsonValue>>;
      };
    },
  });
}
