#!/usr/bin/env node
// Builds the release body from the artifacts that were actually produced, so the
// download table can never point at a file the workflow skipped.
import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const tag = readArg('tag', process.env.GITHUB_REF_NAME)
const assetsDir = readArg('assets', 'dist-release')
const outputPath = readArg('output', 'release-body.md')
const repository = process.env.GITHUB_REPOSITORY

if (!tag) throw new Error('--tag or GITHUB_REF_NAME is required')
if (!repository) throw new Error('GITHUB_REPOSITORY is required')

const version = tag.replace(/^v/, '')
const files = new Set(readdirSync(assetsDir))

if (files.size === 0) throw new Error(`no artifacts found in ${assetsDir}`)

const assetUrl = (name) =>
  `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`
const link = (name) => (files.has(name) ? `[\`${name}\`](${assetUrl(name)})` : null)

const windowsArchs = [
  { label: 'Windows 10/11, 64-bit', arch: 'x64' },
  { label: 'Windows 10/11, 32-bit', arch: 'x86' },
]

const rows = []

for (const { label, arch } of windowsArchs) {
  const installer = link(`iPAGet_${version}_windows-${arch}.msi`)
  const nsis = link(`iPAGet_${version}_windows-${arch}-setup.exe`)
  const portable = link(`iPAGet_${version}_windows-${arch}-portable.exe`)
  if (!installer && !nsis && !portable) continue
  const alternatives = [nsis, portable].filter(Boolean).join(' · ') || null
  rows.push([label, installer || nsis || portable, alternatives])
}

const macDmg = link(`iPAGet_${version}_macos-universal.dmg`)
const macZip = link(`iPAGet_${version}_macos-universal.app.zip`)
if (macDmg || macZip) {
  rows.push(['macOS (Apple silicon and Intel)', macDmg || macZip, macDmg ? macZip : null, null])
}

const appImage = link(`iPAGet_${version}_linux-amd64.AppImage`)
const linuxPortable = link(`iPAGet_${version}_linux-amd64-portable`)
if (appImage || linuxPortable) {
  rows.push(['Linux, 64-bit', appImage || linuxPortable, appImage ? linuxPortable : null, null])
}

const table = [
  '| System | Download this | Other builds |',
  '| --- | --- | --- |',
  ...rows.map((cells) => `| ${cells.map((cell) => cell || '—').join(' | ')} |`),
]

const notes = []
if (rows.some((cells) => cells[0].startsWith('Windows'))) {
  notes.push(
    '- **Windows** — `.msi` is the normal installer. `-setup.exe` is the same app packaged with NSIS, and `-portable.exe` runs without installing anything.',
    '- Windows shows a SmartScreen warning because the build is not code signed: choose **More info → Run anyway**.',
  )
}
if (macDmg || macZip) {
  notes.push(
    '- **macOS** — the single universal file runs on both Apple silicon and Intel; pick the DMG when it is listed, otherwise the `.app.zip`. The build is not signed or notarized: open it with **right-click → Open**, or run `xattr -dr com.apple.quarantine /Applications/iPAGet.app`.',
  )
}
if (appImage || linuxPortable) {
  notes.push(
    '- **Linux** — the AppImage is one executable file: `chmod +x` it and run. It is built on Ubuntu 24.04 and needs glibc 2.39+ (Ubuntu 24.04+, Debian 13+, Fedora 40+). The `-portable` file is the same binary without the AppImage wrapper.',
  )
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

let previousTag = null
try {
  previousTag = git(['describe', '--tags', '--abbrev=0', `${tag}^`])
} catch {
  // First release: the changelog covers every commit reachable from the tag.
}
const range = previousTag ? `${previousTag}..${tag}` : tag
const separator = '\u001e'
const log = git([
  'log',
  range,
  '--date=short',
  '--pretty=format:%h\t%ad\t%an\t%s\t%b' + separator,
])

const commits = log
  .split(separator)
  .map((chunk) => chunk.trim())
  .filter(Boolean)
  .map((chunk) => {
    const [sha, date, author, subject, ...body] = chunk.split('\t')
    return {
      sha,
      date,
      author,
      subject,
      body: body.join('\t').replace(/\s+/g, ' ').trim(),
    }
  })

const changelog = commits.map(({ sha, date, author, subject, body }) => {
  const line = `- ${subject} ([${sha}](https://github.com/${repository}/commit/${sha}), ${date}, ${author})`
  return body ? `${line}\n  ${body}` : line
})

const body = [
  '## Download',
  '',
  'Pick one file for your system. You do not need the rest.',
  '',
  ...table,
  '',
  ...notes,
  '',
  '## What changed',
  '',
  previousTag
    ? `All ${commits.length} commits since ${previousTag}.`
    : `All ${commits.length} commits in this release.`,
  '',
  ...changelog,
  '',
  previousTag
    ? `**Full diff**: https://github.com/${repository}/compare/${previousTag}...${tag}`
    : `**Full history**: https://github.com/${repository}/commits/${tag}`,
  '',
].join('\n')

writeFileSync(outputPath, body)
console.log(`Wrote ${outputPath} with ${commits.length} commits and ${rows.length} platform rows`)
