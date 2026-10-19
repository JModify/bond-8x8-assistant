/* Fictional local files, IndexedDB and pointer events; no real files or permissions are touched. */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const fixture = fs.readFileSync(path.join(__dirname, 'assistant.test.cjs'), 'utf8')
const context = vm.createContext({ require, __dirname, console, Blob, TextDecoder })
vm.runInContext(fixture.slice(0, fixture.indexOf("check('Me is selectable")) + '\nglobalThis.environment = environment', context)
const environment = context.environment
const checks = []
function check (name, fn) { checks.push({ name, fn }) }
async function settle () {
  // File hashing and IndexedDB completion run in later tasks, not just promise microtasks.
  for (let count = 0; count < 12; count++) await new Promise((resolve) => setTimeout(resolve, 1))
}
function error (name, message = name) { return Object.assign(new Error(message), { name }) }
function fakeDisk (text = '') {
  const disk = { text, permission: 'granted', requests: 0, reads: 0, writes: [], aborts: 0, opened: [], writeGate: null, lock: Promise.resolve() }
  disk.handle = {
    kind: 'file',
    name: 'Assistant-Data.txt',
    queryPermission: async () => disk.permission,
    requestPermission: async () => { disk.requests++; disk.permission = disk.nextPermission || 'granted'; return disk.permission },
    getFile: async () => {
      disk.reads++
      if (disk.readError) throw disk.readError
      if (disk.readGate) await disk.readGate
      const bytes = disk.utf16
        ? Buffer.concat([Buffer.from([255, 254]), Buffer.from(disk.text, 'utf16le')])
        : Buffer.from(disk.text)
      return {
        size: disk.reportedSize ?? bytes.length,
        text: async () => disk.text,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      }
    },
    createWritable: async (options) => {
      disk.opened.push(options)
      if (disk.openError) throw disk.openError
      let pending = ''
      return {
        write: async (value) => {
          if (disk.writeGate) await disk.writeGate
          if (disk.writeError) throw disk.writeError
          pending = String(value)
        },
        close: async () => {
          if (disk.closeGate) await disk.closeGate
          if (disk.closeError) throw disk.closeError
          disk.text = pending
          disk.utf16 = false
          disk.writes.push(pending)
        },
        abort: async () => { disk.aborts++ }
      }
    }
  }
  return disk
}
function fakeDatabase (initial) {
  const shared = { handle: initial, writes: [], initialized: false, openFails: false, putFails: false }
  shared.api = {
    open: () => {
      if (shared.openFails) throw error('SecurityError', 'Storage blocked')
      const request = {}
      Promise.resolve().then(() => {
        request.result = {
          objectStoreNames: { contains: () => shared.initialized },
          createObjectStore: () => { shared.initialized = true },
          close () {},
          transaction: () => {
            const transaction = {}
            const operation = (method, value) => {
              if (method === 'put' && shared.putFails) throw error('DataCloneError')
              if (method === 'delete' && shared.deleteFails) throw error('SecurityError')
              const result = {}
              Promise.resolve().then(() => {
                if (method === 'put') { shared.handle = value; shared.writes.push(value) }
                if (method === 'delete') shared.handle = null
                result.result = method === 'get' ? shared.handle : undefined
                transaction.oncomplete?.()
              })
              return result
            }
            transaction.objectStore = () => ({ get: () => operation('get'), put: (value) => operation('put', value), delete: () => operation('delete') })
            return transaction
          }
        }
        if (!shared.initialized) request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    }
  }
  return shared
}
function make (disk = fakeDisk(), database = fakeDatabase(), options = {}) {
  const events = new Map()
  const documentEvents = new Map()
  let picks = 0
  const e = environment({ g1: [] }, {}, {
    blockSessionStorage: options.blockSessionStorage,
    savePicker: options.unsupported ? undefined : async () => { picks++; return options.picker ? options.picker() : disk.handle },
    beforeStart: ({ window, document }) => {
      window.innerWidth = 1200
      window.innerHeight = 900
      window.crypto = { randomUUID: crypto.randomUUID, subtle: crypto.webcrypto.subtle }
      if (database) window.indexedDB = database.api
      window.navigator.locks = {
        request: (name, args, fn) => {
          assert.equal(name, 'service-desk-8x8-assistant-data-write')
          const next = disk.lock.then(() => fn({ name }))
          disk.lock = next.catch(() => {})
          return next
        }
      }
      for (const [target, listeners] of [[window, events], [document, documentEvents]]) {
        const add = target.addEventListener.bind(target)
        const remove = target.removeEventListener.bind(target)
        target.addEventListener = (name, fn, ...args) => {
          if (!listeners.has(name)) listeners.set(name, new Set())
          listeners.get(name).add(fn)
          add(name, fn, ...args)
        }
        target.removeEventListener = (name, fn, ...args) => { listeners.get(name)?.delete(fn); remove(name, fn, ...args) }
      }
      options.beforeStart?.({ window, document })
    }
  })
  const dispatch = (name, event = {}) => { for (const fn of [...events.get(name) || []]) fn(event) }
  const documentDispatch = (name) => { for (const fn of [...documentEvents.get(name) || []]) fn() }
  return {
    e,
    disk,
    database,
    events,
    documentEvents,
    dispatch,
    documentDispatch,
    picks: () => picks,
    choose: () => e.button('Choose data file')?.onclick() || e.button('Change data file')?.onclick(),
    save: () => e.button('Save now').onclick(),
    status: () => e.ui().querySelector('.data-location-status').textContent
  }
}
const importNote = (e, caller = 'Alex Example', notes = 'Fictional visit', job = 'INC123456') => e.window.__itsCallAssist.importCallNotesText(`${caller}\n${notes}\n${job}`)
const records = (e) => e.window.__itsCallAssist.callHistorySession().records
const statusNode = (e) => e.ui().querySelector('.history-transfer-status')
function runFeedbackTimer (e) {
  for (const [id, job] of [...e.jobs]) if (job.ms === 5000) { e.jobs.delete(id); job.fn() }
}
function editFirst (e, value, notes = 'Edited draft') {
  e.button('Call Notes').onclick()
  const card = e.ui().querySelector('.history-card')
  card.querySelector('.history-edit-toggle').onclick()
  const input = card.querySelector('.history-edit-input')
  input.value = value
  input.oninput()
  const noteInput = card.querySelector('.history-notes-input')
  noteInput.value = notes
  noteInput.oninput()
  return card
}

check('The top-left handle resizes from a fixed bottom-right anchor and remembers its size', async () => {
  const m = make()
  const grip = m.e.ui().querySelector('.resize-handle')
  assert.equal(grip.getAttribute('aria-label'), 'Resize assistant')
  grip.onpointerdown({ pointerId: 1, clientX: 730, clientY: 300, button: 0, preventDefault () {}, stopPropagation () {} })
  m.dispatch('pointermove', { pointerId: 1, clientX: 600, clientY: 200, preventDefault () {} })
  m.dispatch('pointerup', { pointerId: 1 })
  const panel = m.e.ui().querySelector('.panel')
  assert.equal(panel.style.width, '600px')
  assert.equal(panel.style.height, '700px')
  assert(panel.classList.contains('resized'))
  m.e.rerun()
  assert.equal(m.e.ui().querySelector('.panel').style.width, '600px')
  assert.equal(m.events.get('pointermove').size, 0)
})
check('Resize clamps to the viewport and refits after a screen-size change', () => {
  const m = make()
  const grip = m.e.ui().querySelector('.resize-handle')
  grip.onpointerdown({ pointerId: 2, clientX: 700, clientY: 300, preventDefault () {}, stopPropagation () {} })
  m.dispatch('pointermove', { pointerId: 2, clientX: -5000, clientY: -5000, preventDefault () {} })
  m.dispatch('pointerup', { pointerId: 2 })
  const panel = m.e.ui().querySelector('.panel')
  assert.equal(panel.style.width, '1164px')
  assert.equal(panel.style.height, '864px')
  m.e.window.innerWidth = 500
  m.e.window.innerHeight = 600
  m.dispatch('resize')
  assert.equal(panel.style.width, '464px')
  assert.equal(panel.style.height, '564px')
})
check('Resize cancellation, keyboard controls, reset and compact views preserve normal behaviour', () => {
  const m = make()
  const grip = m.e.ui().querySelector('.resize-handle')
  const key = (name) => grip.onkeydown({ key: name, preventDefault () {} })
  key('ArrowLeft')
  assert.equal(m.e.ui().querySelector('.panel').style.width, '480px')
  grip.onpointerdown({ pointerId: 1, clientX: 600, clientY: 300, preventDefault () {}, stopPropagation () {} })
  m.dispatch('pointermove', { pointerId: 1, clientX: 500, clientY: 200, preventDefault () {} })
  m.dispatch('pointercancel', { pointerId: 1 })
  assert.equal(m.e.ui().querySelector('.panel').style.width, '480px')
  m.e.button('-').onclick()
  assert.equal(m.e.ui().querySelector('.panel').style.height, '')
  m.e.button('+').onclick()
  assert(m.e.ui().querySelector('.panel').style.height)
  key('Home')
  assert.equal(m.e.ui().querySelector('.panel').style.width, '')
  assert(!m.e.ui().querySelector('.panel').classList.contains('resized'))
})
check('Only the matching primary pointer can resize and destroy removes its listeners', () => {
  const m = make()
  const grip = m.e.ui().querySelector('.resize-handle')
  grip.onpointerdown({ pointerId: 4, clientX: 600, clientY: 300, preventDefault () {}, stopPropagation () {} })
  m.dispatch('pointermove', { pointerId: 5, clientX: 0, clientY: 0, preventDefault () {} })
  assert.equal(m.e.ui().querySelector('.panel').style.width, '')
  m.e.window.__itsCallAssist.destroy()
  assert.equal(m.events.get('pointermove').size, 0)
  assert.equal(m.events.get('resize').size, 0)
})
check('A chosen data file saves readable TXT and keeps only the handle in IndexedDB', async () => {
  const m = make()
  importNote(m.e, '00123456', 'Fictional multiline\nSecond line', 'REQ123456')
  await m.choose()
  assert(m.disk.text.includes('00123456\r\nFictional multiline\r\nSecond line'))
  assert(m.disk.text.includes('Assistant autosave: '))
  assert(m.disk.text.includes('REQ123456'))
  assert(m.database.writes.every((value) => value === m.disk.handle))
  assert.equal(m.disk.opened[0].mode, 'exclusive')
  assert(m.status().includes('Saved'))
  assert(statusNode(m.e).classList.contains('hidden'))
})
check('A fresh browser session restores without a picker or another notification', async () => {
  const first = make()
  importNote(first.e)
  await first.choose()
  const writes = first.disk.writes.length
  await first.e.window.__itsCallAssist.destroy()
  const second = make(first.disk, first.database)
  await settle()
  assert.equal(records(second.e).length, 1, second.status())
  assert.equal(records(second.e)[0].caller, 'Alex Example')
  assert.equal(second.picks(), 0)
  assert.equal(second.disk.requests, 0)
  assert.equal(second.disk.writes.length, writes)
  assert.equal(second.e.window.__itsCallAssist.statistics().total, 0)
  assert(statusNode(second.e).classList.contains('hidden'))
})
check('Background autosave protects a note even when no shutdown event ever fires', async () => {
  const m = make()
  await m.choose()
  importNote(m.e, 'Casey Example')
  const queued = [...m.e.jobs].find(([, job]) => job.ms === 750)
  assert(queued)
  m.e.jobs.delete(queued[0])
  queued[1].fn()
  await settle()
  assert(m.disk.text.includes('Casey Example'))
  const next = make(m.disk, m.database)
  await settle()
  assert.equal(records(next.e)[0].caller, 'Casey Example')
})
check('Startup queries permission quietly and reconnect requests it only after a click', async () => {
  const first = make()
  importNote(first.e)
  await first.choose()
  first.disk.permission = 'prompt'
  const next = make(first.disk, first.database)
  await settle()
  assert.equal(records(next.e).length, 0)
  assert.equal(first.disk.requests, 0)
  assert(next.status().includes('File access needed'))
  const pending = next.e.button('Reconnect').onclick()
  assert.equal(first.disk.requests, 1)
  await pending
  assert.equal(records(next.e).length, 1)
})
check('Denied permission does not read, overwrite or lose the current tab notes', async () => {
  const disk = fakeDisk()
  disk.permission = 'denied'
  disk.nextPermission = 'denied'
  const m = make(disk, fakeDatabase(disk.handle))
  await settle()
  importNote(m.e)
  await m.e.button('Reconnect').onclick()
  assert.equal(disk.reads, 0)
  assert.equal(disk.writes.length, 0)
  assert.equal(records(m.e).length, 1)
  assert(m.status().includes('not allowed'))
})
check('Blocked handle storage still permits autosaving for the current session', async () => {
  const database = fakeDatabase()
  database.putFails = true
  const m = make(fakeDisk(), database)
  importNote(m.e)
  await m.choose()
  assert(m.disk.text.includes('Alex Example'))
  assert(m.status().includes('Reconnect this file next browser session'))
  assert.equal(database.handle, undefined)
  runFeedbackTimer(m.e)
  importNote(m.e, 'Quiet Session Example')
  await m.save()
  assert(m.e.ui().querySelector('.data-file-status').classList.contains('hidden'))
})
check('Disconnect stops writes and forgets the handle without deleting the file', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  const saved = m.disk.text
  await m.e.button('Disconnect').onclick()
  importNote(m.e, 'Other Example')
  await settle()
  assert.equal(m.database.handle, null)
  assert.equal(m.disk.text, saved)
  assert.equal(records(m.e).length, 2)
  assert(m.status().includes('not been deleted'))
})
check('Moved files, invalid text and future formats never replace existing data', async () => {
  for (const text of ['An unrelated document', '--------------------\nAlex\n[Call details]\nDuration seconds: -1', 'Service Desk 8x8 Assistant — Call Notes (TXT v99)\n--------------------']) {
    const m = make(fakeDisk(text))
    importNote(m.e)
    await m.choose()
    assert.equal(m.disk.text, text)
    assert.equal(m.disk.writes.length, 0)
    assert.equal(records(m.e).length, 1)
  }
  const m = make()
  m.disk.readError = error('NotFoundError', 'File moved')
  await m.choose()
  assert.equal(m.disk.writes.length, 0)
})
check('An external edit pauses autosave and reconnection preserves both conflicting copies', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  m.disk.text = m.disk.text.replace('Alex Example', 'External Example')
  const external = m.disk.text
  importNote(m.e, 'New Local Example')
  await m.save()
  assert.equal(m.disk.text, external)
  assert(m.status().includes('changed elsewhere'))
  await m.e.button('Reconnect').onclick()
  assert.equal(m.disk.text, external)
  assert.equal(records(m.e)[0].caller, 'Alex Example')
  assert.equal(records(m.e).length, 2)
  assert(m.status().includes('keep both copies'))
})
check('A failed write aborts without truncating the last good file and can be retried', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  const saved = m.disk.text
  m.disk.writeError = error('NotReadableError', 'Disk unavailable')
  importNote(m.e, 'Later Example')
  await m.save()
  assert.equal(m.disk.text, saved)
  assert.equal(m.disk.aborts, 1)
  m.disk.writeError = null
  await m.e.button('Reconnect').onclick()
  assert(m.disk.text.includes('Later Example'))
})
check('A note deleted after the last save is not resurrected on a rerun', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  m.e.button('Call Notes').onclick()
  m.e.ui().querySelector('.history-delete').onclick()
  m.e.rerun()
  await settle()
  assert.equal(records(m.e).length, 0)
  assert(!m.disk.text.includes('Alex Example'))
})
check('Hidden-page, pagehide and explicit close each flush the latest changes', async () => {
  for (const mode of ['hidden', 'pagehide', 'close']) {
    const m = make()
    await m.choose()
    importNote(m.e, 'Latest Example')
    if (mode === 'hidden') { m.e.window.document.visibilityState = 'hidden'; m.documentDispatch('visibilitychange') } else if (mode === 'pagehide') m.dispatch('pagehide')
    else await m.e.window.__itsCallAssist.destroy()
    await settle()
    assert(m.disk.text.includes('Latest Example'), mode)
  }
})
check('An unfinished editor is checkpointed and recovered after a crash without committing the UI', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  editFirst(m.e, '00123456', 'Unfinished fictional notes')
  await m.save()
  assert.equal(records(m.e)[0].caller, 'Alex Example')
  const next = make(m.disk, m.database)
  await settle()
  assert.equal(records(next.e)[0].caller, '00123456')
  assert.equal(records(next.e)[0].notes, 'Unfinished fictional notes')
  assert.equal(records(next.e)[0].recovered, true)
  assert.equal(records(next.e)[0].callerPrediction, 'Student')
})
check('An unfinished manual note is recovered without affecting observed call totals', async () => {
  const m = make()
  await m.choose()
  m.e.button('Call Notes').onclick()
  m.e.button('+ Add note').onclick()
  const card = m.e.ui().querySelector('.history-card')
  const input = card.querySelector('.history-edit-input')
  input.value = 'Visit Example'
  input.oninput()
  await m.save()
  assert.equal(records(m.e).length, 0)
  const next = make(m.disk, m.database)
  await settle()
  assert.equal(records(next.e)[0].caller, 'Visit Example')
  assert.equal(records(next.e)[0].origin, 'manual')
  assert.equal(next.e.window.__itsCallAssist.statistics().total, 0)
})
check('Escape cancels an editor and the next snapshot returns to the saved values', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  const card = editFirst(m.e, 'Changed Example')
  await m.save()
  card.querySelector('.history-edit-input').onkeydown({ key: 'Escape', preventDefault () {} })
  await m.save()
  assert(!m.disk.text.includes('Changed Example'))
  assert(m.disk.text.includes('Alex Example'))
})
check('Interrupted call fields recover as a note or rejoin only the same stable call reference', async () => {
  const m = make()
  await m.choose()
  m.e.showCall({ transactionId: 'fictional-resume' })
  m.e.caller('Call Example')
  const notes = m.e.ui().querySelector('#its-caller-notes')
  notes.value = 'Call draft notes'
  notes.oninput()
  await m.save()
  const idle = make(m.disk, m.database)
  await settle()
  assert.equal(records(idle.e)[0].caller, 'Call Example')
  assert.equal(records(idle.e)[0].recovered, true)
  const active = make(m.disk, m.database)
  active.e.showCall({ transactionId: 'fictional-resume' })
  await settle()
  assert.equal(records(active.e).length, 0)
  assert.equal(active.e.window.__itsCallAssist.callHistorySession().pending[0].callerInput, 'Call Example')
  active.e.showWrapUp(120, { transactionId: 'fictional-resume', seconds: 30 })
  assert.equal(records(active.e).length, 1)
})
check('UTF-16 data files and a saved empty history restore without creating fake notes', async () => {
  const disk = fakeDisk('--------------------\nEncoded Example\nFictional\nNO JOB NUMBER\n--------------------')
  disk.utf16 = true
  const m = make(disk)
  await m.choose()
  assert.equal(records(m.e)[0].caller, 'Encoded Example')
  m.e.button('Call Notes').onclick()
  m.e.ui().querySelector('.history-delete').onclick()
  await m.save()
  const next = make(disk, m.database)
  await settle()
  assert.equal(records(next.e).length, 0)
})
check('Closing during a data picker cannot write a late selection', async () => {
  let release
  const m = make(fakeDisk(), fakeDatabase(), { picker: () => new Promise((resolve) => { release = resolve }) })
  importNote(m.e)
  const choosing = m.choose()
  await m.e.window.__itsCallAssist.destroy()
  release(m.disk.handle)
  await choosing
  assert.equal(m.disk.writes.length, 0)
  assert.equal(m.database.handle, undefined)
})
check('A cancelled replacement picker keeps saving to the original data file', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  m.e.window.showSaveFilePicker = async () => { throw error('AbortError') }
  await m.e.button('Change data file').onclick()
  importNote(m.e, 'Still Connected Example')
  await m.save()
  assert(m.disk.text.includes('Still Connected Example'))
})
check('Cancelling a draft during an in-flight write aborts the stale checkpoint', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  const card = editFirst(m.e, 'Stale Example')
  let release
  m.disk.writeGate = new Promise((resolve) => { release = resolve })
  const writing = m.save()
  await settle()
  card.querySelector('.history-edit-input').onkeydown({ key: 'Escape', preventDefault () {} })
  release()
  await writing
  assert(!m.disk.text.includes('Stale Example'))
  assert(m.disk.aborts > 0)
  m.disk.writeGate = null
  await m.save()
  assert(m.disk.text.includes('Alex Example'))
})
check('Close drains a stream already committing and then saves the final cancelled state', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  const card = editFirst(m.e, 'Committing Example')
  let release
  m.disk.closeGate = new Promise((resolve) => { release = resolve })
  const writing = m.save()
  await settle()
  card.querySelector('.history-edit-input').onkeydown({ key: 'Escape', preventDefault () {} })
  const closing = m.e.window.__itsCallAssist.destroy()
  release()
  await Promise.all([writing, closing])
  assert(!m.disk.text.includes('Committing Example'))
  assert(m.disk.text.includes('Alex Example'))
})
check('An immediate rerun after close waits for the previous file commit', async () => {
  const m = make()
  await m.choose()
  importNote(m.e, 'Before Rerun Example')
  let release
  m.disk.writeGate = new Promise((resolve) => { release = resolve })
  const closing = m.e.window.__itsCallAssist.destroy()
  m.e.rerun()
  m.e.rerun()
  release()
  await closing
  await settle()
  assert.equal(records(m.e).length, 1)
  assert(m.disk.text.includes('Before Rerun Example'))
  assert(!m.status().includes('changed elsewhere'))
})
check('Two assistant windows cannot silently overwrite one another’s changes', async () => {
  const first = make()
  importNote(first.e)
  await first.choose()
  const second = make(first.disk, first.database)
  await settle()
  importNote(first.e, 'First Window Example')
  importNote(second.e, 'Second Window Example')
  await first.save()
  const saved = first.disk.text
  await second.save()
  assert.equal(first.disk.text, saved)
  assert(!first.disk.text.includes('Second Window Example'))
  assert(second.status().includes('changed elsewhere'))
  assert.equal(records(second.e).length, 2)
})
check('A clean restored tab accepts an external edit even if the header generation was unchanged', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  m.disk.text = m.disk.text.replace('Alex Example', 'External Clean Example')
  const file = m.disk.text
  m.e.rerun()
  await settle()
  assert.equal(records(m.e)[0].caller, 'External Clean Example')
  assert.equal(m.disk.text, file)
})
check('Revoked write access pauses without requesting permission in the background', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  const file = m.disk.text
  m.disk.permission = 'prompt'
  importNote(m.e, 'Unsaved Example')
  await m.save()
  assert.equal(m.disk.requests, 0)
  assert.equal(m.disk.text, file)
  assert(m.status().includes('File access needed'))
  await m.e.button('Reconnect').onclick()
  assert(m.disk.text.includes('Unsaved Example'))
})
check('Data files reject duplicate keys, oversized files and invalid backup metadata atomically', async () => {
  const seed = make()
  importNote(seed.e)
  await seed.choose()
  const exportText = seed.e.window.__itsCallAssist.exportCallNotesText()
  const body = exportText.slice(exportText.indexOf('--------------------') + 22)
  const duplicate = exportText + body
  const invalidMeta = seed.disk.text.replace('"format":1', '"format":99')
  for (const text of [duplicate, invalidMeta]) {
    const m = make(fakeDisk(text))
    await m.choose()
    assert.equal(records(m.e).length, 0)
    assert.equal(m.disk.writes.length, 0)
    assert.equal(m.disk.text, text)
  }
  const m = make()
  m.disk.reportedSize = 21 * 1024 * 1024
  await m.choose()
  assert.equal(m.disk.writes.length, 0)
  assert(m.status().includes('20 MB'))
})
check('An old unfinished caller never attaches to a different call with the same number', async () => {
  const first = make()
  await first.choose()
  first.e.showCall({ transactionId: 'fictional-old' })
  first.e.caller('Old Caller Example')
  await first.save()
  const next = make(first.disk, first.database)
  next.e.showCall({ transactionId: 'fictional-new' })
  await settle()
  const history = next.e.window.__itsCallAssist.callHistorySession()
  assert.equal(history.records[0].caller, 'Old Caller Example')
  assert.equal(history.pending[0].callerInput, '')
  assert.equal(history.pending[0].transactionId, 'fictional-new')
})
check('A delayed recovery cannot undo an intentional empty name or notes edit', async () => {
  const first = make()
  await first.choose()
  first.e.showCall({ transactionId: 'fictional-empty-edit' })
  first.e.caller('Old Draft Example')
  const oldNotes = first.e.ui().querySelector('#its-caller-notes')
  oldNotes.value = 'Old draft notes'
  oldNotes.oninput()
  await first.save()
  let release
  first.disk.readGate = new Promise((resolve) => { release = resolve })
  const next = make(first.disk, first.database)
  next.e.showCall({ transactionId: 'fictional-empty-edit' })
  next.e.caller('Temporary Example')
  next.e.caller('')
  const notes = next.e.ui().querySelector('#its-caller-notes')
  notes.value = 'Temporary notes'
  notes.oninput()
  notes.value = ''
  notes.oninput()
  release()
  await settle()
  const draft = next.e.window.__itsCallAssist.callHistorySession().pending[0]
  assert.equal(draft.callerInput, '')
  assert.equal(draft.notesInput, '')
  await next.save()
  assert(!first.disk.text.includes('Old Draft Example'))
  assert(!first.disk.text.includes('Old draft notes'))
})
check('A blocked location database degrades to a session connection without blocking monitoring', async () => {
  const database = fakeDatabase()
  database.openFails = true
  const m = make(fakeDisk(), database)
  await settle()
  importNote(m.e)
  await m.choose()
  assert(m.disk.text.includes('Alex Example'))
  m.e.scan()
  assert(m.e.window.__itsCallAssist.inspect())
  assert(m.status().includes('next browser session'))
})
check('Blocked preference storage does not prevent remembering and restoring the file handle', async () => {
  const options = {
    beforeStart: ({ window }) => {
      window.localStorage = { getItem: () => { throw error('SecurityError') }, setItem: () => { throw error('SecurityError') } }
    }
  }
  const m = make(fakeDisk(), fakeDatabase(), options)
  importNote(m.e)
  await m.choose()
  assert(m.status().includes('Saved'))
  const next = make(m.disk, m.database, options)
  await settle()
  assert.equal(records(next.e).length, 1)
  assert.equal(next.picks(), 0)
})
check('Failure to forget a connection is reported instead of promising future disconnection', async () => {
  const m = make()
  await m.choose()
  m.database.deleteFails = true
  m.e.window.localStorage.setItem = () => { throw error('SecurityError') }
  await m.e.button('Disconnect').onclick()
  assert(m.status().includes('could not forget'))
  assert(m.status().includes('remove its file access'))
  importNote(m.e)
  await settle()
  assert.equal(m.disk.writes.length, 0)
})
check('A blocked-session rerun preserves intentional clears after a failed file write', async () => {
  const m = make(fakeDisk(), fakeDatabase(), { blockSessionStorage: true })
  await m.choose()
  m.e.showCall({ transactionId: 'fictional-blocked-session' })
  m.e.caller('Earlier Example')
  await m.save()
  m.e.caller('')
  m.disk.writeError = error('NotReadableError', 'Disk unavailable')
  await m.save()
  m.e.rerun()
  await settle()
  assert.equal(m.e.window.__itsCallAssist.callHistorySession().pending[0].callerInput, '')
  assert(m.disk.text.includes('Earlier Example'))
})
check('Edits saved while the startup file read is pending take priority over that old file', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  let release
  m.disk.readGate = new Promise((resolve) => { release = resolve })
  m.e.rerun()
  const card = editFirst(m.e, 'Edited During Startup Example')
  card.querySelector('.history-edit-toggle').onclick()
  release()
  await settle()
  assert.equal(records(m.e)[0].caller, 'Edited During Startup Example')
  await m.save()
  assert(m.disk.text.includes('Edited During Startup Example'))
})
check('Rapid blocked-session reruns inherit the last completed file checkpoint', async () => {
  const m = make(fakeDisk(), fakeDatabase(), { blockSessionStorage: true })
  await m.choose()
  importNote(m.e, 'Before Rapid Rerun Example')
  m.e.rerun()
  m.e.rerun()
  await settle()
  assert.equal(records(m.e).length, 1)
  assert(!m.status().includes('changed while'))
  importNote(m.e, 'After Rapid Rerun Example')
  await m.save()
  assert(m.disk.text.includes('After Rapid Rerun Example'))
})
check('A late location read cannot replace a newer user-selected file', async () => {
  const old = fakeDisk()
  let release
  old.readGate = new Promise((resolve) => { release = resolve })
  const selected = fakeDisk()
  const m = make(selected, fakeDatabase(old.handle))
  await settle()
  importNote(m.e, 'Chosen File Example')
  const choosing = m.choose()
  release()
  await choosing
  await settle()
  assert(selected.text.includes('Chosen File Example'))
  assert.equal(old.writes.length, 0)
  assert.equal(m.database.handle, selected.handle)
})
check('All import, export, cancellation and download feedback expires after five seconds', async () => {
  const m = make()
  importNote(m.e)
  m.e.button('Call Notes').onclick()
  await m.e.button('Export TXT').onclick()
  assert(!statusNode(m.e).classList.contains('hidden'))
  runFeedbackTimer(m.e)
  assert(statusNode(m.e).classList.contains('hidden'))
  const file = m.e.ui().querySelector('input[type="file"]')
  file.files = [new Blob(['Other Example\nFictional\nNO JOB NUMBER'])]
  await file.onchange()
  assert(statusNode(m.e).textContent.includes('imported'))
  runFeedbackTimer(m.e)
  assert(statusNode(m.e).classList.contains('hidden'))
  m.e.window.showSaveFilePicker = async () => { throw error('AbortError') }
  await m.e.button('Export TXT').onclick()
  runFeedbackTimer(m.e)
  assert(statusNode(m.e).classList.contains('hidden'))
  delete m.e.window.showSaveFilePicker
  await m.e.button('Export TXT').onclick()
  runFeedbackTimer(m.e)
  assert(statusNode(m.e).classList.contains('hidden'))
  file.files = [new Blob(['invalid\u0000text'])]
  await file.onchange()
  assert.equal(statusNode(m.e).getAttribute('data-error'), 'true')
  runFeedbackTimer(m.e)
  assert(statusNode(m.e).classList.contains('hidden'))
})
check('Manual export cannot overwrite the connected automatic data file', async () => {
  const m = make()
  importNote(m.e)
  await m.choose()
  const file = m.disk.text
  m.e.button('Call Notes').onclick()
  await m.e.button('Export TXT').onclick()
  assert.equal(m.disk.text, file)
  assert(statusNode(m.e).textContent.includes('different file'))
  const alias = { ...m.disk.handle }
  m.disk.handle.isSameEntry = async (candidate) => candidate === alias
  m.e.window.showSaveFilePicker = async () => alias
  await m.e.button('Export TXT').onclick()
  assert.equal(m.disk.text, file)
  assert(statusNode(m.e).textContent.includes('different file'))
  runFeedbackTimer(m.e)
  assert(statusNode(m.e).classList.contains('hidden'))
})
check('Data-file warnings expire while their Settings indicator remains actionable', async () => {
  const disk = fakeDisk()
  disk.permission = 'prompt'
  const m = make(disk, fakeDatabase(disk.handle))
  await settle()
  m.e.button('Call Notes').onclick()
  const warning = m.e.ui().querySelector('.data-file-status')
  assert(!warning.classList.contains('hidden'))
  runFeedbackTimer(m.e)
  assert(warning.classList.contains('hidden'))
  assert.equal(m.e.button('Settings').getAttribute('data-file-attention'), 'true')
  await m.e.button('Reconnect').onclick()
  assert.equal(m.e.button('Settings').getAttribute('data-file-attention'), 'false')
})
check('Unsupported automatic access leaves ordinary Call Notes imports available', () => {
  const m = make(fakeDisk(), null, { unsupported: true })
  assert(m.e.button('Choose data file').disabled)
  importNote(m.e)
  assert.equal(records(m.e).length, 1)
  assert(m.status().includes('unavailable'))
})

