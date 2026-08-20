import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { LocalEvidenceStore } from '../../local-store/dist/index.js'
import * as aenPlugin from '../dist/index.js'

const EVENTS_PER_ROUND = Number(process.env.AEN_DSH_BENCH_EVENTS ?? 20_000)
const ROUNDS = Number(process.env.AEN_DSH_BENCH_ROUNDS ?? 5)
if (!Number.isSafeInteger(EVENTS_PER_ROUND) || EVENTS_PER_ROUND < 1) throw new Error('AEN_DSH_BENCH_EVENTS must be positive')
if (!Number.isSafeInteger(ROUNDS) || ROUNDS < 3) throw new Error('AEN_DSH_BENCH_ROUNDS must be an integer >=3')

async function runtime(directory, id, withPlugin) {
  const context = new Context()
  const sessionFiber = await context.plugin(SessionStore)
  const agentFiber = await context.plugin(AgentRegistry)
  const skillFiber = await context.plugin(SkillRegistry)
  const session = context.sessions.create(SessionId(id), { meta: { cwd: directory } })
  const agent = {
    id: session.id,
    options: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 4_096 },
    session,
    inbox: {},
    status: 'idle',
    ctx: context,
    cancel: () => undefined,
    whenIdle: async () => undefined,
    runMaintenance: async (task) => task(new AbortController().signal),
    send: () => undefined,
    followup: () => undefined,
    steer: () => undefined,
    inject: () => undefined,
  }
  const unregisterAgent = context.agents.register(agent)
  const storePath = join(directory, `${id}.sqlite`)
  const pluginFiber = withPlugin
    ? await context.plugin(aenPlugin, {
        storePath,
        harnessVersion: '0.1.0-rc.7',
        captureSkillResources: false,
        snapshotDelayMs: 0,
      })
    : undefined
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  let sequence = 0
  return {
    append(count) {
      const started = performance.now()
      for (let index = 0; index < count; index += 1) {
        sequence += 1
        session.append('tool/call', {
          turn: 1,
          step: 1,
          callId: `benchmark-${id}-${sequence}`,
          name: 'read',
          arguments: '{}',
        })
      }
      return performance.now() - started
    },
    async close() {
      await pluginFiber?.dispose()
      unregisterAgent()
      await skillFiber.dispose()
      await agentFiber.dispose()
      await sessionFiber.dispose()
    },
    storePath,
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

const prefix = join(tmpdir(), 'aen-dsh-hot-path-')
const directory = await mkdtemp(prefix)
if (!directory.startsWith(prefix)) throw new Error(`unsafe temporary directory: ${directory}`)
let baseline
let plugin

try {
  baseline = await runtime(directory, 'baseline', false)
  plugin = await runtime(directory, 'aen-plugin', true)
  baseline.append(2_000)
  plugin.append(2_000)
  const baselineRounds = []
  const pluginRounds = []
  for (let round = 0; round < ROUNDS; round += 1) {
    if (round % 2 === 0) {
      baselineRounds.push(baseline.append(EVENTS_PER_ROUND))
      pluginRounds.push(plugin.append(EVENTS_PER_ROUND))
    } else {
      pluginRounds.push(plugin.append(EVENTS_PER_ROUND))
      baselineRounds.push(baseline.append(EVENTS_PER_ROUND))
    }
  }
  await plugin.close()
  plugin = undefined
  const store = new LocalEvidenceStore(join(directory, 'aen-plugin.sqlite'))
  const storedObjectsAfterToolCalls = store.listObjects().length
  store.close()
  const baselineMedianMs = median(baselineRounds)
  const pluginMedianMs = median(pluginRounds)
  const baselineNsPerEvent = baselineMedianMs * 1_000_000 / EVENTS_PER_ROUND
  const pluginNsPerEvent = pluginMedianMs * 1_000_000 / EVENTS_PER_ROUND
  process.stdout.write(`${JSON.stringify({
    profile: 'aen-dsh-tool-call-hot-path-smoke-v0.1',
    generatedAt: new Date().toISOString(),
    harness: 'DeepSeek Harness 0.1.0-rc.7 official SessionStore + AgentRegistry + SkillRegistry',
    warning: 'Isolated session-event append microbenchmark. Relative percentage is diagnostic only and does not establish whole-tool-workload CPU overhead.',
    load: { eventsPerRound: EVENTS_PER_ROUND, rounds: ROUNDS, warmupEvents: 2_000 },
    baseline: { roundsMs: baselineRounds, medianMs: baselineMedianMs, medianNsPerEvent: baselineNsPerEvent },
    plugin: { roundsMs: pluginRounds, medianMs: pluginMedianMs, medianNsPerEvent: pluginNsPerEvent },
    diagnosticRelativeOverheadPercent: (pluginNsPerEvent / baselineNsPerEvent - 1) * 100,
    synchronousIoEvidence: {
      storedObjectsAfterToolCalls,
      pass: storedObjectsAfterToolCalls === 0,
    },
  }, null, 2)}\n`)
  if (storedObjectsAfterToolCalls !== 0) process.exitCode = 1
} finally {
  await plugin?.close()
  await baseline?.close()
  await rm(directory, { recursive: true, force: true })
}
