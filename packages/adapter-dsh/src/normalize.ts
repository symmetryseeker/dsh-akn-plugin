import type { JsonValue, NormalizedEvent } from '@aen/protocol'
import type { DshLoadedTrace } from './types.js'

export const DSH_SCHEMA_NAMESPACE =
  'https://github.com/deepseek-ai/DeepSeek-Harness/session-log' as const
export const DSH_MAPPING_PROFILE = 'https://aen.dev/mappings/dsh-session-jsonl' as const
export const DSH_MAPPING_VERSION = '0.1.0' as const

function normalizedKind(type: string): NormalizedEvent['kind'] {
  if (type.startsWith('turn/')) return 'turn'
  if (type.startsWith('step/')) return 'step'
  if (type.startsWith('request/')) return 'request'
  if (type === 'user/message' || type.startsWith('assistant/')) return 'message'
  if (type === 'tool/call') return 'tool_call'
  if (type === 'tool/result') return 'tool_result'
  if (
    type.startsWith('approval/') ||
    type.startsWith('permission/') ||
    type.startsWith('sandbox/') ||
    type.startsWith('policy/')
  ) {
    return 'policy'
  }
  if (type.startsWith('compaction/')) return 'compaction'
  return 'other'
}

export function normalizeDshTrace(trace: DshLoadedTrace): NormalizedEvent[] {
  const header: NormalizedEvent = {
    eventId: `${trace.sessionDigest}:header`,
    seq: -1,
    time: new Date(trace.header.createdAt).toISOString(),
    kind: 'session',
    sourceType: 'session',
    sourceSchemaNamespace: DSH_SCHEMA_NAMESPACE,
    sourceSchemaVersion: '0',
    mappingProfile: DSH_MAPPING_PROFILE,
    mappingVersion: DSH_MAPPING_VERSION,
    data: trace.header as unknown as JsonValue,
    provenance: { sourcePath: '/session.jsonl/1', inferred: false },
  }
  return [
    header,
    ...trace.events.map(({ event, sourceLine, inferred, inferenceRuleId }) => ({
      eventId: `${trace.sessionDigest}:seq:${event.seq}`,
      seq: event.seq,
      time: new Date(event.time).toISOString(),
      kind: normalizedKind(event.type),
      sourceType: event.type,
      sourceSchemaNamespace: DSH_SCHEMA_NAMESPACE,
      sourceSchemaVersion: '0',
      mappingProfile: DSH_MAPPING_PROFILE,
      mappingVersion: DSH_MAPPING_VERSION,
      data: event.data,
      provenance: {
        sourcePath: `/session.jsonl/${sourceLine}`,
        inferred,
        ...(inferenceRuleId === undefined ? {} : { inferenceRuleId }),
      },
    } satisfies NormalizedEvent)),
  ]
}
