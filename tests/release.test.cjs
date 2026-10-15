/* Exercise publication offline: no token, GitHub request or real release mutation. */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { prepareRelease, publishRelease, githubRequest } = require('../tools/publish-prototype-release.cjs')
const root = path.resolve(__dirname, '..')
const commit = 'a'.repeat(40)
const info = prepareRelease(root, 'JModify/bond-8x8-assistant', commit)
const checks = []
function check (name, fn) { checks.push({ name, fn }) }
const goodAsset = () => ({ name: info.assetName, size: info.source.length, digest: info.digest, state: 'uploaded' })
function savedRelease (draft = false) {
  return { id: 7, name: info.name, tag_name: info.tag, body: info.body, draft, prerelease: false, assets: [goodAsset()], html_url: 'https://github.com/' + info.repository + '/releases/tag/' + info.tag, upload_url: `https://uploads.github.com/repos/${info.repository}/releases/7/assets{?name,label}` }
}
function fakeGitHub (options = {}) {
  let tag = options.tag || null
  let release = options.release || null
  const calls = []
  const base = `/repos/${info.repository}`
  const request = async (resource, settings = {}) => {
    const url = new URL(resource, 'https://api.github.com')
    const method = settings.method || 'GET'
    calls.push({ path: url.pathname, method, body: settings.body })
    if (url.pathname === `${base}/git/ref/tags/${info.tag}`) return tag
    if (url.pathname === `${base}/git/tags/${'b'.repeat(40)}`) return { object: { type: 'commit', sha: options.annotatedCommit || commit } }
    if (url.pathname === `${base}/git/refs` && method === 'POST') {
      assert.equal(settings.body.sha, commit)
      tag = { object: { type: 'commit', sha: settings.body.sha } }
      return tag
    }
    if (url.pathname === `${base}/releases/tags/${info.tag}`) return release
    if (url.pathname === `${base}/releases` && method === 'POST') {
      assert.equal(settings.body.draft, true)
      assert.equal(settings.body.target_commitish, commit)
      release = { ...savedRelease(true), assets: [] }
      return release
    }
    if (url.pathname === `${base}/releases/7/assets` && method === 'POST') {
      assert.equal(url.origin, 'https://uploads.github.com')
      assert.equal(url.searchParams.get('name'), info.assetName)
      assert(Buffer.isBuffer(settings.body) && settings.body.equals(info.source))
      const asset = options.badDigest ? { ...goodAsset(), digest: 'sha256:' + '0'.repeat(64) } : goodAsset()
      release.assets.push(asset)
      return asset
    }
    if (url.pathname === `${base}/releases/7` && method === 'PATCH') {
      assert.equal(settings.body.draft, false)
      release.draft = false
      return release
    }
    throw new Error('Unexpected fixture request: ' + method + ' ' + resource)
  }
  return { request, calls }
}
function withTemporaryRelease (fn) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-release-'))
  try {
    for (const file of ['VERSION', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'Service-Desk-8x8-Assistant.js', `releases/edge-prototype/${info.version}/Service-Desk-8x8-Assistant.js`]) {
      const target = path.join(folder, file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(root, file), target)
    }
    fn(folder)
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
}

