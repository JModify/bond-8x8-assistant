/* Build a deterministic Manifest V3 package from the single versioned extension source. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { packagedSource, compile } = require('./extension-core.cjs')
const root = path.resolve(__dirname, '..')
const releases = path.join(root, 'releases', 'edge-extension')
// Compare version components numerically so 1.10.0 sorts after 1.9.0.
const releasedVersions = fs.readdirSync(releases, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => {
    const a = left.split('.').map(Number)
    const b = right.split('.').map(Number)
    for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return b[index] - a[index]
    return 0
  })
if (!releasedVersions.length) throw new Error('No versioned extension source was found.')
const folder = path.join(releases, releasedVersions[0], 'extension')
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'))
const releasedVersion = manifest.version
const versionOption = process.argv.indexOf('--version')
const targetVersion = versionOption < 0 ? releasedVersion : process.argv[versionOption + 1]
if (!/^\d+\.\d+\.\d+$/.test(targetVersion || '')) throw new Error('Use --version followed by a complete extension version, such as 1.0.1.')
if (targetVersion !== releasedVersion && fs.existsSync(path.join(releases, targetVersion))) throw new Error('That extension version is already released; choose a new version.')
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'extension-updates.json'), 'utf8'))
const previous = JSON.parse(fs.readFileSync(path.join(folder, 'core-info.json'), 'utf8'))
const refreshCore = process.argv.includes('--refresh-core')
// Prototype releases must not silently ship a new extension under its old version.
const source = refreshCore
  ? fs.readFileSync(path.join(root, 'Service-Desk-8x8-Assistant.js'), 'utf8')
  : packagedSource(fs.readFileSync(path.join(folder, 'assistant.js'), 'utf8'))
const baseVersion = refreshCore ? fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim() : previous.coreVersion
const sourceHash = crypto.createHash('sha256').update(source).digest('hex')
if (!refreshCore && sourceHash !== previous.coreSha256) throw new Error('The packaged extension core differs from its recorded hash.')
if (refreshCore && sourceHash !== previous.coreSha256 && fs.existsSync(path.join(releases, targetVersion))) {
  throw new Error('Choose a new --version before refreshing a released extension core.')
}
manifest.version = targetVersion
if (targetVersion !== releasedVersion) manifest.version_name = targetVersion
delete manifest.update_url
delete manifest.key
if (config.enabled) {
  // Edge, rather than page JavaScript, fetches a signed extension update manifest.
  const url = new URL(config.updateUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Updates require a public HTTPS update-manifest URL.')
  manifest.update_url = url.href
}
if (config.publicKey !== null) {
  // Only the public identity key may enter the package. Signing keys stay outside Git.
  if (typeof config.publicKey !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(config.publicKey)) throw new Error('Invalid extension public key.')
  manifest.key = config.publicKey
}
const compiled = compile(source)
const metadata = {
  extensionVersion: manifest.version,
  coreVersion: baseVersion,
  coreSha256: sourceHash
}
const generated = {
  'assistant.js': compiled,
  'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
  'core-info.json': JSON.stringify(metadata, null, 2) + '\n'
}
// Builds go outside the repository. A build or package must never rewrite a released source.
const stagedFolder = path.join(root, '..', 'output', 'edge-extension', targetVersion, 'extension')
const checking = process.argv.includes('--check')
const checkedFolder = targetVersion === releasedVersion ? folder : stagedFolder
if (!checking) {
  fs.rmSync(stagedFolder, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(stagedFolder), { recursive: true })
  fs.cpSync(folder, stagedFolder, { recursive: true })
}
for (const [name, content] of Object.entries(generated)) {
  const file = path.join(checking ? checkedFolder : stagedFolder, name)
  if (checking) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) throw new Error(name + ' is out of date. Run npm run build:extension.')
  } else fs.writeFileSync(file, content)
}
if (process.argv.includes('--package')) {
  const target = path.join(root, '..', 'output', `Service-Desk-8x8-Assistant-Edge-${manifest.version}.zip`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  // Python's standard library writes reproducible ZIPs; no packager is downloaded.
  const script = `import pathlib, sys, zipfile
folder = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(folder.rglob('*')):
        if not file.is_file() or file.name == 'update-config.json':
            continue
        item = zipfile.ZipInfo(file.relative_to(folder).as_posix(), (2026, 10, 14, 0, 0, 0))
        item.compress_type = zipfile.ZIP_DEFLATED
        item.external_attr = 0o100644 << 16
        archive.writestr(item, file.read_bytes())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
print(target)
`
  const result = spawnSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3', ['-c', script, stagedFolder, target], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'Extension packaging failed.')
  process.stdout.write(result.stdout)
}
console.log(`Edge extension ${manifest.version} uses core ${baseVersion}; source SHA-256 ${metadata.coreSha256}`)
