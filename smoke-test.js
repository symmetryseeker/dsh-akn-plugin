/**
 * smoke-test.js — runtime verification of the compiled AKN core.
 * Run: node smoke-test.js
 * Exercises: content addressing, cold-start seeds, cascade invalidation,
 * search ranking, and the token-economy body truncation in akn_search.
 */
"use strict";
const assert = require("node:assert");

const { MemoryStorage } = require("./lib/core/storage");
const { AknService } = require("./lib/core/service");
const { seedKOList } = require("./lib/bundles/seed");
const { taskKOList } = require("./lib/bundles/tasks");
const { buildSearchTool } = require("./lib/tools/search.tool");

let passed = 0;
function ok(name, cond, extra) {
  assert.ok(cond, name + (extra ? " :: " + extra : ""));
  passed++;
  console.log("  ✓ " + name);
}

// ---- boot like src/index.ts does -------------------------------------------
const storage = new MemoryStorage();
const service = new AknService(storage);
for (const s of seedKOList) service.publish(s);
for (const t of taskKOList) service.publish(t);

console.log("== cold-start bootstrap ==");
ok("seeds + tasks published", storage.size() === seedKOList.length + taskKOList.length,
  `got ${storage.size()}`);

// ---- content addressing ----------------------------------------------------
console.log("== content addressing ==");
const dup = service.publish({
  title: "fs.readFile utf-8 returns string, not Buffer",
  summary: "dup",
  body: { type: "tool-call", toolName: "fs.readFile", ok: true, input: { p: 1 }, output: { s: "x" }, durationMs: 1 },
  environment: service.currentEnvironment(),
});
const beforeSize = storage.size();
const dup2 = service.publish({
  title: "fs.readFile utf-8 returns string, not Buffer",
  summary: "dup",
  body: { type: "tool-call", toolName: "fs.readFile", ok: true, input: { p: 1 }, output: { s: "x" }, durationMs: 1 },
  environment: service.currentEnvironment(),
});
ok("same body => same id", dup.id === dup2.id, dup.id);
ok("republish does not grow storage", storage.size() === beforeSize);
ok("id is 64-char sha256 hex", /^[0-9a-f]{64}$/.test(dup.id));

// ---- P0#1: self-certification must be blocked ------------------------------
console.log("== trust-model gate ==");
const cert = service.publish({
  title: "attempt to self-certify as verified",
  summary: "must be downgraded",
  body: { type: "tool-call", toolName: "self_cert", ok: true, input: {}, output: { x: 1 }, durationMs: 1 },
  environment: service.currentEnvironment(),
  status: "verified",
});
ok("publish(status:'verified') is capped to proposed", cert.status === "proposed", cert.status);
const refute = service.publish({
  title: "attempt to publish as refuted",
  summary: "must be downgraded",
  body: { type: "tool-call", toolName: "self_refute", ok: false, input: {}, error: "x", durationMs: 1 },
  environment: service.currentEnvironment(),
  status: "refuted",
});
ok("publish(status:'refuted') is capped to proposed", refute.status === "proposed", refute.status);

// ---- P0#2: reverse index must not retain stale edges -----------------------
console.log("== reverse-index cleanup ==");
const baseA = service.publish({
  title: "base A", summary: "a",
  body: { type: "tool-call", toolName: "base_a", ok: true, input: {}, output: {}, durationMs: 1 },
  environment: service.currentEnvironment(),
});
const baseB = service.publish({
  title: "base B", summary: "b",
  body: { type: "tool-call", toolName: "base_b", ok: true, input: {}, output: {}, durationMs: 1 },
  environment: service.currentEnvironment(),
});
const depBody = { type: "tool-call", toolName: "dep", ok: true, input: {}, output: {}, durationMs: 1 };
const p1 = service.publish({
  title: "dep on A", summary: "d",
  body: depBody,
  environment: service.currentEnvironment(),
  links: { basis: [baseA.id], refutes: [] },
});
ok("A has dependent before republish", storage.dependents(baseA.id).has(p1.id));
const p2 = service.publish({
  title: "dep now on B (same body)", summary: "d2",
  body: depBody,
  environment: service.currentEnvironment(),
  links: { basis: [baseB.id], refutes: [] },
});
ok("republished same body => same id", p1.id === p2.id);
ok("A's reverse edge is removed", !storage.dependents(baseA.id).has(p1.id));
ok("B's reverse edge is present", storage.dependents(baseB.id).has(p2.id));

// ---- locate the cascade chain from the seeds -------------------------------
console.log("== cascade invalidation ==");
const backslash = service.search({ filters: {}, keyword: "backslash" });
const negative = backslash.find((k) => k.body.type === "negative-knowledge" && k.title.includes("backslash"));
const workaround = backslash.find((k) => k.links.basis.includes(negative.id));
ok("found glob-backslash negative seed", !!negative, negative && negative.id);
ok("found workaround KO with basis on it", !!workaround);

// refute the upstream -> downstream must cascade to needs_verification
const before = workaround.status;
const v = service.verify(negative.id, "did:smoke", false, "reproduced on win32: 0 matches");
ok("verdict=false marks upstream refuted", v.ko.status === "refuted");
const after = storage.get(workaround.id).status;
ok("downstream demoted needs_verification", before !== "needs_verification" && after === "needs_verification",
  `${before} -> ${after}`);
ok("invalidation change-log recorded", v.invalidated.some((c) => c.id === workaround.id && c.to === "needs_verification"));

// ---- search ranking: verified first ----------------------------------------
console.log("== search ranking ==");
service.verify(dup.id, "did:smoke", true, "unit-verified");
const ranked = service.search({ filters: { type: "tool-call" }, keyword: "readFile" });
const idx = ranked.map((k) => k.id);
ok("verified KO ranks above others", idx.indexOf(dup.id) === 0, `rank ${idx.indexOf(dup.id)}`);

// ---- token economy: akn_search default body truncation ----------------------
console.log("== akn_search body truncation ==");
const tool = buildSearchTool(service, { defaultLimit: 5 });
(async () => {
  const slim = await tool.execute({ query: { keyword: "glob" }, options: {} });
  ok("default hits are slim (no body)", slim.hits.every((h) => !("body" in h)));
  ok("slim hit has id/title/summary/status/environment",
    slim.hits.every((h) => h.id && h.title && h.summary && h.status && h.environment));

  const full = await tool.execute({ query: { keyword: "glob" }, options: { includeBody: true } });
  ok("includeBody:true returns body", full.hits.length > 0 && full.hits.every((h) => h.body));

  const limited = await tool.execute({ query: { keyword: "" }, options: {} });
  ok("defaultLimit applies", limited.hits.length <= 5, `got ${limited.hits.length}`);

  console.log(`\nPASS: ${passed} checks green. Storage has ${storage.size()} KOs.`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
