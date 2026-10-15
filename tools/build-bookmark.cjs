/* Package the released prototype as a self-contained, offline Edge favourite. */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')

// Chromium's bookmark editor caps the URL at 500 KiB; Edge still needs a managed-device check.
const BOOKMARK_INPUT_LIMIT = 500 * 1024
const PROTOTYPE_FILE = 'Service-Desk-8x8-Assistant.js'
const BOOKMARK_TITLE = '8x8 Assistant'

function bookmarkFileName (version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A complete prototype version is required.')
  return `Service-Desk-8x8-Assistant-Bookmark-${version}.html`
}

function createBookmarkURL (source) {
  // Embed actual source, rather than eval, a remote loader or a browser-policy workaround.
  // Percent encoding preserves comments, Unicode, newlines, URL delimiters and HTML characters.
  const launch = `void (() => {
  if (window.location.origin !== 'https://vcc-au2.8x8.com') {
    window.alert('Open your signed-in 8x8 page, then click the 8x8 Assistant favourite.')
    return
  }
  const document = window.document
  // Several clicks during page loading must share one document-ready callback.
  if (window.__itsCallAssistBookmarkPending) return
  const start = () => {
    if (window.__itsCallAssistBookmarkPending === start) delete window.__itsCallAssistBookmarkPending
    try {
// BEGIN UNCHANGED PROTOTYPE
${source}// END UNCHANGED PROTOTYPE
    } catch (error) {
      console.error('8x8 Assistant could not start:', error)
      window.alert('The assistant could not start. Try your saved snippet, or report this problem.')
    }
  }
  // The prototype mounts into the body. Document-start injection is too early.
  if (document.body) start()
  else {
    window.__itsCallAssistBookmarkPending = start
    document.addEventListener('DOMContentLoaded', start, { once: true })
  }
})()`
  // Compile without running the payload; void prevents a string result replacing the 8x8 page.
  vm.compileFunction(launch, [], { filename: 'assistant-bookmark.js' })
  const url = 'javascript:' + encodeURIComponent(launch)
  if (url.length > BOOKMARK_INPUT_LIMIT) throw new Error('The offline bookmark exceeds the supported build size. Keep using the saved snippet.')
  return url
}

