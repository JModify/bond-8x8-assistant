/* Fictional files exercise dataset switching; no real customer data or files are read. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const fixture = fs.readFileSync(path.join(__dirname, 'persistence.test.cjs'), 'utf8')
const context = vm.createContext({ require, __dirname, console, Blob, TextDecoder, Buffer, setTimeout })
// Reuse the filesystem/DOM fakes, stopping before the unrelated persistence scenarios.
vm.runInContext(fixture.slice(0, fixture.indexOf("check('The top-left handle")) + '\nglobalThis.helpers = { make, fakeDisk, fakeDatabase, settle, importNote, records, editTeachingExtension, registerFromDisk, rewriteDataMetadata, error, editFirst }', context)
const { make, fakeDisk, fakeDatabase, settle, importNote, records, editTeachingExtension, registerFromDisk, rewriteDataMetadata, error, editFirst } = context.helpers
const api = m => m.e.window.__itsCallAssist
const checks = []
function check (name, fn) { checks.push({ name, fn }) }
async function seed (name = 'Selected File Example') {
  const m = make()
  importNote(m.e, name)
  await m.choose()
  return m
}
const names = m => Array.from(records(m.e), record => record.caller)
const normalised = value => JSON.parse(JSON.stringify(value))

check('Selecting a populated file replaces local notes and register without rewriting the target', async () => {
  const selected = await seed()
  editTeachingExtension(selected.e, '01_1_39', '59998')
  await selected.save()
  const text = selected.disk.text
  const writes = selected.disk.writes.length
  const m = make(selected.disk, fakeDatabase())
  importNote(m.e, 'Old Session Example')
  editTeachingExtension(m.e, '01_1_39', '59999')
  await m.choose()
  assert.deepEqual(names(m), ['Selected File Example'], m.status())
  assert.equal(new Map(api(m).teachingSpaceSession().spaces).get('01_1_39'), '59998')
  assert.equal(selected.disk.text, text)
  assert.equal(selected.disk.writes.length, writes)
  assert.equal(m.database.handle, selected.disk.handle)
  await m.save()
  assert.equal(selected.disk.text, text)
})
check('An explicitly selected file wins even when its stable key conflicts with a local edit', async () => {
  const selected = await seed()
  const m = make(selected.disk, fakeDatabase())
  api(m).importCallNotesText(api(selected).exportCallNotesText().replace('Selected File Example', 'Local Conflicting Example'))
  await m.choose()
  assert.deepEqual(names(m), ['Selected File Example'])
  assert(!m.status().includes('different edits'))
})
check('An existing initialized empty file clears the previous notes instead of collecting them', async () => {
  const selected = make()
  await selected.choose()
  const text = selected.disk.text
  const m = make(selected.disk, fakeDatabase())
  importNote(m.e, 'Discarded Session Example')
  await m.choose()
  assert.equal(records(m.e).length, 0)
  assert.equal(selected.disk.text, text)
  assert(!selected.disk.text.includes('Discarded Session Example'))
})
check('A new empty file starts with the current notes and register while the old file stays separate', async () => {
  const m = await seed('Current Notes Example')
  editTeachingExtension(m.e, '01_1_39', '59999')
  await m.save()
  const original = m.disk.text
  const next = fakeDisk()
  m.e.window.showSaveFilePicker = async () => next.handle
  await m.e.button('Create new file').onclick()
  assert(next.text.includes('Current Notes Example'))
  assert.equal(registerFromDisk(next).get('01_1_39'), '59999')
  assert.equal(m.disk.text, original)
  importNote(m.e, 'New File Only Example')
  await m.save()
  assert(next.text.includes('New File Only Example'))
  assert(!m.disk.text.includes('New File Only Example'))
})
check('Open uses the existing-file picker and Create uses Save As when both APIs are available', async () => {
  const selected = await seed()
  const blank = fakeDisk()
  const calls = []
  const m = make(blank, fakeDatabase(), {
    picker: async () => { calls.push('create'); return blank.handle },
    beforeStart: ({ window }) => {
      window.showOpenFilePicker = async options => {
        calls.push('open')
        assert.equal(options.multiple, false)
        return [selected.disk.handle]
      }
    }
  })
  importNote(m.e, 'Old Local Example')
  await m.choose()
  assert.deepEqual(calls, ['open'])
  assert.deepEqual(names(m), ['Selected File Example'])
  await m.e.button('Create new file').onclick()
  assert.deepEqual(calls, ['open', 'create'])
  assert(blank.text.includes('Selected File Example'))
})
check('Malformed and unreadable selections leave the previous connection, notes and target intact', async () => {
  const selected = await seed('Valid File Example')
  const duplicate = api(selected).exportCallNotesText([records(selected.e)[0], { ...records(selected.e)[0], id: 2 }])
  const badInputs = [
    'An unrelated document',
    'Service Desk 8x8 Assistant — Call Notes (TXT v1)\nMalformed content without separators',
    selected.disk.text.replace(/^Assistant autosave: .*$/m, 'Assistant autosave: null'),
    rewriteDataMetadata(selected.disk.text, meta => { meta.teachingSpaces = [['01_1_39', '1234']] }),
    duplicate
  ]
  for (const text of badInputs) {
    const m = await seed('Original Active Example')
    const bad = fakeDisk(text)
    m.e.window.showSaveFilePicker = async () => bad.handle
    await m.choose()
    assert.deepEqual(names(m), ['Original Active Example'])
    assert.equal(m.database.handle, m.disk.handle)
    assert.equal(bad.text, text)
    assert.equal(bad.writes.length, 0)
    importNote(m.e, 'Still Saving Example')
    await m.save()
    assert(m.disk.text.includes('Still Saving Example'))
    assert.equal(bad.writes.length, 0)
  }
})
check('Denied selected-file permission does not replace or disable the current file', async () => {
  const m = await seed()
  const next = fakeDisk()
  next.permission = 'prompt'
  next.nextPermission = 'denied'
  m.e.window.showSaveFilePicker = async () => next.handle
  await m.choose()
  assert.equal(next.requests, 1)
  assert.equal(next.reads, 0)
  assert.equal(m.database.handle, m.disk.handle)
  importNote(m.e, 'Permission Preserved Example')
  await m.save()
  assert(m.disk.text.includes('Permission Preserved Example'))
})
check('An oversized or moved target is not remembered as the selected data file', async () => {
  for (const oversized of [false, true]) {
    const m = await seed()
    const target = fakeDisk()
    if (oversized) target.reportedSize = 21 * 1024 * 1024
    else target.readError = error('NotFoundError')
    m.e.window.showSaveFilePicker = async () => target.handle
    await m.choose()
    assert.equal(m.database.handle, m.disk.handle)
    assert.deepEqual(names(m), ['Selected File Example'])
    assert.equal(target.writes.length, 0)
  }
})
check('Changing files clears stale editors, delete undo, search and filters', async () => {
  const selected = await seed('New Dataset Example')
  const m = await seed('Old Dataset Example')
  m.e.button('Call Notes').onclick()
  m.e.ui().querySelector('.history-delete').onclick()
  const undo = m.e.button('Undo delete')
  importNote(m.e, 'Old Editable Example')
  editFirst(m.e, 'Old Unfinished Example')
  const search = m.e.ui().querySelector('.history-search')
  search.value = 'not in the next dataset'
  search.oninput()
  const tag = m.e.ui().querySelector('[aria-label="Filter tag: Manual Note"]')
  tag.checked = true
  tag.onchange()
  m.e.window.showSaveFilePicker = async () => selected.disk.handle
  await m.choose()
  assert.deepEqual(names(m), ['New Dataset Example'])
  assert.equal(search.value, '')
  assert.equal(tag.checked, false)
  assert(undo.classList.contains('hidden'))
  undo.onclick()
  assert.deepEqual(names(m), ['New Dataset Example'])
  assert.equal(m.e.ui().querySelector('.history-card').querySelector('.history-caller').textContent, 'New Dataset Example')
})
check('A candidate changed during validation cannot replace the loaded dataset', async () => {
  const selected = await seed()
  const m = await seed('Original Active Example')
  const getFile = selected.disk.handle.getFile
  let first = true
  selected.disk.handle.getFile = async () => {
    const file = await getFile()
    if (first) { first = false; selected.disk.text = selected.disk.text.replace('Selected File Example', 'Concurrent Writer Example') }
    return file
  }
  const writes = selected.disk.writes.length
  m.e.window.showSaveFilePicker = async () => selected.disk.handle
  await m.choose()
  assert.deepEqual(names(m), ['Original Active Example'])
  assert.equal(m.database.handle, m.disk.handle)
  assert.equal(selected.disk.writes.length, writes)
  assert(m.status().includes('changed while opening'))
})
check('Disconnect and destruction reject an already reading selected file', async () => {
  for (const destroy of [false, true]) {
    const selected = await seed()
    const m = await seed('Original Active Example')
    let release
    selected.disk.readGate = new Promise(resolve => { release = resolve })
    m.e.window.showSaveFilePicker = async () => selected.disk.handle
    const pending = m.choose()
    await settle()
    if (destroy) await api(m).destroy()
    else await m.e.button('Disconnect').onclick()
    release()
    await pending
    assert.notEqual(m.database.handle, selected.disk.handle)
    if (!destroy) assert.deepEqual(names(m), ['Original Active Example'])
  }
})
check('A file switch preserves native call statistics and the completed-interaction guard', async () => {
  const selected = await seed()
  const m = make()
  m.e.showCall({ transactionId: 'fictional-file-switch-call' })
  m.e.showWrapUp(120, { transactionId: 'fictional-file-switch-call', seconds: 30 })
  assert.equal(api(m).statistics().total, 1)
  m.e.window.showSaveFilePicker = async () => selected.disk.handle
  await m.choose()
  m.e.showCall({ transactionId: 'fictional-file-switch-call', seconds: 40 })
  m.e.showWrapUp(120, { transactionId: 'fictional-file-switch-call', seconds: 45 })
  assert.deepEqual(names(m), ['Selected File Example'])
  assert.equal(api(m).statistics().total, 1)
})
check('Only the selected file can restore editable fields for the same active transaction', async () => {
  const selected = make()
  await selected.choose()
  selected.e.showCall({ transactionId: 'fictional-shared-active-reference' })
  selected.e.caller('Selected Draft Example')
  selected.e.notes('Selected file draft notes')
  await selected.save()
  const m = make()
  m.e.showCall({ transactionId: 'fictional-shared-active-reference' })
  m.e.caller('Old Draft Example')
  m.e.notes('Old file draft notes')
  m.e.window.showSaveFilePicker = async () => selected.disk.handle
  await m.choose()
  m.e.scan()
  assert.equal(m.e.ui().querySelector('#its-caller-identifier').value, 'Selected Draft Example')
  assert.equal(api(m).callHistorySession().pending.length, 1)
  m.e.showWrapUp(120, { transactionId: 'fictional-shared-active-reference', seconds: 35 })
  assert.deepEqual(names(m), ['Selected Draft Example'])
  assert.equal(records(m.e)[0].notes, 'Selected file draft notes')
  assert.equal(api(m).statistics().total, 1)
})
check('Unrelated active-call fields from the old dataset do not leak into the selected file', async () => {
  const selected = await seed()
  const m = make()
  m.e.showCall({ transactionId: 'fictional-old-active-reference' })
  m.e.caller('Old Active Example')
  m.e.notes('Old active private draft')
  m.e.window.showSaveFilePicker = async () => selected.disk.handle
  await m.choose()
  m.e.scan()
  assert.equal(m.e.ui().querySelector('#its-caller-identifier').value, '')
  assert(!api(m).callHistorySession().pending.some(record => record.callerInput === 'Old Active Example'))
  await m.save()
  assert(!selected.disk.text.includes('Old Active Example'))
  assert(!selected.disk.text.includes('Old active private draft'))
})
check('Export copies all loaded records and register while leaving the connected source alone', async () => {
  const m = await seed()
  importNote(m.e, 'Second Record Example')
  editTeachingExtension(m.e, '01_1_39', '59999')
  await m.save()
  const source = m.disk.text
  const copy = fakeDisk()
  m.e.window.showSaveFilePicker = async () => copy.handle
  m.e.button('Call Notes').onclick()
  const search = m.e.ui().querySelector('.history-search')
  search.value = 'Selected File'
  search.oninput()
  await m.e.button('Export TXT').onclick()
  assert.equal(api(m).parseCallNotesText(copy.text).length, 2)
  assert.equal(registerFromDisk(copy).get('01_1_39'), '59999')
  assert.equal(m.disk.text, source)
  assert.equal(m.database.handle, m.disk.handle)
  const next = make(copy, fakeDatabase(copy.handle))
  await settle()
  assert.deepEqual(names(next).sort(), ['Second Record Example', 'Selected File Example'])
  assert.equal(new Map(api(next).teachingSpaceSession().spaces).get('01_1_39'), '59999')
})
check('Export includes recovered call fields and works for a file containing only the register', async () => {
  const m = make()
  await m.choose()
  const emptyCopy = fakeDisk()
  m.e.window.showSaveFilePicker = async () => emptyCopy.handle
  m.e.button('Call Notes').onclick()
  m.e.scan()
  assert.equal(m.e.button('Download TXT').disabled, false)
  await m.e.button('Export TXT').onclick()
  assert.equal(api(m).parseCallNotesText(emptyCopy.text, true).length, 0)
  assert.equal(registerFromDisk(emptyCopy).size, 224)
  m.e.showCall({ transactionId: 'fictional-export-active-draft' })
  m.e.caller('Export Draft Example')
  m.e.notes('Draft notes in a full data copy')
  const draftCopy = fakeDisk()
  m.e.window.showSaveFilePicker = async () => draftCopy.handle
  await m.e.button('Export TXT').onclick()
  const record = api(m).parseCallNotesText(draftCopy.text)[0]
  assert.equal(record.caller, 'Export Draft Example')
  assert.equal(record.notes, 'Draft notes in a full data copy')
  assert.equal(record.recovered, true)
})
check('Import adds extra records to the active file and does not replace its register', async () => {
  const m = await seed('Existing Dataset Example')
  editTeachingExtension(m.e, '01_1_39', '59999')
  await m.save()
  const extra = await seed('Imported Extra Example')
  editTeachingExtension(extra.e, '01_1_39', '59998')
  await extra.save()
  const text = extra.disk.text
  m.e.button('Call Notes').onclick()
  const input = m.e.ui().querySelector('input[type="file"]')
  input.files = [new Blob([text])]
  await input.onchange()
  await m.save()
  assert.deepEqual(names(m).sort(), ['Existing Dataset Example', 'Imported Extra Example'])
  assert.equal(registerFromDisk(m.disk).get('01_1_39'), '59999')
  assert.equal(extra.disk.text, text)
  assert.equal(api(m).statistics().total, 0)
  assert.equal(normalised(api(m).parseCallNotesText(m.disk.text)).length, 2)
})
check('A malformed final record in a batched file cannot partially replace the current data', async () => {
  const m = await seed('Original Active Example')
  const base = records(m.e)[0]
  const entries = Array.from({ length: 205 }, (_, i) => ({
    ...base,
    id: i + 1,
    recordKey: 'fictional-batched-switch-' + i,
    caller: 'Fictional Batch Example ' + i,
    durationSeconds: i === 204 ? -1 : 10
  }))
  const text = api(m).exportCallNotesText(entries)
  const target = fakeDisk(text)
  m.e.window.showSaveFilePicker = async () => target.handle
  await m.choose()
  assert.deepEqual(names(m), ['Original Active Example'])
  assert.equal(m.database.handle, m.disk.handle)
  assert.equal(target.text, text)
  assert.equal(target.writes.length, 0)
})
check('The download fallback includes the full register even with no call notes', async () => {
  const m = make(fakeDisk(), fakeDatabase(), { unsupported: true })
  m.e.button('Call Notes').onclick()
  m.e.scan()
  assert.equal(m.e.button('Export TXT').disabled, false)
  assert.equal(m.e.button('Download TXT').disabled, false)
  await m.e.button('Export TXT').onclick()
  const blob = m.e.blobs.get(m.e.downloads[0].href)
  const text = await blob.text()
  assert.equal(registerFromDisk({ text }).size, 224)
  assert.equal(api(m).parseCallNotesText(text, true).length, 0)
})
;(async () => {
  for (const { name, fn } of checks) {
    await fn()
    console.log('PASS:', name)
  }
  console.log(`${checks.length} data-file workflow scenarios passed.`)
})().catch(failure => { console.error(failure); process.exitCode = 1 })
