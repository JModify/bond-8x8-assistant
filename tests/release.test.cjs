/* Exercise two-download publication offline: no token, network or real release mutation. */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { prepareRelease, publishRelease, githubRequest } = require('../tools/publish-prototype-release.cjs')
const { buildBookmark } = require('../tools/build-bookmark.cjs')
const root = path.resolve(__dirname, '..')
const commit = 'a'.repeat(40)
const info = prepareRelease(root, 'JModify/bond-8x8-assistant', commit)
const checks = []
function check (name, fn) { checks.push({ name, fn }) }
const goodAsset = (expected) => ({ name: expected.name, size: expected.source.length, digest: expected.digest, state: 'uploaded' })
function savedRelease (draft = false) {
  return {
    id: 7,
    name: info.name,
    tag_name: info.tag,
    body: info.body,
    draft,
    prerelease: false,
    assets: info.assets.map(goodAsset),
    html_url: 'https://github.com/' + info.repository + '/releases/tag/' + info.tag,
    upload_url: 'https://uploads.github.com/repos/' + info.repository + '/releases/7/assets{?name,label}'
  }
}
function fakeGitHub (options = {}) {
  let tag = options.tag || null
  let release = options.release || null
  const calls = []
  const base = '/repos/' + info.repository
  const request = async (resource, settings = {}) => {
    const url = new URL(resource, 'https://api.github.com')
    const method = settings.method || 'GET'
    calls.push({ path: url.pathname, method, name: url.searchParams.get('name'), body: settings.body })
    if (url.pathname === base + '/git/ref/tags/' + info.tag) return tag
    if (url.pathname === base + '/git/tags/' + 'b'.repeat(40)) return { object: { type: 'commit', sha: options.annotatedCommit || commit } }
    if (url.pathname === base + '/git/refs' && method === 'POST') {
      assert.equal(settings.body.sha, commit)
      tag = { object: { type: 'commit', sha: settings.body.sha } }
      return tag
    }
    if (url.pathname === base + '/releases/tags/' + info.tag) return release
    if (url.pathname === base + '/releases' && method === 'POST') {
      assert.equal(settings.body.draft, true)
      assert.equal(settings.body.target_commitish, commit)
      release = { ...savedRelease(true), assets: [] }
      return release
    }
    if (url.pathname === base + '/releases/7/assets' && method === 'POST') {
      assert.equal(url.origin, 'https://uploads.github.com')
      const expected = info.assets.find((asset) => asset.name === url.searchParams.get('name'))
      assert(expected, 'Only the JavaScript and bookmark assets may be uploaded')
      assert.equal(settings.contentType, expected.contentType)
      assert(Buffer.isBuffer(settings.body) && settings.body.equals(expected.source))
      const asset = options.badDigest === expected.name
        ? { ...goodAsset(expected), digest: 'sha256:' + '0'.repeat(64) }
        : goodAsset(expected)
      release.assets.push(asset)
      return asset
    }
    if (url.pathname === base + '/releases/7' && method === 'PATCH') {
      assert.equal(settings.body.draft, false)
      assert.equal(release.assets.length, 2)
      release.draft = false
      return release
    }
    throw new Error('Unexpected fixture request: ' + method + ' ' + resource)
  }
  return { request, calls }
}
function withTemporaryRelease (fn) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-release-'))
  const files = ['VERSION', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'Service-Desk-8x8-Assistant.js',
    'releases/edge-prototype/' + info.version + '/Service-Desk-8x8-Assistant.js',
    'releases/edge-prototype/' + info.version + '/RELEASE_NOTES.md',
    'docs/bookmark/' + info.assets[1].name]
  try {
    for (const file of files) {
      const target = path.join(folder, file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(root, file), target)
    }
    fn(folder)
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
}