function createInstaller (version, source) {
  const url = createBookmarkURL(source)
  const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex')
  // A single uppercase, single-line A inside DL also works with Netscape-format bookmark import.
  // Other installer content contains no links, scripts, remote assets or additional bookmarks.
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<html lang="en">
<head>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="assistant-version" content="${version}">
<meta name="assistant-source-sha256" content="${sourceSha256}">
<title>Install the 8x8 Assistant favourite</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 44px 20px; background: #f1f5f9; color: #172b4d; font: 16px/1.55 "Segoe UI", system-ui, sans-serif; }
  main { max-width: 740px; margin: auto; }
  header { margin-bottom: 24px; }
  .badge { display: inline-block; padding: 5px 11px; border: 1px solid #cad8eb; border-radius: 999px; color: #365779; background: #e7effa; font-size: 12px; font-weight: 600; }
  h1 { margin: 14px 0 8px; font-size: clamp(28px, 5vw, 36px); line-height: 1.2; letter-spacing: -.7px; }
  p { margin: 8px 0; }
  .muted { color: #53657d; }
  section { margin: 16px 0; padding: 23px 26px; background: white; border: 1px solid #d9e2ee; border-radius: 16px; box-shadow: 0 5px 18px #172b4d06; }
  h2 { margin: 0 0 9px; font-size: 19px; }
  .bookmark-slot { margin: 20px 0; padding: 23px 16px; text-align: center; background: #f5f8fd; border: 1px dashed #b9cce8; border-radius: 12px; }
  dl, dt { margin: 0; }
  .bookmark { display: inline-flex; align-items: center; gap: 10px; padding: 12px 23px; border: 1px solid #1b51a5; border-radius: 10px; color: white; background: #245fbc; text-decoration: none; font-weight: 600; box-shadow: 0 4px 10px #245fbc20; cursor: grab; }
  .bookmark:hover { background: #194e9e; }
  .bookmark:focus-visible { outline: 3px solid #73a8f5; outline-offset: 4px; }
  kbd { padding: 1px 5px; background: #edf2f8; border: 1px solid #d0dbe8; border-radius: 4px; font: inherit; font-size: 13px; white-space: nowrap; }
  ol { padding-left: 23px; margin: 10px 0 0; }
  li { padding-left: 4px; margin: 7px 0; }
  .notice { padding: 13px 16px; background: #edf5ff; border: 1px solid #cbdef7; border-radius: 10px; font-size: 14px; }
  footer { margin: 22px 2px 0; color: #65758c; font-size: 13px; }
  @media (max-width: 480px) { body { padding: 25px 14px; } section { padding: 20px; } }
</style>
</head>
<body>
<main>
  <header>
    <span class="badge">Service Desk 8x8 Assistant · Prototype ${version}</span>
    <h1>Your assistant, one click away.</h1>
    <p class="muted">Add the favourite once. Click it whenever you open or refresh 8x8.</p>
  </header>
  <section>
    <h2>1. Add to your favourites bar</h2>
    <p>Open this downloaded file in Microsoft Edge. Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd> to show the favourites bar.</p>
    <p><strong>Drag the button below onto the favourites bar.</strong></p>
    <div class="bookmark-slot">
<DL><p>
<DT><A HREF="${url}" id="assistant-bookmark" class="bookmark" draggable="true" title="Drag to your favourites bar · Prototype ${version}">${BOOKMARK_TITLE}</A>
</DL><p>
    </div>
    <p class="muted">Drag this button to install it. Use the saved favourite from your 8x8 tab.</p>
  </section>
  <section>
    <h2>Prefer to import it?</h2>
    <p>In Edge Settings, find <strong>Import browser data</strong>. Choose <strong>Favorites or bookmarks HTML file</strong>, then select this same downloaded file.</p>
    <p class="muted">Find <strong>8x8 Assistant</strong> in the imported favourites and move it onto your favourites bar.</p>
  </section>
  <section>
    <h2>2. Start the assistant</h2>
    <ol>
      <li>Open your signed-in <strong>vcc-au2.8x8.com</strong> tab and let the page load.</li>
      <li>Click your saved <strong>8x8 Assistant</strong> favourite.</li>
      <li>Open queue information and keep your usual ITS group and status filters selected.</li>
    </ol>
    <p class="notice">Refresh or reopen 8x8? Click the favourite again. Your existing Data location setting still restores Call Notes when access is allowed.</p>
  </section>
  <footer>
    <p>Author: Joshua Lavagna-Slater · Prototype ${version}</p>
    <p>The favourite includes this version of the assistant. It downloads no code when clicked. Replace it when installing a newer prototype.</p>
    <p>If your organisation blocks JavaScript favourites, keep using the approved launch method. This installer does not change browser policies or install an extension.</p>
  </footer>
</main>
</body>
</html>
`
  return { html, url, sourceSha256, version, fileName: bookmarkFileName(version) }
}

function buildBookmark (root) {
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  bookmarkFileName(version)
  const source = fs.readFileSync(path.join(root, PROTOTYPE_FILE), 'utf8')
  const archive = fs.readFileSync(path.join(root, 'releases', 'edge-prototype', version, PROTOTYPE_FILE), 'utf8')
  // Never package an unversioned edit or silently swap the code inside an existing release.
  if (source !== archive || !source.startsWith(`/* Service Desk 8x8 Assistant — Prototype v${version}\n`) || !source.includes(`const VERSION = deployment?.version || '${version}'`)) {
    throw new Error('The prototype version and exact released source must match before building a bookmark.')
  }
  return createInstaller(version, source)
}

if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--check')) throw new Error('Use npm run build:bookmark, or --check to validate the committed installer.')
  const root = path.resolve(__dirname, '..')
  const result = buildBookmark(root)
  const checking = args.includes('--check')
  const directory = checking ? path.join(root, 'docs', 'bookmark') : path.join(root, '..', 'output', 'bookmark')
  const target = path.join(directory, result.fileName)
  if (checking) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== result.html) throw new Error('The committed bookmark installer is out of date. Rebuild and copy the generated HTML to docs/bookmark/.')
  } else {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(target, result.html)
    console.log(target)
  }
  console.log(`Prototype ${result.version} offline bookmark: ${result.url.length}/${BOOKMARK_INPUT_LIMIT} URL characters; source SHA-256 ${result.sourceSha256}`)
}

module.exports = { BOOKMARK_INPUT_LIMIT, BOOKMARK_TITLE, bookmarkFileName, createBookmarkURL, createInstaller, buildBookmark }
