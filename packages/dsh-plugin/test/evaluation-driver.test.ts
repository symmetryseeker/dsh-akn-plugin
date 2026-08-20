import { describe, expect, it } from 'vitest'
import { parseDshEvaluationDriverConfig } from '../src/evaluation-driver.js'

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`

function config(): unknown {
  return {
    dshExecutable: '/opt/dsh/bin/dsh',
    dshHome: '/var/lib/dsh',
    profile: 'headless',
    harnessVersion: '0.1.0-rc.7',
    traceRoot: '/var/lib/aen/private-traces',
    fixturesByBenchmarkDigest: {
      [digest('1')]: { mode: 'empty', fixtureDigests: [] },
      [digest('2')]: { mode: 'copy', sourceDir: '/opt/aen/fixtures/task-b', fixtureDigests: [digest('3')] },
    },
    patchesByHarnessConfigurationDigest: {
      [digest('4')]: ['/opt/aen/harness-a.patch.yml'],
      [digest('5')]: ['/opt/aen/harness-b.patch.yml'],
    },
    contextBudget: { estimatedMaxTokens: 2048, maxBytes: 32_768 },
    maxOutputBytes: 1_048_576,
  }
}

describe('built-in DSH live evaluation driver configuration', () => {
  it('accepts only immutable digest-keyed fixtures and Harness configurations', () => {
    expect(parseDshEvaluationDriverConfig(config())).toMatchObject({
      profile: 'headless',
      contextBudget: { estimatedMaxTokens: 2048, maxBytes: 32_768 },
    })
  })

  it('rejects non-headless profiles, relative paths, extra fields, and ambiguous empty fixtures', () => {
    expect(() => parseDshEvaluationDriverConfig({ ...(config() as object), profile: 'web' })).toThrow('official headless')
    expect(() => parseDshEvaluationDriverConfig({ ...(config() as object), dshExecutable: './dsh' })).toThrow('absolute path')
    expect(() => parseDshEvaluationDriverConfig({ ...(config() as object), surprise: true })).toThrow('unsupported fields')
    const value = config() as Record<string, unknown>
    value.fixturesByBenchmarkDigest = {
      [digest('1')]: { mode: 'empty', sourceDir: '/tmp/source', fixtureDigests: [] },
    }
    expect(() => parseDshEvaluationDriverConfig(value)).toThrow('empty mode cannot declare')
  })
})
