/* One-off publication of the explicitly requested v1.1.7 prototype. No dependencies. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const RELEASE_NAME = 'Service Desk 8x8 Assistant - Prototype'
const RELEASE_VERSION = '1.1.7'

function prepareRelease (root, repository, commit) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository || '') || !/^[a-f0-9]{40}$/.test(commit || '')) {
    throw new Error('A repository and exact release commit are required.')
  }
  const read = (file) => fs.readFileSync(path.join(root, file))
  const version = read('VERSION').toString('utf8').trim()
  // This publisher is authorised for one release; future versions cannot use its write access.
  if (version !== RELEASE_VERSION) throw new Error('This one-off publisher only supports prototype v1.1.7.')
  const source = read('Service-Desk-8x8-Assistant.js')
  const snapshot = read(`releases/${version}/Service-Desk-8x8-Assistant.js`)
  const metadata = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  // Never publish a stale snapshot, mixed versions or an extension as the prototype.
  if (!source.equals(snapshot) || metadata.version !== version || lock.version !== version || lock.packages[''].version !== version ||
      !source.toString('utf8').startsWith(`/* Service Desk 8x8 Assistant — Prototype v${version}\n`) ||
      !source.toString('utf8').includes(`const VERSION = deployment?.version || '${version}'`)) {
    throw new Error('Prototype source, snapshot and version metadata must agree.')
  }
  const changelog = read('CHANGELOG.md').toString('utf8')
  const section = changelog.split(/^## /m).find((text) => text.startsWith(version + ' (Prototype) — '))
  if (!section) throw new Error('The prototype needs a matching changelog entry.')
  const digest = 'sha256:' + crypto.createHash('sha256').update(snapshot).digest('hex')
  const body = [
    `**Prototype v${version}**`,
    'This JavaScript prototype runs in your 8x8 page. The goal is an organisation-approved Microsoft Edge extension embedded in the browser; this download is the prototype.',
    section.slice(section.indexOf('\n') + 1).trim(),
    `[Setup and features](https://github.com/${repository}/blob/${commit}/README.md)`,
    `Download **Service-Desk-8x8-Assistant-Prototype-${version}.js** below.`,
    `SHA-256: \`${digest.slice(7)}\``
  ].join('\n\n')
  return { repository, commit, version, tag: 'v' + version, name: RELEASE_NAME, body, source: snapshot, digest, assetName: `Service-Desk-8x8-Assistant-Prototype-${version}.js` }
}

async function githubRequest (resource, options = {}) {
  const url = new URL(resource, 'https://api.github.com')
  // Authentication is restricted to GitHub's API/upload hosts, without redirect forwarding.
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
      'Content-Type': binary ? 'application/javascript' : 'application/json'
    },
    body: options.body === undefined ? undefined : binary ? options.body : JSON.stringify(options.body)
  })
  if (response.status === 404 && options.allowMissing) return null
  // Do not include tokens, request bodies or GitHub response bodies in failure logs.
  if (!response.ok) throw new Error(`GitHub release request failed: HTTP ${response.status}, ${options.method || 'GET'} ${url.pathname}`)
  return response.json()
}

async function verifyTag (info, tag, request) {
  let target = tag?.object
  // Accept annotated tags only when their ultimate commit is the exact tested commit.
  for (let depth = 0; target?.type === 'tag' && depth < 8; depth++) {
    const annotated = await request(`/repos/${info.repository}/git/tags/${target.sha}`)
    target = annotated.object
  }
  if (target?.type !== 'commit' || target.sha !== info.commit) throw new Error('The release tag belongs to a different commit; it will not be moved.')
}

function verifyAsset (info, asset) {
  if (asset?.name !== info.assetName || asset.state !== 'uploaded' || asset.size !== info.source.length || asset.digest !== info.digest) {
    throw new Error('The prototype download does not match the verified snapshot; the release will not be published.')
  }
}

async function publishRelease (info, request = githubRequest) {
  const base = `/repos/${info.repository}`
  const ref = `${base}/git/ref/tags/${info.tag}`
  let tag = await request(ref, { allowMissing: true })
  if (!tag) tag = await request(`${base}/git/refs`, { method: 'POST', body: { ref: 'refs/tags/' + info.tag, sha: info.commit } })
  await verifyTag(info, tag, request)
  let release = await request(`${base}/releases/tags/${info.tag}`, { allowMissing: true })
  if (!release) {
    // Upload into a draft first, so a failed asset transfer cannot publish an incomplete release.
    release = await request(`${base}/releases`, {
      method: 'POST',
      body: { tag_name: info.tag, target_commitish: info.commit, name: info.name, body: info.body, draft: true, prerelease: false, make_latest: 'false' }
    })
  }
  if (release.name !== info.name || release.tag_name !== info.tag || release.prerelease || release.body !== info.body) {
    throw new Error('An existing release has different metadata; it will not be overwritten.')
  }
  let asset = release.assets?.find((item) => item.name === info.assetName)
  if (!asset && !release.draft) throw new Error('The published release is missing its verified prototype download.')
  if (!asset) {
    const upload = new URL(release.upload_url.replace(/\{.*$/, ''))
    if (upload.origin !== 'https://uploads.github.com' || upload.pathname !== `${base}/releases/${release.id}/assets`) {
      throw new Error('Unexpected release upload destination.')
    }
    upload.searchParams.set('name', info.assetName)
    upload.searchParams.set('label', `JavaScript prototype v${info.version}`)
    asset = await request(upload.href, { method: 'POST', body: info.source })
  }
  verifyAsset(info, asset)
  if (release.draft) {
    release = await request(`${base}/releases/${release.id}`, { method: 'PATCH', body: { draft: false, make_latest: 'true' } })
  }
  // Read back both the publication and tag; retries reuse matching objects, never replace them.
  release = await request(`${base}/releases/tags/${info.tag}`)
  verifyAsset(info, release.assets?.find((item) => item.name === info.assetName))
  await verifyTag(info, await request(ref), request)
  if (release.draft || release.name !== info.name || release.tag_name !== info.tag || release.body !== info.body || release.prerelease) {
    throw new Error('GitHub did not confirm the expected published prototype release.')
  }
  return release.html_url
}

module.exports = { prepareRelease, publishRelease, githubRequest }
if (require.main === module) {
  // Only the push adding the immutable v1.1.7 snapshot can start this one-off workflow.
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME !== 'push') {
    throw new Error('Prototype publication requires a main-branch GitHub Actions run.')
  }
  const info = prepareRelease(path.resolve(__dirname, '..'), process.env.GITHUB_REPOSITORY, process.env.GITHUB_SHA)
  publishRelease(info).then((url) => console.log('Published prototype:', url)).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
