/**
 * tools/verify.tool.ts — akn_verify.
 *
 * Appends a reproducible VerificationV1 record. A `false` verdict refutes the
 * target AND cascades invalidation to all direct & indirect dependents via the
 * reverse index (they become needs_verification).
 */

import { z } from "zod";
import { AknService } from "../core/service";

export const VerifyToolParams = z.object({
  targetId: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "targetId must be a 64-char sha256 hex KO id"),
  verifierDid: z.string().min(1),
  verdict: z.boolean(),
  evidence: z.string().min(1),
});

export type VerifyToolArgs = z.infer<typeof VerifyToolParams>;

export function buildVerifyTool(service: AknService) {
  return {
    name: "akn_verify",
    description:
      "Submit a verification verdict for a knowledge object (KO). verdict=true marks it verified; verdict=false marks it refuted and cascades invalidation to every dependent KO (direct and indirect) via the dependency graph. Provide reproducible evidence.",
    parameters: VerifyToolParams,
    execute: async (args: VerifyToolArgs) => {
      const result = service.verify(
        args.targetId,
        args.verifierDid,
        args.verdict,
        args.evidence,
      );
      return {
        targetId: result.ko.id,
        status: result.ko.status,
        verifications: result.ko.verifications.length,
        invalidatedCount: result.invalidated.length,
        invalidated: result.invalidated.map((c) => ({
          id: c.id,
          from: c.from,
          to: c.to,
        })),
      };
    },
  };
}
