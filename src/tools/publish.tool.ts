/**
 * tools/publish.tool.ts — akn_publish.
 *
 * Agents (or auto-capture) commit knowledge to the network. The id is always
 * derived from the body; a `refuted` upstream in links.basis forces the new KO
 * to `needs_verification`. Publishers may only declare `draft`/`proposed` —
 * `verified` and the other states are owned by verify()/drift/cascade.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { AknService } from "../core/service";

export interface PublishToolArgs {
  title: string;
  summary: string;
  body: Record<string, unknown>;
  environment?: Record<string, unknown>;
  links?: { basis?: unknown[]; refutes?: unknown[] };
  tags?: string[];
  status?: string;
}

export function buildPublishTool(service: AknService) {
  return defineTool({
    name: "akn_publish",
    description:
      "Publish a knowledge object (KO) to the Agent Knowledge Network. The KO id is the sha256 content-hash of its body (edits create new ids; old versions are retained). If any upstream id listed in links.basis is refuted, the new KO is demoted to needs_verification.",
    parameters: {
      title: { type: "string", required: true, description: "Short title." },
      summary: { type: "string", required: true, description: "One-line summary (used in search results)." },
      body: {
        type: "object",
        required: true,
        additionalProperties: true,
        description:
          "KO body. Must be a discriminated object with type one of: tool-call (toolName/input/output/durationMs/ok/error?), negative-knowledge (toolName/error/stack?/mitigation?), task-intent (intent/criteria[]/reward?).",
      },
      environment: {
        type: "object",
        additionalProperties: true,
        description: "Optional environment snapshot { os, toolVersions }. Defaults to the current runtime.",
      },
      links: {
        type: "object",
        additionalProperties: false,
        description: "Dependency graph.",
        properties: {
          basis: { type: "array", description: "Upstream KO ids this claim relies on.", items: { type: "string" } },
          refutes: { type: "array", description: "KO ids this object refutes.", items: { type: "string" } },
        },
      },
      tags: { type: "array", description: "Classifier tags.", items: { type: "string" } },
      status: {
        type: "string",
        description: "Initial status. Only draft or proposed is accepted; any other value is forced to proposed.",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          id: { type: "string", required: true },
          status: { type: "string", required: true },
          inheritedInvalidation: { type: "boolean", required: true },
          title: { type: "string", required: true },
          summary: { type: "string", required: true },
        },
        additionalProperties: false,
      } as const,
      render: (_args, value) => [{ type: "text", text: `akn_publish -> ${JSON.stringify(value)}` }],
    },

    async execute(args: unknown) {
      const a = args as PublishToolArgs;
      const result = service.publish({
        title: a.title,
        summary: a.summary,
        body: a.body,
        environment: a.environment ?? service.currentEnvironment(),
        links: a.links,
        tags: a.tags,
        status: a.status,
      });
      return {
        id: result.id,
        status: result.status,
        inheritedInvalidation: result.inheritedInvalidation,
        title: result.ko.title,
        summary: result.ko.summary,
      };
    },
  });
}
