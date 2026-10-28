/* Prototype feature scenarios run separately to keep simulated browser contexts bounded. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const fixture = fs.readFileSync(path.join(__dirname, 'assistant.test.cjs'), 'utf8')
const context = vm.createContext({ require, __dirname, console, Blob, TextDecoder })
// Run the shared 8x8 fixture definitions, including the prototype, without the baseline list.
vm.runInContext(fixture.slice(0, fixture.indexOf("check('Me is selectable")) + '\nglobalThis.environment = environment', context)
const environment = context.environment
const checks = []
function check (name, fn) { checks.push({ name, fn }) }
const asyncCheck = check
function editableHistory (callers = ['Alex Example']) {
  const e = environment({ g1: [] })
  callers.forEach((caller, index) => {
    const transactionId = 'demo-manual-baseline-' + index
    e.showCall({ transactionId })
    e.caller(caller)
    e.showWrapUp(120, { transactionId, seconds: 20 })
    e.restoreMain()
  })
  e.button('Call Notes').onclick()
  return e
}
function historyCard (e, id = 1) {
  return e.ui().querySelectorAll('.history-card').find((card) => card.getAttribute('data-call-id') === String(id))
}
function editIdentifier (card, value) {
  const input = card.querySelector('.history-edit-input')
  input.value = value
  input.oninput()
  return input
}
function editNoteFields (card, { caller, notes, jobNumber }) {
  if (caller !== undefined) editIdentifier(card, caller)
  for (const [selector, value] of [['.history-notes-input', notes], ['.history-job-input', jobNumber]]) {
    if (value === undefined) continue
    const input = card.querySelector(selector)
    input.value = value
    input.oninput()
  }
}
// Manual-note helpers exercise the same card editor as captured calls, with fictional data.
function startManualNote (e) {
  e.button('Call Notes').onclick()
  e.button('+ Add note').onclick()
  return e.ui().querySelector('.new-note')
}
function noteTotals (e) {
  return Array.from(e.ui().querySelector('.history-statistics').querySelectorAll('.stat-value'), (node) => node.textContent)
}
check('A manual note draft uses the existing editor and does not invent call details', () => {
  const e = environment()
  const card = startManualNote(e)
  assert(card.classList.contains('editing'))
  assert.equal(card.querySelector('.history-source').textContent, 'Manual Note')
  assert.equal(card.querySelector('.history-information'), null)
  assert.equal(card.querySelector('.history-timings'), null)
  assert.equal(card.querySelector('.history-edit-toggle').textContent, '✓')
  assert.deepEqual(noteTotals(e), ['0', '0', '0', '0'])
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
  editNoteFields(card, { caller: '00123456', notes: 'Walk-in password help\nFictional detail', jobNumber: 'REQ1234567' })
  card.querySelector('.history-edit-toggle').onclick()
  const record = e.window.__itsCallAssist.callHistorySession().records[0]
  assert.equal(record.origin, 'manual')
  assert.equal(record.caller, '00123456')
  assert.equal(record.callerPrediction, 'Student')
  assert.equal(record.notes, 'Walk-in password help\nFictional detail')
  assert.equal(record.jobNumber, 'REQ1234567')
  for (const key of ['number', 'queue', 'transactionId', 'channel', 'durationSeconds', 'waitSeconds', 'holdSeconds']) assert.equal(record[key], null)
  assert(record.completedAt >= record.detectedAt)
  assert(!card.querySelector('.history-extra').textContent.includes('Time unknown'))
  assert.deepEqual(noteTotals(e), ['1', '1', '0', '0'])
  assert.equal(e.window.__itsCallAssist.statistics().total, 0)
  assert.equal(e.notifications.length, 0)
  assert.equal(e.debug().playing.length, 0)
})
check('Blank manual names become Unknown and missing job placeholders contribute to note totals', () => {
  const e = environment()
  const card = startManualNote(e)
  editNoteFields(card, { caller: '   ', notes: 'Fictional visit', jobNumber: 'NO JOB NUMBER' })
  card.querySelector('.history-edit-toggle').onclick()
  const record = e.window.__itsCallAssist.callHistorySession().records[0]
  assert.equal(record.caller, 'Unknown')
  assert.equal(record.callerPrediction, 'Unknown')
  assert.equal(record.jobNumber, '')
  assert.deepEqual(noteTotals(e), ['1', '0', '0', '1'])
})
check('Escape and Cancel discard a new manual draft without deleting any saved note', () => {
  for (const action of ['Escape', 'Cancel']) {
    const e = editableHistory(['Demo Saved Caller'])
    const initial = JSON.stringify(e.window.__itsCallAssist.callHistorySession().records)
    const card = startManualNote(e)
    editNoteFields(card, { caller: 'Discarded Demo', notes: 'Discarded fictional draft' })
    if (action === 'Escape') card.querySelector('.history-edit-input').onkeydown({ key: 'Escape', preventDefault () {} })
    else card.querySelector('[aria-label="Cancel new note"]').onclick()
    assert.equal(e.ui().querySelector('.new-note'), null)
    assert.equal(JSON.stringify(e.window.__itsCallAssist.callHistorySession().records), initial)
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    assert.deepEqual(noteTotals(e), ['1', '0', '1', '1'])
  }
})
check('A double Add click keeps one manual editor, and another record pen saves it first', () => {
  const e = editableHistory(['Existing Demo'])
  const card = startManualNote(e)
  editNoteFields(card, { caller: 'New Demo', notes: 'One draft only' })
  e.button('+ Add note').onclick()
  assert.equal(e.ui().querySelectorAll('.new-note').length, 1)
  assert.equal(e.ui().querySelector('.new-note'), card)
  historyCard(e, 1).querySelector('.history-edit-toggle').onclick()
  const records = e.window.__itsCallAssist.callHistorySession().records
  assert.equal(records.length, 2)
  assert.equal(records.find((record) => record.origin === 'manual').notes, 'One draft only')
  assert.equal(e.ui().querySelectorAll('.history-card').filter((node) => node.classList.contains('editing')).length, 1)
})
check('Clicking away, Back, settings, pagehide and a rerun each save a manual draft once', () => {
  for (const action of ['outside', 'Back', 'Settings', 'pagehide', 'rerun']) {
    const e = environment()
    const card = startManualNote(e)
    editNoteFields(card, { caller: 'Demo ' + action, notes: 'Fictional autosave', jobNumber: 'INC123456' })
    if (action === 'outside') e.pointerDown(e.window.document.body)
    else if (action === 'Back') e.ui().querySelector('.call-history').querySelector('button').onclick()
    else if (action === 'Settings') e.button('Settings').onclick()
    else if (action === 'pagehide') e.pageHide()
    else e.rerun()
    const records = e.window.__itsCallAssist.callHistorySession().records
    assert.equal(records.length, 1, action)
    assert.equal(records[0].caller, 'Demo ' + action)
    assert.equal(records[0].notes, 'Fictional autosave')
    assert.equal(e.window.__itsCallAssist.statistics().total, 0)
  }
})
check('Manual typing and caret nodes survive polling while the native agent data is frozen', () => {
  const e = environment()
  e.header.hidden = e.group.hidden = true
  for (const queue of e.queues) queue.row.hidden = true
  e.scan()
  const card = startManualNote(e)
  const input = editIdentifier(card, 'Demo Frozen Visit')
  editNoteFields(card, { notes: 'Accessible during a data gap' })
  e.scan()
  assert.equal(e.ui().querySelector('.new-note'), card)
  assert.equal(card.querySelector('.history-edit-input'), input)
  assert.equal(input.value, 'Demo Frozen Visit')
  assert(card.classList.contains('editing'))
  card.querySelector('.history-edit-toggle').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].notes, 'Accessible during a data gap')
  assert(e.window.__itsCallAssist.inspect().agentsFrozen)
})
check('Manual entries coexist with an active call without changing its draft, counter or capture ledger', () => {
  const e = environment({ g1: [] })
  e.showCall({ transactionId: 'demo-concurrent-manual' })
  e.caller('Demo Phone Caller')
  e.notes('Phone draft')
  const card = startManualNote(e)
  editNoteFields(card, { caller: 'Demo In Person', notes: 'Visit draft' })
  card.querySelector('.history-edit-toggle').onclick()
  e.showWrapUp(120, { transactionId: 'demo-concurrent-manual', seconds: 20 })
  const history = e.window.__itsCallAssist.callHistorySession()
  assert.equal(history.records.length, 2)
  assert.equal(new Set(history.records.map((record) => record.id)).size, 2)
  assert.equal(history.records.find((record) => record.origin === '8x8').caller, 'Demo Phone Caller')
  assert.equal(history.records.find((record) => record.origin === 'manual').notes, 'Visit draft')
  assert.deepEqual(Array.from(history.completedTransactions), ['demo-concurrent-manual'])
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
})
check('Manual notes round-trip through TXT and session restoration without guessed native data', () => {
  const e = environment()
  const card = startManualNote(e)
  editNoteFields(card, { caller: '001234567', notes: 'First line\n--------------------\nSecond line', jobNumber: 'INC1234567' })
  card.querySelector('.history-edit-toggle').onclick()
  const before = e.window.__itsCallAssist.callHistorySession().records[0]
  const exported = e.window.__itsCallAssist.exportCallNotesText()
  const target = environment()
  target.window.__itsCallAssist.importCallNotesText(exported)
  const imported = target.window.__itsCallAssist.callHistorySession().records[0]
  for (const key of Object.keys(before).filter((key) => key !== 'id')) assert.equal(imported[key], before[key], key)
  target.rerun()
  target.button('Call Notes').onclick()
  assert.equal(historyCard(target).querySelector('.history-source').textContent, 'Manual Note')
  assert.equal(target.window.__itsCallAssist.statistics().total, 0)
  assert.equal(target.window.__itsCallAssist.callHistorySession().completedTransactions.length, 0)
  for (const saved of e.storage.values()) assert(!saved.includes('First line'))
})
check('Note totals follow saved edits, import, delete and Undo, and remain global during searches', () => {
  const e = editableHistory(['00123456', 'Demo Staff', 'Unknown'])
  assert.deepEqual(noteTotals(e), ['3', '1', '1', '3'])
  historyCard(e, 3).querySelector('.history-edit-toggle').onclick()
  editNoteFields(historyCard(e, 3), { caller: '123456789', jobNumber: 'REQ123456' })
  historyCard(e, 3).querySelector('.history-edit-toggle').onclick()
  assert.deepEqual(noteTotals(e), ['3', '2', '1', '2'])
  const search = e.ui().querySelector('.history-search')
  search.value = 'Demo Staff'
  search.oninput()
  assert.equal(e.ui().querySelectorAll('.history-card').length, 1)
  assert.deepEqual(noteTotals(e), ['3', '2', '1', '2'])
  historyCard(e, 2).querySelector('.history-delete').onclick()
  assert.deepEqual(noteTotals(e), ['2', '2', '0', '1'])
  e.button('Undo delete').onclick()
  assert.deepEqual(noteTotals(e), ['3', '2', '1', '2'])
  e.window.__itsCallAssist.importCallNotesText('Demo Imported\nFictional import\nINC123456')
  assert.deepEqual(noteTotals(e), ['4', '2', '2', '2'])
  assert.equal(e.window.__itsCallAssist.statistics().total, 3)
  assert(!e.ui().querySelector('.call-history').textContent.includes('Calls taken today'))
})
check('Record cards keep uncertain prediction and duration markers without the two removed paragraphs', () => {
  const e = editableHistory()
  const text = historyCard(e).textContent
  assert(!text.includes('Duration shows the last time read'))
  assert(!text.includes('Prediction uses the entered name'))
  assert(text.includes('Caller type (prediction): Staff'))
})
check('Footer and personal mute icons have accessible actions and change their speaker paths', () => {
  const e = environment()
  const buttons = e.ui().querySelector('.controls').querySelectorAll('button')
  assert.equal(buttons[0].textContent, 'Call Notes')
  const mute = buttons[1]
  const settings = buttons[2]
  assert.equal(mute.textContent, '')
  assert.equal(settings.textContent, '')
  assert.equal(settings.getAttribute('aria-label'), 'Settings')
  assert(settings.querySelector('svg'))
  const audiblePath = mute.querySelectorAll('path').map((node) => node.getAttribute('d')).join('|')
  mute.onclick()
  assert.equal(mute.getAttribute('aria-label'), 'Unmute')
  assert.equal(mute.getAttribute('aria-pressed'), 'true')
  assert.notEqual(mute.querySelectorAll('path').map((node) => node.getAttribute('d')).join('|'), audiblePath)
  e.showBreak(1)
  const compact = e.ui().querySelector('.compact-view').querySelector('[aria-label="Unmute"]')
  assert(compact.querySelector('svg'))
  compact.onclick()
  assert.equal(compact.getAttribute('aria-label'), 'Mute')
  assert(!e.debug().muted)
})
function reminderCard (e, kind) {
  return e.ui().querySelector('.current-reminders').querySelector('[data-kind="' + kind + '"]')
}
function breakInfo () {
  const e = environment({ g1: ['Alex Agent'] })
  e.other('Alex Agent', 'On Break', 10)
  e.scan()
  return e
}
check('A finite G1 break sound shows finished, then its card and desktop popup close after five seconds', () => {
  const e = breakInfo()
  assert(e.debug().playing.includes('lunch'))
  const notice = e.notifications.at(-1)
  e.advance(1999)
  assert(e.debug().playing.includes('lunch'))
  e.advance(1)
  assert(!e.debug().playing.includes('lunch'))
  assert(reminderCard(e, 'lunch').textContent.includes('Sound finished'))
  e.advance(4999)
  assert(reminderCard(e, 'lunch'))
  assert(!notice.closed)
  e.advance(1)
  assert.equal(reminderCard(e, 'lunch'), null)
  assert(notice.closed)
  const count = e.notifications.length
  e.scan()
  assert.equal(reminderCard(e, 'lunch'), null)
  assert.equal(e.notifications.length, count)
})
check('Notification Display Time uses saved seconds and changing it applies to an existing finished message', () => {
  const e = environment({ g1: ['Alex Agent'], notificationDisplaySeconds: 10 })
  e.other('Alex Agent', 'On Break', 10)
  e.scan()
  e.advance(7000)
  assert(reminderCard(e, 'lunch'))
  const input = e.ui().querySelector('#its-notification-display-seconds')
  assert.equal(input.value, '10')
  input.value = '3'
  input.onchange()
  assert.equal(reminderCard(e, 'lunch'), null)
  assert.equal(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).notificationDisplaySeconds, 3)
  e.rerun()
  assert.equal(e.ui().querySelector('#its-notification-display-seconds').value, '3')
})
check('New informational episodes replace an earlier dismissal deadline and do not close too soon', () => {
  const e = environment({ g1: ['Alex Agent', 'Casey Agent'] })
  e.other('Alex Agent', 'On Break', 10)
  e.scan()
  e.advance(4000)
  e.other('Casey Agent', 'On Break', 10)
  e.scan()
  const latest = e.notifications.at(-1)
  e.advance(1000)
  assert(reminderCard(e, 'lunch').textContent.includes('Casey Agent'))
  assert(!latest.closed)
  e.advance(6000)
  assert.equal(reminderCard(e, 'lunch'), null)
  assert(latest.closed)
})
check('An expired finite personal alert stays dismissed until a distinct condition episode begins', () => {
  const e = environment({ g1: ['Me'], notificationDisplaySeconds: 2 }, { disposition: { repeat: false, seconds: 1 } })
  e.setMe('Wrap Up', 11)
  e.advance(3000)
  assert(!reminderCard(e, 'disposition'))
  e.setMe('Wrap Up', 15)
  assert(!reminderCard(e, 'disposition'))
  e.setMe('Available', 1)
  e.setMe('Wrap Up', 11)
  assert(reminderCard(e, 'disposition'))
})
check('Repeating alerts remain visible and audible after their desktop popup closes', () => {
  const e = environment({ g1: ['Me'], notificationDisplaySeconds: 2 })
  e.setMe('Wrap Up', 11)
  const notice = e.notifications.at(-1)
  e.advance(2000)
  assert(notice.closed)
  assert(reminderCard(e, 'disposition'))
  assert(e.debug().playing.includes('disposition'))
  e.setMe('Available', 1)
  assert(!reminderCard(e, 'disposition'))
})
check('Muted informational messages expire, while muted repeating alerts retain their actionable card', () => {
  const e = environment({ g1: ['Alex Agent'], muted: true, notificationDisplaySeconds: 2 })
  e.other('Alex Agent', 'On Break', 10)
  e.scan()
  assert(reminderCard(e, 'lunch').textContent.includes('Sound muted'))
  e.advance(4000)
  assert.equal(reminderCard(e, 'lunch'), null)
  e.setMe('Wrap Up', 11)
  e.setMe('Wrap Up', 12)
  e.advance(2000)
  assert(reminderCard(e, 'disposition').textContent.includes('Sound muted'))
  assert.equal(e.debug().playing.length, 0)
})
check('Finished preview messages expire and an obsolete preview timeout cannot stop a new preview', () => {
  const e = environment({ notificationDisplaySeconds: 2 })
  e.button('Settings').onclick()
  e.button('Open Sound Settings').onclick()
  const preview = e.ui().querySelector('.sound-category').querySelectorAll('button').find((button) => button.textContent === 'Preview')
  preview.onclick()
  const old = [...e.jobs.values()].find((job) => job.ms === 2000)
  preview.onclick()
  old.fn()
  assert(e.debug().playing.includes('preview'))
  e.advance(2000)
  assert(reminderCard(e, 'preview').textContent.includes('Sound finished'))
  e.advance(2000)
  assert.equal(reminderCard(e, 'preview'), null)
})
function confirmationTimeout (e) {
  const pair = [...e.jobs].find(([, job]) => job.ms === 5000 && job.fn.toString().includes('historyTransferStatus'))
  assert(pair)
  return pair
}
check('Delete and restore confirmations disappear after five seconds while Undo stays available', () => {
  const e = editableHistory()
  historyCard(e).querySelector('.history-delete').onclick()
  const [id, job] = confirmationTimeout(e)
  assert(!e.ui().querySelector('.history-transfer-status').classList.contains('hidden'))
  e.jobs.delete(id)
  job.fn()
  assert(e.ui().querySelector('.history-transfer-status').classList.contains('hidden'))
  assert(!e.button('Undo delete').classList.contains('hidden'))
  e.button('Undo delete').onclick()
  assert(e.ui().querySelector('.history-transfer-status').textContent.includes('restored'))
  const [restoreId, restoreJob] = confirmationTimeout(e)
  e.jobs.delete(restoreId)
  restoreJob.fn()
  assert(e.ui().querySelector('.history-transfer-status').classList.contains('hidden'))
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
})
check('New confirmations replace their timeout and closing clears the pending five-second timer', () => {
  const e = editableHistory()
  historyCard(e).querySelector('.history-delete').onclick()
  const [oldId] = confirmationTimeout(e)
  e.button('Undo delete').onclick()
  assert(!e.jobs.has(oldId))
  assert.equal([...e.jobs.values()].filter((job) => job.ms === 5000 && job.fn.toString().includes('historyTransferStatus')).length, 1)
  e.button('x').onclick()
  assert.equal(e.jobs.size, 0)
})
asyncCheck('A desktop notification test closes after the configured time even through a reader error', async () => {
  const e = environment({ notificationDisplaySeconds: 2 })
  await e.button('Test desktop notification').onclick()
  const notice = e.notifications.at(-1)
  const originalQuery = e.window.document.querySelectorAll
  e.window.document.querySelectorAll = () => { throw new Error('Fictional read failure') }
  e.advance(2000)
  assert(notice.closed)
  e.window.document.querySelectorAll = originalQuery
})
;(async () => {
  let passed = 0
  for (const { name, fn } of checks) {
    await fn()
    passed++
    console.log('PASS:', name)
  }
  console.log(`${passed} prototype feature scenarios passed.`)
})().catch((error) => { console.error(error); process.exitCode = 1 })
