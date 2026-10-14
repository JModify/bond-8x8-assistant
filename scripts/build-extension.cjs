/* Build a deterministic, entirely local Manifest V3 package from the shared core. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const folder = path.join(root, 'extension')
const source = fs.readFileSync(path.join(root, 'Service-Desk-8x8-Assistant.js'), 'utf8')
const baseVersion = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'))
const config = JSON.parse(fs.readFileSync(path.join(folder, 'update-config.json'), 'utf8'))
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
// Change only the outer entry point. The function body and template-literal text
// stay byte-for-byte identical to the reusable snippet, including CSS and TXT strings.
const coreFunction = source.replace(/^;\(\(\) => \{$/m, 'function startServiceDeskAssistant () {').replace(/\}\)\(\)\s*$/, '}\n')
if (coreFunction === source || !coreFunction.includes('function startServiceDeskAssistant () {')) throw new Error('The core entry point could not be packaged.')
const compiled = `/* Generated from Service-Desk-8x8-Assistant.js. Run npm run build:extension. */
${coreFunction}
;(() => {
  const runtime = window.__itsCallAssistRuntime
  if (!runtime) return
  runtime.ready.then(() => {
    if (!runtime.active || window.__itsCallAssist) return
    startServiceDeskAssistant()
    runtime.onStarted()
  }).catch((error) => runtime.reportStartError(error))
})()
`
const metadata = {
  extensionVersion: manifest.version,
  coreVersion: baseVersion,
  coreSha256: crypto.createHash('sha256').update(source).digest('hex')
}
const generated = {
  'assistant.js': compiled,
  'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
  'core-info.json': JSON.stringify(metadata, null, 2) + '\n'
}
for (const [name, content] of Object.entries(generated)) {
  const file = path.join(folder, name)
  if (process.argv.includes('--check')) {
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
  const result = spawnSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3', ['-c', script, folder, target], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'Extension packaging failed.')
  process.stdout.write(result.stdout)
}
console.log(`Edge extension ${manifest.version} uses core ${baseVersion}; source SHA-256 ${metadata.coreSha256}`)
