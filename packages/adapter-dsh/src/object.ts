import {
  finalizeProtocolObject,
  type JsonRecord,
} from '@aen/protocol'

export function publishObject<T>(draft: JsonRecord): T {
  return finalizeProtocolObject<T>(draft)
}