check('Startup renews a remembered data file during an active launch gesture and imports it', async () => {
  const first = make()
  importNote(first.e, 'Startup Permission Example')
  await first.choose()
  await first.e.window.__itsCallAssist.destroy()
  first.disk.permission = 'prompt'
  const next = make(first.disk, first.database, {
    beforeStart: ({ window }) => { window.navigator.userActivation = { isActive: true } }
  })
  await settle()
  assert.equal(next.disk.requests, 1)
  assert.equal(next.picks(), 0)
  assert.equal(records(next.e)[0].caller, 'Startup Permission Example')
  assert(!next.status().includes('File access needed'))
})
check('Startup waits for a genuine activated interaction when launch permission cannot be requested yet', async () => {
  const first = make()
  importNote(first.e, 'Page Interaction Example')
  await first.choose()
  await first.e.window.__itsCallAssist.destroy()
  first.disk.permission = 'prompt'
  const activation = { isActive: false }
  const next = make(first.disk, first.database, {
    beforeStart: ({ window }) => { window.navigator.userActivation = activation }
  })
  await settle()
  assert.equal(records(next.e).length, 0)
  assert.equal(next.disk.requests, 0)
  assert(next.status().includes('Click in 8x8'))
  const listeners = [...next.e.window.document.listeners.get('pointerdown')]
  activation.isActive = true
  for (const listener of listeners) listener({ type: 'pointerdown', isTrusted: false })
  assert.equal(next.disk.requests, 0)
  activation.isActive = false
  next.e.pointerDown(next.e.window.document.body)
  assert.equal(next.disk.requests, 0)
  activation.isActive = true
  next.e.pointerDown(next.e.window.document.body)
  assert.equal(next.disk.requests, 1)
  await settle()
  assert.equal(records(next.e)[0].caller, 'Page Interaction Example')
  next.e.pointerDown(next.e.window.document.body)
  assert.equal(next.disk.requests, 1)
})
check('An expired launch gesture is rechecked after permission lookup and can reconnect on the next page click', async () => {
  const first = make()
  importNote(first.e, 'Expired Gesture Example')
  await first.choose()
  await first.e.window.__itsCallAssist.destroy()
  first.disk.permission = 'prompt'
  const activation = { isActive: true }
  let initialQuery = true
  first.disk.handle.queryPermission = async () => {
    if (initialQuery) { activation.isActive = false; initialQuery = false }
    return first.disk.permission
  }
  const next = make(first.disk, first.database, {
    beforeStart: ({ window }) => { window.navigator.userActivation = activation }
  })
  await settle()
  assert.equal(next.disk.requests, 0)
  activation.isActive = true
  next.e.pointerDown(next.e.window.document.body)
  await settle()
  assert.equal(next.disk.requests, 1)
  assert.equal(records(next.e)[0].caller, 'Expired Gesture Example')
})
check('Declining automatic reconnection never loops permission requests or reads the file', async () => {
  const disk = fakeDisk()
  disk.permission = 'prompt'
  disk.nextPermission = 'denied'
  const activation = { isActive: true }
  const m = make(disk, fakeDatabase(disk.handle), {
    beforeStart: ({ window }) => { window.navigator.userActivation = activation }
  })
  await settle()
  assert.equal(disk.requests, 1)
  assert.equal(disk.reads, 0)
  assert.equal(disk.writes.length, 0)
  m.e.pointerDown(m.e.window.document.body)
  m.e.pointerDown(m.e.window.document.body)
  await settle()
  assert.equal(disk.requests, 1)
  disk.nextPermission = 'granted'
  await m.e.button('Reconnect').onclick()
  assert.equal(disk.requests, 2)
})
check('Disconnect invalidates a delayed startup permission result without restoring old notes', async () => {
  const first = make()
  importNote(first.e, 'Disconnected Startup Example')
  await first.choose()
  await first.e.window.__itsCallAssist.destroy()
  first.disk.permission = 'prompt'
  let allow
  first.disk.handle.requestPermission = () => {
    first.disk.requests++
    return new Promise((resolve) => { allow = () => { first.disk.permission = 'granted'; resolve('granted') } })
  }
  const next = make(first.disk, first.database, {
    beforeStart: ({ window }) => { window.navigator.userActivation = { isActive: true } }
  })
  await settle()
  assert.equal(first.disk.requests, 1)
  await next.e.button('Disconnect').onclick()
  allow()
  await settle()
  assert.equal(records(next.e).length, 0)
  assert.equal(next.database.handle, null)
  assert(next.status().includes('Disconnected'))
})
check('Automatic reconnect leaves assistant controls and an explicitly disconnected file alone', async () => {
  const disk = fakeDisk()
  disk.permission = 'prompt'
  const activation = { isActive: false }
  const m = make(disk, fakeDatabase(disk.handle), {
    beforeStart: ({ window }) => { window.navigator.userActivation = activation }
  })
  await settle()
  activation.isActive = true
  const host = m.e.window.document.body.querySelector('#its-call-assist-panel')
  m.e.pointerDown(host)
  assert.equal(disk.requests, 0)
  await m.e.button('Disconnect').onclick()
  m.e.pointerDown(m.e.window.document.body)
  await settle()
  assert.equal(disk.requests, 0)
  assert.equal(disk.reads, 0)
})

