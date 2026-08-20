import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspacePackage = (name) => resolve(packageRoot, '..', name, 'src', 'index.ts')

await build({
  entryPoints: {
    index: resolve(packageRoot, 'src', 'index.ts'),
    definition: resolve(packageRoot, 'src', 'runtime.ts'),
    policy: resolve(packageRoot, 'src', 'policy-plugin.ts'),
    provider: resolve(packageRoot, 'src', 'provider-plugin.ts'),
    tools: resolve(packageRoot, 'src', 'tool-plugin.ts'),
    'evaluation-driver': resolve(packageRoot, 'src', 'evaluation-driver.ts'),
  },
  outdir: resolve(packageRoot, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'eof',
  alias: {
    '@aen/adapter-dsh': workspacePackage('adapter-dsh'),
    '@aen/client': workspacePackage('client'),
    '@aen/evaluation': workspacePackage('evaluation'),
    '@aen/local-store': workspacePackage('local-store'),
    '@aen/promotion': workspacePackage('promotion'),
    '@aen/protocol': workspacePackage('protocol'),
    '@aen/workbench': workspacePackage('workbench'),
  },
  external: [
    '@deepseek-ai/*',
    '@sinclair/typebox',
    'ajv',
    'ajv/*',
    'ajv-formats',
    'canonicalize',
    'fflate',
  ],
})

// The runtime is fully bundled because the private @aen/* workspace packages
// are not separately published. Keep the installable public declaration
// structural for the same reason; leaking workspace-only type imports would
// make an otherwise self-contained DSH plugin unusable to TypeScript graders.
await writeFile(resolve(packageRoot, 'dist', 'evaluation-driver.d.ts'), `export type DshEvaluationDigest = \`sha256:\${string}\`;
export type DshEvaluationJsonRecord = Record<string, unknown>;
export interface DshEvaluationFixture {
  mode: 'empty' | 'copy';
  sourceDir?: string;
  fixtureDigests: DshEvaluationDigest[];
}
export interface DshEvaluationDriverConfig {
  dshExecutable: string;
  dshHome: string;
  profile: 'headless';
  harnessVersion: string;
  traceRoot: string;
  fixturesByBenchmarkDigest: Record<string, DshEvaluationFixture>;
  patchesByHarnessConfigurationDigest: Record<string, string[]>;
  contextBudget: { estimatedMaxTokens: number; maxBytes: number };
  maxOutputBytes: number;
}
export interface DshEvaluationGradeInput {
  benchmark: DshEvaluationJsonRecord;
  run: DshEvaluationJsonRecord;
  stdout: string;
  stderr: string;
  latencyMs: number;
  workspace: string;
  transcriptPath: string;
  imported: DshEvaluationJsonRecord;
}
export interface DshEvaluationGradeResult {
  graderRefDigest: DshEvaluationDigest;
  status: 'success' | 'agent_failure' | 'policy_refusal';
  criteria: Array<{ criterionId: string; passed: boolean; score?: number }>;
  qualityScore?: number;
  totalCostUsd?: number;
  failureType?: string;
}
export interface DshEvaluationGrader {
  readonly name: string;
  readonly evaluator: { actorId: string; type: 'human' | 'agent' | 'organization' | 'service' | 'node'; displayName?: string };
  readonly graderRefDigests: DshEvaluationDigest[];
  grade(input: DshEvaluationGradeInput): Promise<DshEvaluationGradeResult>;
}
export interface DshEvaluationDriverHandle {
  readonly name: string;
  readonly executionMode: 'live';
  run(input: unknown): Promise<unknown>;
}
export declare function parseDshEvaluationDriverConfig(value: unknown): DshEvaluationDriverConfig;
export declare function createDshEvaluationDriver(input: {
  config: DshEvaluationDriverConfig;
  store: unknown;
  storePath: string;
  grader: DshEvaluationGrader;
}): Promise<DshEvaluationDriverHandle>;
`)
