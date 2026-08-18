/**
 * bundles/seed.ts — B1 cold-start adversarial seeds.
 *
 * 22 synthetic records (~half success, half failure) that exercise real,
 * cross-platform pitfalls agents hit every day. A small dependency chain is
 * baked in so cascade invalidation can be demonstrated out of the box:
 *
 *   [glob-backslash-ok] --(refutes)--> [glob-backslash-negative]
 *                                          |
 *                                        (basis)
 *                                          v
 *                                 [use-fwd-slash-workaround]
 *
 * If an agent later refutes [glob-backslash-negative], the workaround KO is
 * demoted to needs_verification automatically.
 */

import { AknBody } from "../core/types";
import { buildEnvironment, hashBody } from "../core/service";
import type { AknPublishInput } from "../core/service";

const envWin = buildEnvironment({ node: "v24.14.1", glob: "10.4.0", fs: "Node core" });
const envMac = buildEnvironment({ node: "v22.9.0", glob: "10.3.0", fs: "Node core" });
const envLinux = buildEnvironment({ node: "v20.11.1", glob: "10.3.0", fs: "Node core" });

/** Compute the id a body will receive, so links can reference real ids. */
const idOf = (body: AknBody): string => hashBody(body);

/* ------------------------------------------------------------------ *
 * named bodies
 * ------------------------------------------------------------------ */

const globBackslashNegative = {
  type: "negative-knowledge",
  toolName: "glob",
  error: "Pattern with backslashes ('.\\\\**\\\\*.ts') matched nothing on win32",
  stack: "at GlobSync.find\n  pattern normalized as literal backslash path",
  mitigation: "Always use forward slashes in glob patterns; they are supported on win32.",
} as const;

const useFwdSlashWorkaround = {
  type: "negative-knowledge",
  toolName: "glob",
  error: "N/A — positive guidance",
  mitigation: "Forward slashes are accepted on all platforms; backslashes are literal on POSIX and unreliable on win32.",
} as const;

/* ------------------------------------------------------------------ *
 * seed list (each element is a service.publish-compatible input)
 * ------------------------------------------------------------------ */

