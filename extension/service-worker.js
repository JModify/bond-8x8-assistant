/* Manifest V3 broker: caller details remain in this browser profile, never storage.sync. */
globalThis.importScripts('shared.js')
const api = globalThis.chrome
const C = globalThis.SDAExtension
let cache = null
let owner = null
let ready = null
let writes = Promise.resolve()
const cancelledNotices = new Set()
const creatingNotices = new Set()
let controls = Promise.resolve()

function initialise () {
  if (!ready) {
    ready = (async () => {
      // The page and content scripts cannot directly access durable extension storage.
      await api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
      cache = await api.storage.local.get(null)
      owner = (await api.storage.session.get(C.ownerKey))[C.ownerKey] || null
    })().catch((error) => { ready = null; throw error })
  }
  return ready
}
function serial (task) {
  // Failed writes do not poison the queue; later retries keep their original data intact.
  const result = writes.then(async () => { await initialise(); return task() })
  writes = result.catch(() => {})
  return result
}
async function persist (patch) {
  // Update the in-memory mirror only after the browser commits the durable write.
  await api.storage.local.set(patch)
  Object.assign(cache, patch)
}
function pageSender (sender) {
  return sender.id === api.runtime.id && sender.tab && sender.frameId === 0 &&
    typeof sender.documentId === 'string' && C.isSite(sender.url)
}
function popupSender (sender) {
  return sender.id === api.runtime.id && sender.url === api.runtime.getURL('popup.html') && !sender.tab
}
function requireOwner (sender, token) {
  if (!pageSender(sender) || !owner || owner.tabId !== sender.tab.id ||
    owner.documentId !== sender.documentId || owner.token !== token) {
    const error = new Error('This 8x8 tab no longer owns the assistant.')
    error.code = 'not-owner'
    throw error
  }
}
async function saveOwner (value) {
  await api.storage.session.set({ [C.ownerKey]: value })
  owner = value
}
async function clearOwnedNotices (token) {
  // Notification settings must never turn a successful note save into a storage error.
  const all = await api.notifications.getAll().catch(() => ({}))
  await Promise.all(Object.keys(all).filter((id) => id.startsWith('sd8x8-' + token + '-')).map((id) => api.notifications.clear(id).catch(() => {})))
}
function editorFields (value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid call-note edit.')
  const limit = (key, length) => {
    if (typeof value[key] !== 'string' || value[key].length > length) throw new Error('Invalid call-note text.')
    return value[key]
  }
  return { caller: limit('caller', 160), notes: limit('notes', 20000), jobNumber: limit('jobNumber', 80) }
}
async function saveHistory (header, records, documentId) {
  if (!header || !Array.isArray(header.pending) || !Number.isSafeInteger(header.nextId)) {
    throw new Error('Invalid call-history snapshot.')
  }
  const previous = cache[C.metaKey] || { recordKeys: [], draftDocuments: {} }
  const meta = { ...previous, ...header, recordKeys: previous.recordKeys, draftDocuments: {} }
  // Preserve the original document of each unfinished call across subsequent saves.
  for (const draft of header.pending) {
    meta.draftDocuments[draft.id] = previous.draftDocuments?.[draft.id] || documentId
  }
  const patch = {}
  if (records !== undefined) {
    if (!Array.isArray(records)) throw new Error('Invalid completed-call list.')
    const keys = new Set()
    for (const record of records) {
      if (!record || typeof record.recordKey !== 'string' || !record.recordKey || record.recordKey.length > 180 || keys.has(record.recordKey)) {
        throw new Error('Invalid or duplicate call-note identity.')
      }
      keys.add(record.recordKey)
      const key = C.recordKey(record.recordKey)
      if (JSON.stringify(cache[key]) !== JSON.stringify(record)) patch[key] = record
    }
    meta.recordKeys = [...keys]
  }
  patch[C.metaKey] = meta
  await persist(patch)
  // The committed index determines which records exist. Cleanup failure cannot resurrect a
  // deleted record, and the old data stays recoverable if the commit itself fails.
  const removed = (previous.recordKeys || []).filter((key) => !meta.recordKeys.includes(key))
  if (removed.length) {
    await api.storage.local.remove(removed.map(C.recordKey)).catch(() => {})
    for (const key of removed) delete cache[C.recordKey(key)]
  }
}
async function recoverEditor () {
  const edit = cache[C.checkpointKey]
  const meta = cache[C.metaKey]
  if (!edit || !meta?.recordKeys?.includes(edit.recordKey)) return
  const key = C.recordKey(edit.recordKey)
  const fields = editorFields(edit.fields)
  // Recover only user-editable fields. Native identities, times, guards and counters stay intact.
  await persist({ [key]: { ...cache[key], ...fields }, [C.checkpointKey]: null })
}
async function migrateLegacy (tabId, documentId) {
  const results = await api.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: 'MAIN',
    func: () => {
      // This fixed, packaged migration reads only this assistant's keys and stops its old
      // snippet. No extension API, credential, cookie or unrelated 8x8 setting is exposed.
      const core = window.__itsCallAssist
      const settings = {}
      for (const key of ['service-desk-8x8-preferences-v5', 'service-desk-8x8-sounds-v4', 'service-desk-8x8-statistics-v1', 'service-desk-8x8-short-breaks-v1']) {
        try { const value = window.localStorage.getItem(key); if (value !== null) settings[key] = value } catch {}
      }
      let history = null
      const recognised = core && typeof core.destroy === 'function' && /^1\.\d+\.\d+$/.test(core.version)
      if (recognised) {
        core.finaliseCallNotes?.()
        history = core.callHistorySession?.() || null
        core.destroy()
      }
      if (!history) {
        try { history = JSON.parse(window.sessionStorage.getItem('service-desk-8x8-call-history-v1') || 'null') } catch {}
      }
      return { settings, history, reloadRequired: !!document.getElementById('its-call-assist-panel') }
    }
  })
  const legacy = results[0]?.result || {}
  if (legacy.reloadRequired) {
    const error = new Error('Reload 8x8 when you are not on a call to finish starting the extension.')
    error.code = 'reload-required'
    throw error
  }
  const patch = {}
  for (const key of C.settingsKeys) {
    if (cache[key] === undefined && typeof legacy.settings?.[key] === 'string') patch[key] = legacy.settings[key]
  }
  if (Object.keys(patch).length) await persist(patch)
  if (!cache[C.metaKey] && legacy.history?.records && Array.isArray(legacy.history.pending)) {
    const { records, ...header } = legacy.history
    await saveHistory(header, records, documentId)
  }
}
function historyPage (offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid call-history page.')
  const meta = cache[C.metaKey]
  if (!meta) return { records: [], next: null }
  const keys = meta.recordKeys || []
  // Chunk IPC messages so long histories do not exceed Chromium's message size limit.
  const records = []
  let size = 0
  let index = offset
  while (index < keys.length && records.length < 200) {
    const record = cache[C.recordKey(keys[index])]
    if (!record) throw new Error('A saved call note could not be loaded. Existing data has been kept.')
    const length = JSON.stringify(record).length
    if (records.length && size + length > 500000) break
    records.push(record)
    size += length
    index++
  }
  return { records, next: index < keys.length ? index : null }
}
async function initPage (sender) {
  if (cache[C.enabledKey] === false) return { active: false, reason: 'disabled' }
  if (owner && (owner.tabId !== sender.tab.id || owner.documentId !== sender.documentId)) {
    // A new document in the same tab replaces a destroyed navigation context. Another
    // live tab keeps ownership until a deliberate toolbar takeover safely flushes it.
    if (owner.tabId !== sender.tab.id) {
      const alive = await api.tabs.sendMessage(owner.tabId, { channel: C.channel, operation: 'ping' }, { documentId: owner.documentId }).catch(() => null)
      if (alive?.active) return { active: false, reason: 'another-tab' }
    }
  }
  await migrateLegacy(sender.tab.id, sender.documentId)
  await recoverEditor()
  await saveOwner({ tabId: sender.tab.id, documentId: sender.documentId, token: globalThis.crypto.randomUUID() })
  const meta = cache[C.metaKey]
  const header = meta ? { ...meta } : null
  if (header) { delete header.recordKeys; delete header.draftDocuments }
  return {
    active: true,
    token: owner.token,
    settings: Object.fromEntries(C.settingsKeys.filter((key) => cache[key] !== undefined).map((key) => [key, cache[key]])),
    history: header,
    ...historyPage(),
    restoredDraftIds: (meta?.pending || []).filter((draft) => meta.draftDocuments?.[draft.id] !== sender.documentId).map((draft) => draft.id),
    permission: await api.notifications.getPermissionLevel()
  }
}
async function inject (tabId) {
  await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', files: ['shared.js', 'bootstrap.js', 'assistant.js'] })
}
async function stopOwner () {
  await initialise()
  const old = owner
  if (!old) return
  // Do not hold the storage queue while the content script flushes: its save messages
  // must be allowed to commit before the acknowledgement and ownership transfer.
  let timeout
  const response = await Promise.race([
    api.tabs.sendMessage(old.tabId, { channel: C.channel, operation: 'stop' }, { documentId: old.documentId }).catch(() => ({ gone: true })),
    new Promise((resolve) => { timeout = setTimeout(() => resolve({ error: 'The other 8x8 tab has not finished saving. Keep it open and try again.' }), 5000) })
  ]).finally(() => clearTimeout(timeout))
  if (response?.error) throw new Error(response.error)
  await serial(async () => { if (owner?.token === old.token) await saveOwner(null) })
}
async function route (message, sender) {
  if (message?.channel !== C.channel) return undefined
  const popup = popupSender(sender)
  const page = pageSender(sender)
  if (!popup && !page) throw new Error('Assistant access was refused.')
  if (page && message.operation === 'retry') {
    await inject(sender.tab.id)
    return { ok: true }
  }
  if (popup && message.operation === 'activate') {
    const tab = await api.tabs.get(message.tabId)
    if (!C.isSite(tab.url)) throw new Error('Open your 8x8 tab first.')
    await stopOwner()
    await serial(() => persist({ [C.enabledKey]: true }))
    await inject(tab.id)
    await api.tabs.update(tab.id, { active: true })
    await api.windows.update(tab.windowId, { focused: true })
    return { ok: true }
  }
  if (popup && message.operation === 'open-site') {
    await api.tabs.create({ url: C.site })
    return { ok: true }
  }
  if (popup && message.operation === 'enabled') {
    if (typeof message.enabled !== 'boolean') throw new Error('Invalid assistant preference.')
    if (!message.enabled) await stopOwner()
    await serial(() => persist({ [C.enabledKey]: message.enabled }))
    if (message.enabled) {
      const tabs = await api.tabs.query({ url: C.match })
      for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) await inject(tab.id)
    }
    return { ok: true }
  }
  if (popup && message.operation === 'reload') {
    const tab = await api.tabs.get(message.tabId)
    if (!C.isSite(tab.url)) throw new Error('Open your 8x8 tab first.')
    await api.tabs.reload(tab.id)
    return { ok: true }
  }
  if (popup && message.operation === 'update') {
    if (!api.runtime.getManifest().update_url) return { status: 'not-configured' }
    return api.runtime.requestUpdateCheck()
  }
  // Closing a pending notification can overtake its asynchronous permission/create call.
  if (page && message.operation === 'notice-close') {
    await initialise()
    requireOwner(sender, message.token)
    if (typeof message.noticeId !== 'string' || !message.noticeId.startsWith('sd8x8-' + owner.token + '-')) throw new Error('Invalid notification identity.')
    if (creatingNotices.has(message.noticeId)) cancelledNotices.add(message.noticeId)
    await api.notifications.clear(message.noticeId)
    return { ok: true }
  }
  if (page && message.operation === 'notice') {
    await initialise()
    requireOwner(sender, message.token)
    const id = message.noticeId
    if (typeof id !== 'string' || !id.startsWith('sd8x8-' + owner.token + '-')) throw new Error('Invalid notification identity.')
    creatingNotices.add(id)
    try {
      if (await api.notifications.getPermissionLevel() !== 'granted') throw new Error('Extension notifications are not permitted.')
      if (cancelledNotices.has(id) || owner?.token !== message.token) return { cancelled: true }
      const title = String(message.title || '').slice(0, 300)
      const body = String(message.body || '').slice(0, 2000)
      await api.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title, message: body, silent: true, requireInteraction: !!message.requireInteraction })
      if (cancelledNotices.has(id) || owner?.token !== message.token) await api.notifications.clear(id)
      return { ok: true }
    } finally {
      creatingNotices.delete(id)
      cancelledNotices.delete(id)
    }
  }
  return serial(async () => {
    if (popup && message.operation === 'status') return { enabled: cache[C.enabledKey] !== false, owner, version: api.runtime.getManifest().version_name, savedCalls: cache[C.metaKey]?.recordKeys?.length || 0, updatesConfigured: !!api.runtime.getManifest().update_url }
    if (page && message.operation === 'init') return initPage(sender)
    requireOwner(sender, message.token)
    if (message.operation === 'history-page') return historyPage(message.offset)
    if (message.operation === 'setting') {
      if (!C.settingsKeys.includes(message.key) || typeof message.value !== 'string' || message.value.length > 500000) throw new Error('Invalid assistant setting.')
      JSON.parse(message.value)
      await persist({ [message.key]: message.value })
    } else if (message.operation === 'history') {
      await saveHistory(message.header, message.records, sender.documentId)
    } else if (message.operation === 'editor') {
      if (typeof message.recordKey !== 'string' || !cache[C.metaKey]?.recordKeys?.includes(message.recordKey)) throw new Error('Invalid editor identity.')
      await persist({ [C.checkpointKey]: { recordKey: message.recordKey, fields: editorFields(message.fields) } })
    } else if (message.operation === 'editor-finish') {
      const patch = { [C.checkpointKey]: null }
      const key = C.recordKey(message.recordKey)
      if (message.fields && cache[C.metaKey]?.recordKeys?.includes(message.recordKey)) patch[key] = { ...cache[key], ...editorFields(message.fields) }
      await persist(patch)
    } else if (message.operation === 'release') {
      await saveOwner(null)
      await clearOwnedNotices(message.token)
    } else throw new Error('Unknown assistant operation.')
    return { ok: true }
  })
}
api.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.channel !== C.channel) return false
  // Toolbar operations may flush another tab. Serialize those controls separately so
  // the storage queue stays free to accept that tab's final writes.
  let result
  if (popupSender(sender) && ['activate', 'enabled', 'reload'].includes(message.operation)) {
    result = controls.then(() => route(message, sender))
    controls = result.catch(() => {})
  } else result = route(message, sender)
  result.then(reply).catch((error) => reply({ error: error.message, code: error.code || 'failed' }))
  return true
})
api.runtime.onInstalled.addListener(() => {
  initialise().then(async () => {
    if (cache[C.enabledKey] === false) return
    const tabs = await api.tabs.query({ url: C.match })
    for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) await inject(tab.id).catch(() => {})
  }).catch(() => {})
})
api.tabs.onRemoved.addListener((tabId) => {
  serial(async () => {
    if (owner?.tabId !== tabId) return null
    const old = owner
    await saveOwner(null)
    return old
  }).then(async (old) => {
    if (!old) return
    await clearOwnedNotices(old.token)
    if (cache[C.enabledKey] === false) return
    // If the monitored tab closes, an already-open 8x8 tab may resume automatically.
    const tabs = await api.tabs.query({ url: C.match })
    for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) await inject(tab.id).catch(() => {})
  }).catch(() => {})
})
api.notifications.onClicked.addListener((id) => {
  initialise().then(async () => {
    if (!owner || !id.startsWith('sd8x8-' + owner.token + '-')) return
    const tab = await api.tabs.get(owner.tabId)
    if (!C.isSite(tab.url)) return
    await api.tabs.update(tab.id, { active: true })
    await api.windows.update(tab.windowId, { focused: true })
    await api.tabs.sendMessage(tab.id, { channel: C.channel, operation: 'notice-click', noticeId: id }, { documentId: owner.documentId })
  }).catch(() => {})
})
