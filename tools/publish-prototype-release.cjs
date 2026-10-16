/* Publish the authorised v1.2.1 prototype with both verified downloads. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { buildBookmark } = require('./build-bookmark.cjs')
const RELEASE_VERSION = '1.2.1'

function prepareRelease (root, repository, commit) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository || '') || !/^[a-f0-9]{40}$/.test(commit || '')) {
    throw new Error('A repository and exact release commit are required.')
  }
  const read = (file) => fs.readFileSync(path.join(root, file))
  const version = read('VERSION').toString('utf8').trim()
  const parts = version.split('.').map(Number)
  // Ongoing publication was requested from 1.2.1; older releases and tags remain immutable.
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || parts.some((part) => !Number.isSafeInteger(part)) ||
      parts[0] < 1 || (parts[0] === 1 && (parts[1] < 2 || (parts[1] === 2 && parts[2] < 1)))) {
    throw new Error('Automated prototype releases start at version 1.2.1.')
  }
  // Future updates need their own version-scoped publisher and workflow.
  if (version !== RELEASE_VERSION) throw new Error('This publisher is limited to prototype v1.2.1.')
  const source = read('Service-Desk-8x8-Assistant.js')
  const snapshot = read('releases/edge-prototype/' + version + '/Service-Desk-8x8-Assistant.js')
  const metadata = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  // Versioned source and both package metadata copies must describe the same tested release.
  if (!source.equals(snapshot) || metadata.version !== version || lock.version !== version || lock.packages[''].version !== version ||
      !source.toString('utf8').startsWith('/* Service Desk 8x8 Assistant — Prototype v' + version + '\n') ||
      !source.toString('utf8').includes("const VERSION = deployment?.version || '" + version + "'")) {
    throw new Error('Prototype source, snapshot and version metadata must agree.')
  }
  const changelog = read('CHANGELOG.md').toString('utf8')
  const section = changelog.split(/^## /m).find((text) => text.startsWith(version + ' (Prototype) — '))
  if (!section) throw new Error('The prototype needs a matching changelog entry.')
  const notes = read('releases/edge-prototype/' + version + '/RELEASE_NOTES.md').toString('utf8').trim()
  const heading = '# Prototype v' + version
  if (!notes.startsWith(heading + '\n') || notes.length > 4000 || !notes.slice(heading.length).trim().startsWith('- ')) {
    throw new Error('Add concise, version-matched release notes for agents.')
  }
  const bookmark = buildBookmark(root)
  const bookmarkSource = read('docs/bookmark/' + bookmark.fileName)
  if (bookmark.version !== version || bookmarkSource.toString('utf8') !== bookmark.html) {
    throw new Error('The bookmark download must match a deterministic build of the released prototype.')
  }
  const asset = (name, data, contentType, label) => ({
    name,
    source: data,
    digest: 'sha256:' + crypto.createHash('sha256').update(data).digest('hex'),
    contentType,
    label
  })
  const assets = [
    asset('Service-Desk-8x8-Assistant-Prototype-' + version + '.js', snapshot, 'application/javascript', 'DevTools Script Prototype v' + version),
    asset(bookmark.fileName, bookmarkSource, 'text/html', 'Bookmark Prototype v' + version + ' (recommended)')
  ]
  const tag = 'v' + version
  const downloads = 'https://github.com/' + repository + '/releases/download/' + tag + '/'
  const body = [
    '## What changed',
    notes.slice(heading.length).trim(),
    '## Downloads',
    '- **Recommended:** [Bookmark Prototype (.html)](' + downloads + assets[1].name + ')\n' +
      '- [DevTools Script Prototype (.js)](' + downloads + assets[0].name + ')',
    '[Setup and features](https://github.com/' + repository + '/blob/' + tag + '/README.md)',
    'Both downloads run the same prototype. The organisation-approved Microsoft Edge extension remains the intended deployment.'
  ].join('\n\n')
  return { repository, commit, version, tag, name: 'Service Desk 8x8 Assistant - Prototype v' + version, body, assets }
}

async function githubRequest (resource, options = {}) {
  const url = new URL(resource, 'https://api.github.com')
  // Authentication stays on GitHub's API/upload hosts and is never forwarded through redirects.
  if (url.protocol !== 'https:' || !['api.github.com', 'uploads.github.com'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Release requests must use GitHub API hosts.')
  }
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required by the release workflow.')
  const binary = Buffer.isBuffer(options.body)
  const response = await fetch(url, {
    method: options.method || 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'Content-Type': binary ? options.contentType || 'application/octet-stream' : 'application/json'
    },
    body: options.body === undefined ? undefined : binary ? options.body : JSON.stringify(options.body)
  })
  if (response.status === 404 && options.allowMissing) return null
  // Logs omit tokens, request bodies and GitHub response bodies.
  if (!response.ok) throw new Error('GitHub release request failed: HTTP ' + response.status + ', ' + (options.method || 'GET') + ' ' + url.pathname)
  return response.json()
}

async function verifyTag (info, tag, request) {
  let target = tag?.object
  // Annotated tags are accepted only when their final commit is the tested commit.
  for (let depth = 0; target?.type === 'tag' && depth < 8; depth++) {
    const annotated = await request('/repos/' + info.repository + '/git/tags/' + target.sha)
    target = annotated.object
  }
  if (target?.type !== 'commit' || target.sha !== info.commit) throw new Error('The release tag belongs to a different commit; it will not be moved.')
}

function verifyAsset (expected, asset) {
  if (asset?.name !== expected.name || asset.state !== 'uploaded' || asset.size !== expected.source.length || asset.digest !== expected.digest) {
    throw new Error('The release download does not match the verified build; the release will not be published.')
  }
}

function verifyMetadata (info, release) {
  if (release.name !== info.name || release.tag_name !== info.tag || release.prerelease || release.body !== info.body ||
      release.assets?.some((asset) => !info.assets.some((expected) => expected.name === asset.name))) {
    throw new Error('An existing release has different metadata; it will not be overwritten.')
  }
}

async function publishRelease (info, request = githubRequest) {
  const base = '/repos/' + info.repository
  const ref = base + '/git/ref/tags/' + info.tag
  let tag = await request(ref, { allowMissing: true })
  if (!tag) tag = await request(base + '/git/refs', { method: 'POST', body: { ref: 'refs/tags/' + info.tag, sha: info.commit } })
  await verifyTag(info, tag, request)
  let release = await request(base + '/releases/tags/' + info.tag, { allowMissing: true })
  if (!release) {
    // Both assets must be verified in a draft before the release becomes visible.
    release = await request(base + '/releases', {
      method: 'POST',
      body: { tag_name: info.tag, target_commitish: info.commit, name: info.name, body: info.body, draft: true, prerelease: false, make_latest: 'false' }
    })
  }
  verifyMetadata(info, release)
  // Check all existing uploads before adding another file to an interrupted draft.
  for (const expected of info.assets) {
    const existing = release.assets?.find((asset) => asset.name === expected.name)
    if (existing) verifyAsset(expected, existing)
    else if (!release.draft) throw new Error('The published release is missing a verified download.')
  }
  for (const expected of info.assets) {
    if (release.assets?.some((asset) => asset.name === expected.name)) continue
    const upload = new URL(release.upload_url.replace(/\{.*$/, ''))
    if (upload.origin !== 'https://uploads.github.com' || upload.pathname !== base + '/releases/' + release.id + '/assets') {
      throw new Error('Unexpected release upload destination.')
    }
    upload.searchParams.set('name', expected.name)
    upload.searchParams.set('label', expected.label)
    const asset = await request(upload.href, { method: 'POST', body: expected.source, contentType: expected.contentType })
    verifyAsset(expected, asset)
  }
  if (release.draft) {
    release = await request(base + '/releases/' + release.id, { method: 'PATCH', body: { draft: false, make_latest: 'true' } })
  }
  // Retries reuse matching assets; neither old tags nor published downloads are replaced.
  release = await request(base + '/releases/tags/' + info.tag)
  verifyMetadata(info, release)
  for (const expected of info.assets) verifyAsset(expected, release.assets?.find((asset) => asset.name === expected.name))
  await verifyTag(info, await request(ref), request)
  if (release.draft || release.assets?.length !== info.assets.length) throw new Error('GitHub did not confirm both published downloads.')
  return release.html_url
}

module.exports = { prepareRelease, publishRelease, githubRequest }
if (require.main === module) {
  const info = prepareRelease(path.resolve(__dirname, '..'), process.env.GITHUB_REPOSITORY || 'JModify/bond-8x8-assistant', process.env.GITHUB_SHA || '0'.repeat(40))
  if (process.argv.includes('--check')) {
    console.log('Verified release inputs: prototype v' + info.version + ', JavaScript and bookmark.')
  } else {
    // Only the fixed v1.2.1 snapshot workflow can publish; there is no future release trigger.
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME !== 'push' ||
        info.version !== RELEASE_VERSION || process.env.PROTOTYPE_RELEASE_VERSION !== RELEASE_VERSION ||
        process.env.PROTOTYPE_RELEASE_APPROVED !== 'v1.2.1-snapshot') {
      throw new Error('Prototype publication requires a main-branch GitHub Actions run adding its release snapshot.')
    }
    publishRelease(info).then((url) => console.log('Published prototype:', url)).catch((error) => { console.error(error.message); process.exitCode = 1 })
  }
}
