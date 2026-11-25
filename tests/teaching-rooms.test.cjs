/* Approved room-reference entries with fictional callers, transactions and call notes. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const fixture = fs.readFileSync(path.join(__dirname, 'assistant.test.cjs'), 'utf8')
const context = vm.createContext({ require, __dirname, console, Blob, TextDecoder })
// Reuse the connected/disposition fixture without repeating its baseline scenarios.
vm.runInContext(fixture.slice(0, fixture.indexOf("check('Me is selectable")) + '\nglobalThis.environment = environment', context)
const environment = context.environment
const api = e => e.window.__itsCallAssist
const records = e => api(e).callHistorySession().records
const callRoom = e => e.ui().querySelector('.call-room')
const cards = e => e.ui().querySelectorAll('.history-card')
let passed = 0
function check (name, test) { test(); passed++; console.log('PASS:', name) }
function openNotes (e) {
  e.restoreMain()
  e.ui().querySelector('.notes-shortcut').onclick()
}
function record (id, number, extra = {}) {
  return {
    id,
    recordKey: 'fictional-teaching-room-' + id,
    originalId: id,
    origin: '8x8',
    caller: 'Unknown',
    notes: 'Fictional teaching support notes',
    jobNumber: '',
    number,
    queue: 'ITS Service Desk',
    detectedAt: Date.parse('2026-11-25T09:00:00+10:00'),
    completedAt: Date.parse('2026-11-25T09:02:00+10:00'),
    durationSeconds: 120,
    waitSeconds: 5,
    holdSeconds: null,
    durationComplete: true,
    transactionId: 'fictional-room-call-' + id,
    channel: null,
    channelNumber: null,
    ...extra
  }
}

check('Room matches use the final five native digits for extensions and formatted full numbers', () => {
  for (const number of ['50292', '+1 (555) 555-0292', '07 5555 0292']) {
    const e = environment({ g1: [] })
    e.showCall({ number, transactionId: 'fictional-room-native' })
    assert.equal(callRoom(e).textContent, '01_1_39')
    assert(!callRoom(e).parentElement.classList.contains('hidden'))
    assert.equal(e.ui().querySelector('.call-number').textContent, number)
    assert.equal(e.ui().querySelector('#its-caller-identifier').value, '')
    e.showWrapUp(120, { number, transactionId: 'fictional-room-native', seconds: 30 })
    assert.equal(records(e)[0].roomLocation, '01_1_39')
    assert.equal(records(e)[0].number, number)
    assert.equal(records(e)[0].caller, 'Unknown')
    assert.equal(api(e).statistics().total, 1)
  }
})
check('Anonymous, short and unlisted numbers do not acquire a teaching-space location', () => {
  for (const number of [null, '0292', '99999', '51634']) {
    const e = environment({ g1: [] })
    e.showCall({ number, transactionId: 'fictional-unmatched-room' })
    assert(callRoom(e).parentElement.classList.contains('hidden'))
    e.showWrapUp(120, { number, transactionId: 'fictional-unmatched-room', seconds: 30 })
    assert.equal(records(e)[0].roomLocation, undefined)
  }
})
check('An extension listed against two rooms displays and saves both without choosing one', () => {
  const e = environment({ g1: [] })
  e.showCall({ number: '52170', transactionId: 'fictional-two-rooms' })
  assert.equal(callRoom(e).textContent, '04_2_22 / 04_2_24')
  e.showWrapUp(120, { number: '52170', transactionId: 'fictional-two-rooms', seconds: 25 })
  assert.equal(records(e)[0].roomLocation, '04_2_22 / 04_2_24')
  openNotes(e)
  const search = e.ui().querySelector('.history-search')
  for (const room of ['04_2_22', '04_2_24']) {
    search.value = room
    search.oninput()
    assert.equal(cards(e).length, 1)
  }
})
check('Named campus prefixes retain their room IDs and omit descriptions and dangling dashes', () => {
  const e = environment({ g1: [] })
  for (const [number, room] of [['50277', 'BIHSN_1_04'], ['51623', 'BRIS_2_24'], ['51633', 'RH_HG_316']]) {
    e.showCall({ number, transactionId: 'fictional-campus-' + number })
    assert.equal(callRoom(e).textContent, room)
    e.showWrapUp(120, { number, transactionId: 'fictional-campus-' + number, seconds: 20 })
    assert.equal(records(e).at(-1).roomLocation, room)
    e.restoreMain()
  }
})
check('Room metadata survives held calls, hidden Info, polling, reruns and tab restoration', () => {
  const e = environment({ g1: [] })
  e.showCall({ number: '50292', transactionId: 'fictional-room-held' })
  e.caller('Typed Example')
  e.notes('Separate caller notes')
  e.showCall({ number: '50292', transactionId: 'fictional-room-held', onHold: true, info: false, seconds: 25 })
  e.rerun()
  e.reload()
  assert.equal(callRoom(e).textContent, '01_1_39')
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, 'Typed Example')
  e.showWrapUp(120, { number: '50292', transactionId: 'fictional-room-held', seconds: 40 })
  assert.equal(records(e).length, 1)
  assert.equal(records(e)[0].roomLocation, '01_1_39')
  assert.equal(records(e)[0].notes, 'Separate caller notes')
  assert.equal(api(e).statistics().total, 1)
})
check('Switching between distinct calls never carries a previous room into an unmatched call', () => {
  const e = environment({ g1: [] })
  e.showCall({ number: '50292', transactionId: 'fictional-room-first' })
  e.showCall({ number: '99999', transactionId: 'fictional-room-second' })
  assert(callRoom(e).parentElement.classList.contains('hidden'))
  e.showWrapUp(120, { number: '99999', transactionId: 'fictional-room-second', seconds: 20 })
  assert.equal(records(e)[0].roomLocation, undefined)
  e.showCall({ number: '50292', transactionId: 'fictional-room-first', seconds: 30 })
  assert.equal(callRoom(e).textContent, '01_1_39')
  e.showWrapUp(120, { number: '50292', transactionId: 'fictional-room-first', seconds: 40 })
  assert.equal(records(e).length, 2)
  assert.equal(records(e)[1].roomLocation, '01_1_39')
})
check('A late native number reveals the room without replacing typed input or its caret', () => {
  const e = environment({ g1: [] })
  e.showCall({ number: null, transactionId: 'fictional-late-room' })
  e.caller('Current Example')
  const field = e.ui().querySelector('#its-caller-identifier')
  field.selectionStart = field.selectionEnd = 4
  e.showCall({ number: '50292', transactionId: 'fictional-late-room', seconds: 20 })
  assert.equal(callRoom(e).textContent, '01_1_39')
  assert.equal(e.ui().querySelector('#its-caller-identifier'), field)
  assert.equal(field.value, 'Current Example')
  assert.equal(field.selectionStart, 4)
})
check('A room is saved when a confirmed idle state recovers a missed Wrap up', () => {
  const e = environment({ g1: [] })
  e.showCall({ number: '50292', transactionId: 'fictional-room-missed-wrap', seconds: 35 })
  e.restoreMain('Available')
  assert.equal(records(e).length, 1)
  assert.equal(records(e)[0].roomLocation, '01_1_39')
  assert.equal(records(e)[0].durationComplete, false)
  assert.equal(records(e)[0].durationSeconds, 35)
})
check('The saved room remains visible and read-only while caller fields are edited', () => {
  const e = environment({ g1: [] })
  e.showCall({ number: '50292', transactionId: 'fictional-room-edit' })
  e.showWrapUp(120, { number: '50292', transactionId: 'fictional-room-edit', seconds: 30 })
  openNotes(e)
  const card = cards(e)[0]
  const room = card.querySelector('.history-room')
  const information = card.querySelector('.history-information')
  assert.equal(room.parentElement.parentElement, information)
  assert(information.children[0].querySelector('.history-number'))
  assert(information.children[1].querySelector('.history-queue'))
  assert.equal(information.children[2], room.parentElement)
  assert(!room.parentElement.classList.contains('room-location'))
  assert.equal(room.tagName, 'SPAN')
  assert.equal(room.textContent, '01_1_39')
  card.querySelector('.history-edit-toggle').onclick()
  assert(!room.parentElement.classList.contains('hidden'))
  const input = card.querySelector('.history-edit-input')
  input.value = '00987654'
  input.oninput()
  const notes = card.querySelector('.history-notes-input')
  notes.value = 'Changed notes'
  notes.oninput()
  const job = card.querySelector('.history-job-input')
  job.value = 'INC9000001'
  job.oninput()
  card.querySelector('.history-edit-toggle').onclick()
  assert.equal(records(e)[0].roomLocation, '01_1_39')
  assert.equal(records(e)[0].caller, '00987654')
  assert.equal(records(e)[0].jobNumber, 'INC9000001')
  assert.equal(api(e).statistics().total, 1)
})
check('Room searches cover every matching page and combine with existing filters', () => {
  const e = environment({ g1: [] })
  const entries = Array.from({ length: 121 }, (_, i) => record(i + 1, i % 2 ? '99999' : '50292'))
  api(e).importCallNotesText(api(e).exportCallNotesText(entries))
  e.ui().querySelector('.notes-shortcut').onclick()
  const search = e.ui().querySelector('.history-search')
  search.value = '01_1_39'
  search.oninput()
  assert.equal(e.ui().querySelector('.history-result-count').textContent, '61 matching notes')
  assert.equal(cards(e).length, 50)
  e.button('Next').onclick()
  assert.equal(cards(e).length, 11)
  const queue = e.ui().querySelector('[aria-label="Filter queue: ITS Academic Hotline"]')
  queue.checked = true
  queue.onchange()
  assert.equal(cards(e).length, 0)
  assert.equal(e.ui().querySelector('.notes-total').textContent, '121')
  assert.equal(api(e).parseCallNotesText(api(e).exportCallNotesText()).length, 121)
})
check('Room metadata round-trips through TXT and old exports gain their phone-based match once', () => {
  const e = environment({ g1: [] })
  const text = api(e).exportCallNotesText([record(1, '52170')])
  assert(text.includes('Room location: "04_2_22 / 04_2_24"'))
  const parsed = api(e).parseCallNotesText(text)
  assert.equal(parsed[0].roomLocation, '04_2_22 / 04_2_24')
  const older = text.replace(/^Room location:.*\r?\n/gm, '')
  api(e).importCallNotesText(older)
  api(e).importCallNotesText(text)
  assert.equal(records(e).length, 1)
  assert.equal(records(e)[0].roomLocation, '04_2_22 / 04_2_24')
  assert.equal(api(e).statistics().total, 0)
})
check('A captured historical room survives a TXT transfer even without a current directory match', () => {
  const e = environment({ g1: [] })
  const text = api(e).exportCallNotesText([record(1, '99999', { roomLocation: 'LEGACY_1_02' })])
  api(e).importCallNotesText(text)
  assert.equal(records(e)[0].roomLocation, 'LEGACY_1_02')
  assert.equal(records(e)[0].number, '99999')
})
check('Manual notes never inherit a room from stray phone or room metadata', () => {
  const e = environment({ g1: [] })
  const text = api(e).exportCallNotesText([record(1, '50292', { origin: 'manual', roomLocation: '01_1_39' })])
  assert(text.includes('Room location: Not recorded'))
  api(e).importCallNotesText(text)
  assert.equal(records(e)[0].roomLocation, undefined)
  e.ui().querySelector('.notes-shortcut').onclick()
  assert.equal(cards(e)[0].querySelector('.history-room'), null)
})
check('Older session notes gain a room without adding calls or changing their saved keys', () => {
  const e = environment({ g1: [] }, {}, {
    callHistory: { records: [record(1, '50292')], pending: [], nextId: 2 }
  })
  e.ui().querySelector('.notes-shortcut').onclick()
  assert.equal(records(e)[0].roomLocation, '01_1_39')
  assert.equal(records(e)[0].recordKey, 'fictional-teaching-room-1')
  assert.equal(cards(e)[0].querySelector('.history-room').textContent, '01_1_39')
  assert.equal(api(e).statistics().total, 0)
})
check('Invalid imported room text cannot appear as markup and oversized room fields are refused atomically', () => {
  const e = environment({ g1: [] })
  const text = api(e).exportCallNotesText([record(1, '50292')])
  const invalid = text.replace('Room location: "01_1_39"', 'Room location: "<img src=x>"')
  api(e).importCallNotesText(invalid)
  assert.equal(records(e)[0].roomLocation, '01_1_39')
  const oversized = text.replace('Room location: "01_1_39"', 'Room location: "' + 'X'.repeat(126001) + '"')
  assert.throws(() => api(e).importCallNotesText(oversized), /more text/)
  assert.equal(records(e).length, 1)
})
check('Deleting and restoring a room call keeps its location and independent observed call count', () => {
  const e = environment({ g1: [] })
  e.showCall({ number: '50292', transactionId: 'fictional-room-delete' })
  e.showWrapUp(120, { number: '50292', transactionId: 'fictional-room-delete', seconds: 30 })
  openNotes(e)
  const before = JSON.stringify(records(e)[0])
  cards(e)[0].querySelector('.history-delete').onclick()
  assert.equal(records(e).length, 0)
  e.button('Undo delete').onclick()
  assert.equal(JSON.stringify(records(e)[0]), before)
  assert.equal(cards(e)[0].querySelector('.history-room').textContent, '01_1_39')
  assert.equal(api(e).statistics().total, 1)
})

function openRegister (e) {
  e.button('Settings').onclick()
  e.button('Open Teaching Space Register').onclick()
}
function registerInput (e, label) { return e.ui().querySelector(`[aria-label="${label}"]`) }
function setRegister (e, label, value, commit = true) {
  const field = registerInput(e, label)
  field.value = value
  field.oninput()
  if (commit) field.onchange()
  return field
}
const preferences = e => JSON.parse(e.storage.get('service-desk-8x8-preferences-v5'))
check('The dedicated register lists every named room, including rooms without an extension', () => {
  const e = environment({ g1: [] })
  assert.equal(e.ui().querySelector('.teaching-table').querySelector('tbody').children.length, 0)
  openRegister(e)
  assert.equal(e.ui().querySelector('.teaching-table').querySelector('tbody').children.length, 178)
  assert.equal(registerInput(e, 'Extension for 01_1_39').value, '50292')
  assert.equal(registerInput(e, 'Extension for 01_1_56').value, '')
  assert.equal(registerInput(e, 'Room ID for BRIS_2_24').value, 'BRIS_2_24')
  e.ui().querySelector('.teaching-register').querySelector('.menu-header').querySelector('button').onclick()
  assert(!e.ui().querySelector('.assistant-settings').classList.contains('hidden'))
})
check('Register edits update live matching and persist while earlier notes retain their captured location', () => {
  const e = environment({ g1: [] })
  api(e).importCallNotesText(api(e).exportCallNotesText([record(1, '50292')]))
  openRegister(e)
  setRegister(e, 'Room ID for 01_1_39', 'FICT_1_01')
  setRegister(e, 'Extension for FICT_1_01', '59999')
  e.rerun()
  e.showCall({ number: '59999', transactionId: 'fictional-corrected-register' })
  assert.equal(callRoom(e).textContent, 'FICT_1_01')
  e.showWrapUp(120, { number: '59999', transactionId: 'fictional-corrected-register', seconds: 30 })
  assert.equal(records(e)[0].roomLocation, '01_1_39')
  assert.equal(records(e).at(-1).roomLocation, 'FICT_1_01')
  e.restoreMain()
  e.showCall({ number: '50292', transactionId: 'fictional-previous-register-number' })
  assert(callRoom(e).parentElement.classList.contains('hidden'))
})
check('A room with no phone can gain an extension, and a cleared extension stops future matching', () => {
  const e = environment({ g1: [] })
  openRegister(e)
  setRegister(e, 'Extension for 01_1_56', '59998')
  e.showCall({ number: '59998', transactionId: 'fictional-new-room-phone' })
  assert.equal(callRoom(e).textContent, '01_1_56')
  e.showWrapUp(120, { number: '59998', transactionId: 'fictional-new-room-phone', seconds: 30 })
  e.restoreMain()
  openRegister(e)
  setRegister(e, 'Extension for 01_1_56', '')
  e.showCall({ number: '59998', transactionId: 'fictional-cleared-room-phone' })
  assert(callRoom(e).parentElement.classList.contains('hidden'))
  assert.equal(records(e)[0].roomLocation, '01_1_56')
})
check('Several rooms can share an extension without a guessed single-room assignment', () => {
  const e = environment({ g1: [] })
  openRegister(e)
  setRegister(e, 'Extension for 01_1_41', '50292')
  e.showCall({ number: '50292', transactionId: 'fictional-edited-shared-room-phone' })
  assert.equal(callRoom(e).textContent, '01_1_39 / 01_1_41')
})
check('Invalid register edits preserve the last valid values and Escape restores the row', () => {
  const e = environment({ g1: [] })
  openRegister(e)
  const field = setRegister(e, 'Extension for 01_1_39', '1234')
  assert.equal(new Map(preferences(e).teachingSpaces).get('01_1_39'), '50292')
  assert(!field.parentElement.parentElement.querySelector('.name-setting-feedback').classList.contains('hidden'))
  for (const listener of field.listeners.get('keydown')) listener({ key: 'Escape', preventDefault () {}, stopPropagation () {} })
  assert.equal(field.value, '50292')
  setRegister(e, 'Room ID for 01_1_41', '01_1_39')
  assert.equal(new Map(preferences(e).teachingSpaces).get('01_1_41'), '50192')
  assert.equal(new Map(preferences(e).teachingSpaces).size, 178)
})
check('Register search narrows rows by room or extension without rebuilding an active input', () => {
  const e = environment({ g1: [] })
  openRegister(e)
  const search = registerInput(e, 'Search Teaching Space Register')
  search.value = '51623'
  search.oninput()
  assert.equal(e.ui().querySelector('.teaching-count').textContent, '1 of 178 teaching spaces')
  const field = registerInput(e, 'Extension for BRIS_2_24')
  field.value = '512'
  field.oninput()
  field.selectionStart = 2
  e.scan()
  assert.equal(registerInput(e, 'Extension for BRIS_2_24'), field)
  assert.equal(field.value, '512')
  assert.equal(field.selectionStart, 2)
})
check('Back and prototype reruns commit valid register edits before a field loses focus', () => {
  const e = environment({ g1: [] })
  openRegister(e)
  setRegister(e, 'Extension for 01_1_39', '59999', false)
  e.ui().querySelector('.teaching-register').querySelector('.menu-header').querySelector('button').onclick()
  assert.equal(new Map(preferences(e).teachingSpaces).get('01_1_39'), '59999')
  e.button('Open Teaching Space Register').onclick()
  setRegister(e, 'Extension for 01_1_39', '59998', false)
  e.rerun()
  assert.equal(new Map(preferences(e).teachingSpaces).get('01_1_39'), '59998')
})
check('The register remains accessible with frozen agent data and correctly hosts the warning', () => {
  const e = environment({ g1: [] })
  e.header.hidden = e.group.hidden = true
  for (const q of e.queues) q.row.hidden = true
  e.scan()
  openRegister(e)
  assert(!e.ui().querySelector('.teaching-register').classList.contains('hidden'))
  assert.equal(e.ui().querySelector('.data-warning').parentElement, e.ui().querySelector('.teaching-register'))
  assert.equal(registerInput(e, 'Extension for 01_1_39').value, '50292')
})
check('A long multi-room location survives export and import without truncation', () => {
  const teachingSpaces = Array.from({ length: 30 }, (_, i) => ['FICT_' + i + '_01', '59999'])
  const e = environment({ g1: [], teachingSpaces })
  e.showCall({ number: '59999', transactionId: 'fictional-many-shared-rooms' })
  e.showWrapUp(120, { number: '59999', transactionId: 'fictional-many-shared-rooms', seconds: 20 })
  const location = records(e)[0].roomLocation
  assert(location.length > 200)
  assert(location.includes('FICT_29_01'))
  assert.equal(api(e).parseCallNotesText(api(e).exportCallNotesText())[0].roomLocation, location)
})
check('Register corrections survive rerunning even when browser preference storage is blocked', () => {
  const e = environment({ g1: [] }, {}, {
    beforeStart: ({ window }) => {
      window.localStorage = { getItem () { throw new Error('Blocked') }, setItem () { throw new Error('Blocked') } }
    }
  })
  openRegister(e)
  setRegister(e, 'Extension for 01_1_39', '59999')
  e.rerun()
  e.showCall({ number: '59999', transactionId: 'fictional-memory-register' })
  assert.equal(callRoom(e).textContent, '01_1_39')
})
console.log(`${passed} teaching-room scenarios passed.`)
