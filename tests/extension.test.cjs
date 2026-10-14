/* Fictional browser/8x8 fixtures exercise the real worker, adapter and shared core. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const folder = path.join(root, 'extension')
const read = (name) => fs.readFileSync(path.join(folder, name), 'utf8')
const manifest = JSON.parse(read('manifest.json'))
const clone = (value) => JSON.parse(JSON.stringify(value))
const asFunction = (source) => source.replace(/^;\(\(\) => \{$/m, 'function startServiceDeskAssistant () {').replace(/\}\)\(\)\s*$/, '}\n')
const compiled = read('assistant.js').replace(
  'root.__itsCallAssist = { destroy, inspect: () => lastSample }',
  'root.__itsCallAssist = { destroy, inspect: () => lastSample, rescan: safeScan, debug: () => ({ playing: [...sounds.keys()] }), exportCallNotesText }'
)
assert.notEqual(compiled, read('assistant.js'), 'The core fixture must have private scan hooks.')
const fixtureSource = fs.readFileSync(path.join(__dirname, 'assistant.test.cjs'), 'utf8')
const fixtureContext = vm.createContext({ require, __dirname, console, URL, Blob, TextDecoder })
// Reuse the production DOM fixtures without executing their separate scenario list.
vm.runInContext(fixtureSource.slice(0, fixtureSource.indexOf("check('Me is selectable")) + '\nglobalThis.makeEnvironment = environment', fixtureContext)
const environment = fixtureContext.makeEnvironment
let passed = 0
let clockSeed = 100000
const checks = []
function check (name, test) { checks.push({ name, test }) }
function event () {
  const listeners = new Set()
  return { listeners, addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) }
}
function deliver (target, message, sender) {
  return new Promise((resolve, reject) => {
    let replied = false
    for (const listener of target.listeners) {
      const result = listener(clone(message), sender, (reply) => { replied = true; resolve(clone(reply)) })
      if (result === true || replied) return
    }
    reject(new Error('No receiving extension context.'))
  })
}
function record (id = 1, fields = {}) {
  return {
    id,
    recordKey: 'fixture-note-' + id,
    originalId: id,
    origin: '8x8',
    detectedAt: 1000 + id,
    completedAt: 5000 + id,
    caller: 'Demo Caller',
    callerPrediction: 'Staff',
    notes: 'Fictional notes',
    jobNumber: 'INC123456',
    number: '+155501001',
    queue: 'ITS Service Desk',
    transactionId: 'TX-fixture-' + id,
    channel: 'Voice',
    channelNumber: '+155501002',
    waitSeconds: 12,
    durationSeconds: 30,
    durationComplete: true,
    holdSeconds: null,
    ...fields
  }
}
function header (fields = {}) {
  return { startedAt: 1000, nextId: 2, currentId: null, closedId: null, closedCall: null, completedTransactions: [], pending: [], ...fields }
}
function state () {
  return { local: new Map(), session: new Map(), tabs: new Map(), notifications: new Map(), failWrites: 0, failReads: false, failRemove: false, scripts: [], localWrites: [], permission: 'granted', focus: [], updateChecks: 0 }
}
function worker (data) {
  const id = 'fixture-extension'
  const incoming = event()
  const installed = event()
  const removed = event()
  const clicked = event()
  const storageArea = (map, local) => ({
    setAccessLevel: async (value) => { data.accessLevel = value.accessLevel },
    get: async (keys) => {
      if (local && data.failReads) throw new Error('Fixture storage is unavailable.')
      if (keys === null) return clone(Object.fromEntries(map))
      const names = typeof keys === 'string' ? [keys] : keys
      return clone(Object.fromEntries(names.filter((key) => map.has(key)).map((key) => [key, map.get(key)])))
    },
    set: async (patch) => {
      if (local && data.failWrites > 0) { data.failWrites--; throw new Error('Fixture durable write failed.') }
      if (local && data.writeGate) await data.writeGate
      for (const [key, value] of Object.entries(clone(patch))) map.set(key, value)
      if (local) data.localWrites.push(clone(patch))
    },
    remove: async (keys) => {
      if (data.failRemove) throw new Error('Fixture cleanup failed.')
      for (const key of keys) map.delete(key)
    }
  })
  const api = {
    runtime: {
      id,
      getURL: (name) => 'chrome-extension://' + id + '/' + name,
      getManifest: () => clone(data.manifest || manifest),
      onMessage: incoming,
      onInstalled: installed,
      requestUpdateCheck: async () => { data.updateChecks++; return { status: 'no_update' } }
    },
    storage: { local: storageArea(data.local, true), session: storageArea(data.session, false) },
    tabs: {
      query: async (query) => [...data.tabs.values()].filter((tab) => (!query.url || tab.url.startsWith('https://vcc-au2.8x8.com/')) && (!query.active || tab.active)).map((tab) => ({ id: tab.id, url: tab.url, active: tab.active, windowId: 1 })),
      get: async (tabId) => {
        const tab = data.tabs.get(tabId)
        if (!tab) throw new Error('The tab has closed.')
        return { id: tab.id, url: tab.url, active: tab.active, windowId: 1 }
      },
      sendMessage: async (tabId, message, options) => {
        const tab = data.tabs.get(tabId)
        if (!tab || (options?.documentId && options.documentId !== tab.documentId)) throw new Error('The document has closed.')
        if (tab.respond) return tab.respond(message)
        return deliver(tab.messages, message, { id, url: api.runtime.getURL('service-worker.js') })
      },
      update: async (tabId, patch) => { data.focus.push(tabId); Object.assign(data.tabs.get(tabId), patch) },
      create: async (patch) => { data.opened = patch.url },
      reload: async (tabId) => { data.reloaded = tabId },
      onRemoved: removed
    },
    windows: { update: async () => {} },
    notifications: {
      getPermissionLevel: async () => { if (data.permissionGate) await data.permissionGate; return data.permission },
      create: async (noticeId, options) => { if (data.noticeGate) await data.noticeGate; data.notifications.set(noticeId, clone(options)); return noticeId },
      clear: async (noticeId) => data.notifications.delete(noticeId),
      getAll: async () => {
        if (data.notificationCleanupFails) throw new Error('Fixture notification cleanup denied.')
        return Object.fromEntries([...data.notifications.keys()].map((key) => [key, true]))
      },
      onClicked: clicked
    },
    scripting: {
      executeScript: async (args) => {
        data.scripts.push({ ...args, func: undefined })
        const tab = data.tabs.get(args.target.tabId)
        if (!tab) throw new Error('The tab has closed.')
        if (args.world === 'MAIN') {
          return [{ result: vm.runInNewContext('(' + args.func.toString() + ')()', { window: tab.legacy, document: tab.legacy.document }) }]
        }
        start(tab)
        return [{ result: undefined }]
      }
    }
  }
  const context = vm.createContext({ chrome: api, URL, crypto, console, setTimeout, clearTimeout })
  context.importScripts = (name) => vm.runInContext(read(name), context)
  vm.runInContext(read('service-worker.js'), context)
  const C = context.SDAExtension
  const pageSender = (tabId) => ({ id, tab: { id: tabId }, frameId: 0, documentId: data.tabs.get(tabId)?.documentId || 'closed-document', url: data.tabs.get(tabId)?.url || C.site })
  const popupSender = { id, url: api.runtime.getURL('popup.html') }
  const request = (operation, fields = {}, sender = popupSender) => deliver(incoming, { channel: C.channel, operation, ...fields }, sender)
  const contentRequest = (tabId, operation, fields = {}) => request(operation, fields, pageSender(tabId))
  data.backend = { api, C, request, contentRequest, pageSender, incoming, installed, removed, clicked }
  function start (tab) {
    tab.fixture.runScript(read('shared.js') + '\n' + read('bootstrap.js'), { chrome: tab.contentAPI, URL })
    tab.fixture.runScript(compiled)
  }
  return data.backend
}
function page (data, tabId = 1, options = {}) {
  const e = environment(options.preferences, options.sounds, { ...options, deferStart: true })
  // A new browser document must start later than its predecessor's observed timestamps.
  clockSeed += 60000
  e.setTime(clockSeed)
  e.window.location.href = 'https://vcc-au2.8x8.com/agent/'
  e.window.top = e.window
  const messages = event()
  const tab = {
    id: tabId,
    documentId: options.documentId || 'document-' + tabId,
    url: e.window.location.href,
    active: tabId === 1,
    fixture: e,
    messages,
    legacy: {
      localStorage: e.window.localStorage,
      sessionStorage: e.window.sessionStorage,
      document: { getElementById: () => options.oldHost || null }
    }
  }
  tab.contentAPI = {
    runtime: {
      id: 'fixture-extension',
      getManifest: () => clone(manifest),
      onMessage: messages,
      sendMessage: (message) => deliver(data.backend.incoming, message, data.backend.pageSender(tabId))
    }
  }
  data.tabs.set(tabId, tab)
  return e
}
async function settle () { for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve)) }
async function boot (data, tabId = 1) {
  await data.backend.api.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', files: ['shared.js', 'bootstrap.js', 'assistant.js'] })
  const runtime = data.tabs.get(tabId).fixture.window.__itsCallAssistRuntime
  await runtime.ready
  await settle()
  if (runtime.active) await runtime.flush()
  return runtime
}
function seed (data, records, fields = {}) {
  data.local.set('extension-history-v1', { ...header({ nextId: records.length + 1 }), recordKeys: records.map((call) => call.recordKey), draftDocuments: {}, ...fields })
  for (const call of records) data.local.set('extension-call:' + call.recordKey, clone(call))
}
check('Manifest V3 runs only on the permitted top-level 8x8 host with packaged resources', () => {
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.version, '1.0.0')
  assert.equal(manifest.version_name, '1.0')
  assert.deepEqual(manifest.host_permissions, ['https://vcc-au2.8x8.com/*'])
  assert.deepEqual(manifest.permissions, ['storage', 'unlimitedStorage', 'notifications', 'scripting'])
  assert.equal(manifest.content_scripts[0].all_frames, false)
  assert.equal(manifest.content_scripts[0].world, 'ISOLATED')
  assert.equal(manifest.content_scripts[0].run_at, 'document_idle')
  assert(!manifest.update_url)
  assert(!manifest.externally_connectable)
  assert(!manifest.web_accessible_resources)
  for (const file of [...manifest.content_scripts[0].js, manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons)]) {
    assert(fs.statSync(path.join(folder, file)).size > 0)
  }
  const metadata = JSON.parse(read('core-info.json'))
  const core = fs.readFileSync(path.join(root, 'Service-Desk-8x8-Assistant.js'), 'utf8')
  assert(read('assistant.js').includes(asFunction(core)))
  assert.equal(metadata.coreSha256, crypto.createHash('sha256').update(core).digest('hex'))
  assert.equal(metadata.extensionVersion, manifest.version)
  assert.equal(metadata.coreVersion, fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim())
  assert(!/\beval\s*\(|\bnew Function\b|https?:\/\//.test(read('popup.html')))
  assert(!/<script[^>]*>\s*[^<\s]/.test(read('popup.html')))
})
check('Automatic startup hydrates preferences and shows extension version without another login', async () => {
  const data = state()
  worker(data)
  const e = page(data, 1, { preferences: { g1: ['Alex Agent'], muted: true, lunchMinutes: 45 } })
  const runtime = await boot(data)
  assert.equal(runtime.active, true)
  assert.equal(data.accessLevel, 'TRUSTED_CONTEXTS')
  assert.equal(e.window.__itsCallAssist.version, '1.0')
  assert(e.checkbox('Alex Agent').checked)
  assert(e.ui().querySelector('.release-version').textContent.includes('1.0'))
  assert(e.button('Unmute'))
  assert.equal(e.window.__itsCallAssist.statistics().total, 0)
})
check('Installing injects existing tabs once, prioritising the active 8x8 tab', async () => {
  const data = state()
  const backend = worker(data)
  const first = page(data, 1)
  const second = page(data, 2)
  for (const listener of backend.installed.listeners) listener({ reason: 'install' })
  await settle()
  assert(first.window.__itsCallAssist)
  assert(!second.window.__itsCallAssist)
  const controller = first.window.__itsCallAssist
  await boot(data)
  assert.equal(first.window.__itsCallAssist, controller)
  assert.equal(data.session.get(backend.C.ownerKey).tabId, 1)
})
check('Closing and reopening a browser preserves completed notes, preferences and counter totals', async () => {
  const data = state()
  worker(data)
  const first = page(data)
  let runtime = await boot(data)
  first.showCall({ seconds: 24, number: '+155501001', transactionId: 'TX-survives-restart' })
  first.caller('00123456')
  first.notes('Fictional caller notes\nSecond line')
  first.showWrapUp(300, { seconds: 28, number: '+155501001', transactionId: 'TX-survives-restart' })
  await runtime.flush()
  assert.equal(first.window.__itsCallAssist.callHistorySession().records.length, 1)
  const savedTotal = first.window.__itsCallAssist.statistics().total
  data.tabs.clear()
  data.session.clear()
  worker(data)
  const second = page(data, 1, { documentId: 'reopened-browser' })
  runtime = await boot(data)
  second.button('Call Notes').onclick()
  const saved = second.window.__itsCallAssist.callHistorySession().records
  assert.equal(saved.length, 1)
  assert.equal(saved[0].caller, '00123456')
  assert.equal(saved[0].notes, 'Fictional caller notes\nSecond line')
  assert.equal(saved[0].callerPrediction, 'Student')
  assert.equal(second.window.__itsCallAssist.statistics().total, savedTotal)
  assert(second.ui().querySelector('.history-note').textContent.includes('Saved in this browser'))
  assert.equal(second.session.size, 0, 'Caller details must not be written into website sessionStorage.')
  assert(!second.storage.has('service-desk-8x8-call-history-v1'))
})
check('Worker suspension preserves ownership and data without restarting the content assistant', async () => {
  const data = state()
  seed(data, [record()])
  worker(data)
  const e = page(data)
  const runtime = await boot(data)
  const controller = e.window.__itsCallAssist
  worker(data)
  e.tick('Alex Agent', true)
  await runtime.flush()
  assert.equal(e.window.__itsCallAssist, controller)
  assert.equal((await data.backend.request('status')).savedCalls, 1)
  assert(JSON.parse(data.local.get('service-desk-8x8-preferences-v5')).g1.includes('Alex Agent'))
})
check('Saved-record typing is recovered after browser closure without changing native metadata', async () => {
  const data = state()
  const original = record()
  seed(data, [original])
  worker(data)
  const first = page(data)
  const runtime = await boot(data)
  first.button('Call Notes').onclick()
  first.ui().querySelector('[aria-label="Edit call note for call #1"]').onclick()
  const identifier = first.ui().querySelector('[aria-label="Caller name or ID for call #1"]')
  identifier.value = '001234567'
  identifier.oninput()
  const notes = first.ui().querySelector('.history-notes-input')
  notes.value = 'Recovered draft\nFictional detail'
  notes.oninput()
  await runtime.flush()
  assert(data.local.get('extension-editor-v1'))
  data.tabs.clear()
  data.session.clear()
  worker(data)
  const second = page(data, 1, { documentId: 'recover-editor' })
  await boot(data)
  const recovered = second.window.__itsCallAssist.callHistorySession().records[0]
  assert.equal(recovered.caller, '001234567')
  assert.equal(recovered.callerPrediction, 'Student')
  assert.equal(recovered.notes, 'Recovered draft\nFictional detail')
  for (const field of ['number', 'queue', 'transactionId', 'detectedAt', 'completedAt', 'durationSeconds', 'waitSeconds']) assert.equal(recovered[field], original[field])
  assert.equal(data.local.get('extension-editor-v1'), null)
})
check('Escape cancels a checkpoint, while Back saves all three editable fields durably', async () => {
  const data = state()
  seed(data, [record()])
  worker(data)
  const e = page(data)
  const runtime = await boot(data)
  e.button('Call Notes').onclick()
  e.ui().querySelector('[aria-label="Edit call note for call #1"]').onclick()
  const input = e.ui().querySelector('[aria-label="Caller name or ID for call #1"]')
  input.value = 'Cancelled Demo'
  input.oninput()
  input.onkeydown({ key: 'Escape', preventDefault () {} })
  await runtime.flush()
  assert.equal(data.local.get('extension-call:fixture-note-1').caller, 'Demo Caller')
  assert.equal(data.local.get('extension-editor-v1'), null)
  e.ui().querySelector('[aria-label="Edit call note for call #1"]').onclick()
  input.value = 'Saved Demo'
  input.oninput()
  const notes = e.ui().querySelector('.history-notes-input')
  notes.value = 'Saved fictional notes'
  notes.oninput()
  const job = e.ui().querySelector('.history-job-input')
  job.value = 'REQ123456'
  job.oninput()
  e.ui().querySelector('.call-history').querySelector('.menu-header').querySelector('button').onclick()
  await runtime.flush()
  const saved = data.local.get('extension-call:fixture-note-1')
  assert.equal(saved.caller, 'Saved Demo')
  assert.equal(saved.notes, 'Saved fictional notes')
  assert.equal(saved.jobNumber, 'REQ123456')
})
check('An ongoing call restores only by native reference and survives a later hidden Info tab', async () => {
  const data = state()
  worker(data)
  const first = page(data)
  let runtime = await boot(data)
  first.showCall({ seconds: 12, number: '+155501001', transactionId: 'TX-resume-call' })
  first.caller('Demo Continuing Caller')
  first.notes('Keep this fictional draft')
  await runtime.flush()
  const total = first.window.__itsCallAssist.statistics().total
  data.tabs.clear()
  data.session.clear()
  worker(data)
  const second = page(data, 1, { documentId: 'same-call-new-document' })
  second.showCall({ seconds: 24, number: '+155501001', transactionId: 'TX-resume-call' })
  runtime = await boot(data)
  assert.equal(second.ui().querySelector('#its-caller-identifier').value, 'Demo Continuing Caller')
  second.setCallInfo('Transaction ID', null)
  second.notes('Still the same fictional caller')
  second.setCallInfo('Transaction ID', 'TX-resume-call')
  second.showWrapUp(300, { seconds: 30, number: '+155501001', transactionId: 'TX-resume-call' })
  await runtime.flush()
  const history = second.window.__itsCallAssist.callHistorySession()
  assert.equal(history.records.length, 1)
  assert.equal(history.records[0].caller, 'Demo Continuing Caller')
  assert.equal(history.records[0].notes, 'Still the same fictional caller')
  assert.equal(history.pending.length, 0)
  assert.equal(second.window.__itsCallAssist.statistics().total, total)
})
check('A repeated phone number without the old transaction cannot inherit a previous draft', async () => {
  const data = state()
  const draft = { ...record(), callerInput: 'Old Demo Caller', notesInput: 'Do not attach to a new call' }
  delete draft.completedAt
  seed(data, [], { ...header({ currentId: 1, nextId: 2, pending: [draft] }), draftDocuments: { 1: 'old-document' } })
  worker(data)
  const e = page(data)
  e.showCall({ seconds: 3, number: '+155501001', transactionId: null })
  await boot(data)
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, '')
  assert.equal(e.ui().querySelector('#its-caller-notes').value, '')
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 2)
})
check('Two distinct connected references across a restart count once each; disposition stays uncounted', async () => {
  const data = state()
  worker(data)
  const first = page(data)
  let runtime = await boot(data)
  first.showCall({ seconds: 8, number: '+155501001', transactionId: 'TX-first-call' })
  await runtime.flush()
  const total = first.window.__itsCallAssist.statistics().total
  data.tabs.clear()
  data.session.clear()
  worker(data)
  const second = page(data, 1, { documentId: 'different-call-document' })
  second.showCall({ seconds: 5, number: '+155501001', transactionId: 'TX-second-call' })
  runtime = await boot(data)
  second.scan()
  assert.equal(second.window.__itsCallAssist.statistics().total, total + 1)
  second.showWrapUp(300, { seconds: 12, number: '+155501001', transactionId: 'TX-second-call' })
  second.scan()
  await runtime.flush()
  assert.equal(second.window.__itsCallAssist.statistics().total, total + 1)
})
check('Other tabs cannot overwrite notes; explicit takeover flushes and stops the first assistant', async () => {
  const data = state()
  const backend = worker(data)
  const first = page(data)
  const second = page(data, 2)
  const runtime = await boot(data)
  first.showCall({ seconds: 6, number: '+155501001', transactionId: 'TX-tab-transfer' })
  first.caller('Demo Tab Transfer')
  await runtime.flush()
  const oldToken = runtime.token
  const inactive = await boot(data, 2)
  assert.equal(inactive.active, false)
  assert(!second.window.__itsCallAssist)
  const moved = await backend.request('activate', { tabId: 2 })
  assert(!moved.error)
  await second.window.__itsCallAssistRuntime.ready
  await settle()
  assert(!first.window.__itsCallAssist)
  assert(second.window.__itsCallAssist)
  assert.equal(data.session.get(backend.C.ownerKey).tabId, 2)
  const refused = await backend.contentRequest(1, 'history', { token: oldToken, header: header(), records: [] })
  assert.equal(refused.code, 'not-owner')
  const retained = second.window.__itsCallAssist.callHistorySession()
  assert([...retained.pending, ...retained.records].some((call) => (call.callerInput || call.caller) === 'Demo Tab Transfer'))
})
check('A write failure keeps edits queued and visibly unsaved until a successful retry', async () => {
  const data = state()
  seed(data, [record()])
  worker(data)
  const e = page(data)
  const runtime = await boot(data)
  data.failWrites = 1
  runtime.checkpointEditor('fixture-note-1', { caller: 'Retry Demo', notes: 'Retained', jobNumber: '' })
  await assert.rejects(runtime.flush(), /write failed/)
  assert(e.ui().querySelector('.extension-storage-state').textContent.includes('Not saved'))
  assert.equal(data.local.get('extension-editor-v1'), undefined)
  await runtime.flush()
  assert.equal(data.local.get('extension-editor-v1').fields.caller, 'Retry Demo')
  assert(e.ui().querySelector('.extension-storage-state').textContent.includes('Saved'))
})
check('Failed final saves block a tab takeover rather than replacing the unsaved owner', async () => {
  const data = state()
  const backend = worker(data)
  page(data)
  page(data, 2)
  const runtime = await boot(data)
  data.failWrites = 100
  runtime.settingsStorage.setItem('service-desk-8x8-preferences-v5', JSON.stringify({ g1: ['Alex Agent'] }))
  await assert.rejects(runtime.flush())
  const moved = await backend.request('activate', { tabId: 2 })
  assert(moved.error)
  assert.equal(data.session.get(backend.C.ownerKey).tabId, 1)
  const second = await backend.contentRequest(2, 'init')
  assert.equal(second.reason, 'another-tab')
  data.failWrites = 0
  await runtime.onDestroy()
})
check('Deletion remains deleted even if orphan cleanup fails, preserving capture guards', async () => {
  const data = state()
  seed(data, [record()], { completedTransactions: ['TX-fixture-1'] })
  const backend = worker(data)
  const e = page(data)
  const runtime = await boot(data)
  data.failRemove = true
  e.button('Call Notes').onclick()
  e.ui().querySelector('[aria-label="Delete call note #1"]').onclick()
  await runtime.flush()
  assert(data.local.has('extension-call:fixture-note-1'))
  assert.equal((await backend.request('status')).savedCalls, 0)
  assert(data.local.get('extension-history-v1').completedTransactions.includes('TX-fixture-1'))
  data.tabs.clear()
  data.session.clear()
  worker(data)
  const second = page(data, 1, { documentId: 'deleted-restart' })
  await boot(data)
  assert.equal(second.window.__itsCallAssist.callHistorySession().records.length, 0)
})
check('Interrupted durable writes do not replace the previously committed call-note index', async () => {
  const data = state()
  seed(data, [record()])
  const backend = worker(data)
  page(data)
  const runtime = await boot(data)
  data.failWrites = 1
  const response = await backend.contentRequest(1, 'history', { token: runtime.token, header: header(), records: [] })
  assert(response.error)
  assert.equal((await backend.request('status')).savedCalls, 1)
  assert.equal(data.local.get('extension-call:fixture-note-1').caller, 'Demo Caller')
})
check('Long histories hydrate in bounded chunks; paging and search retain full TXT export', async () => {
  const data = state()
  const records = Array.from({ length: 230 }, (_, index) => record(index + 1, { caller: 'Demo ' + (index + 1), notes: 'x'.repeat(4000) }))
  seed(data, records)
  const backend = worker(data)
  const e = page(data)
  const runtime = await boot(data)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 230)
  e.button('Call Notes').onclick()
  assert.equal(e.ui().querySelectorAll('.history-card').length, 100)
  e.button('Next').onclick()
  assert.equal(e.ui().querySelectorAll('.history-card').length, 100)
  e.button('Next').onclick()
  assert.equal(e.ui().querySelectorAll('.history-card').length, 30)
  const search = e.ui().querySelector('.history-search')
  search.value = 'Demo 230'
  search.oninput()
  assert.equal(e.ui().querySelectorAll('.history-card').length, 1)
  assert(/Demo 1\r?\n/.test(e.window.__itsCallAssist.exportCallNotesText()))
  assert(/Demo 230\r?\n/.test(e.window.__itsCallAssist.exportCallNotesText()))
  const first = await backend.contentRequest(1, 'history-page', { token: runtime.token, offset: 0 })
  assert(first.records.length < 200)
  assert(first.next > 0)
  assert((await backend.contentRequest(1, 'history-page', { token: runtime.token, offset: -1 })).error)
})
check('Legacy migration finalises and stops the old snippet, without replacing durable extension data', async () => {
  const data = state()
  const backend = worker(data)
  page(data)
  const tab = data.tabs.get(1)
  let stopped = 0
  let finalised = 0
  tab.legacy.__itsCallAssist = {
    version: '1.1.5',
    finaliseCallNotes: () => { finalised++ },
    destroy: () => { stopped++ },
    callHistorySession: () => ({ ...header(), records: [record()] })
  }
  await boot(data)
  assert.equal(stopped, 1)
  assert.equal(finalised, 1)
  assert.equal((await backend.request('status')).savedCalls, 1)
  assert(data.local.has('extension-call:fixture-note-1'))
  const saved = clone(data.local.get('extension-call:fixture-note-1'))
  tab.legacy.__itsCallAssist.callHistorySession = () => ({ ...header(), records: [] })
  await tab.fixture.window.__itsCallAssistRuntime.onDestroy()
  // Simulate a replacement document, as an extension update must not run two worlds at once.
  page(data, 1, { documentId: 'legacy-migration-again' })
  await boot(data)
  assert.deepEqual(data.local.get('extension-call:fixture-note-1'), saved)
})
check('A leftover extension panel requests a safe reload and never reloads an active call', async () => {
  const data = state()
  worker(data)
  const e = page(data, 1, { oldHost: {} })
  await assert.rejects(boot(data), /Reload 8x8 when you are not on a call/)
  assert(!e.window.__itsCallAssist)
  assert.equal(data.reloaded, undefined)
  assert(e.window.document.body.querySelector('#its-extension-status'))
})
check('Unreadable storage or a missing saved record blocks startup without erasing any notes', async () => {
  for (const reason of ['read', 'missing']) {
    const data = state()
    seed(data, [record()])
    if (reason === 'read') data.failReads = true
    else data.local.delete('extension-call:fixture-note-1')
    worker(data)
    const e = page(data)
    const before = clone(Object.fromEntries(data.local))
    await assert.rejects(boot(data))
    assert(!e.window.__itsCallAssist)
    const privateData = Object.fromEntries([...data.local].filter(([key]) => key.startsWith('extension-')))
    assert.deepEqual(privateData, Object.fromEntries(Object.entries(before).filter(([key]) => key.startsWith('extension-'))))
  }
})
check('Foreign origins, frames, extension IDs and ownership tokens cannot write private storage', async () => {
  const data = state()
  seed(data, [record()])
  const backend = worker(data)
  page(data)
  const runtime = await boot(data)
  const valid = backend.pageSender(1)
  for (const changed of [{ url: 'https://example.com/' }, { frameId: 1 }, { id: 'foreign-extension' }, { documentId: 'different-document' }]) {
    const result = await backend.request('history', { token: runtime.token, header: header(), records: [] }, { ...valid, ...changed })
    assert(result.error)
  }
  assert((await backend.contentRequest(1, 'history', { token: 'wrong', header: header(), records: [] })).error)
  assert((await backend.contentRequest(1, 'setting', { token: runtime.token, key: 'unrelated-site-key', value: '{}' })).error)
  assert((await backend.contentRequest(1, 'notice-close', { token: runtime.token, noticeId: 'unrelated-notification' })).error)
  assert.equal((await backend.request('status')).savedCalls, 1)
})
check('Extension desktop notification tests await delivery and stay silent, even while muted', async () => {
  const data = state()
  worker(data)
  const e = page(data, 1, { preferences: { g1: ['Me'], muted: true } })
  await boot(data)
  await e.button('Test desktop notification').onclick()
  assert.equal(data.notifications.size, 1)
  const [notice] = data.notifications.values()
  assert.equal(notice.silent, true)
  assert.equal(notice.type, 'basic')
  assert(e.ui().querySelector('.notification-feedback').textContent.includes('Test notification sent'))
  assert(e.ui().querySelector('.notification-instructions').textContent.includes('extension'))
  assert(!e.ui().querySelector('.notification-instructions').textContent.includes('Add site'))
  assert.equal(e.notifications.length, 0, 'The website Notification API is not used.')
})
check('Denied extension notifications report failure and never claim that a popup was sent', async () => {
  const data = state()
  worker(data)
  const e = page(data)
  await boot(data)
  data.permission = 'denied'
  await e.button('Test desktop notification').onclick()
  assert.equal(data.notifications.size, 0)
  assert(e.ui().querySelector('.notification-feedback').textContent.includes('could not be sent'))
})
check('Notification cancellation can overtake creation; a click focuses the owning 8x8 tab', async () => {
  const data = state()
  const backend = worker(data)
  page(data)
  const runtime = await boot(data)
  let finish
  data.noticeGate = new Promise((resolve) => { finish = resolve })
  const cancelled = new runtime.Notification('Demo notice', { body: 'Fictional text' })
  await settle()
  cancelled.close()
  await settle()
  finish()
  await cancelled.ready
  await settle()
  assert.equal(data.notifications.size, 0)
  data.noticeGate = null
  const visible = new runtime.Notification('Demo click', { body: 'Fictional text' })
  let clicks = 0
  visible.onclick = () => { clicks++; visible.close() }
  await visible.ready
  for (const listener of backend.clicked.listeners) listener(visible.id)
  await settle()
  assert.equal(clicks, 1)
  assert(data.focus.includes(1))
  assert.equal(data.notifications.size, 0)
})
check('Turning automatic startup off stops monitoring but keeps Call Notes for re-enabling', async () => {
  const data = state()
  seed(data, [record()])
  const backend = worker(data)
  const e = page(data)
  await boot(data)
  const off = await backend.request('enabled', { enabled: false })
  assert(!off.error)
  assert(!e.window.__itsCallAssist)
  assert.equal((await backend.request('status')).savedCalls, 1)
  const disabled = await boot(data)
  assert.equal(disabled.active, false)
  const on = await backend.request('enabled', { enabled: true })
  assert(!on.error)
  await e.window.__itsCallAssistRuntime.ready
  await settle()
  assert(e.window.__itsCallAssist)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
})
check('Closing the panel releases its lease and the toolbar can reopen it with saved notes', async () => {
  const data = state()
  seed(data, [record()])
  const backend = worker(data)
  const e = page(data)
  const runtime = await boot(data)
  e.button('x').onclick()
  await runtime.closePromise
  assert.equal(data.session.get('extension-owner-v1'), null)
  assert(!e.window.__itsCallAssist)
  assert(!(await backend.request('activate', { tabId: 1 })).error)
  await e.window.__itsCallAssistRuntime.ready
  await settle()
  assert(e.window.__itsCallAssist)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
})
check('Closing the monitored tab resumes in an already-open 8x8 tab and clears its old notices', async () => {
  const data = state()
  const backend = worker(data)
  page(data)
  const second = page(data, 2)
  const runtime = await boot(data)
  await boot(data, 2)
  const notice = new runtime.Notification('Demo tab close', { body: 'Fictional text' })
  await notice.ready
  data.tabs.delete(1)
  for (const listener of backend.removed.listeners) listener(1)
  await settle()
  assert(second.window.__itsCallAssist)
  assert.equal(data.session.get('extension-owner-v1').tabId, 2)
  assert.equal(data.notifications.size, 0)
})
check('Notification cleanup failures cannot misreport a committed save or block closing', async () => {
  const data = state()
  const backend = worker(data)
  const e = page(data)
  const runtime = await boot(data)
  data.notificationCleanupFails = true
  e.button('x').onclick()
  await runtime.closePromise
  assert.equal((await backend.request('status')).owner, null)
  assert.equal(e.window.document.body.querySelector('#its-extension-status'), null)
})
check('Unconfigured remote updates make no network request; configured updates use Edge', async () => {
  const data = state()
  let backend = worker(data)
  assert.equal((await backend.request('update')).status, 'not-configured')
  assert.equal(data.updateChecks, 0)
  data.manifest = { ...manifest, update_url: 'https://updates.example.com/8x8-updates.xml' }
  backend = worker(data)
  assert.equal((await backend.request('update')).status, 'no_update')
  assert.equal(data.updateChecks, 1)
  assert.equal((await backend.request('status')).updatesConfigured, true)
})
check('The deterministic builder accepts HTTPS update configuration and rejects executable update URLs', () => {
  const builder = fs.readFileSync(path.join(root, 'scripts/build-extension.cjs'), 'utf8')
  for (const updateUrl of ['https://updates.example.com/8x8-updates.xml', 'http://updates.example.com/file', 'javascript:alert(1)']) {
    const written = new Map()
    const fakeFS = {
      ...fs,
      readFileSync: (file, encoding) => file === path.join(folder, 'update-config.json')
        ? JSON.stringify({ enabled: true, updateUrl, publicKey: null })
        : fs.readFileSync(file, encoding),
      writeFileSync: (file, content) => written.set(file, content)
    }
    const context = { require: (name) => name === 'node:fs' ? fakeFS : require(name), __dirname: path.join(root, 'scripts'), process: { argv: [], env: {} }, console: { log () {} }, URL }
    if (updateUrl.startsWith('https:')) {
      vm.runInNewContext(builder, context)
      assert.equal(JSON.parse(written.get(path.join(folder, 'manifest.json'))).update_url, updateUrl)
      assert(written.get(path.join(folder, 'assistant.js')).includes(asFunction(fs.readFileSync(path.join(root, 'Service-Desk-8x8-Assistant.js'), 'utf8'))))
    } else assert.throws(() => vm.runInNewContext(builder, context), /HTTPS/)
  }
})
;(async () => {
  for (const { name, test } of checks) {
    await test()
    passed++
    console.log('PASS:', name)
  }
  console.log(`${passed} extension scenarios passed.`)
})().catch((error) => { console.error(error); process.exitCode = 1 })
