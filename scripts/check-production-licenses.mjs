import { execFileSync } from 'node:child_process'

const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT'
])

const report = loadLicenseReport()
const rejected = Object.entries(report).filter(
  ([license]) => !allowedLicenses.has(license)
)

if (rejected.length > 0) {
  for (const [license, packages] of rejected) {
    const names = packages
      .map((dependency) => `${dependency.name}@${dependency.versions.join(',')}`)
      .join(', ')
    process.stderr.write(`Rejected production license ${license}: ${names}\n`)
  }
  process.stderr.write(
    'Review the dependency and repository licensing decision before changing the allowlist.\n'
  )
  process.exit(1)
}

const packageCount = Object.values(report).reduce(
  (total, packages) => total + packages.length,
  0
)
const licenses = Object.keys(report).sort().join(', ')
process.stdout.write(
  `Production dependency licenses accepted: ${licenses} (${packageCount} packages)\n`
)

function loadLicenseReport() {
  const argumentsList = ['licenses', 'list', '--prod', '--json']
  const pnpmCLI = process.env.npm_execpath
  const output = pnpmCLI
    ? execFileSync(process.execPath, [pnpmCLI, ...argumentsList], {
        encoding: 'utf8'
      })
    : execFileSync(
        process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        argumentsList,
        { encoding: 'utf8' }
      )

  return JSON.parse(output)
}
