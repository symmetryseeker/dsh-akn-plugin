import { describe, expect, it } from 'vitest'
import { validateProtocolObject, type TraceInput } from '@aen/protocol'
import { SAMPLE_SCHEMA_NAMESPACE, SampleHarnessAdapter } from '../src/index.js'

function source(rows: unknown[]): TraceInput {
  const text = rows.map((row) => JSON.stringify(row)).join('\n')
  return {
    mediaType: 'application/x-ndjson',
    sourceName: 'sample.jsonl',
    schemaNamespace: SAMPLE_SCHEMA_NAMESPACE,
    schemaVersion: '1',
    bytes: new TextEncoder().encode(text),
  }
}

const header = {
  type: 'sample/session',
  version: 1,
  sessionId: 'sample-session',
  createdAt: '2026-08-20T00:00:00.000Z',
  harness: { name: 'Community Harness', version: '1.2.3' },
}

const task = {
  taxonomy: ['software-engineering', 'failure-recovery'],
  intent: 'Recover a failed build and verify the correction.',
  constraints: ['Do not publish raw command output.'],
  acceptance: [{ id: 'build', description: 'The trusted local build passes.', required: true }],
  riskClass: 'reversible_write',
}

describe('community sample HarnessAdapter conformance', () => {
  it('returns the required EvidenceGapReport through the standard Adapter interface', async () => {
    const adapter = new SampleHarnessAdapter()
    const events = adapter.importTrace(source([
      header,
      {
        type: 'learning/candidate', seq: 0, time: '2026-08-20T00:00:02.000Z',
        candidateReason: 'user_pinned', outcome: 'success', task,
      },
    ]))
    const pairs = []
    for await (const pair of adapter.deriveEpisodes(events)) pairs.push(pair)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.episode.evidenceGapReportRef.digest).toBe(pairs[0]?.gapReport.digest)
    expect(validateProtocolObject(pairs[0]?.episode)).toMatchObject({ ok: true })
    expect(validateProtocolObject(pairs[0]?.gapReport)).toMatchObject({ ok: true })
  })

  it('emits protocol-valid objects without modifying AEXP or treating ordinary activity as experience', async () => {
    const adapter = new SampleHarnessAdapter()
    const result = await adapter.importEvidence(source([
      header,
      { type: 'activity', seq: 0, time: '2026-08-20T00:00:01.000Z', data: { summary: 'ordinary step' } },
      {
        type: 'learning/candidate',
        seq: 1,
        time: '2026-08-20T00:00:02.000Z',
        candidateReason: 'failure_recovery',
        outcome: 'success',
        task,
      },
    ]))
    expect(result.episodes).toHaveLength(1)
    expect(result.gapReports).toHaveLength(1)
    expect(result.episodes[0]?.eventRange).toEqual({ fromSeq: 1, toSeq: 1 })
    expect(result.gapReports[0]?.maximumEvidenceLevel).toBe('H0')
    for (const object of [result.manifest, ...result.gapReports, ...result.episodes]) {
      expect(validateProtocolObject(object)).toMatchObject({ ok: true, issues: [] })
    }
    expect(result.episodes[0]?.evidenceGapReportRef.digest).toBe(result.gapReports[0]?.digest)
  })

  it('does not create an Episode when the stream has no explicit high-value candidate', async () => {
    const result = await new SampleHarnessAdapter().importEvidence(source([
      header,
      { type: 'activity', seq: 0, time: '2026-08-20T00:00:01.000Z' },
    ]))
    expect(result.episodes).toEqual([])
    expect(result.gapReports).toEqual([])
  })

  it('fails closed for unsupported source versions and candidate reasons', async () => {
    const adapter = new SampleHarnessAdapter()
    await expect(adapter.importEvidence({ ...source([header]), schemaVersion: '2' })).rejects.toThrow('version 1')
    await expect(adapter.importEvidence(source([
      header,
      {
        type: 'learning/candidate',
        seq: 0,
        time: '2026-08-20T00:00:02.000Z',
        candidateReason: 'every_tool_call',
        outcome: 'success',
        task,
      },
    ]))).rejects.toThrow('not a high-value trigger')
  })
})
