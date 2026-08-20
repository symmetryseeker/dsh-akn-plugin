import { readFile, readdir, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = process.cwd()
const excludedDirectories = new Set([
  '.backups', '.git', '.work', 'deepseek-harness', 'dist', 'dsh-web-ui', 'fixtures', 'node_modules', 'test',
])
const includedExtensions = new Set(['.js', '.json', '.md', '.mjs', '.ts', '.yaml', '.yml'])
const allowedTestVectorFiles = new Set([
  'packages/protocol/src/generate-schemas.ts',
  'packages/promotion/src/scanner.ts',
  'scripts/check-source-secrets.mjs',
  'conformance/keys/fixture-ed25519-private.pem',
])
const rules = [
  { id: 'private-key-pem', pattern: new RegExp(['-----BEGIN ', '(?:RSA |EC |OPENSSH )?', 'PRIVATE KEY-----'].join('')) },
  { id: 'provider-api-key', pattern: /\b(?:sk|dsk)-[A-Za-z0-9_-]{16,}\b/ },
  { id: 'github-token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
]

function extension(path) {
  const index = path.lastIndexOf('.')
  return index === -1 ? '' : path.slice(index)
}

async function files(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) output.push(...await files(absolute))
    else if (entry.isFile() && includedExtensions.has(extension(entry.name)) && (await stat(absolute)).size <= 2 * 1024 * 1024) output.push(absolute)
  }
  return output
}

const findings = []
for (const absolute of await files(root)) {
  const path = relative(root, absolute)
  if (allowedTestVectorFiles.has(path)) continue
  const content = await readFile(absolute, 'utf8')
  for (const rule of rules) {
    if (rule.pattern.test(content)) findings.push(`${rule.id}@${path}`)
  }
}
if (findings.length > 0) throw new Error(`possible operational secret found: ${findings.join(', ')}`)
process.stdout.write('No operational secret signatures found outside reviewed test vectors.\n')
