/* Content-script adapter. The shared assistant starts only after durable data is loaded. */
;(() => {
  'use strict'
  const root = window
  const api = globalThis.chrome
  const C = globalThis.SDAExtension
  if (root !== root.top || !C.isSite(root.location.href)) return
  if (root.__itsCallAssistRuntime?.starting || root.__itsCallAssistRuntime?.active) return

  const previous = root.__itsCallAssistRuntime
  // Reopening a closed panel must not overtake writes still pending from that panel.
  const previousClose = previous?.closePromise || Promise.resolve()
  previous?.detach?.()
  const settings = new Map()
  const pending = new Map()
  const listeners = new Set()
  const notices = new Map()
  let sequence = 0
  let draining = null
  let retryTimer = null
  let status = 'saved'
  let historyJSON = null
  let lastRevision = -1
  let lastLedgerLength = -1
  let permission = 'default'
  let detached = false
  let noticeNumber = 0
  let banner = null
  let errorReason = ''

  const runtime = {
    version: api.runtime.getManifest().version_name || api.runtime.getManifest().version,
    persistent: true,
    historyPageSize: 100,
    starting: true,
    active: false,
    token: null,
    restoredDraftIds: [],
    settingsStorage: {
      getItem: (key) => settings.get(key) ?? null,
      setItem: (key, value) => {
        if (!C.settingsKeys.includes(key)) throw new Error('Unknown assistant setting.')
        const text = String(value)
        if (settings.get(key) === text) return
        settings.set(key, text)
        enqueue('setting:' + key, { operation: 'setting', key, value: text })
      }
    },
    historyStorage: { getItem: (key) => key === C.historyKey ? historyJSON : null },
    onStorageStatus: (listener) => {
      listeners.add(listener)
      listener(status)
      return () => listeners.delete(listener)
    },
    saveHistory: (history, revision) => {
      // Changing call clocks must not serialise every saved call on each one-second scan.
      const { records, completedTransactions, ...header } = history
      const message = { operation: 'history', header: clone(header) }
      if (completedTransactions.length !== lastLedgerLength) {
        message.header.completedTransactions = [...completedTransactions]
        lastLedgerLength = completedTransactions.length
      }
      if (revision !== lastRevision) {
        message.records = clone(records)
        lastRevision = revision
      }
      // A newer draft update must retain any completed-record changes awaiting a commit.
      const waiting = pending.get('history')?.message
      if (waiting?.records !== undefined && message.records === undefined) message.records = waiting.records
      if (waiting?.header.completedTransactions && !message.header.completedTransactions) {
        message.header.completedTransactions = waiting.header.completedTransactions
      }
      enqueue('history', message)
    },
    checkpointEditor: (recordKey, fields) => enqueue('editor', { operation: 'editor', recordKey, fields: clone(fields) }),
    finishEditor: (recordKey, fields) => enqueue('editor', { operation: 'editor-finish', recordKey, fields: fields ? clone(fields) : null }),
    onDestroy: () => {
      if (detached || !runtime.token) return Promise.resolve()
      if (runtime.closePromise) return runtime.closePromise
      runtime.active = false
      // Keep the lease until every queued edit has been accepted by extension storage.
      runtime.closePromise = flush().then(async () => {
        await send({ operation: 'release' })
        runtime.detach()
      }).catch((error) => {
        runtime.closePromise = null
        showMessage('Your latest changes have not been saved.', 'Keep this tab open and try again, or export your Call Notes as a backup.', 'Retry saving', () => runtime.onDestroy())
        throw error
      })
      // UI close handlers are synchronous; a visible retry replaces an unhandled rejection.
      runtime.closePromise.catch(() => {})
      return runtime.closePromise
    },
    detach: () => {
      detached = true
      if (retryTimer !== null) root.clearTimeout(retryTimer)
      api.runtime.onMessage.removeListener(onMessage)
      banner?.remove()
      listeners.clear()
    },
    onStarted: () => { runtime.starting = false },
    reportStartError: (error) => {
      runtime.starting = false
      if (!banner) showMessage('The assistant could not start.', error.message || 'Reload 8x8 when you are not on a call and try again.')
    },
    flush
  }
  root.__itsCallAssistRuntime = runtime

  function clone (value) { return JSON.parse(JSON.stringify(value)) }
  async function send (message) {
    const response = await api.runtime.sendMessage({ channel: C.channel, token: runtime.token, ...message })
    if (!response) throw new Error('The extension did not respond. Reload 8x8 when you are not on a call.')
    if (response.error) {
      const error = new Error(response.error)
      error.code = response.code
      throw error
    }
    return response
  }
  function setStatus (value) {
    status = value
    for (const listener of listeners) listener(value)
    if (value === 'saved' && errorReason === 'storage') { banner?.remove(); banner = null; errorReason = '' }
  }
  function enqueue (key, message) {
    if (detached || !runtime.token) return
    // Coalesce obsolete snapshots, while retaining a monotonically ordered editor commit.
    pending.set(key, { message, sequence: ++sequence })
    if (status !== 'error') setStatus('saving')
    flush().catch(() => {})
  }
  function flush () {
    if (draining) return draining
    draining = (async () => {
      while (pending.size) {
        const [key, item] = [...pending].sort((a, b) => a[1].sequence - b[1].sequence)[0]
        try {
          await send(item.message)
        } catch (error) {
          setStatus('error')
          if (error.code === 'not-owner') {
            // An obsolete tab must never continue saving or sounding after a takeover.
            runtime.active = false
            runtime.starting = false
            runtime.detach()
            root.__itsCallAssist?.destroy()
            showMessage('The assistant is running in another 8x8 tab.', 'Use the extension button to move it to this tab.')
          } else {
            errorReason = 'storage'
            showMessage('Your latest changes have not been saved.', 'Keep this tab open. Use Export TXT in Call Notes to keep a backup.', 'Retry saving', () => flush().catch(() => {}))
            if (retryTimer === null) {
              retryTimer = root.setTimeout(() => {
                retryTimer = null
                if (!detached) flush().catch(() => {})
              }, 5000)
            }
          }
          throw error
        }
        // A new snapshot can replace the one being written while the browser is busy.
        if (pending.get(key) === item) pending.delete(key)
      }
      setStatus('saved')
    })().finally(() => { draining = null })
    return draining
  }
  function showMessage (title, text, action, handler) {
    banner?.remove()
    banner = root.document.createElement('div')
    banner.id = 'its-extension-status'
    banner.style.cssText = 'position:fixed;top:18px;right:18px;z-index:2147483647;max-width:calc(100vw - 36px)'
    const shadow = banner.attachShadow({ mode: 'open' })
    const style = root.document.createElement('style')
    style.textContent = ':host{font:13px/1.45 system-ui,sans-serif;color:#172235}.box{width:340px;max-width:100%;padding:15px;background:#fff8ed;border:1px solid #e2bf8c;border-left:4px solid #bf671b;border-radius:12px;box-shadow:0 8px 28px #0002}strong{display:block;margin-bottom:5px}p{margin:0}button{margin-top:10px;padding:6px 10px;border:1px solid #b9c7dd;border-radius:6px;background:#eef3fa;color:#172235;cursor:pointer}'
    const box = root.document.createElement('section')
    box.className = 'box'
    box.setAttribute('role', 'status')
    const heading = root.document.createElement('strong')
    heading.textContent = title
    const description = root.document.createElement('p')
    description.textContent = text
    box.append(heading, description)
    if (action && handler) {
      const button = root.document.createElement('button')
      button.textContent = action
      button.onclick = handler
      box.append(button)
    }
    shadow.append(style, box)
    root.document.body.append(banner)
  }
  // Notifications use Edge's extension permission rather than 8x8's website allowlist.
  runtime.Notification = class AssistantNotification {
    static get permission () { return permission }
    constructor (title, options = {}) {
      this.id = 'sd8x8-' + runtime.token + '-' + (++noticeNumber)
      this.onclick = null
      notices.set(this.id, this)
      this.ready = send({ operation: 'notice', noticeId: this.id, title, body: options.body || '', requireInteraction: !!options.requireInteraction })
      this.ready.catch(() => {})
    }

    close () {
      notices.delete(this.id)
      send({ operation: 'notice-close', noticeId: this.id }).catch(() => {})
    }
  }
  function onMessage (message, sender, reply) {
    // Only the background worker can control this isolated-world instance.
    if (sender.id !== api.runtime.id || sender.tab || message?.channel !== C.channel) return false
    if (message.operation === 'ping') {
      // Unsaved edits keep this tab alive even after the user closes its panel.
      reply({ active: runtime.active || runtime.starting || (!detached && pending.size > 0) })
      return false
    }
    if (message.operation === 'stop') {
      root.__itsCallAssist?.destroy()
      const closing = runtime.closePromise || runtime.onDestroy()
      closing.then(() => reply({ ok: true })).catch((error) => reply({ error: error.message }))
      return true
    }
    if (message.operation === 'notice-click') {
      const notice = notices.get(message.noticeId)
      notice?.onclick?.()
      reply({ ok: true })
      return false
    }
    if (message.operation === 'open-notes') {
      runtime.ready.then(() => {
        root.__itsCallAssist?.openCallNotes?.()
        reply({ ok: true })
      }).catch((error) => reply({ error: error.message }))
      return true
    }
    return false
  }
  api.runtime.onMessage.addListener(onMessage)
  runtime.ready = (async () => {
    await previousClose
    const snapshot = await send({ operation: 'init' })
    if (!snapshot.active) {
      runtime.starting = false
      showMessage(snapshot.reason === 'disabled' ? 'The assistant is turned off.' : 'The assistant is running in another 8x8 tab.', 'Use the extension button to start it in this tab.')
      return
    }
    runtime.token = snapshot.token
    for (const [key, value] of Object.entries(snapshot.settings)) settings.set(key, value)
    const records = [...snapshot.records]
    let next = snapshot.next
    while (next !== null) {
      const page = await send({ operation: 'history-page', offset: next })
      records.push(...page.records)
      next = page.next
    }
    if (snapshot.history) historyJSON = JSON.stringify({ ...snapshot.history, records })
    runtime.restoredDraftIds = snapshot.restoredDraftIds
    permission = snapshot.permission === 'granted' ? 'granted' : 'denied'
    runtime.active = true
    runtime.starting = true
    setStatus('saved')
  })().catch((error) => {
    runtime.starting = false
    runtime.active = false
    showMessage('The assistant could not start.', error.message, error.code === 'reload-required' ? null : 'Try again', () => {
      // Reinitialisation uses the same packaged files and never reloads a call automatically.
      runtime.detach()
      api.runtime.sendMessage({ channel: C.channel, operation: 'retry' }).catch(() => {})
    })
    throw error
  })
  runtime.ready.catch(() => {})
})()
