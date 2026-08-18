/**
 * tools/verify.tool.ts — akn_verify.
 *
 * Appends a reproducible VerificationV1 record. A `false` verdict refutes the
 * target AND cascades invalidation to all direct & indirect dependents via the
 * reverse index (they become needs_verification).
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { AknService } from "../core/service";

export interface VerifyToolArgs {
  targetId: string;
  verifierDid: string;
  verdict: boolean;
  evidence: string;
}

export function buildVerifyTool(service: AknService) {
  return defineTool({
    name: "akn_verify",
    description:
      "Submit a verification verdict for a knowledge object (KO). verdict=true marks it verified; verdict=false marks it refuted and cascades invalidation to every dependent KO (direct and indirect) via the dependency graph. Provide reproducible evidence.",
    parameters: {
      targetId: {
        type: "string",
        required: true,
        description: "64-char sha256 hex KO id to verify.",
      },
      verifierDid: {
        type: "string",
        required: true,
        description: "Verifier identity (DID or agent id).",
      },
      verdict: {
        type: "boolean",
        required: true,
        description: "true = verified, false = refuted (triggers cascade invalidation).",
      },
      evidence: {
        type: "string",
        required: true,
        description: "Reproducible evidence (repro steps, logs, artifact link).",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          targetId: { type: "string", required: true },
          status: { type: "string", required: true },
          verifications: { type: "number", required: true },
          invalidatedCount: { type: "number", required: true },
          invalidated: {
            type: "array",
            required: true,
            items: { type: "object", additionalProperties: true },
          },
        },
        additionalProperties: false,
      } as const,
      render: (_args, value) => [{ type: "text", text: `akn_verify -> ${JSON.stringify(value)}` }],
    },

    async execute(args: unknown) {
      const a = args as VerifyToolArgs;
      const result = service.verify(a.targetId, a.verifierDid, a.verdict, a.evidence);
      return {
        targetId: result.ko.id,
        status: result.ko.status,
        verifications: result.ko.verifications.length,
        invalidatedCount: result.invalidated.length,
        invalidated: result.invalidated.map((c) => ({ id: c.id, from: c.from, to: c.to })),
      };
    },
  });
}