check('Release offers the exact JavaScript and recommended bookmark with concise agent notes', () => {
  assert.equal(info.version, fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim())
  assert.equal(info.name, 'Service Desk 8x8 Assistant - Prototype v' + info.version)
  assert.equal(info.assets.length, 2)
  assert.equal(info.assets[0].name, 'Service-Desk-8x8-Assistant-Prototype-' + info.version + '.js')
  assert.equal(info.assets[1].name, 'Service-Desk-8x8-Assistant-Bookmark-' + info.version + '.html')
  assert(info.body.includes('**Recommended:**'))
  assert(info.body.includes('organisation-approved Microsoft Edge extension'))
  assert(!info.body.includes('Validation runs on GitHub Actions'))
  assert(info.body.includes('/releases/download/' + info.tag + '/' + info.assets[1].name))
  assert(info.assets[0].source.equals(fs.readFileSync(path.join(root, 'Service-Desk-8x8-Assistant.js'))))
  assert(info.assets[1].source.equals(Buffer.from(buildBookmark(root).html)))
})
check('Mixed metadata, stale archives and old release versions fail before publication', () => {
  withTemporaryRelease((folder) => {
    const archive = path.join(folder, 'releases/edge-prototype/' + info.version + '/Service-Desk-8x8-Assistant.js')
    fs.appendFileSync(archive, '// stale\n')
    assert.throws(() => prepareRelease(folder, info.repository, commit), /must agree/)
    fs.copyFileSync(path.join(root, 'Service-Desk-8x8-Assistant.js'), archive)
    const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'package.json')))
    metadata.version = '1.1.6'
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify(metadata))
    assert.throws(() => prepareRelease(folder, info.repository, commit), /must agree/)
    fs.writeFileSync(path.join(folder, 'VERSION'), '1.2.0\n')
    assert.throws(() => prepareRelease(folder, info.repository, commit), /start at version 1.2.1/)
  })
  assert.throws(() => prepareRelease(root, info.repository, 'main'), /exact release commit/)
  assert.throws(() => prepareRelease(root, '../other', commit), /repository/)
})
check('An altered bookmark cannot publish alongside a valid JavaScript snapshot', () => {
  withTemporaryRelease((folder) => {
    fs.appendFileSync(path.join(folder, 'docs/bookmark/' + info.assets[1].name), '\n<!-- stale -->')
    assert.throws(() => prepareRelease(folder, info.repository, commit), /bookmark download must match/)
  })
})
check('Later versions remain blocked even with otherwise matching source, bookmark and notes', () => {
  withTemporaryRelease((folder) => {
    const version = info.version.split('.').map(Number)
    version[2]++
    const future = version.join('.')
    const source = fs.readFileSync(path.join(folder, 'Service-Desk-8x8-Assistant.js'), 'utf8')
      .replace('Prototype v' + info.version + '\n', 'Prototype v' + future + '\n')
      .replace("const VERSION = deployment?.version || '" + info.version + "'", "const VERSION = deployment?.version || '" + future + "'")
    fs.writeFileSync(path.join(folder, 'VERSION'), future + '\n')
    fs.writeFileSync(path.join(folder, 'Service-Desk-8x8-Assistant.js'), source)
    for (const file of ['package.json', 'package-lock.json']) {
      const data = JSON.parse(fs.readFileSync(path.join(folder, file)))
      data.version = future
      if (data.packages) data.packages[''].version = future
      fs.writeFileSync(path.join(folder, file), JSON.stringify(data))
    }
    const release = path.join(folder, 'releases/edge-prototype/' + future)
    fs.mkdirSync(release, { recursive: true })
    fs.writeFileSync(path.join(release, 'Service-Desk-8x8-Assistant.js'), source)
    fs.writeFileSync(path.join(release, 'RELEASE_NOTES.md'), '# Prototype v' + future + '\n\n- Fictional future update.\n')
    fs.appendFileSync(path.join(folder, 'CHANGELOG.md'), '\n## ' + future + ' (Prototype) — 2026-10-16\n\n- Fixture.\n')
    const built = buildBookmark(folder)
    fs.writeFileSync(path.join(folder, 'docs/bookmark/' + built.fileName), built.html)
    assert.throws(() => prepareRelease(folder, info.repository, commit), /limited to prototype v1.2.3/)
  })
})
check('Missing or incorrectly versioned short release notes cannot publish', () => {
  withTemporaryRelease((folder) => {
    const file = path.join(folder, 'releases/edge-prototype/' + info.version + '/RELEASE_NOTES.md')
    fs.writeFileSync(file, '# Prototype v0.0.0\n\n- Incorrect notes.\n')
    assert.throws(() => prepareRelease(folder, info.repository, commit), /version-matched release notes/)
    fs.unlinkSync(file)
    assert.throws(() => prepareRelease(folder, info.repository, commit))
  })
})
check('New release pins the tag and verifies both draft uploads before publishing', async () => {
  const api = fakeGitHub()
  assert.equal(await publishRelease(info, api.request), savedRelease().html_url)
  assert.deepEqual(api.calls.filter((call) => call.method !== 'GET').map((call) => call.method + ' ' + call.path), [
    'POST /repos/' + info.repository + '/git/refs',
    'POST /repos/' + info.repository + '/releases',
    'POST /repos/' + info.repository + '/releases/7/assets',
    'POST /repos/' + info.repository + '/releases/7/assets',
    'PATCH /repos/' + info.repository + '/releases/7'
  ])
  assert.deepEqual(api.calls.filter((call) => call.name).map((call) => call.name), info.assets.map((asset) => asset.name))
})
check('Rerunning a matching published release makes no changes', async () => {
  const api = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release: savedRelease() })
  await publishRelease(info, api.request)
  assert(api.calls.every((call) => call.method === 'GET'))
})
check('Existing tags are never moved to a different tested commit', async () => {
  const api = fakeGitHub({ tag: { object: { type: 'commit', sha: 'c'.repeat(40) } } })
  await assert.rejects(publishRelease(info, api.request), /will not be moved/)
  assert(api.calls.every((call) => call.method === 'GET'))
})
check('Annotated tags must resolve to the exact release commit', async () => {
  const tag = { object: { type: 'tag', sha: 'b'.repeat(40) } }
  await publishRelease(info, fakeGitHub({ tag, release: savedRelease() }).request)
  const bad = fakeGitHub({ tag, annotatedCommit: 'c'.repeat(40) })
  await assert.rejects(publishRelease(info, bad.request), /will not be moved/)
  assert(bad.calls.every((call) => call.method === 'GET'))
})
check('An interrupted matching draft resumes only its missing bookmark download', async () => {
  const release = savedRelease(true)
  release.assets = [goodAsset(info.assets[0])]
  const api = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release })
  await publishRelease(info, api.request)
  assert.deepEqual(api.calls.filter((call) => call.name).map((call) => call.name), [info.assets[1].name])
  assert.equal(api.calls.filter((call) => call.method === 'PATCH').length, 1)
})
check('A complete matching draft needs only its final publication', async () => {
  const api = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release: savedRelease(true) })
  await publishRelease(info, api.request)
  assert.deepEqual(api.calls.filter((call) => call.method !== 'GET').map((call) => call.method), ['PATCH'])
})
check('Corruption of either upload leaves the release unpublished', async () => {
  for (const asset of info.assets) {
    const api = fakeGitHub({ badDigest: asset.name })
    await assert.rejects(publishRelease(info, api.request), /does not match/)
    assert(!api.calls.some((call) => call.method === 'PATCH'))
  }
})
check('Different metadata or either altered existing asset is never overwritten', async () => {
  const release = savedRelease()
  release.name = 'Different release'
  const api = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release })
  await assert.rejects(publishRelease(info, api.request), /will not be overwritten/)
  assert(api.calls.every((call) => call.method === 'GET'))
  for (let index = 0; index < 2; index++) {
    const changed = savedRelease(true)
    changed.assets[index].size++
    const assetApi = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release: changed })
    await assert.rejects(publishRelease(info, assetApi.request), /does not match/)
    assert(assetApi.calls.every((call) => call.method === 'GET'))
  }
})
check('An incomplete published release or unexpected extra asset cannot be silently changed', async () => {
  for (const extra of [false, true]) {
    const release = savedRelease()
    if (extra) release.assets.push({ name: 'unexpected.txt', size: 0, state: 'uploaded' })
    else release.assets.pop()
    const api = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release })
    await assert.rejects(publishRelease(info, api.request), extra ? /will not be overwritten/ : /missing a verified download/)
    assert(api.calls.every((call) => call.method === 'GET'))
  }
})
check('An unexpected upload host is rejected before transferring either download', async () => {
  const release = savedRelease(true)
  release.assets = []
  release.upload_url = 'https://example.invalid/upload'
  const api = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release })
  await assert.rejects(publishRelease(info, api.request), /Unexpected release upload destination/)
  assert(api.calls.every((call) => call.method === 'GET'))
  await assert.rejects(githubRequest('https://example.invalid/'), /GitHub API hosts/)
})
check('Local execution cannot publish and explicit check mode performs validation only', () => {
  const script = path.join(root, 'tools/publish-prototype-release.cjs')
  const env = { ...process.env, GITHUB_ACTIONS: '', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: commit, GITHUB_TOKEN: '' }
  const denied = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
  assert.notEqual(denied.status, 0)
  assert(denied.stderr.includes('requires a main-branch GitHub Actions run'))
  const checked = spawnSync(process.execPath, [script, '--check'], { env, encoding: 'utf8' })
  assert.equal(checked.status, 0, checked.stderr)
  assert(checked.stdout.includes('JavaScript and bookmark'))
})

;(async () => {
  for (const { name, fn } of checks) { await fn(); console.log('PASS:', name) }
  console.log(checks.length + ' release scenarios passed.')
})().catch((error) => { console.error(error); process.exitCode = 1 })