export const seedKOList: AknPublishInput[] = [
  // ---- successes -------------------------------------------------------
  {
    title: "fs.readFile utf-8 returns string, not Buffer",
    summary: "fs.readFile(path,'utf-8') returns a string; omitting encoding returns a Buffer.",
    body: {
      type: "tool-call", toolName: "fs.readFile", ok: true,
      input: { path: "config.json", encoding: "utf-8" },
      output: { type: "string", bytes: 512 }, durationMs: 3,
    },
    environment: envLinux, tags: ["fs", "encoding", "pitfall"],
  },
  {
    title: "glob forward-slash patterns match on all platforms",
    summary: "glob('src/**/*.ts') matched 214 files identically on linux & win32.",
    body: {
      type: "tool-call", toolName: "glob", ok: true,
      input: { pattern: "src/**/*.ts" }, output: { matches: 214 }, durationMs: 18,
    },
    environment: envLinux, tags: ["glob", "cross-platform"],
  },
  {
    title: "fetch with AbortSignal timeout succeeds fast",
    summary: "fetch(url,{signal:AbortSignal.timeout(5000)}) aborts cleanly on stall instead of hanging.",
    body: {
      type: "tool-call", toolName: "fetch", ok: true,
      input: { url: "https://api.example.com/data", signal: "AbortSignal.timeout(5000)" },
      output: { status: 200, ms: 1420 }, durationMs: 1420,
    },
    environment: envMac, tags: ["fetch", "timeout", "resilience"],
  },
  {
    title: "pool-size 10 handles 100 concurrent queries",
    summary: "pg pool max:10 served 100 concurrent selects without exhaustion (avg wait 4ms).",
    body: {
      type: "tool-call", toolName: "pg.query", ok: true,
      input: { concurrency: 100, poolMax: 10 }, output: { avgWaitMs: 4, errors: 0 }, durationMs: 320,
    },
    environment: envLinux, tags: ["database", "pool", "scaling"],
  },
  {
    title: "JSON.parse succeeds after stripping UTF-8 BOM",
    summary: "Removing the leading \\uFEFF before JSON.parse avoids 'Unexpected token' errors.",
    body: {
      type: "tool-call", toolName: "JSON.parse", ok: true,
      input: { content: "\\uFEFF{...}" }, output: { parsed: true }, durationMs: 1,
    },
    environment: envMac, tags: ["json", "bom", "pitfall"],
  },
  {
    title: "git status --porcelain parses cleanly",
    summary: "porcelain output split on ' ' yields {status, path} for every entry.",
    body: {
      type: "tool-call", toolName: "exec", ok: true,
      input: { command: "git status --porcelain" }, output: { entries: 12 }, durationMs: 40,
    },
    environment: envLinux, tags: ["git", "parsing"],
  },
  {
    title: "dotenv parses .env without syntax errors",
    summary: "KEY=value lines parse; comments and quotes handled by the dotenv lib.",
    body: {
      type: "tool-call", toolName: "dotenv.config", ok: true,
      input: { path: ".env" }, output: { parsedKeys: 23 }, durationMs: 2,
    },
    environment: envWin, tags: ["dotenv", "config"],
  },
  {
    title: "path.resolve handles POSIX absolute paths",
    summary: "path.resolve('/a','../b') -> '/b' on linux.",
    body: {
      type: "tool-call", toolName: "path.resolve", ok: true,
      input: { segments: ["/a", "../b"] }, output: { resolved: "/b" }, durationMs: 1,
    },
    environment: envLinux, tags: ["path", "posix"],
  },
  {
    title: "semver range ^1.2.3 accepts 1.2.9",
    summary: "semver.satisfies('1.2.9','^1.2.3') === true.",
    body: {
      type: "tool-call", toolName: "semver.satisfies", ok: true,
      input: { version: "1.2.9", range: "^1.2.3" }, output: { satisfied: true }, durationMs: 1,
    },
    environment: envMac, tags: ["semver", "versioning"],
  },
  {
    title: "fetch streaming a large file avoids buffering OOM",
    summary: "Iterating res.body reader in chunks keeps RSS flat for a 2GB download.",
    body: {
      type: "tool-call", toolName: "fetch", ok: true,
      input: { url: "big-file.bin", streaming: true }, output: { bytes: 2147483648, rssPeakMB: 84 }, durationMs: 18300,
    },
    environment: envLinux, tags: ["fetch", "streaming", "memory"],
  },
  {
    title: "AbortController cooperates with fetch to cancel mid-flight",
    summary: "controller.abort() interrupts an in-flight fetch; the promise rejects with AbortError.",
    body: {
      type: "tool-call", toolName: "fetch", ok: true,
      input: { useAbortController: true }, output: { aborted: true }, durationMs: 900,
    },
    environment: envWin, tags: ["fetch", "abort", "resilience"],
  },
  // ---- failures (ok:false) --------------------------------------------
  {
    title: "fs.readFile default encoding returns Buffer, breaking JSON.parse",
    summary: "Omitting encoding gives a Buffer; JSON.parse(Buffer) throws unless .toString('utf-8') is applied.",
    body: {
      type: "tool-call", toolName: "fs.readFile", ok: false,
      input: { path: "config.json" }, output: undefined, error: "TypeError: Uint8Array: cannot be parsed as JSON", durationMs: 2,
    },
    environment: envMac, tags: ["fs", "encoding", "failure"],
  },
  {
    title: "glob backslash patterns break on Windows",
    summary: "Pattern '.\\\\**\\\\*.ts' matched zero files on win32; forward slashes fix it.",
    body: globBackslashNegative,
    environment: envWin, tags: ["glob", "windows", "failure"],
  },
  {
    title: "fetch without timeout hangs forever on stalled connection",
    summary: "Default fetch has no timeout; a half-open connection can hang indefinitely.",
    body: {
      type: "tool-call", toolName: "fetch", ok: false,
      input: { url: "https://stalled.example.com" }, output: undefined, error: "timeout: client network socket disconnected", durationMs: 120000,
    },
    environment: envMac, tags: ["fetch", "timeout", "failure"],
  },
  {
    title: "pool-size 5 exhausted by 500 concurrent queries",
    summary: "pg pool max:5 with 500 concurrent -> 'timeout exceeded when trying to connect'.",
    body: {
      type: "tool-call", toolName: "pg.query", ok: false,
      input: { concurrency: 500, poolMax: 5 }, output: undefined, error: "Connection terminated due to connection timeout", durationMs: 30000,
    },
    environment: envLinux, tags: ["database", "pool", "failure"],
  },
  {
    title: "JSON.parse chokes on trailing commas",
    summary: "JSON with trailing commas throws SyntaxError; strip them (or use JSON5) first.",
    body: {
      type: "tool-call", toolName: "JSON.parse", ok: false,
      input: { content: '{ "a": 1, }' }, output: undefined, error: "SyntaxError: Unexpected token }", durationMs: 1,
    },
    environment: envWin, tags: ["json", "syntax", "failure"],
  },
  {
    title: "chmod throws EPERM on Windows",
    summary: "fs.chmod('x', 0o755) is not meaningful on win32 and can throw EPERM.",
    body: {
      type: "tool-call", toolName: "fs.chmod", ok: false,
      input: { path: "x", mode: 0o755 }, output: undefined, error: "EPERM: operation not permitted, chmod", durationMs: 1,
    },
    environment: envWin, tags: ["fs", "windows", "failure"],
  },
  {
    title: "child_process.spawn with shell:false and quoted command fails",
    summary: "spawn('cmd /c dir') treats 'cmd /c dir' as a single binary -> ENOENT; use shell:true or args array.",
    body: {
      type: "tool-call", toolName: "child_process.spawn", ok: false,
      input: { command: "cmd /c dir", shell: false }, output: undefined, error: "ENOENT: spawn cmd /c dir ENOENT", durationMs: 2,
    },
    environment: envWin, tags: ["child_process", "spawn", "failure"],
  },
  {
    title: "path.resolve treats backslash as literal on POSIX",
    summary: "path.resolve('a\\\\b') on linux yields 'a\\\\b', not a nested path.",
    body: {
      type: "tool-call", toolName: "path.resolve", ok: false,
      input: { segments: ["a\\b"] }, output: undefined, error: "unexpected result: literal backslash on POSIX", durationMs: 1,
    },
    environment: envLinux, tags: ["path", "posix", "failure"],
  },
  {
    title: "crypto unsupported hash algorithm throws",
    summary: "createHash('md3') throws ERR_OSSL_EVP_UNSUPPORTED; algorithm names are strict.",
    body: {
      type: "tool-call", toolName: "crypto.createHash", ok: false,
      input: { algorithm: "md3" }, output: undefined, error: "Error: Unsupported crypto hash algorithm", durationMs: 1,
    },
    environment: envMac, tags: ["crypto", "failure"],
  },
  {
    title: "catastrophic regex backtracking hangs on long input",
    summary: "(a+)+$ on a 100k-char 'a...!' input caused a ~8s stall before /(a+)+$/ timed out.",
    body: {
      type: "tool-call", toolName: "regex.test", ok: false,
      input: { pattern: "(a+)+$", inputLength: 100000 }, output: undefined, error: "V8 regex timeout (ReDoS)", durationMs: 8000,
    },
    environment: envLinux, tags: ["regex", "redos", "failure"],
  },
  {
    title: "process.env.NODE_ENV undefined compares falsy",
    summary: "process.env.NODE_ENV is undefined outside bundlers; '!== \"production\"' logic silently runs dev paths.",
    body: {
      type: "tool-call", toolName: "process.env", ok: false,
      input: { key: "NODE_ENV" }, output: undefined, error: "undefined value caused production guard to fail open", durationMs: 1,
    },
    environment: envWin, tags: ["env", "config", "failure"],
  },
  // ---- derived workaround (basis chain for cascade demo) ---------------
  {
    title: "use forward slashes in glob patterns cross-platform",
    summary: "Adopt forward-slash glob patterns everywhere; backslash handling is unreliable on win32.",
    body: useFwdSlashWorkaround,
    environment: envWin,
    links: { basis: [idOf(globBackslashNegative)], refutes: [] },
    tags: ["glob", "windows", "guidance"],
  },
];
