import { createRequire } from 'node:module'
import type { ErrorObject, Options, ValidateFunction } from 'ajv'
import type { Ajv2020 as Ajv2020Instance } from 'ajv/dist/2020.js'
import type { TSchema } from '@sinclair/typebox'
import { InTotoStatementSchema } from './components.js'
import { computeObjectDigest, assertJsonRecord, canonicalJson, type JsonRecord } from './digest.js'
import { AexpError } from './errors.js'
import { apiPayloadSchemas, protocolObjectSchemas, type ProtocolObjectType } from './schemas.js'

export interface ValidationLimits {
  maxBytes: number
  maxDepth: number
  maxArrayItems: number
}

export interface ValidationOptions {
  supportedCapabilities?: ReadonlySet<string>
  limits?: Partial<ValidationLimits>
  verifyDigest?: boolean
}

export interface ValidationIssue {
  code: string
  path: string
  message: string
}

export interface ValidationResult<T = JsonRecord> {
  ok: boolean
  value?: T
  issues: ValidationIssue[]
}

const DEFAULT_LIMITS: ValidationLimits = {
  maxBytes: 1_048_576,
  maxDepth: 64,
  maxArrayItems: 10_000,
}

const require = createRequire(import.meta.url)
const ajv2020Package = require('ajv/dist/2020.js') as {
  default?: new (options?: Options) => Ajv2020Instance
  Ajv2020?: new (options?: Options) => Ajv2020Instance
}
const ajv2020Constructor = ajv2020Package.default ?? ajv2020Package.Ajv2020
if (ajv2020Constructor === undefined) throw new Error('Ajv 2020 constructor is unavailable')
const Ajv2020: new (options?: Options) => Ajv2020Instance = ajv2020Constructor
const formatsPackage = require('ajv-formats') as {
  default?: (ajv: Ajv2020Instance) => Ajv2020Instance
}
const formatsPlugin = formatsPackage.default
if (formatsPlugin === undefined) throw new Error('ajv-formats plugin is unavailable')
const addFormats: (ajv: Ajv2020Instance) => Ajv2020Instance = formatsPlugin

const validatorCache = new Map<string, ValidateFunction>()
const contentValidatorCache = new Map<string, ValidateFunction>()

function createAjv(): Ajv2020Instance {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true,
  })
  addFormats(ajv)
  return ajv
}

function compile(schema: TSchema, contentOnly: boolean): ValidateFunction {
  const key = `${String(schema.$id)}:${contentOnly ? 'content' : 'published'}`
  const cache = contentOnly ? contentValidatorCache : validatorCache
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const selected = contentOnly ? createPreDigestSchema(schema) : schema
  const validator = createAjv().compile(selected)
  cache.set(key, validator)
  return validator
}

function createPreDigestSchema(schema: TSchema): TSchema {
  const copy = structuredClone(schema) as TSchema & {
    properties?: Record<string, unknown>
    required?: string[]
  }
  const exclusions = new Set(['digest', 'attestation', 'attestations', 'signatures'])
  if (copy.properties !== undefined) {
    for (const key of exclusions) delete copy.properties[key]
  }
  if (copy.required !== undefined) {
    copy.required = copy.required.filter((key) => !exclusions.has(key))
  }
  if (typeof copy.$id === 'string') {
    copy.$id = copy.$id.replace(/\.schema\.json$/, '.pre-digest.schema.json')
  }
  return copy
}

function ajvIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    code: `schema.${error.keyword}`,
    path: error.instancePath || '/',
    message: error.message ?? 'schema validation failed',
  }))
}

function enforceLimits(value: unknown, limits: ValidationLimits): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const jsonIssue = findNonJsonValue(value)
  if (jsonIssue !== undefined) return [jsonIssue]
  let encoded: string
  try {
    encoded = canonicalJson(value)
  } catch (error) {
    return [{ code: 'object.not_json', path: '/', message: String(error) }]
  }
  if (Buffer.byteLength(encoded, 'utf8') > limits.maxBytes) {
    issues.push({ code: 'object.too_large', path: '/', message: `object exceeds ${limits.maxBytes} bytes` })
  }

  const stack: Array<{ value: unknown; depth: number; path: string }> = [{ value, depth: 0, path: '/' }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    if (current.depth > limits.maxDepth) {
      issues.push({ code: 'object.too_deep', path: current.path, message: `depth exceeds ${limits.maxDepth}` })
      break
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > limits.maxArrayItems) {
        issues.push({
          code: 'object.too_many_items',
          path: current.path,
          message: `array exceeds ${limits.maxArrayItems} items`,
        })
      }
      current.value.forEach((item, index) =>
        stack.push({ value: item, depth: current.depth + 1, path: `${current.path}/${index}` }),
      )
    } else if (current.value !== null && typeof current.value === 'object') {
      for (const [key, child] of Object.entries(current.value)) {
        stack.push({ value: child, depth: current.depth + 1, path: `${current.path}/${key}` })
      }
    }
  }
  return issues
}

