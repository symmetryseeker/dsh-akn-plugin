import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { sha256, type Digest, type JsonRecord, type TraceInput } from '@aen/protocol'
import type { DshDecodedEvent, DshLoadedTrace, DshSessionEvent, DshSessionHeader } from './types.js'

const MAX_INPUT_BYTES = 128 * 1024 * 1024
const MAX_SESSION_JSONL_BYTES = 256 * 1024 * 1024
const DSH_SESSION_FORMAT_VERSION = 0

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertSafeInteger(value: unknown, field: string, minimum?: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (minimum !== undefined && Number(value) < minimum)) {
    throw new Error(`DSH session export ${field} must be a safe integer`)
  }
}

function assertEpochMilliseconds(value: unknown, field: string): asserts value is number {
  assertSafeInteger(value, field, 0)
  if (!Number.isFinite(new Date(value).getTime())) {
    throw new Error(`DSH session export ${field} is outside the supported date range`)
  }
}

function parseHeader(value: unknown): DshSessionHeader {
  if (!isRecord(value) || value.type !== 'session') {
    throw new Error('DSH session export first line must be a session header')
  }
  if (value.version !== DSH_SESSION_FORMAT_VERSION) {
    throw new Error(`unsupported DSH session format version ${String(value.version)}; expected 0`)
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('DSH session export header id must be a non-empty string')
  }
  assertEpochMilliseconds(value.createdAt, 'header.createdAt')
  assertSafeInteger(value.delegationDepth, 'header.delegationDepth', 0)
  if (value.cwd !== undefined && typeof value.cwd !== 'string') {
    throw new Error('DSH session export header cwd must be a string')
  }
  if (value.agentPreset !== undefined && typeof value.agentPreset !== 'string') {
    throw new Error('DSH session export header agentPreset must be a string')
  }
  if (value.parentSession !== undefined && typeof value.parentSession !== 'string') {
    throw new Error('DSH session export header parentSession must be a string')
  }
  if (value.seedLength !== undefined) assertSafeInteger(value.seedLength, 'header.seedLength', 0)
  if (value.origin !== undefined && value.origin !== 'subagent') {
    throw new Error('DSH session export header origin must be subagent')
  }
  return value as unknown as DshSessionHeader
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function packedPayload(
  row: JsonRecord,
  tag: 'text-chunks' | 'reasoning-chunks' | 'tool-call-chunks',
): { data: JsonRecord; members: string[] } {
  if (!exactKeys(row, ['type', 'seq0', 'time0', 'data'])) {
    throw new Error(`malformed DSH ${tag} storage row envelope`)
  }
  assertSafeInteger(row.seq0, `${tag}.seq0`, 0)
  assertSafeInteger(row.time0, `${tag}.time0`)
  if (!isRecord(row.data)) throw new Error(`malformed DSH ${tag} storage row data`)
  const data = row.data
  const payloadKey = tag === 'tool-call-chunks' ? 'args' : 'texts'
  const members = data[payloadKey]
  const deltas = data.dt
  if (!Array.isArray(members) || members.length === 0 || members.some((entry) => typeof entry !== 'string')) {
    throw new Error(`malformed DSH ${tag} ${payloadKey}`)
  }
  if (!Array.isArray(deltas) || deltas.length !== members.length - 1) {
    throw new Error(`malformed DSH ${tag} dt arity`)
  }
  for (const delta of deltas) assertSafeInteger(delta, `${tag}.dt`)
  for (const field of ['turn', 'step', 'index']) assertSafeInteger(data[field], `${tag}.${field}`, 0)
  if (tag === 'tool-call-chunks') {
    if (typeof data.id !== 'string' || (data.name !== undefined && typeof data.name !== 'string')) {
      throw new Error('malformed DSH tool-call-chunks identity')
    }
  }
  return { data, members: members as string[] }
}

function expandPackedRow(row: JsonRecord, sourceLine: number): DshDecodedEvent[] | undefined {
  const tag = row.type
  if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks') return undefined
  const { data, members } = packedPayload(row, tag)
  const turn = data.turn as number
  const step = data.step as number
  const blockIndex = data.index as number
  const callId = data.id as string | undefined
  const callName = data.name as string | undefined
  let time = row.time0 as number
  return members.map((member, index) => {
    if (index > 0) time += (data.dt as number[])[index - 1] as number
    assertSafeInteger(time, `${tag}.member.time`)
    const chunk =
      tag === 'text-chunks'
        ? { type: 'text-delta', index: blockIndex, text: member }
        : tag === 'reasoning-chunks'
          ? { type: 'reasoning-delta', index: blockIndex, text: member }
          : {
              type: 'tool-call-delta',
              index: blockIndex,
              id: callId as string,
              ...(callName === undefined ? {} : { name: callName }),
              argumentsDelta: member,
            }
    return {
      event: {
        type: 'assistant/chunk',
        seq: (row.seq0 as number) + index,
        time,
        data: { turn, step, chunk },
      },
      sourceLine,
      inferred: true,
      inferenceRuleId: 'dsh.storage.chunk-row.v0',
    }
  })
}

function parseEvent(value: unknown, sourceLine: number): DshDecodedEvent[] {
  if (!isRecord(value)) throw new Error(`DSH session event at line ${sourceLine} must be an object`)
  const expanded = expandPackedRow(value, sourceLine)
  if (expanded !== undefined) return expanded
  if (typeof value.type !== 'string' || value.type.length === 0) {
    throw new Error(`DSH session event at line ${sourceLine} has no type`)
  }
  assertSafeInteger(value.seq, `event line ${sourceLine} seq`, 0)
  assertEpochMilliseconds(value.time, `event line ${sourceLine} time`)
  if (!Object.hasOwn(value, 'data')) throw new Error(`DSH session event at line ${sourceLine} has no data`)
  return [{ event: value as unknown as DshSessionEvent, sourceLine, inferred: false }]
}

function parseJsonl(bytes: Uint8Array): { header: DshSessionHeader; events: DshDecodedEvent[] } {
  if (bytes.byteLength > MAX_SESSION_JSONL_BYTES) throw new Error('DSH session JSONL exceeds import limit')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const lines = text.split('\n')
  if (lines.length === 0 || lines[0] === '') throw new Error('DSH session export is empty')
  let headerValue: unknown
  try {
    headerValue = JSON.parse(lines[0] as string)
  } catch {
    throw new Error('DSH session export header is not valid JSON')
  }
  const header = parseHeader(headerValue)
  const events: DshDecodedEvent[] = []
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index] as string
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error(`DSH session event at line ${index + 1} is not valid JSON`)
    }
    events.push(...parseEvent(parsed, index + 1))
  }
  events.forEach(({ event }, index) => {
    if (event.seq !== index) {
      throw new Error(`DSH session event sequence is not contiguous: expected ${index}, got ${event.seq}`)
    }
  })
  return { header, events }
}

