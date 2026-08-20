import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = fileURLToPath(new URL('../', import.meta.url))
const outputFile = resolve(rootDirectory, 'dist/build-info.json')
const packageJson = JSON.parse(
  await readFile(resolve(rootDirectory, 'package.json'), 'utf8')
)

function nonEmptyString(value) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function readGitCommit() {
  try {
    return nonEmptyString(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }))
  } catch {
    return undefined
  }
}

const version = nonEmptyString(process.env.SERVICE_VERSION)
  ?? nonEmptyString(packageJson.version)
  ?? 'dev'
const commit = nonEmptyString(process.env.SERVICE_COMMIT)
  ?? readGitCommit()
  ?? 'unknown'

await mkdir(dirname(outputFile), { recursive: true })
await writeFile(outputFile, `${JSON.stringify({ version, commit }, null, 2)}\n`)
