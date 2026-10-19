/* Reproducible, fictional-data measurements. This fixture excludes browser layout, disk and antivirus. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const os = require('node:os')
const crypto = require('node:crypto')
const { performance } = require('node:perf_hooks')
const repo = path.join(__dirname, '..')
const source = path.resolve(process.argv[2] || path.join(repo, 'Service-Desk-8x8-Assistant.js'))
const sizes = (process.argv[3] || '100,500,1000,2000,5000,10000').split(',').map(Number)
const noteCharacters = Number(process.argv[4] || 240)
if (sizes.some((size) => !Number.isSafeInteger(size) || size < 1 || size > 20000)) throw new Error('Use counts from 1 to 20000.')
if (!Number.isSafeInteger(noteCharacters) || noteCharacters < 1 || noteCharacters > 20000) throw new Error('Use note lengths from 1 to 20000.')
const fixture = fs.readFileSync(path.join(repo, 'tests', 'assistant.test.cjs'), 'utf8')
const setup = fixture.slice(0, fixture.indexOf("check('Me is selectable")).replace(
  "const file = path.join(__dirname, '..', 'Service-Desk-8x8-Assistant.js')",
  'const file = ' + JSON.stringify(source)
)
if (!setup.includes(JSON.stringify(source))) throw new Error('The fixture source path was not replaced.')
const context = vm.createContext({ require, __dirname: path.join(repo, 'tests'), console, Blob, TextDecoder })
vm.runInContext(setup + '\nglobalThis.make = environment', context)
const timed = (fn) => {
  const started = performance.now()
  const value = fn()
  return { value, ms: Number((performance.now() - started).toFixed(2)) }
}
const report = {
  version: fs.readFileSync(source, 'utf8').match(/Prototype v([\d.]+)/)?.[1],
  sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
  environment: 'Node ' + process.version + '; simulated DOM; no browser layout or real disk I/O',
  cpu: os.cpus()[0]?.model,
  noteCharacters,
  results: []
}
for (const count of sizes) {
  if (count * noteCharacters > 32 * 1024 * 1024) {
    report.results.push({ count, supported: false, error: 'This sample exceeds the benchmark memory budget; use fewer records or shorter notes.' })
    continue
  }
  global.gc?.()
  const e = context.make({ g1: [], muted: true, desktopNotifications: false })
  const api = e.window.__itsCallAssist
  const entries = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    originalId: index + 1,
    recordKey: 'fictional-performance-' + index,
    caller: 'Fictional Caller ' + index,
    callerPrediction: 'Staff',
    origin: 'text',
    notes: 'Fictional performance measurement. '.repeat(Math.ceil(noteCharacters / 32)).slice(0, noteCharacters),
    jobNumber: 'INC' + (9000000 + index),
    detectedAt: Date.UTC(2026, 8, 1) + index * 60000,
    completedAt: null,
    number: null,
    queue: null,
    transactionId: null,
    channel: null,
    channelNumber: null,
    durationSeconds: null,
    waitSeconds: null,
    holdSeconds: null,
    durationComplete: false
  }))
  const format = timed(() => api.exportCallNotesText(entries))
  const row = { count, bytes: Buffer.byteLength(format.value), formatMs: format.ms }
  try {
    // Warm the parser, then take three samples to reduce one-time JIT noise.
    api.parseCallNotesText(format.value)
    const parse = Array.from({ length: 3 }, () => timed(() => api.parseCallNotesText(format.value)).ms).sort((a, b) => a - b)
    const imported = timed(() => api.importCallNotesText(format.value))
    const opened = timed(() => e.button('Call Notes').onclick())
    const cards = e.ui().querySelectorAll('.history-card').length
    const nodes = e.ui().querySelectorAll('div,span,p,button,input,article,textarea,label,details,summary,h4').length
    const field = e.ui().querySelector('.history-search')
    const searched = timed(() => { field.value = 'Fictional Caller ' + (count - 1); field.oninput() })
    const exported = timed(() => api.exportCallNotesText())
    const session = e.session.get('service-desk-8x8-call-history-v1') || ''
    Object.assign(row, {
      supported: true,
      parseMs: parse[1],
      importMs: imported.ms,
      openMs: opened.ms,
      searchMs: searched.ms,
      exportMs: exported.ms,
      renderedCards: cards,
      renderedNodes: nodes,
      sessionUtf16Bytes: session.length * 2,
      exportedRecords: (exported.value.match(/\[Call details\]/g) || []).length
    })
  } catch (error) { Object.assign(row, { supported: false, error: error.message }) }
  report.results.push(row)
  api.destroy()
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