async function retryDataFile (m) {
  // Advance only the file-recovery timeout, leaving sound/message deadlines alone.
  const entry = [...m.e.jobs].find(([, job]) => job.fn.name === 'recover')
  assert(entry, 'A disconnected selected file must keep a recovery attempt scheduled')
  const [id, job] = entry
  m.e.jobs.delete(id)
  await job.fn()
  await settle()
}
check('A temporary file read failure reconnects automatically without reopening a picker', async () => {
  const m = make()
  importNote(m.e, 'First Example')
  await m.choose()
  m.disk.readError = error('NotReadableError', 'Temporary file read failure')
  importNote(m.e, 'Later Example')
  await m.save()
  assert(m.status().includes('Temporary file read failure'))
  m.disk.readError = null
  await retryDataFile(m)
  assert(m.disk.text.includes('First Example'))
  assert(m.disk.text.includes('Later Example'))
  assert.equal(m.picks(), 1)
  assert.equal(records(m.e).length, 2)
})
check('Another process holding the data file is retried and unsaved notes survive', async () => {
  const m = make()
  await m.choose()
  m.disk.openError = error('NoModificationAllowedError')
  importNote(m.e, 'Locked File Example')
  await m.save()
  assert(!m.disk.text.includes('Locked File Example'))
  m.disk.openError = null
  await retryDataFile(m)
  assert(m.disk.text.includes('Locked File Example'))
  assert.equal(records(m.e).length, 1)
})
check('Permission revoked during a session can renew on the next genuine page click', async () => {
  const activation = { isActive: false }
  const m = make(undefined, undefined, { beforeStart: ({ window }) => { window.navigator.userActivation = activation } })
  await m.choose()
  m.disk.permission = 'prompt'
  importNote(m.e, 'Revoked Access Example')
  await m.save()
  assert.equal(m.disk.requests, 0)
  activation.isActive = true
  m.e.pointerDown(m.e.window.document.body)
  await settle()
  assert.equal(m.disk.requests, 1)
  assert(m.disk.text.includes('Revoked Access Example'))
})
check('Automatic retries never repeat a declined prompt, but recover when browser access is restored', async () => {
  const disk = fakeDisk()
  disk.permission = 'prompt'
  disk.nextPermission = 'denied'
  const activation = { isActive: false }
  const m = make(disk, fakeDatabase(disk.handle), { beforeStart: ({ window }) => { window.navigator.userActivation = activation } })
  await settle()
  activation.isActive = true
  m.e.pointerDown(m.e.window.document.body)
  await settle()
  assert.equal(disk.requests, 1)
  await retryDataFile(m)
  m.e.pointerDown(m.e.window.document.body)
  await retryDataFile(m)
  assert.equal(disk.requests, 1)
  assert.equal(disk.reads, 0)
  disk.permission = 'granted'
  await retryDataFile(m)
  assert(m.status().includes('Connected.'))
  assert.equal(disk.requests, 1)
})
check('Returning to the tab promptly retries an already permitted file', async () => {
  const disk = fakeDisk()
  disk.permission = 'denied'
  const m = make(disk, fakeDatabase(disk.handle))
  await settle()
  disk.permission = 'granted'
  m.dispatch('focus')
  const next = [...m.e.jobs.values()].find((job) => job.fn.name === 'recover')
  assert.equal(next.ms, 0)
  await retryDataFile(m)
  assert(m.status().includes('Connected.'))
  assert.equal(disk.requests, 0)
})
check('Returning to an idle connected tab detects revoked access before the next note is entered', async () => {
  const activation = { isActive: false }
  const m = make(undefined, undefined, { beforeStart: ({ window }) => { window.navigator.userActivation = activation } })
  await m.choose()
  m.disk.permission = 'prompt'
  m.dispatch('focus')
  await settle()
  assert(m.status().includes('File access needed'))
  assert.equal(m.disk.requests, 0)
  activation.isActive = true
  m.e.pointerDown(m.e.window.document.body)
  await settle()
  assert.equal(m.disk.requests, 1)
  assert(m.status().includes('Connected.'))
})
check('A remembered location survives a failed database open and is recovered automatically', async () => {
  const disk = fakeDisk('--------------------\nRestored Example\nFictional archived note\nINC9000000\n--------------------\n')
  const database = fakeDatabase(disk.handle)
  database.openFails = true
  const m = make(disk, database, {
    beforeStart: ({ window }) => window.localStorage.setItem('service-desk-8x8-data-enabled-v1', 'true')
  })
  await settle()
  assert.equal(records(m.e).length, 0)
  database.openFails = false
  await retryDataFile(m)
  assert.equal(records(m.e).length, 1)
  assert.equal(records(m.e)[0].caller, 'Restored Example')
  assert.equal(m.picks(), 0)
})
check('Repeated recovery attempts cannot overwrite a conflicting external edit', async () => {
  const m = make()
  importNote(m.e, 'Original Conflict Example')
  await m.choose()
  const external = m.disk.text.replace('Original Conflict Example', 'External Conflict Example')
  m.disk.text = external
  importNote(m.e, 'Unsaved Conflict Example')
  await m.save()
  for (let count = 0; count < 3; count++) await retryDataFile(m)
  assert.equal(m.disk.text, external)
  assert.equal(records(m.e).length, 2)
  assert.equal(records(m.e)[0].caller, 'Original Conflict Example')
  assert(m.status().includes('keep both copies'))
})
check('Explicit Disconnect cancels retries, lifecycle wakes and an already queued stale callback', async () => {
  const disk = fakeDisk()
  disk.permission = 'denied'
  const m = make(disk, fakeDatabase(disk.handle))
  await settle()
  const old = [...m.e.jobs.values()].find((job) => job.fn.name === 'recover')
  assert(old)
  await m.e.button('Disconnect').onclick()
  disk.permission = 'granted'
  m.dispatch('focus')
  m.dispatch('online')
  m.e.pointerDown(m.e.window.document.body)
  await old.fn()
  await settle()
  assert.equal(disk.reads, 0)
  assert.equal(disk.writes.length, 0)
  assert(![...m.e.jobs.values()].some((job) => job.fn.name === 'recover'))
})
check('A late automatic reconnect cannot import notes after Disconnect or destruction', async () => {
  for (const mode of ['disconnect', 'destroy']) {
    const disk = fakeDisk('--------------------\nLate Recovery Example\nFictional note\nINC9000000\n--------------------\n')
    disk.permission = 'denied'
    const m = make(disk, fakeDatabase(disk.handle))
    await settle()
    disk.permission = 'granted'
    let release
    disk.readGate = new Promise((resolve) => { release = resolve })
    const [id, job] = [...m.e.jobs].find(([, job]) => job.fn.name === 'recover')
    m.e.jobs.delete(id)
    const pending = job.fn()
    await settle()
    const api = m.e.window.__itsCallAssist
    if (mode === 'disconnect') await m.e.button('Disconnect').onclick()
    else await api.destroy()
    release()
    await pending
    await settle()
    assert.equal(api.callHistorySession().records.length, 0)
    assert.equal(disk.writes.length, 0)
  }
})
check('Explicit disconnect survives a rerun even when Edge cannot persist that choice', async () => {
  const m = make()
  await m.choose()
  m.database.deleteFails = true
  const write = m.e.window.localStorage.setItem
  m.e.window.localStorage.setItem = (key, value) => {
    if (key === 'service-desk-8x8-data-enabled-v1' && value === 'false') throw error('SecurityError')
    write(key, value)
  }
  await m.e.button('Disconnect').onclick()
  const reads = m.disk.reads
  m.e.rerun()
  await settle()
  m.dispatch('focus')
  await settle()
  assert.equal(m.disk.reads, reads)
  assert(![...m.e.jobs.values()].some((job) => job.fn.name === 'recover'))
})
check('A cancelled edit is repaired automatically even if a previous file close was already committing', async () => {
  const m = make()
  importNote(m.e, 'Original Cancel Example')
  await m.choose()
  let release
  m.disk.closeGate = new Promise((resolve) => { release = resolve })
  const card = editFirst(m.e, 'Cancelled Commit Example')
  const pending = m.save()
  await settle()
  card.querySelector('.history-edit-input').onkeydown({ key: 'Escape', preventDefault () {} })
  // Let the cancellation's scheduled no-op flush happen before the old close completes.
  for (const [id, job] of [...m.e.jobs]) {
    if (job.ms === 5000) { m.e.jobs.delete(id); job.fn() }
  }
  release()
  await pending
  await settle()
  m.disk.closeGate = null
  for (const [id, job] of [...m.e.jobs]) {
    if (job.ms === 5000) { m.e.jobs.delete(id); job.fn() }
  }
  await settle()
  assert(m.disk.text.includes('Original Cancel Example'))
  assert(!m.disk.text.includes('Cancelled Commit Example'))
})
;(async () => {
  for (const { name, fn } of checks) {
    await fn()
    await settle()
    console.log('PASS:', name)
  }
  console.log(`${checks.length} persistence and resize scenarios passed.`)
})().catch((failure) => { console.error(failure); process.exitCode = 1 })
