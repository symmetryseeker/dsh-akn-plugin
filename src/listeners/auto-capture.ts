/**
 * listeners/auto-capture.ts — "tool-call-as-knowledge".
 *
 * The killer feature that makes the AKN unavoidable: every tool call the agent
 * makes is harvested into a content-addressed KO automatically. Because KO ids
 * are content hashes, repeated identical calls dedupe for free.
 *
 * Hard rule: capture must NEVER break the agent main loop. Every handler is
 * wrapped so any failure degrades to a warn log only.
 */

import type { Context } from "@deepseek-ai/cordis";

import { AknService } from "../core/service";
import { ToolCallRecordV1, NegativeKnowledgeV1 } from "../core/types";

export interface AutoCaptureConfig {
  autoPublish: boolean;
}

/** Meta-tools we never self-capture (they ARE the AKN — avoid noise/loops). */
const SKIP_TOOL_NAMES = new Set(["akn_search", "akn_publish", "akn_verify"]);

/** Keep summaries token-cheap for the search projection. */
const MAX_SUMMARY_CHARS = 320;

function toCompactString(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    if (s === undefined) return String(value);
    return s.length > MAX_SUMMARY_CHARS
      ? s.slice(0, MAX_SUMMARY_CHARS) + "…"
      : s;
  } catch {
    return String(value);
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function toolNameOf(payload: Record<string, unknown>): string {
  return asString(payload.toolName ?? payload.name ?? payload.tool ?? "unknown-tool");
}

/** Tolerate multiple dsh event shapes: input/args, output/result, error/message. */
function pick(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) return payload[key];
  }
  return undefined;
}

/** cordis types ctx.on against its known event map; dsh emits runtime events
 *  like "tool/after" that are not in every published type surface — cast the
 *  registrar so custom-event listeners compile across dsh releases. */
function onEvent(ctx: Context, event: string, handler: (payload: unknown) => void): void {
  (ctx.on as (event: string, handler: (payload: unknown) => void) => void)(event, handler);
}

function durationOf(payload: Record<string, unknown>): number {
  const d = payload.durationMs ?? payload.duration;
  const n = typeof d === "number" ? d : Number(d);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function mountAutoCapture(
  ctx: Context,
  service: AknService,
  config: AutoCaptureConfig,
): void {
  const enabled = config.autoPublish === true;

  const publishToolCall = (payload: Record<string, unknown>, ok: boolean, error?: string): void => {
    const toolName = toolNameOf(payload);
    if (SKIP_TOOL_NAMES.has(toolName)) return;

    const body: ToolCallRecordV1 = {
      type: "tool-call",
      toolName,
      input: pick(payload, ["input", "args"]),
      output: ok ? pick(payload, ["output", "result"]) : undefined,
      durationMs: durationOf(payload),
      ok,
      error,
    };
    const summary = `${toolName} ${ok ? "ok" : "FAILED"}: ${toCompactString(ok ? payload.output : error)}`;

    service.publish({
      title: `tool:${toolName} ${ok ? "ok" : "failed"}`,
      summary,
      body,
      environment: service.currentEnvironment(),
      source: { capture: ok ? "tool/after" : "tool/after(error)" },
      status: "proposed",
    });
  };

  const publishNegative = (payload: Record<string, unknown>): void => {
    const toolName = toolNameOf(payload);
    if (SKIP_TOOL_NAMES.has(toolName)) return;

    const body: NegativeKnowledgeV1 = {
      type: "negative-knowledge",
      toolName,
      error: asString(payload.error ?? payload.message ?? "unknown error"),
      stack: payload.stack ? asString(payload.stack).slice(0, 2000) : undefined,
      mitigation: payload.mitigation ? asString(payload.mitigation) : undefined,
    };

    service.publish({
      title: `negative:${toolName}`,
      summary: `FAILED ${toolName}: ${body.error.slice(0, MAX_SUMMARY_CHARS)}`,
      body,
      environment: service.currentEnvironment(),
      source: { capture: "tool/error" },
      status: "proposed",
    });
  };

  if (!enabled) return;

  // --- successful / completed calls -------------------------------------
  onEvent(ctx, "tool/after", (payload) => {
    try {
      const p = (payload ?? {}) as Record<string, unknown>;
      if (p.error !== undefined && p.error !== null && p.error !== "") return; // handled by tool/error
      publishToolCall(p, true);
    } catch (error) {
      console.warn("[akn] auto-capture tool/after failed:", error);
    }
  });

  // --- failed calls → NegativeKnowledge --------------------------------
  onEvent(ctx, "tool/error", (payload) => {
    try {
      publishNegative((payload ?? {}) as Record<string, unknown>);
    } catch (error) {
      console.warn("[akn] auto-capture tool/error failed:", error);
    }
  });
}
