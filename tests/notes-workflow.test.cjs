/* Fictional 8x8 scenarios for independent presence, scoped notes and confirmed caller suggestions. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const fixture = fs.readFileSync(path.join(__dirname, 'assistant.test.cjs'), 'utf8')
const context = vm.createContext({ require, __dirname, console, Blob, TextDecoder })
// Share the native-page fixture without running its baseline test list a second time.
vm.runInContext(fixture.slice(0, fixture.indexOf("check('Me is selectable")) + '\nglobalThis.environment = environment', context)
const environment = context.environment
let passed = 0
function check (name, fn) { fn(); passed++; console.log('PASS:', name) }
const rows = e => e.ui().querySelector('tbody').querySelectorAll('tr')
const own = e => rows(e).find(row => row.querySelector('.agent-name').textContent === 'Me')
const api = e => e.window.__itsCallAssist
const input = (e, label) => e.ui().querySelector(`[aria-label="${label}"]`)
const choose = (field, checked = true) => { field.checked = checked; field.onchange() }
const cards = e => e.ui().querySelectorAll('.history-card')
const names = e => Array.from(cards(e), card => card.querySelector('.history-caller').textContent)
function date (e, value) {
  const field = input(e, 'Filter notes by date')
  field.value = value
  field.onchange()
}
function search (e, value) {
  const field = e.ui().querySelector('.history-search')
  field.value = value
  field.oninput()
}
function record (id, caller, queue, day = '2026-10-27', extra = {}) {
  return {
    id,
    originalId: id,
    recordKey: 'fictional-notes-workflow-' + id,
    caller,
    notes: 'Fictional support notes',
    jobNumber: '',
    origin: '8x8',
    queue,
    detectedAt: day ? Date.parse(day + 'T09:00:00+10:00') : null,
    completedAt: null,
    number: '+1555010000' + id,
    channel: null,
    channelNumber: null,
    transactionId: 'fictional-call-' + id,
    durationSeconds: 20,
    waitSeconds: 5,
    holdSeconds: null,
    durationComplete: true,
    ...extra
  }
}
function loadNotes (records, preferences = {}) {
  const e = environment({ g1: [], ...preferences })
  e.setTime(Date.parse('2026-10-28T12:00:00+10:00'))
  api(e).importCallNotesText(api(e).exportCallNotesText(records))
  // Use the visible main shortcut; the hidden on-call shortcut deliberately remembers a call visit.
  e.ui().querySelector('.notes-shortcut').onclick()
  return e
}
function filteredNotes () {
  return loadNotes([
    record(1, 'Alpha Advisor', 'ITS Academic Hotline', '2026-10-27', { jobNumber: 'INC9000001' }),
    record(2, '00123456', 'ITS Service Desk'),
    record(3, 'Transfer Person', 'ITS Internal TRNFR', '2026-10-28'),
    record(4, '00987654', 'ITS Outbound', '2026-10-27', { jobNumber: 'REQ9000004' }),
    record(5, 'Unknown', null, null),
    record(6, 'Manual Example', null, '2026-10-28', { origin: 'manual', number: null, transactionId: null })
  ])
}
function suggestion (e) { return e.ui().querySelector('.caller-suggestion') }
const suggestedName = e => e.ui().querySelector('.caller-suggestion-copy').querySelector('strong').textContent
const suggestionVisible = e => !suggestion(e).classList.contains('hidden')
const soundCard = (e, kind) => e.ui().querySelector(`[data-sound-kind="${kind}"]`)

check('An initially empty zero-height Groups list keeps the native Me status and clock live', () => {
  const e = environment({ g1: ['Me'] }, {}, {
    beforeStart: ({ group }) => {
      for (const row of [...group.children]) row.remove()
      group.getClientRects = () => []
    }
  })
  e.setMe('Working Offline', 42)
  assert.equal(own(e).querySelector('.agent-status').textContent, 'Working Offline')
  assert.equal(own(e).querySelector('.agent-time').textContent, '42s')
  assert.equal(rows(e).length, 1)
  assert.equal(api(e).inspect().unavailable, false)
  assert.equal(api(e).inspect().agentsFrozen, false)
  assert(e.ui().querySelector('.data-warning').classList.contains('hidden'))
  assert(!e.checkbox('Me').disabled)
})
check('The last other agents signing out leave Me live, preserve G1 choices and allow solo queue cover', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 5 })
  e.logout('Alex Agent')
  e.logout('Casey Agent')
  e.group.getClientRects = () => []
  e.setMe('Working Offline', 1)
  e.waiting(1, 6)
  e.setMe('Working Offline', 2)
  e.waiting(1, 7)
  e.setMe('Working Offline', 3)
  assert.equal(rows(e).length, 1)
  assert.equal(own(e).querySelector('.agent-time').textContent, '3s')
  assert.equal(api(e).inspect().queuesReadable, true)
  assert(e.debug().playing.includes('critical'))
  assert(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1.includes('Alex Agent'))
})
check('A native empty Groups region without any list or empty-state message supports a solo session', () => {
  for (const attributes of [
    { 'data-test-id': 'groups-panel' },
    { role: 'region', 'aria-label': 'Groups' }
  ]) {
    const e = environment({ g1: ['Me'] }, {}, {
      beforeStart: ({ group, document }) => {
        group.remove()
        const empty = document.createElement('section')
        for (const [key, value] of Object.entries(attributes)) empty.setAttribute(key, value)
        document.body.append(empty)
      }
    })
    e.setMe('Available', 150)
    assert.equal(own(e).querySelector('.agent-time').textContent, '150s')
    assert.equal(api(e).inspect().agentsFrozen, false)
    assert.equal(api(e).inspect().unavailable, false)
    assert(e.ui().querySelector('.data-warning').classList.contains('hidden'))
  }
})
check('A busy native Groups region is not a confirmed empty roster', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'] })
  e.group.remove()
  const loading = e.window.document.createElement('section')
  loading.setAttribute('role', 'region')
  loading.setAttribute('aria-label', 'Groups')
  loading.setAttribute('aria-busy', 'true')
  e.window.document.body.append(loading)
  e.setMe('Working Offline', 33)
  e.advance(10000)
  assert.equal(rows(e).length, 3)
  assert.equal(own(e).querySelector('.agent-time').textContent, '33s')
  assert.equal(api(e).inspect().agentsFrozen, true)
})
check('Hidden empty Groups never prove sign-out, but a readable Me header still updates', () => {
  const e = environment({ g1: ['Alex Agent'] })
  e.logout('Alex Agent')
  e.logout('Casey Agent')
  e.group.getClientRects = () => []
  e.group.hidden = true
  e.setMe('Busy', 81)
  e.advance(10000)
  assert.equal(rows(e).length, 3)
  assert.equal(own(e).querySelector('.agent-time').textContent, '81s')
  assert.equal(own(e).getAttribute('data-live'), 'true')
  assert(e.checkbox('Alex Agent').disabled)
  assert(e.ui().querySelector('.data-warning').textContent.includes('Your status is live'))
})
check('Empty virtual padding cannot remove cached agents or enable a cover alert', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 5 })
  e.logout('Alex Agent')
  e.logout('Casey Agent')
  e.group.getClientRects = () => []
  e.group.setAttribute('style', 'padding-top: 120px; padding-bottom: 60px;')
  e.setMe('Working Offline', 55)
  e.waiting(1, 300)
  e.scan()
  assert.equal(rows(e).length, 3)
  assert.equal(own(e).querySelector('.agent-time').textContent, '55s')
  assert(!e.debug().playing.includes('critical'))
})
check('A missing Groups element cannot freeze Me or fabricate the other agents statuses', () => {
  const e = environment()
  const cached = e.checkbox('Alex Agent').closest('tr').querySelector('.agent-time').textContent
  e.group.remove()
  e.setMe('Available', 91)
  assert.equal(own(e).querySelector('.agent-time').textContent, '91s')
  assert.equal(e.checkbox('Alex Agent').closest('tr').querySelector('.agent-time').textContent, cached)
  assert.equal(api(e).inspect().agentsFrozen, true)
  assert.equal(api(e).inspect().queuesReadable, true)
})
check('An unreadable own clock still freezes Me instead of extrapolating a cached timer', () => {
  const e = environment()
  e.setMe('Available', 8)
  e.meTimer.textContent = 'unreadable'
  e.scan()
  assert.equal(own(e).querySelector('.agent-time').textContent, '8s')
  assert.equal(own(e).getAttribute('data-live'), 'false')
  assert(e.checkbox('Me').disabled)
})

check('Student Assist Desk is derived from the native phone suffix on live and saved calls', () => {
  for (const number of ['55848', '+1 (555) 015-5848']) {
    const e = environment()
    e.showCall({ number, transactionId: 'fictional-student-assist' })
    assert(!e.ui().querySelector('.call-heading').querySelector('.student-assist').classList.contains('hidden'))
    e.showWrapUp(120, { number, transactionId: 'fictional-student-assist', seconds: 15 })
    e.restoreMain()
    e.button('Call Notes').onclick()
    assert.equal(cards(e)[0].querySelector('.student-assist').textContent, 'Student Assist Desk')
    const copy = loadNotes(api(e).parseCallNotesText(api(e).exportCallNotesText()))
    assert.equal(cards(copy)[0].querySelector('.student-assist').textContent, 'Student Assist Desk')
  }
})
check('Caller names, note text and similar phone suffixes cannot create a Student Assist Desk tag', () => {
  const e = loadNotes([record(1, '55848', 'ITS Service Desk', '2026-10-27', { number: '+15550155849', notes: 'Student Assist Desk 55848' })])
  assert.equal(cards(e)[0].querySelector('.student-assist'), null)
})
check('The superseded 55858 suffix is not tagged as Student Assist Desk on imported or live calls', () => {
  const e = loadNotes([record(1, 'Fictional Caller', 'ITS Service Desk', '2026-10-27', { number: '+15550155858' })])
  assert.equal(cards(e)[0].querySelector('.student-assist'), null)
  e.showCall({ number: '55858', transactionId: 'fictional-old-desk-suffix' })
  assert(e.ui().querySelector('.call-heading').querySelector('.student-assist').classList.contains('hidden'))
})
check('Old manual records keep their source and styling while displaying Manual Note', () => {
  const e = filteredNotes()
  const manual = cards(e).find(card => card.getAttribute('data-call-id') === '6')
  assert.equal(manual.querySelector('.history-source').textContent, 'Manual Note')
  assert.equal(manual.querySelector('.history-information'), null)
  assert.equal(e.ui().querySelector('.history-note'), null)
  e.button('+ Add note').onclick()
  assert.equal(e.ui().querySelector('.new-note').querySelector('.history-source').textContent, 'Manual Note')
  assert.equal(api(e).statistics().total, 0)
})

check('Filters toggle an accessible panel containing four built-in queue choices and a date picker', () => {
  const e = filteredNotes()
  const toggle = e.ui().querySelector('.history-filter-toggle')
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  toggle.onclick()
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert(!e.ui().querySelector('.history-filters').classList.contains('hidden'))
  assert.equal(e.ui().querySelector('.history-filter-queues').querySelectorAll('input').length, 4)
  assert.equal(input(e, 'Filter notes by date').type, 'date')
  toggle.onclick()
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
})
check('Staff and Student choices combine within their category and retain Unknown when unrestricted', () => {
  const e = filteredNotes()
  choose(input(e, 'Filter caller type: Staff'))
  assert.deepEqual(names(e).sort(), ['Alpha Advisor', 'Manual Example', 'Transfer Person'])
  choose(input(e, 'Filter caller type: Student'))
  assert.equal(cards(e).length, 5)
  choose(input(e, 'Filter caller type: Staff'), false)
  assert.deepEqual(names(e).sort(), ['00123456', '00987654'])
  choose(input(e, 'Filter caller type: Student'), false)
  assert.equal(cards(e).length, 6)
  choose(input(e, 'Filter caller type: Unknown'))
  assert.deepEqual(names(e), ['Unknown'])
})
check('Multiple queue checkboxes form a union, and caller type restricts that union', () => {
  const e = filteredNotes()
  choose(input(e, 'Filter queue: ITS Academic Hotline'))
  choose(input(e, 'Filter queue: ITS Internal TRNFR'))
  assert.deepEqual(names(e).sort(), ['Alpha Advisor', 'Transfer Person'])
  choose(input(e, 'Filter caller type: Student'))
  assert.equal(cards(e).length, 0)
  assert(e.ui().querySelector('.history-filter-summary').textContent.includes('ITS Academic Hotline'))
  choose(input(e, 'Filter queue: ITS Outbound'))
  assert.deepEqual(names(e), ['00987654'])
})
check('Missing job numbers combines with date, caller type and queue while totals stay global', () => {
  const e = filteredNotes()
  choose(input(e, 'Filter job number: Missing'))
  assert.equal(cards(e).length, 4)
  date(e, '2026-10-27')
  choose(input(e, 'Filter caller type: Student'))
  choose(input(e, 'Filter queue: ITS Service Desk'))
  assert.deepEqual(names(e), ['00123456'])
  assert.equal(e.ui().querySelector('.notes-total').textContent, '6')
  assert.equal(e.ui().querySelector('.notes-missing-jobs').textContent, '4')
  assert.equal(api(e).statistics().total, 0)
})
check('Keyword search is scoped to selected filters rather than all notes', () => {
  const e = filteredNotes()
  date(e, '2026-10-27')
  assert.equal(cards(e).length, 3)
  search(e, 'Transfer')
  assert.equal(cards(e).length, 0)
  search(e, 'alpha')
  assert.deepEqual(names(e), ['Alpha Advisor'])
  search(e, 'REQ9000004')
  assert.deepEqual(names(e), ['00987654'])
  assert(e.ui().querySelector('.history-filter-summary').textContent.includes('27/10/2026'))
})
check('The visible result count follows combined filters, keyword search and zero or singular matches', () => {
  const e = filteredNotes()
  const count = e.ui().querySelector('.history-result-count')
  const total = e.ui().querySelector('.history-result-context')
  assert.equal(count.textContent, '6 notes')
  assert.equal(count.getAttribute('aria-live'), 'polite')
  date(e, '2026-10-27')
  assert.equal(count.textContent, '3 matching notes')
  assert.equal(total.textContent, 'of 6 total')
  search(e, 'Alpha')
  assert.equal(count.textContent, '1 matching note')
  search(e, 'Transfer')
  assert.equal(count.textContent, '0 matching notes')
  search(e, '')
  choose(input(e, 'Filter job number: Missing'))
  assert.equal(count.textContent, '1 matching note')
  e.button('Clear filters').onclick()
  assert.equal(count.textContent, '6 notes')
  assert.equal(total.textContent, 'Newest first')
})
check('Result counts cover all matching pages and stay correct after scoped deletion and Undo', () => {
  const e = loadNotes(Array.from({ length: 120 }, (_, index) => record(index + 1,
    index % 2 ? '00123456' : 'Fictional Staff ' + index, 'ITS Service Desk')))
  choose(input(e, 'Filter caller type: Student'))
  const count = e.ui().querySelector('.history-result-count')
  const total = e.ui().querySelector('.history-result-context')
  assert.equal(count.textContent, '60 matching notes')
  assert.equal(cards(e).length, 50)
  e.button('Next').onclick()
  assert.equal(cards(e).length, 10)
  assert.equal(count.textContent, '60 matching notes')
  cards(e)[0].querySelector('.history-delete').onclick()
  assert.equal(count.textContent, '59 matching notes')
  assert.equal(total.textContent, 'of 119 total')
  e.button('Undo delete').onclick()
  assert.equal(count.textContent, '60 matching notes')
  assert.equal(total.textContent, 'of 120 total')
  assert.equal(api(e).parseCallNotesText(api(e).exportCallNotesText()).length, 120)
})
check('Date filtering uses the Brisbane call date across midnight and excludes unknown dates', () => {
  const midnight = Date.parse('2026-10-27T00:00:00+10:00')
  const e = loadNotes([
    record(1, 'Before Midnight', null, null, { detectedAt: midnight - 1 }),
    record(2, 'After Midnight', null, null, { detectedAt: midnight }),
    record(3, 'Undated Example', null, null)
  ])
  date(e, '2026-10-27')
  assert.deepEqual(names(e), ['After Midnight'])
  date(e, '2026-10-26')
  assert.deepEqual(names(e), ['Before Midnight'])
  date(e, '')
  assert.equal(cards(e).length, 3)
})
check('Invalid date input is rejected without excluding every note or changing their dates', () => {
  const e = filteredNotes()
  const before = JSON.stringify(api(e).callHistorySession().records)
  for (const value of ['2026-02-30', 'not-a-date']) {
    date(e, value)
    assert.equal(cards(e).length, 6)
    assert.equal(input(e, 'Filter notes by date').value, '')
  }
  assert.equal(JSON.stringify(api(e).callHistorySession().records), before)
})
check('Clear filters preserves keyword search, and export still contains every note', () => {
  const e = filteredNotes()
  date(e, '2026-10-28')
  search(e, 'Alpha')
  assert.equal(cards(e).length, 0)
  e.button('Clear filters').onclick()
  assert.deepEqual(names(e), ['Alpha Advisor'])
  assert.equal(e.ui().querySelector('.history-search').value, 'Alpha')
  assert.equal(api(e).parseCallNotesText(api(e).exportCallNotesText()).length, 6)
})
check('History-specific queue choices do not make Outbound eligible for live monitoring', () => {
  const e = filteredNotes()
  choose(input(e, 'Filter queue: ITS Outbound'))
  e.waiting(9, 900, 2)
  e.scan()
  assert.deepEqual(names(e), ['00987654'])
  assert.equal(api(e).inspect().queues.length, 3)
  assert(!api(e).inspect().queues.some(queue => queue.name === 'ITS Outbound'))
})
check('Filters page the matching set, reset on changes and preserve all records', () => {
  const e = loadNotes(Array.from({ length: 120 }, (_, index) => record(index + 1,
    index % 2 ? '00123456' : 'Fictional Staff ' + index, 'ITS Service Desk')))
  e.button('Next').onclick()
  e.button('Next').onclick()
  assert.equal(cards(e).length, 20)
  choose(input(e, 'Filter caller type: Student'))
  assert.equal(cards(e).length, 50)
  assert(e.ui().querySelector('.history-summary').parentElement.textContent.includes('Page 1 of 2'))
  e.button('Next').onclick()
  assert.equal(cards(e).length, 10)
  search(e, 'no matching fictional keyword')
  assert.equal(cards(e).length, 0)
  assert.equal(api(e).callHistorySession().records.length, 120)
})
check('Changing a filter saves an active edit and recomputes its predicted caller type', () => {
  const e = filteredNotes()
  const card = cards(e).find(card => card.querySelector('.history-caller').textContent === 'Alpha Advisor')
  card.querySelector('.history-edit-toggle').onclick()
  const field = card.querySelector('.history-edit-input')
  field.value = '00111111'
  field.oninput()
  choose(input(e, 'Filter caller type: Staff'))
  assert(!names(e).includes('00111111'))
  assert.equal(api(e).callHistorySession().records.find(record => record.caller === '00111111').callerPrediction, 'Student')
})
check('Filters survive menu changes and remain useful when all native 8x8 information is hidden', () => {
  const e = filteredNotes()
  date(e, '2026-10-27')
  e.ui().querySelector('.call-history').querySelector('.menu-header').querySelector('button').onclick()
  e.header.hidden = e.group.hidden = true
  for (const queue of e.queues) queue.row.hidden = true
  e.scan()
  e.button('Call Notes').onclick()
  assert.equal(cards(e).length, 3)
  assert.equal(input(e, 'Filter notes by date').value, '2026-10-27')
})

check('A known number offers a caller suggestion without automatically filling or saving it', () => {
  const e = loadNotes([record(1, 'Saved Example', 'ITS Service Desk')])
  e.showCall({ number: '+1 (555) 010-0001', transactionId: 'fictional-new-call' })
  assert(suggestionVisible(e))
  assert.equal(suggestedName(e), 'Saved Example')
  assert.equal(input(e, 'Accept caller suggestion').textContent, '✓')
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, '')
  assert.equal(api(e).callHistorySession().records.length, 1)
  assert.equal(api(e).callHistorySession().pending[0].callerInput, '')
})
check('Accepting a suggestion fills only the current name field and saves it once at Wrap up', () => {
  const e = loadNotes([record(1, '00123456', 'ITS Service Desk')])
  e.showCall({ number: '+15550100001', transactionId: 'fictional-confirmed-call' })
  e.notes('Current call details')
  input(e, 'Accept caller suggestion').onclick()
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, '00123456')
  assert.equal(e.ui().querySelector('#its-caller-notes').value, 'Current call details')
  assert(!suggestionVisible(e))
  assert.equal(api(e).callHistorySession().records.length, 1)
  e.showWrapUp(120, { transactionId: 'fictional-confirmed-call', number: '+15550100001', seconds: 30 })
  assert.equal(api(e).callHistorySession().records.length, 2)
  assert.equal(api(e).callHistorySession().records.at(-1).caller, '00123456')
  assert.equal(api(e).statistics().total, 1)
})
check('A rejected suggestion stays dismissed through polling and prototype reruns, then resets for a new call', () => {
  const e = loadNotes([record(1, 'Saved Example', 'ITS Service Desk')])
  e.showCall({ number: '+15550100001', transactionId: 'fictional-rejected-call' })
  input(e, 'Dismiss caller suggestion for this call').onclick()
  e.callTime(25)
  e.rerun()
  assert(!suggestionVisible(e))
  assert.equal(api(e).callHistorySession().pending[0].callerInput, '')
  e.showWrapUp(120, { transactionId: 'fictional-rejected-call', seconds: 25 })
  e.restoreMain()
  e.showCall({ number: '+15550100001', transactionId: 'fictional-next-call' })
  assert(suggestionVisible(e))
  assert.equal(suggestedName(e), 'Saved Example')
})
check('Typing a caller identity takes priority, including after the field is cleared', () => {
  const e = loadNotes([record(1, 'Saved Example', 'ITS Service Desk')])
  e.showCall({ number: '+15550100001', transactionId: 'fictional-typed-call' })
  e.caller('Different Example')
  input(e, 'Accept caller suggestion').onclick()
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, 'Different Example')
  e.caller('')
  e.callTime(40)
  assert(!suggestionVisible(e))
})
check('Shared numbers suggest the most recent named record and explicitly disclose alternatives', () => {
  const e = loadNotes([
    record(1, 'Newer Example', null, '2026-10-28', { number: '5551234' }),
    record(2, 'Older Example', null, '2026-10-27', { number: '5551234' }),
    record(3, 'Unknown', null, '2026-10-28', { number: '5551234' })
  ])
  e.showCall({ number: '5551234', transactionId: 'fictional-shared-line' })
  assert.equal(suggestedName(e), 'Newer Example')
  assert(suggestion(e).textContent.includes('2 names or IDs'))
})
check('Australian local/international forms match, but a shared suffix never matches another number', () => {
  const e = loadNotes([record(1, 'Fictional AU Example', null, '2026-10-27', { number: '02 5550 0001' })])
  e.showCall({ number: '+61 2 5550 0001', transactionId: 'fictional-au-call' })
  assert(suggestionVisible(e))
  e.showCall({ number: '+1 555 2555 0001', transactionId: 'fictional-other-country' })
  assert(!suggestionVisible(e))
})
check('Manual notes, Unknown identifiers and anonymous numbers cannot identify a caller', () => {
  const e = loadNotes([
    record(1, 'Unknown', null, '2026-10-27', { number: '5551234' }),
    record(2, 'Manual Example', null, '2026-10-27', { number: '5551234', origin: 'manual' })
  ])
  e.showCall({ number: '5551234', transactionId: 'fictional-no-identity' })
  assert(!suggestionVisible(e))
  e.showCall({ number: null, transactionId: 'fictional-anonymous' })
  assert(!suggestionVisible(e))
})
check('Caller suggestions search all notes despite date, queue and keyword filters', () => {
  const e = filteredNotes()
  date(e, '2026-10-28')
  choose(input(e, 'Filter queue: ITS Outbound'))
  search(e, 'no results')
  assert.equal(cards(e).length, 0)
  e.showCall({ number: '+15550100001', transactionId: 'fictional-unfiltered-prediction' })
  assert(suggestionVisible(e))
  assert.equal(suggestedName(e), 'Alpha Advisor')
})
check('A suggestion cannot be accepted after switching from the call view to Call Notes', () => {
  const e = loadNotes([record(1, 'Saved Example', 'ITS Service Desk')])
  e.showCall({ number: '+15550100001', transactionId: 'fictional-hidden-suggestion' })
  const accept = input(e, 'Accept caller suggestion').onclick
  e.ui().querySelector('.call-heading').querySelectorAll('button').find(button => button.textContent === 'Call Notes').onclick()
  accept()
  assert.equal(api(e).callHistorySession().pending[0].callerInput, '')
})
check('Large histories retain scoped paging and offer caller suggestions from off-page records', () => {
  const e = loadNotes(Array.from({ length: 10000 }, (_, index) => record(index + 1,
    'Fictional Caller ' + index, index % 2 ? 'ITS Service Desk' : 'ITS Academic Hotline')))
  choose(input(e, 'Filter queue: ITS Academic Hotline'))
  assert.equal(cards(e).length, 50)
  search(e, 'Fictional Caller 9999')
  assert.equal(cards(e).length, 0)
  e.showCall({ number: '+155501000010000', transactionId: 'fictional-large-index' })
  assert.equal(suggestedName(e), 'Fictional Caller 9999')
  assert(suggestionVisible(e))
  e.callTime(60)
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, '')
  assert.equal(api(e).callHistorySession().records.length, 10000)
})
check('Editing or deleting a source note invalidates its cached caller suggestion', () => {
  const e = loadNotes([record(1, 'Saved Example', 'ITS Service Desk')])
  e.showCall({ number: '+15550100001', transactionId: 'fictional-edit-source' })
  assert.equal(suggestedName(e), 'Saved Example')
  e.ui().querySelector('.call-heading').querySelectorAll('button').find(button => button.textContent === 'Call Notes').onclick()
  const card = cards(e)[0]
  card.querySelector('.history-edit-toggle').onclick()
  const field = card.querySelector('.history-edit-input')
  field.value = 'Updated Example'
  field.oninput()
  card.querySelector('.history-edit-toggle').onclick()
  e.ui().querySelector('.call-history').querySelector('.menu-header').querySelector('button').onclick()
  e.scan()
  assert.equal(suggestedName(e), 'Updated Example')
  e.ui().querySelector('.call-heading').querySelectorAll('button').find(button => button.textContent === 'Call Notes').onclick()
  cards(e)[0].querySelector('.history-delete').onclick()
  e.ui().querySelector('.call-history').querySelector('.menu-header').querySelector('button').onclick()
  e.scan()
  assert(!suggestionVisible(e))
})
check('Late suggestion actions after Wrap up or closing cannot modify another record', () => {
  const e = loadNotes([record(1, 'Saved Example', 'ITS Service Desk')])
  e.showCall({ number: '+15550100001', transactionId: 'fictional-late-accept' })
  const accept = input(e, 'Accept caller suggestion').onclick
  e.showWrapUp(120, { transactionId: 'fictional-late-accept', number: '+15550100001', seconds: 20 })
  accept()
  assert.equal(api(e).callHistorySession().records.at(-1).caller, 'Unknown')
  const before = JSON.stringify(api(e).callHistorySession())
  api(e).destroy()
  accept()
  assert.equal(JSON.stringify(JSON.parse(e.session.get('service-desk-8x8-call-history-v1')).records), JSON.stringify(JSON.parse(before).records))
})

check('Sound disable preferences default on and migrate independently of existing sound fields', () => {
  const e = environment({}, { disposition: { enabled: false, volume: 23, preset: 'Soft bell' }, critical: { enabled: 'false' } })
  const saved = JSON.parse(e.storage.get('service-desk-8x8-sounds-v4'))
  assert.equal(saved.disposition.enabled, false)
  assert.equal(saved.disposition.volume, 23)
  assert.equal(saved.disposition.preset, 'Soft bell')
  assert.equal(saved.critical.enabled, true)
  assert.equal(soundCard(e, 'disposition').querySelector('.sound-enable-toggle').textContent, 'Enable')
})
check('A disabled disposition sound retains its visual reminder and optional silent desktop notice', () => {
  const e = environment({ g1: ['Me'], secondaryRingerEnabled: true }, { disposition: { enabled: false } })
  e.setMe('Wrap Up', 11)
  assert.equal(e.debug().activeReminder.kind, 'disposition')
  assert(!e.debug().playing.includes('disposition'))
  assert.equal(e.ui().querySelector('.reminder-state').textContent, 'Sound disabled')
  assert.equal(e.notifications.length, 1)
  assert.equal(e.notifications[0].options.silent, true)
  assert(e.audioContexts.every(context => context.notes.length === 0))
})
check('Disabling a playing tone stops both assistant outputs and re-enabling resumes without another popup', () => {
  const e = environment()
  e.setMe('Wrap Up', 11)
  const toggle = soundCard(e, 'disposition').querySelector('.sound-enable-toggle')
  assert(e.debug().playing.includes('disposition'))
  const notices = e.notifications.length
  toggle.onclick()
  assert(!e.debug().playing.includes('disposition'))
  e.scan()
  e.button('Mute').onclick()
  e.button('Unmute').onclick()
  assert(!e.debug().playing.includes('disposition'))
  toggle.onclick()
  assert(e.debug().playing.includes('disposition'))
  assert.equal(e.notifications.length, notices)
})
check('Individual disable states survive other sound edits and prototype reruns', () => {
  const e = environment()
  const card = soundCard(e, 'disposition')
  card.querySelector('.sound-enable-toggle').onclick()
  const volume = card.querySelector('input[type="range"]')
  volume.value = '15'
  volume.oninput()
  e.rerun()
  const saved = JSON.parse(e.storage.get('service-desk-8x8-sounds-v4'))
  assert.equal(saved.disposition.enabled, false)
  assert.equal(saved.disposition.volume, 15)
  assert.equal(saved.critical.enabled, true)
  e.setMe('Wrap Up', 11)
  assert(!e.debug().playing.includes('disposition'))
})
check('Disabled previews cannot be restarted by mute, output refresh or a late direct button event', () => {
  const e = environment()
  const card = soundCard(e, 'lunch')
  const preview = card.querySelectorAll('button').find(button => button.textContent === 'Preview')
  preview.onclick()
  assert(e.debug().playing.includes('preview'))
  card.querySelector('.sound-enable-toggle').onclick()
  assert(!e.debug().playing.includes('preview'))
  assert(preview.disabled)
  preview.onclick()
  e.button('Mute').onclick()
  e.button('Unmute').onclick()
  assert(preview.disabled)
  assert(!e.debug().playing.includes('preview'))
})
check('Turning off one tone does not disable another sound or its notification preference', () => {
  const e = environment({ g1: ['Me'] }, { disposition: { enabled: false, desktopNotification: false } })
  e.setMe('Wrap Up', 11)
  assert.equal(e.notifications.length, 0)
  e.setMe('Available', 0)
  e.setMe('On Break', 1801)
  assert(e.debug().playing.includes('lunchOverdue'))
  assert.equal(e.notifications.length, 1)
})
function taggedNotes () {
  return loadNotes([
    record(1, 'Call Example', 'ITS Academic Hotline', '2026-10-27', { jobNumber: 'inc9000001' }),
    record(2, '00123456', 'ITS Service Desk', '2026-10-27', { number: '+15550155848', jobNumber: 'IMS9000002' }),
    record(3, 'Manual Example', null, '2026-10-27', { origin: 'manual', number: null, jobNumber: 'req9000003' }),
    record(4, 'Second Call', 'ITS Internal TRNFR', '2026-10-28', { jobNumber: 'sctask9000004' }),
    record(5, 'Legacy Example', 'ITS Outbound', '2026-10-27', { origin: 'text', number: null, jobNumber: 'CASE9000005' }),
    record(6, 'Missing Example', 'ITS Academic Hotline')
  ])
}
check('Each call, desk, manual and legacy note receives exactly one exclusive tag', () => {
  const e = taggedNotes()
  const expected = { 'Call Example': 'Call', '00123456': 'Student Assist Desk', 'Manual Example': 'Manual Note', 'Second Call': 'Call', 'Legacy Example': 'Call', 'Missing Example': 'Call' }
  for (const card of cards(e)) {
    const tags = card.querySelectorAll('.history-source')
    assert.equal(tags.length, 1)
    assert.equal(tags[0].textContent, expected[card.querySelector('.history-caller').textContent])
    assert.equal(card.querySelector('.history-card-heading').querySelector('.history-source'), null)
  }
  assert.equal(api(e).statistics().total, 0)
})
check('A manual source takes precedence over stray Student Assist phone metadata', () => {
  const e = loadNotes([record(1, 'Manual Example', null, '2026-10-27', { origin: 'manual', number: '55848' })])
  assert.equal(cards(e)[0].querySelectorAll('.history-source').length, 1)
  assert.equal(cards(e)[0].querySelector('.history-source').textContent, 'Manual Note')
  assert.equal(cards(e)[0].querySelector('.student-assist'), null)
  choose(input(e, 'Filter tag: Student Assist Desk'))
  assert.equal(cards(e).length, 0)
  choose(input(e, 'Filter tag: Manual Note'))
  assert.equal(cards(e).length, 1)
})
check('New connected calls get Call or Student Assist Desk without changing their native counter', () => {
  const e = environment()
  for (const [number, transactionId] of [['5551234', 'fictional-tagged-call'], ['55848', 'fictional-tagged-desk']]) {
    e.showCall({ number, transactionId })
    e.showWrapUp(120, { number, transactionId, seconds: 20 })
    e.restoreMain()
  }
  e.ui().querySelector('.notes-shortcut').onclick()
  assert.deepEqual(Array.from(cards(e), card => card.querySelector('.history-source').textContent).sort(), ['Call', 'Student Assist Desk'])
  assert.equal(api(e).callHistorySession().records.length, 2)
  assert.equal(api(e).statistics().total, 2)
})
check('Recovered status remains visible while a restored note still has only one classification tag', () => {
  const e = environment({ g1: [] }, {}, {
    callHistory: { records: [record(1, 'Recovered Example', null, '2026-10-27', { recovered: true })], pending: [], nextId: 2 }
  })
  for (let run = 0; run < 2; run++) {
    if (run) e.rerun()
    e.ui().querySelector('.notes-shortcut').onclick()
    const card = cards(e)[0]
    assert.equal(card.querySelectorAll('.history-source').length, 1)
    assert.equal(card.querySelector('.history-source').textContent, 'Call')
    assert(!card.querySelector('.history-recovery-status').classList.contains('hidden'))
    assert.equal(card.querySelector('.history-recovery-status').textContent, 'Recovered')
    assert.equal(api(e).callHistorySession().records[0].recovered, true)
  }
})
check('Legacy TXT imports gain a Call tag without inventing phone, queue or timing data', () => {
  const e = environment({ g1: [] })
  api(e).importCallNotesText('Legacy Example\nFictional archived call notes\nNO JOB NUMBER')
  e.ui().querySelector('.notes-shortcut').onclick()
  const saved = api(e).callHistorySession().records[0]
  assert.equal(saved.origin, 'text')
  for (const field of ['number', 'queue', 'detectedAt', 'durationSeconds']) assert.equal(saved[field], null)
  assert.equal(cards(e)[0].querySelector('.history-source').textContent, 'Call')
  const restored = loadNotes(api(e).parseCallNotesText(api(e).exportCallNotesText()))
  assert.equal(cards(restored)[0].querySelector('.history-source').textContent, 'Call')
  assert.equal(api(restored).callHistorySession().records[0].number, null)
  assert.equal(api(e).statistics().total, 0)
})
check('Tag choices form a union and Student Assist Desk never also matches Call', () => {
  const e = taggedNotes()
  choose(input(e, 'Filter tag: Call'))
  assert.deepEqual(names(e).sort(), ['Call Example', 'Legacy Example', 'Missing Example', 'Second Call'])
  choose(input(e, 'Filter tag: Manual Note'))
  assert.equal(cards(e).length, 5)
  choose(input(e, 'Filter tag: Call'), false)
  assert.deepEqual(names(e), ['Manual Example'])
  choose(input(e, 'Filter tag: Student Assist Desk'))
  assert.deepEqual(names(e).sort(), ['00123456', 'Manual Example'])
  assert(e.ui().querySelector('.history-filter-summary').textContent.includes('Student Assist Desk'))
})
check('Tag, queue, caller type, job prefix, date and keyword search combine without restricting exports', () => {
  const e = taggedNotes()
  choose(input(e, 'Filter tag: Student Assist Desk'))
  choose(input(e, 'Filter queue: ITS Service Desk'))
  choose(input(e, 'Filter caller type: Student'))
  choose(input(e, 'Filter job number: IMS'))
  date(e, '2026-10-27')
  assert.deepEqual(names(e), ['00123456'])
  assert.equal(e.ui().querySelector('.history-result-count').textContent, '1 matching note')
  search(e, 'Manual')
  assert.equal(cards(e).length, 0)
  search(e, 'Student Assist Desk')
  assert.deepEqual(names(e), ['00123456'])
  assert.equal(e.ui().querySelector('.notes-total').textContent, '6')
  assert.equal(api(e).parseCallNotesText(api(e).exportCallNotesText()).length, 6)
})
check('Each job prefix is case insensitive and Other excludes missing job numbers', () => {
  const e = taggedNotes()
  const expected = { IMS: '00123456', REQ: 'Manual Example', INC: 'Call Example', SCTASK: 'Second Call', Other: 'Legacy Example', Missing: 'Missing Example' }
  const before = JSON.stringify(api(e).callHistorySession().records)
  for (const [prefix, caller] of Object.entries(expected)) {
    const field = input(e, 'Filter job number: ' + prefix)
    choose(field)
    assert.deepEqual(names(e), [caller])
    choose(field, false)
  }
  assert.equal(cards(e).length, 6)
  assert.equal(JSON.stringify(api(e).callHistorySession().records), before)
})
check('Several job prefixes, Other and Missing can be selected together within one category', () => {
  const e = taggedNotes()
  choose(input(e, 'Filter job number: REQ'))
  choose(input(e, 'Filter job number: INC'))
  assert.deepEqual(names(e).sort(), ['Call Example', 'Manual Example'])
  choose(input(e, 'Filter job number: Missing'))
  choose(input(e, 'Filter job number: Other'))
  assert.deepEqual(names(e).sort(), ['Call Example', 'Legacy Example', 'Manual Example', 'Missing Example'])
  choose(input(e, 'Filter tag: Call'))
  assert.deepEqual(names(e).sort(), ['Call Example', 'Legacy Example', 'Missing Example'])
})
check('Job classification uses the requested prefix rather than guessing a ticket-number format', () => {
  const e = loadNotes([
    record(1, 'Bare REQ', null, '2026-10-27', { jobNumber: 'REQ' }),
    record(2, 'Spaced Task', null, '2026-10-27', { jobNumber: '  ScTaSk 0099  ' }),
    record(3, 'Other Entry', null, '2026-10-27', { jobNumber: 'CASE INC9000001' }),
    record(4, 'Placeholder', null, '2026-10-27', { jobNumber: 'NO JOB NUMBER' })
  ])
  choose(input(e, 'Filter job number: REQ'))
  assert.deepEqual(names(e), ['Bare REQ'])
  choose(input(e, 'Filter job number: REQ'), false)
  choose(input(e, 'Filter job number: SCTASK'))
  assert.deepEqual(names(e), ['Spaced Task'])
  choose(input(e, 'Filter job number: SCTASK'), false)
  choose(input(e, 'Filter job number: Other'))
  assert.deepEqual(names(e), ['Other Entry'])
})
check('Saving a changed job number immediately re-filters the record and keeps deletion/Undo counts correct', () => {
  const e = taggedNotes()
  choose(input(e, 'Filter job number: Other'))
  const card = cards(e)[0]
  card.querySelector('.history-edit-toggle').onclick()
  const field = card.querySelector('.history-job-input')
  field.value = 'IMS9000055'
  field.oninput()
  card.querySelector('.history-edit-toggle').onclick()
  assert.equal(cards(e).length, 0)
  assert.equal(e.ui().querySelector('.history-result-count').textContent, '0 matching notes')
  choose(input(e, 'Filter job number: IMS'))
  assert.equal(cards(e).length, 2)
  cards(e).find(card => card.querySelector('.history-caller').textContent === 'Legacy Example').querySelector('.history-delete').onclick()
  assert.equal(e.ui().querySelector('.history-result-count').textContent, '1 matching note')
  e.button('Undo delete').onclick()
  assert.equal(e.ui().querySelector('.history-result-count').textContent, '2 matching notes')
})
check('Clear filters resets tag and job choices while keeping the keyword search', () => {
  const e = taggedNotes()
  choose(input(e, 'Filter tag: Student Assist Desk'))
  choose(input(e, 'Filter job number: IMS'))
  search(e, 'Example')
  assert.equal(cards(e).length, 0)
  e.button('Clear filters').onclick()
  assert.equal(cards(e).length, 4)
  assert.equal(e.ui().querySelector('.history-search').value, 'Example')
  for (const tag of ['Call', 'Student Assist Desk', 'Manual Note']) assert(!input(e, 'Filter tag: ' + tag).checked)
  for (const job of ['IMS', 'REQ', 'INC', 'SCTASK', 'Other', 'Missing']) assert(!input(e, 'Filter job number: ' + job).checked)
})
check('Combined tag and job results remain paged and searchable across every matching record', () => {
  const e = loadNotes(Array.from({ length: 180 }, (_, index) => record(index + 1, 'Fictional Entry ' + index, 'ITS Service Desk', '2026-10-27', {
    origin: index % 3 === 2 ? 'manual' : '8x8',
    number: index % 3 === 1 ? '55848' : '+1555010000' + index,
    jobNumber: (index % 2 ? 'REQ' : 'IMS') + String(index)
  })))
  choose(input(e, 'Filter tag: Call'))
  choose(input(e, 'Filter tag: Student Assist Desk'))
  choose(input(e, 'Filter job number: IMS'))
  assert.equal(cards(e).length, 50)
  assert.equal(e.ui().querySelector('.history-result-count').textContent, '60 matching notes')
  e.button('Next').onclick()
  assert.equal(cards(e).length, 10)
  search(e, 'Fictional Entry 174')
  assert.deepEqual(names(e), ['Fictional Entry 174'])
  assert.equal(e.ui().querySelector('.history-result-count').textContent, '1 matching note')
  assert.equal(api(e).parseCallNotesText(api(e).exportCallNotesText()).length, 180)
})
console.log(`${passed} notes workflow scenarios passed.`)
