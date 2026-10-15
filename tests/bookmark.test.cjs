/* Exercise the actual offline favourite payload without a browser or network dependency. */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { BOOKMARK_INPUT_LIMIT, BOOKMARK_TITLE, createBookmarkURL, createInstaller, bookmarkFileName, buildBookmark } = require('../tools/build-bookmark.cjs')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'Service-Desk-8x8-Assistant.js'), 'utf8')
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
const result = buildBookmark(root)
const launch = decodeURIComponent(result.url.slice('javascript:'.length))
const fixture = fs.readFileSync(path.join(__dirname, 'assistant.test.cjs'), 'utf8')
const context = vm.createContext({ require, __dirname, console, Blob, TextDecoder })
// Reuse page definitions only; baseline scenarios run in their own existing process.
vm.runInContext(fixture.slice(0, fixture.indexOf("check('Me is selectable")) + '\nglobalThis.environment = environment', context)
const environment = context.environment
let passed = 0
function check (name, test) {
  test()
  passed++
  console.log('PASS:', name)
}
function page (options = {}) {
  const e = environment({ g1: [] }, {}, { deferStart: true, ...options })
  e.alerts = []
  e.errors = []
  e.requests = 0
  e.window.alert = (message) => e.alerts.push(message)
  // A future loader must not silently add network access to this offline packaging.
  e.window.fetch = () => { e.requests++; throw new Error('Unexpected network request') }
  e.launch = () => e.runScript(launch, {
    console: { error: (...args) => e.errors.push(args) },
    fetch: e.window.fetch
  })
  return e
}
function panels (e) { return e.window.document.body.querySelectorAll('#its-call-assist-panel').length }

check('The committed installer is deterministic and embeds the exact released source', () => {
  const committed = fs.readFileSync(path.join(root, 'docs', 'bookmark', result.fileName), 'utf8')
  assert.equal(committed, result.html)
  assert.equal(buildBookmark(root).html, result.html)
  const prefix = '// BEGIN UNCHANGED PROTOTYPE\n'
  const start = launch.indexOf(prefix) + prefix.length
  const end = launch.indexOf('// END UNCHANGED PROTOTYPE', start)
  assert.equal(launch.slice(start, end), source)
  assert.equal(result.sourceSha256, crypto.createHash('sha256').update(source).digest('hex'))
  assert(fs.readFileSync(path.join(root, 'releases', 'edge-prototype', version, 'Service-Desk-8x8-Assistant.js')).equals(Buffer.from(source)))
})

check('The URL remains below the conservative editor limit and survives URL parsing unchanged', () => {
  assert(result.url.startsWith('javascript:'))
  assert(result.url.length < BOOKMARK_INPUT_LIMIT)
  assert(!/[\r\n\t\u0080-\uFFFF]/.test(result.url))
  assert.equal(decodeURIComponent(new URL(result.url).pathname), launch)
  assert.equal(new URL(result.url).hash, '')
  assert.doesNotThrow(() => new vm.Script(launch))
})

check('Bookmark import has exactly one uppercase single-line entry with the full payload', () => {
  assert(result.html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'))
  assert(result.html.includes('CONTENT="text/html; charset=UTF-8"'))
  assert.equal((result.html.match(/<A\b/gi) || []).length, 1)
  const entry = result.html.split('\n').find((line) => line.startsWith('<DT><A HREF="'))
  const match = entry.match(/^<DT><A HREF="([^"]+)"[^>]*>([^<]+)<\/A>$/)
  assert(match)
  assert.equal(match[1], result.url)
  assert.equal(match[2], BOOKMARK_TITLE)
  assert(!/<script\b|<iframe\b|<img\b|<link\b|\bon\w+\s*=/i.test(result.html))
  assert(result.html.includes('Drag the button below onto the favourites bar.'))
  assert(result.html.includes('Favorites or bookmarks HTML file'))
})

check('A favourite click starts the actual prototype without navigation, downloads or requests', () => {
  const e = page()
  assert.equal(e.launch(), undefined)
  assert.equal(panels(e), 1)
  assert(e.window.__itsCallAssist)
  assert.equal(e.window.location.origin, 'https://vcc-au2.8x8.com')
  assert.equal(e.alerts.length, 0)
  assert.equal(e.errors.length, 0)
  assert.equal(e.requests, 0)
  assert.equal(e.downloads.length, 0)
  e.window.__itsCallAssist.destroy()
})

check('The origin guard refuses unrelated pages, lookalike hosts, HTTP and alternate ports', () => {
  for (const origin of ['file://', 'https://example.invalid', 'https://vcc-au2.8x8.com.example.invalid', 'http://vcc-au2.8x8.com', 'https://vcc-au2.8x8.com:8443']) {
    const e = page()
    e.window.location.origin = origin
    e.launch()
    assert.equal(e.alerts.length, 1, origin)
    assert.equal(e.window.__itsCallAssist, undefined, origin)
    assert.equal(panels(e), 0, origin)
    assert.equal(e.jobs.size, 0, origin)
    assert.equal(e.requests, 0, origin)
    assert(!e.window.document.listeners.has('DOMContentLoaded'), origin)
  }
})