function findNonJsonValue(value: unknown): ValidationIssue | undefined {
  const stack: Array<{ value: unknown; path: string; leave?: boolean }> = [{ value, path: '/' }]
  // Only active ancestors indicate a cycle. The same object may be reused in
  // sibling fields; JSON serialization simply emits its value twice.
  const ancestors = new WeakSet<object>()
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    if (current.leave) {
      if (current.value !== null && typeof current.value === 'object') ancestors.delete(current.value)
      continue
    }
    if (
      current.value === null ||
      typeof current.value === 'string' ||
      typeof current.value === 'boolean'
    ) {
      continue
    }
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) {
        return { code: 'object.not_json', path: current.path, message: 'number must be finite' }
      }
      continue
    }
    if (Array.isArray(current.value)) {
      if (ancestors.has(current.value)) {
        return { code: 'object.not_json', path: current.path, message: 'cyclic arrays are not JSON' }
      }
      ancestors.add(current.value)
      stack.push({ value: current.value, path: current.path, leave: true })
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], path: `${current.path}/${index}` })
      }
      continue
    }
    if (typeof current.value === 'object') {
      if (ancestors.has(current.value)) {
        return { code: 'object.not_json', path: current.path, message: 'cyclic objects are not JSON' }
      }
      ancestors.add(current.value)
      const prototype = Object.getPrototypeOf(current.value)
      if (prototype !== Object.prototype && prototype !== null) {
        return { code: 'object.not_json', path: current.path, message: 'object must have a plain prototype' }
      }
      stack.push({ value: current.value, path: current.path, leave: true })
      const entries = Object.entries(current.value)
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry !== undefined) stack.push({ value: entry[1], path: `${current.path}/${entry[0]}` })
      }
      continue
    }
    return { code: 'object.not_json', path: current.path, message: `unsupported ${typeof current.value}` }
  }
  return undefined
}

function capabilityIssues(value: JsonRecord, supported: ReadonlySet<string>): ValidationIssue[] {
  const required = value.requiredCapabilities
  if (required === undefined) return []
  if (!Array.isArray(required)) {
    return [{ code: 'capability.invalid', path: '/requiredCapabilities', message: 'must be an array' }]
  }
  return required
    .filter((capability): capability is string => typeof capability === 'string')
    .filter((capability) => !supported.has(capability))
    .map((capability) => ({
      code: 'capability.unsupported',
      path: '/requiredCapabilities',
      message: `unsupported required capability: ${capability}`,
    }))
}

function resolvedLimits(partial?: Partial<ValidationLimits>): ValidationLimits {
  return { ...DEFAULT_LIMITS, ...partial }
}

export function validateProtocolObject(
  value: unknown,
  options: ValidationOptions = {},
): ValidationResult {
  try {
    assertJsonRecord(value)
  } catch (error) {
    return { ok: false, issues: [{ code: 'object.not_object', path: '/', message: String(error) }] }
  }
  const objectType = value.objectType
  if (typeof objectType !== 'string' || !(objectType in protocolObjectSchemas)) {
    return {
      ok: false,
      issues: [{ code: 'schema.unknown_object_type', path: '/objectType', message: 'unknown objectType' }],
    }
  }

  const schema = protocolObjectSchemas[objectType as ProtocolObjectType]
  const issues = [
    ...enforceLimits(value, resolvedLimits(options.limits)),
    ...capabilityIssues(value, options.supportedCapabilities ?? new Set()),
  ]
  const validator = compile(schema, false)
  if (!validator(value)) issues.push(...ajvIssues(validator.errors))

  if (options.verifyDigest !== false && typeof value.digest === 'string') {
    try {
      const expected = computeObjectDigest(value)
      if (value.digest !== expected) {
        issues.push({ code: 'digest.mismatch', path: '/digest', message: `expected ${expected}` })
      }
    } catch (error) {
      if (!issues.some((issue) => issue.code === 'object.not_json')) {
        issues.push({ code: 'digest.uncomputable', path: '/digest', message: String(error) })
      }
    }
  }
  return issues.length === 0 ? { ok: true, value, issues } : { ok: false, issues }
}

export function validatePreDigestObject(value: unknown, options: ValidationOptions = {}): ValidationResult {
  try {
    assertJsonRecord(value)
  } catch (error) {
    return { ok: false, issues: [{ code: 'object.not_object', path: '/', message: String(error) }] }
  }
  const objectType = value.objectType
  if (typeof objectType !== 'string' || !(objectType in protocolObjectSchemas)) {
    return {
      ok: false,
      issues: [{ code: 'schema.unknown_object_type', path: '/objectType', message: 'unknown objectType' }],
    }
  }
  const schema = protocolObjectSchemas[objectType as ProtocolObjectType]
  const issues = [
    ...enforceLimits(value, resolvedLimits(options.limits)),
    ...capabilityIssues(value, options.supportedCapabilities ?? new Set()),
  ]
  const validator = compile(schema, true)
  if (!validator(value)) issues.push(...ajvIssues(validator.errors))
  return issues.length === 0 ? { ok: true, value, issues } : { ok: false, issues }
}

export function validateApiPayload(
  payloadType: keyof typeof apiPayloadSchemas,
  value: unknown,
  options: Pick<ValidationOptions, 'limits'> = {},
): ValidationResult {
  const issues = enforceLimits(value, resolvedLimits(options.limits))
  const validator = compile(apiPayloadSchemas[payloadType], false)
  if (!validator(value)) issues.push(...ajvIssues(validator.errors))
  return issues.length === 0
    ? { ok: true, value: value as JsonRecord, issues }
    : { ok: false, issues }
}

export function validateInTotoStatement(value: unknown): ValidationResult {
  const issues = enforceLimits(value, DEFAULT_LIMITS)
  const validator = compile(InTotoStatementSchema, false)
  if (!validator(value)) issues.push(...ajvIssues(validator.errors))
  return issues.length === 0
    ? { ok: true, value: value as JsonRecord, issues }
    : { ok: false, issues }
}

export function assertValidProtocolObject(value: unknown, options: ValidationOptions = {}): JsonRecord {
  const result = validateProtocolObject(value, options)
  if (!result.ok || result.value === undefined) {
    throw new AexpError('AEXP_SCHEMA_UNSUPPORTED', 'Protocol object validation failed', result.issues)
  }
  return result.value
}