function isZipInput(input: TraceInput, bytes: Uint8Array): boolean {
  return (
    input.mediaType === 'application/zip' ||
    input.mediaType === 'application/vnd.deepseek-harness.session+zip' ||
    input.sourceName.endsWith('.zip') ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b)
  )
}

function sessionJsonlFromZip(bytes: Uint8Array): Uint8Array {
  let rootSeen = false
  const entries = unzipSync(bytes, {
    filter(file) {
      if (file.name !== 'session.jsonl') return false
      if (rootSeen) throw new Error('DSH session ZIP contains duplicate root session.jsonl')
      rootSeen = true
      if (file.originalSize > MAX_SESSION_JSONL_BYTES) {
        throw new Error('DSH session ZIP root JSONL exceeds import limit')
      }
      return true
    },
  })
  const session = entries['session.jsonl']
  if (session === undefined) throw new Error('DSH session ZIP has no root session.jsonl')
  return session
}

async function inputBytes(input: TraceInput): Promise<Uint8Array> {
  if ((input.bytes === undefined) === (input.localPath === undefined)) {
    throw new Error('TraceInput must provide exactly one of bytes or localPath')
  }
  const bytes = input.bytes ?? (await readFile(input.localPath as string))
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error('DSH trace input exceeds import limit')
  return bytes
}

export async function loadDshTrace(input: TraceInput): Promise<DshLoadedTrace> {
  const raw = await inputBytes(input)
  const rawInputDigest = sha256(raw)
  if (input.expectedDigest !== undefined && input.expectedDigest !== rawInputDigest) {
    throw new Error(`DSH trace input digest mismatch: expected ${input.expectedDigest}, got ${rawInputDigest}`)
  }
  const zip = isZipInput(input, raw)
  const jsonl = zip ? sessionJsonlFromZip(raw) : raw
  const rawTraceDigest = sha256(jsonl)
  const { header, events } = parseJsonl(jsonl)
  return {
    header,
    events,
    sessionDigest: rawTraceDigest,
    rawInputDigest,
    rawTraceDigest,
    ...(input.localPath === undefined
      ? {}
      : { localLocator: zip ? `${input.localPath}#session.jsonl` : input.localPath }),
    sourceName: input.sourceName,
    ...(input.exporterVersion === undefined ? {} : { exporterVersion: input.exporterVersion }),
  }
}