check('Early clicks wait for a body, share one callback and clear the pending marker', () => {
  const e = page()
  const document = e.window.document
  const body = document.body
  document.body = null
  e.launch()
  const pending = e.window.__itsCallAssistBookmarkPending
  assert.equal(typeof pending, 'function')
  e.launch()
  assert.equal(document.listeners.get('DOMContentLoaded').size, 1)
  assert.equal(e.window.__itsCallAssist, undefined)
  document.body = body
  pending()
  assert.equal(panels(e), 1)
  assert.equal(e.window.__itsCallAssistBookmarkPending, undefined)
  assert.equal(e.alerts.length, 0)
  e.window.__itsCallAssist.destroy()
})

check('A second click restarts one assistant and preserves an unfinished caller draft', () => {
  const e = page()
  e.launch()
  // The fixture's call helpers need their test-only scan entry point after native DOM changes.
  // Keep the production payload unchanged and drive its actual scheduled polling callback.
  const scan = () => { for (const job of [...e.jobs.values()]) if (job.ms === 1000) job.fn() }
  e.showCall({ transactionId: 'bookmark-fictional-transaction' })
  scan()
  e.caller('Fictional Bookmark Caller')
  e.notes('Fictional note retained on a repeated click')
  const previous = e.window.__itsCallAssist
  e.launch()
  assert.notEqual(e.window.__itsCallAssist, previous)
  assert.equal(panels(e), 1)
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, 'Fictional Bookmark Caller')
  assert.equal(e.ui().querySelector('#its-caller-notes').value, 'Fictional note retained on a repeated click')
  assert.equal([...e.jobs.values()].filter((job) => job.ms === 1000).length, 1)
  assert.equal(e.requests, 0)
  e.window.__itsCallAssist.destroy()
})

check('The assistant can start with missing native data and close before being launched again', () => {
  const e = page({
    beforeStart: ({ header, group, queues }) => {
      header.hidden = true
      group.hidden = true
      for (const queue of queues) queue.row.hidden = true
    }
  })
  e.launch()
  assert.equal(panels(e), 1)
  assert(e.button('Call Notes'))
  e.window.__itsCallAssist.destroy()
  assert.equal(panels(e), 0)
  e.launch()
  assert.equal(panels(e), 1)
  assert.equal(e.errors.length, 0)
  e.window.__itsCallAssist.destroy()
})

check('A startup failure reports a short message and never returns a replacement document', () => {
  const errors = []
  const alerts = []
  const url = createBookmarkURL('throw new Error("Fictional startup failure")\n')
  const output = vm.runInNewContext(decodeURIComponent(url.slice('javascript:'.length)), {
    window: {
      location: { origin: 'https://vcc-au2.8x8.com' },
      document: { body: {} },
      alert: (message) => alerts.push(message)
    },
    console: { error: (...args) => errors.push(args) }
  })
  assert.equal(output, undefined)
  assert.equal(errors.length, 1)
  assert.equal(alerts.length, 1)
  assert(!alerts[0].includes('Fictional startup failure'))
  const returning = createBookmarkURL('"A string must not replace the page"\n')
  assert.equal(vm.runInNewContext(decodeURIComponent(returning.slice('javascript:'.length)), {
    window: { location: { origin: 'https://vcc-au2.8x8.com' }, document: { body: {} } }
  }), undefined)
})

check('Unicode, comments and HTML or URL delimiters survive one decode without markup injection', () => {
  const unusual = '/* comment with a newline\n*/\nwindow.bookmarkProbe = "</A><script> # ? % & \\u2728 \\u00e9"\n'
  const built = createInstaller('9.8.7', unusual)
  assert.equal((built.html.match(/<A\b/gi) || []).length, 1)
  assert(!built.html.includes('<script>'))
  const window = { location: { origin: 'https://vcc-au2.8x8.com' }, document: { body: {} } }
  vm.runInNewContext(decodeURIComponent(built.url.slice('javascript:'.length)), { window })
  assert.equal(window.bookmarkProbe, '</A><script> # ? % & ✨ é')
})

check('The builder rejects oversized or invalid payloads and unsafe version paths', () => {
  assert.throws(() => createBookmarkURL('// ' + 'x'.repeat(BOOKMARK_INPUT_LIMIT)), /exceeds/)
  assert.throws(() => createBookmarkURL(')'), SyntaxError)
  for (const invalid of ['../1.2.0', '1.2', '1.2.0/other', '<script>', '']) assert.throws(() => bookmarkFileName(invalid), /version/)
})

check('A changed root or mismatched release version cannot silently replace bookmark code', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), '8x8-bookmark-test-'))
  try {
    const archive = path.join(folder, 'releases', 'edge-prototype', version)
    fs.mkdirSync(archive, { recursive: true })
    fs.writeFileSync(path.join(folder, 'VERSION'), version)
    fs.writeFileSync(path.join(folder, 'Service-Desk-8x8-Assistant.js'), source)
    fs.writeFileSync(path.join(archive, 'Service-Desk-8x8-Assistant.js'), source)
    assert.equal(buildBookmark(folder).html, result.html)
    fs.appendFileSync(path.join(folder, 'Service-Desk-8x8-Assistant.js'), '\n// Unreleased edit\n')
    assert.throws(() => buildBookmark(folder), /exact released source/)
    fs.writeFileSync(path.join(folder, 'Service-Desk-8x8-Assistant.js'), source)
    fs.writeFileSync(path.join(archive, 'Service-Desk-8x8-Assistant.js'), source.replace(`Prototype v${version}`, 'Prototype v0.0.0'))
    assert.throws(() => buildBookmark(folder), /exact released source/)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

console.log(`${passed} offline bookmark scenarios passed.`)
