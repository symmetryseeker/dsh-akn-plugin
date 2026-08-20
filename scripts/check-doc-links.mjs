import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

const root = resolve(process.cwd())
const ignoredDirectories = new Set([
  '.git',
  '.work',
  'coverage',
  'deepseek-harness',
  'dist',
  'dsh-web-ui',
  'node_modules',
])

async function markdownFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(path))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(path)
  }
  return files
}

const failures = []
let checkedLinks = 0

for (const file of await markdownFiles(root)) {
  const source = await readFile(file, 'utf8')
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/gu
  for (const match of source.matchAll(pattern)) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    if (target === '' || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue
    target = target.split('#', 1)[0]
    try {
      target = decodeURIComponent(target)
    } catch {
      failures.push(`${file.slice(root.length + 1)}: malformed URL encoding in ${match[1]}`)
      continue
    }
    checkedLinks += 1
    const line = source.slice(0, match.index).split('\n').length
    try {
      await stat(resolve(dirname(file), target))
    } catch {
      failures.push(`${file.slice(root.length + 1)}:${line}: missing ${target}`)
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Resolved ${checkedLinks} relative Markdown links.\n`)
}
