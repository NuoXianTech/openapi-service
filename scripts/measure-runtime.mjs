import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { performance } from 'node:perf_hooks'

const readyBudgetMs = readPositiveInteger(
  'RUNTIME_READY_BUDGET_MS',
  2_000
)
const idleMemoryBudgetBytes = readPositiveInteger(
  'RUNTIME_IDLE_MEMORY_BUDGET_BYTES',
  128 * 1024 * 1024
)
const token = 'runtime-measurement-token-with-32-characters'
const port = await reservePort()
const baseURL = `http://127.0.0.1:${port}`
const child = spawn(
  process.execPath,
  ['--enable-source-maps', 'dist/index.js'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LISTEN_ADDR: `127.0.0.1:${port}`,
      API_SERVICE_TOKEN: token,
      SHUTDOWN_TIMEOUT: '2s',
      SERVICE_VERSION: 'runtime-measurement',
      SERVICE_COMMIT: 'local'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }
)

let output = ''
let errorOutput = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  output = keepTail(output + chunk)
})
child.stderr.on('data', (chunk) => {
  errorOutput = keepTail(errorOutput + chunk)
})

const startedAt = performance.now()
let result
let failure

try {
  const readyAt = await waitUntilReady(child, baseURL)
  await delay(150)

  const idleMemoryBytes = await readProcessMemoryBytes(child.pid)
  const contractResponse = await fetch(`${baseURL}/openapi.json`, {
    headers: {
      authorization: `Service ${token}`
    },
    signal: AbortSignal.timeout(2_000)
  })
  const contractSha256 = contractResponse.headers.get(
    'x-openapi-sha256'
  )
  await contractResponse.arrayBuffer()

  if (!contractResponse.ok || !/^[0-9a-f]{64}$/.test(contractSha256 ?? '')) {
    throw new Error('OpenAPI contract check failed')
  }

  result = {
    readyMilliseconds: Math.round(readyAt - startedAt),
    readyBudgetMilliseconds: readyBudgetMs,
    idleMemoryMiB: roundMiB(idleMemoryBytes),
    idleMemoryBudgetMiB: roundMiB(idleMemoryBudgetBytes),
    memoryMetric:
      process.platform === 'win32' ? 'working_set' : 'rss',
    openapiStatus: contractResponse.status,
    contractSha256
  }

  if (result.readyMilliseconds > readyBudgetMs) {
    throw new Error('runtime ready budget was exceeded')
  }
  if (idleMemoryBytes > idleMemoryBudgetBytes) {
    throw new Error('runtime idle memory budget was exceeded')
  }
} catch (error) {
  failure = error
} finally {
  await stopChild(child)
}

if (result) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

if (failure) {
  if (output.trim()) {
    process.stderr.write('SERVICE_STDOUT\n' + output)
  }
  if (errorOutput.trim()) {
    process.stderr.write('SERVICE_STDERR\n' + errorOutput)
  }
  throw failure
}

async function waitUntilReady(processHandle, serviceBaseURL) {
  const deadline = performance.now() + 5_000

  while (performance.now() < deadline) {
    if (hasExited(processHandle)) {
      throw new Error(
        `API Service exited before ready with code ${processHandle.exitCode ?? 'none'} and signal ${processHandle.signalCode ?? 'none'}`
      )
    }

    try {
      const response = await fetch(`${serviceBaseURL}/readyz`, {
        signal: AbortSignal.timeout(500)
      })
      if (response.ok && (await response.json()).status === 'ready') {
        return performance.now()
      }
    } catch {
      // The socket is expected to refuse connections during startup.
    }

    await delay(50)
  }

  throw new Error('API Service did not become ready within 5 seconds')
}

async function readProcessMemoryBytes(pid) {
  if (!pid) {
    throw new Error('API Service process ID is unavailable')
  }

  if (process.platform === 'linux') {
    const status = await readFile(`/proc/${pid}/status`, 'utf8')
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)
    if (!match) {
      throw new Error('could not read Linux RSS')
    }
    return parsePositiveNumber(match[1], 'Linux RSS') * 1024
  }

  if (process.platform === 'win32') {
    const bytes = execFileSync(
      'pwsh.exe',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`],
      { encoding: 'utf8' }
    ).trim()
    return parsePositiveNumber(bytes, 'Windows working set')
  }

  const kilobytes = execFileSync(
    'ps',
    ['-o', 'rss=', '-p', String(pid)],
    { encoding: 'utf8' }
  ).trim()
  return parsePositiveNumber(kilobytes, 'process RSS') * 1024
}

async function reservePort() {
  const server = createServer()
  server.unref()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('could not reserve a local port')
  }
  const selectedPort = address.port
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
  return selectedPort
}

async function stopChild(processHandle) {
  if (hasExited(processHandle)) {
    return
  }

  const gracefulExit = once(processHandle, 'exit')
  processHandle.kill('SIGTERM')
  await Promise.race([gracefulExit, delay(2_000)])
  if (!hasExited(processHandle)) {
    const forcedExit = once(processHandle, 'exit')
    processHandle.kill('SIGKILL')
    await Promise.race([forcedExit, delay(2_000)])
  }
  if (!hasExited(processHandle)) {
    throw new Error('API Service measurement process did not stop')
  }
}

function hasExited(processHandle) {
  return (
    processHandle.exitCode !== null ||
    processHandle.signalCode !== null
  )
}

function readPositiveInteger(name, fallback) {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function parsePositiveNumber(value, label) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} is not a positive number`)
  }
  return parsed
}

function roundMiB(bytes) {
  return Math.round((bytes / 1024 / 1024) * 100) / 100
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function keepTail(value) {
  return value.slice(-16_384)
}
