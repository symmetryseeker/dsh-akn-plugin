export type AexpErrorCode =
  | 'AEXP_SCHEMA_UNSUPPORTED'
  | 'AEXP_DIGEST_MISMATCH'
  | 'AEXP_CAPABILITY_UNSUPPORTED'
  | 'AEXP_SIGNATURE_INVALID'
  | 'AEXP_OBJECT_TOO_LARGE'

export class AexpError extends Error {
  readonly code: AexpErrorCode
  readonly details?: unknown

  constructor(code: AexpErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AexpError'
    this.code = code
    this.details = details
  }
}