check('Release uses exact prototype bytes, version, name and extension goal', () => {
  assert.equal(info.version, '1.2.0')
  assert.equal(info.name, 'Service Desk 8x8 Assistant - Prototype')
  assert(info.body.includes('organisation-approved Microsoft Edge extension'))
  assert(info.body.includes(info.digest.slice(7)))
  assert.equal(info.assetName, 'Service-Desk-8x8-Assistant-Prototype-1.2.0.js')
})
check('Later versions, mixed metadata and a stale archive fail before publication', () => {
  withTemporaryRelease((folder) => {
    fs.appendFileSync(path.join(folder, `releases/edge-prototype/${info.version}/Service-Desk-8x8-Assistant.js`), '// stale\n')
    assert.throws(() => prepareRelease(folder, info.repository, commit), /must agree/)
    fs.copyFileSync(path.join(root, 'Service-Desk-8x8-Assistant.js'), path.join(folder, `releases/edge-prototype/${info.version}/Service-Desk-8x8-Assistant.js`))
    const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'package.json')))
    metadata.version = '1.1.6'
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify(metadata))
    assert.throws(() => prepareRelease(folder, info.repository, commit), /must agree/)
    fs.writeFileSync(path.join(folder, 'VERSION'), '1.2.1\n')
    assert.throws(() => prepareRelease(folder, info.repository, commit), /one-off publisher only supports prototype v1.2.0/)
  })
  assert.throws(() => prepareRelease(root, info.repository, 'main'), /exact release commit/)
  assert.throws(() => prepareRelease(root, '../other', commit), /repository/)
})
check('New release pins the tag, uploads a verified draft and only then publishes', async () => {
  const api = fakeGitHub()
  assert.equal(await publishRelease(info, api.request), savedRelease().html_url)
  assert.deepEqual(api.calls.filter((call) => call.method !== 'GET').map((call) => call.method + ' ' + call.path), [
    `POST /repos/${info.repository}/git/refs`,
    `POST /repos/${info.repository}/releases`,
    `POST /repos/${info.repository}/releases/7/assets`,
    `PATCH /repos/${info.repository}/releases/7`
  ])
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
  const good = fakeGitHub({ tag, release: savedRelease() })
  await publishRelease(info, good.request)
  const bad = fakeGitHub({ tag, annotatedCommit: 'c'.repeat(40) })
  await assert.rejects(publishRelease(info, bad.request), /will not be moved/)
  assert(bad.calls.every((call) => call.method === 'GET'))
})
check('An interrupted matching draft resumes without duplicate downloads', async () => {
  const api = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release: savedRelease(true) })
  await publishRelease(info, api.request)
  assert.deepEqual(api.calls.filter((call) => call.method !== 'GET').map((call) => call.method), ['PATCH'])
})
check('A corrupt upload leaves the release unpublished', async () => {
  const api = fakeGitHub({ badDigest: true })
  await assert.rejects(publishRelease(info, api.request), /does not match/)
  assert(!api.calls.some((call) => call.method === 'PATCH'))
})
check('Different release metadata or an altered asset is not overwritten', async () => {
  const release = savedRelease()
  release.name = 'Different release'
  const api = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release })
  await assert.rejects(publishRelease(info, api.request), /will not be overwritten/)
  assert(api.calls.every((call) => call.method === 'GET'))
  const changed = savedRelease()
  changed.assets[0].size++
  const assetApi = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release: changed })
  await assert.rejects(publishRelease(info, assetApi.request), /does not match/)
  assert(assetApi.calls.every((call) => call.method === 'GET'))
})
check('An unexpected upload host is rejected before transferring the prototype', async () => {
  const release = savedRelease(true)
  release.assets = []
  release.upload_url = 'https://example.invalid/upload'
  const api = fakeGitHub({ tag: { object: { type: 'commit', sha: commit } }, release })
  await assert.rejects(publishRelease(info, api.request), /Unexpected release upload destination/)
  assert(api.calls.every((call) => call.method === 'GET'))
  await assert.rejects(githubRequest('https://example.invalid/'), /GitHub API hosts/)
})
check('Local execution cannot publish or make any GitHub requests', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'tools/publish-prototype-release.cjs')], {
    env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_REF: 'refs/heads/main' }, encoding: 'utf8'
  })
  assert.notEqual(result.status, 0)
  assert(result.stderr.includes('requires a main-branch GitHub Actions run'))
})

;(async () => {
  for (const { name, fn } of checks) { await fn(); console.log('PASS:', name) }
  console.log(`${checks.length} release scenarios passed.`)
})().catch((error) => { console.error(error); process.exitCode = 1 })
