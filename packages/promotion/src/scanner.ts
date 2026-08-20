import type { JsonRecord } from '@aen/protocol'

export interface ScanFinding {
  ruleId: string
  path: string
  preview: string
}

export interface HazardousInstructionFinding {
  ruleId: string
  path: string
}

const RULES: Array<{ id: string; pattern: RegExp }> = [
  { id: 'private-key-pem', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'provider-api-key', pattern: /\b(?:sk|dsk)-[A-Za-z0-9_-]{16,}\b/ },
  { id: 'github-token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'jwt-token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { id: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/i },
  { id: 'generic-secret-assignment', pattern: /\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^\s,;]{8,}/i },
  { id: 'email-address-pii', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { id: 'phone-number-pii', pattern: /(?<![A-Za-z0-9])(?:\+\d{1,3}[ -]?)?1[3-9]\d{9}(?![A-Za-z0-9])|(?<![A-Za-z0-9])\(\d{3}\)\s?\d{3}-\d{4}(?![A-Za-z0-9])/ },
  { id: 'macos-absolute-user-path', pattern: /\/Users\/[^/\s]+\// },
  { id: 'macos-temporary-user-path', pattern: /\/(?:private\/)?var\/folders\/[^\s]+/ },
  { id: 'linux-absolute-home-path', pattern: /\/home\/[^/\s]+\// },
  { id: 'temporary-path', pattern: /\/tmp\/[^\s]+/ },
  { id: 'windows-absolute-user-path', pattern: /[A-Za-z]:\\Users\\[^\\\s]+\\/ },
  { id: 'file-uri', pattern: /\bfile:\/\/[^\s]+/i },
  { id: 'private-network-url', pattern: /https?:\/\/(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?(?:\/|\b)/i },
  { id: 'internal-hostname-url', pattern: /https?:\/\/[A-Za-z0-9.-]+\.(?:local|internal|corp)(?::\d+)?(?:\/|\b)/i },
]

function preview(value: string): string {
  return value.length <= 24 ? '[redacted]' : `${value.slice(0, 4)}…[redacted]`
}

export function scanForRestrictedContent(value: unknown): ScanFinding[] {
  const findings: ScanFinding[] = []
  const stack: Array<{ value: unknown; path: string }> = [{ value, path: '/' }]
  while (stack.length > 0) {
    const item = stack.pop()
    if (item === undefined) break
    if (typeof item.value === 'string') {
      for (const rule of RULES) {
        if (rule.pattern.test(item.value)) findings.push({ ruleId: rule.id, path: item.path, preview: preview(item.value) })
      }
      continue
    }
    if (Array.isArray(item.value)) {
      item.value.forEach((child, index) => stack.push({ value: child, path: `${item.path}/${index}` }))
    } else if (item.value !== null && typeof item.value === 'object') {
      for (const [key, child] of Object.entries(item.value as JsonRecord)) {
        stack.push({ value: child, path: `${item.path === '/' ? '' : item.path}/${key}` })
      }
    }
  }
  return findings.sort((left, right) => left.path.localeCompare(right.path) || left.ruleId.localeCompare(right.ruleId))
}

export function assertNoRestrictedContent(value: unknown, label: string): void {
  const findings = scanForRestrictedContent(value)
  if (findings.length > 0) {
    throw new Error(`${label} failed secret/path scan: ${findings.map((finding) => `${finding.ruleId}@${finding.path}`).join(', ')}`)
  }
}

const PROMPT_INJECTION = /\b(?:ignore|disregard|override|bypass)\b.{0,80}\b(?:previous|prior|system|developer|safety|approval|instructions?|rules?|policy)\b/is
const DESTRUCTIVE_SHELL = /(?:^|[;&|]\s*)(?:sudo\s+)?(?:rm\s+-[a-zA-Z]*r[a-zA-Z]*f|mkfs(?:\.|\s)|dd\s+if=\S+\s+of=\/dev\/|diskutil\s+erase|format\s+[a-zA-Z]:)/i
const PIPE_TO_SHELL = /\b(?:curl|wget)\b[^\n]{0,300}\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i
const CREDENTIAL_EXFILTRATION = /\b(?:upload|send|post|exfiltrat\w*)\b.{0,100}\b(?:credential|secret|token|api[_ -]?key|private[_ -]?key)\b/is

/** Detect instruction text that public MVP clients must not distribute as an ordinary recipe. */
export function scanForHazardousInstructions(value: unknown): HazardousInstructionFinding[] {
  const findings: HazardousInstructionFinding[] = []
  const stack: Array<{ value: unknown; path: string }> = [{ value, path: '/' }]
  while (stack.length > 0) {
    const item = stack.pop()
    if (item === undefined) break
    if (typeof item.value === 'string') {
      if (PROMPT_INJECTION.test(item.value)) findings.push({ ruleId: 'prompt-injection', path: item.path })
      const instructionSurface = /\/(?:recipe|steps|strategy|action|rationale)(?:\/|$)/.test(item.path)
      if (instructionSurface && DESTRUCTIVE_SHELL.test(item.value)) {
        findings.push({ ruleId: 'destructive-shell-instruction', path: item.path })
      }
      if (instructionSurface && PIPE_TO_SHELL.test(item.value)) {
        findings.push({ ruleId: 'remote-pipe-to-shell', path: item.path })
      }
      if (instructionSurface && CREDENTIAL_EXFILTRATION.test(item.value)) {
        findings.push({ ruleId: 'credential-exfiltration-instruction', path: item.path })
      }
      continue
    }
    if (Array.isArray(item.value)) {
      item.value.forEach((child, index) => stack.push({ value: child, path: `${item.path}/${index}` }))
    } else if (item.value !== null && typeof item.value === 'object') {
      for (const [key, child] of Object.entries(item.value as JsonRecord)) {
        stack.push({ value: child, path: `${item.path === '/' ? '' : item.path}/${key}` })
      }
    }
  }
  return findings.sort((left, right) => left.path.localeCompare(right.path) || left.ruleId.localeCompare(right.ruleId))
}

export function assertNoHazardousInstructions(value: unknown, label: string): void {
  const findings = scanForHazardousInstructions(value)
  if (findings.length > 0) {
    throw new Error(`${label} failed hazardous-instruction policy: ${findings.map((finding) => `${finding.ruleId}@${finding.path}`).join(', ')}`)
  }
}
