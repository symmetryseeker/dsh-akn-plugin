/**
 * tools/publish.tool.ts — akn_publish.
 *
 * Agents (or auto-capture) commit knowledge to the network. The id is always
 * derived from the body; a `refuted` upstream in links.basis forces the new KO
 * to `needs_verification`.
 */

import { z } from "zod";
import { AknService } from "../core/service";
import { AknBodySchema, AknEnvironmentSchema, AknLinksSchema, AknStatusSchema } from "../core/types";

export const PublishToolParams = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  body: AknBodySchema,
  /** Optional; when omitted the current runtime environment is captured. */
  environment: AknEnvironmentSchema.optional(),
  links: AknLinksSchema.optional(),
  tags: z.array(z.string()).optional(),
  status: AknStatusSchema.optional(),
});

export type PublishToolArgs = z.infer<typeof PublishToolParams>;

export function buildPublishTool(service: AknService) {
  return {
    name: "akn_publish",
    description:
      "Publish a knowledge object (KO) to the Agent Knowledge Network. The KO id is the sha256 content-hash of its body (edits create new ids; old versions are retained). If any upstream id listed in links.basis is refuted, the new KO is demoted to needs_verification.",
    parameters: PublishToolParams,
    execute: async (args: PublishToolArgs) => {
      const result = service.publish({
        title: args.title,
        summary: args.summary,
        body: args.body,
        environment: args.environment ?? service.currentEnvironment(),
        links: args.links,
        tags: args.tags,
        status: args.status,
      });
      return {
        id: result.id,
        status: result.status,
        inheritedInvalidation: result.inheritedInvalidation,
        title: result.ko.title,
        summary: result.ko.summary,
      };
    },
  };
}
