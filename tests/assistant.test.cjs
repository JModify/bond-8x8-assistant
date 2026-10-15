const fs = require('fs')
const vm = require('vm')
const assert = require('node:assert/strict')
const path = require('node:path')
const file = path.join(__dirname, '..', 'Service-Desk-8x8-Assistant.js')
const original = fs.readFileSync(file, 'utf8')
let passed = 0
function check (name, fn) {
  fn()
  passed++
  console.log('PASS:', name)
}

// Minimal page fixture: the same status, timer and queue attributes 8x8 supplies.
// The production reader, UI handlers, rule logic and alert lifecycle all run.
function environment (preferences = { g1: ['Me'], lunchMinutes: 30 }, sounds = {}, options = {}) {
  // Most scenarios use an intentionally configured 10-second delay. Raw preferences
  // exercise default settings and migrations without that fixture convenience.
  if (!options.rawPreferences) {
    preferences = { settingsVersion: 3, dispositionSeconds: 10, ...preferences }
  }
  let now = 100000
  let nextId = 0
  const jobs = new Map()
  const notifications = []
  const downloads = []
  const blobs = new Map()
  const revokedUrls = []
  const rootListeners = new Map()
  const storage = new Map([
    ['service-desk-8x8-preferences-v5', JSON.stringify(preferences)],
    [
      'service-desk-8x8-inbound-queues-v1',
      JSON.stringify(['Demo Academic Queue', 'Demo Transfer Queue', 'Demo Service Queue'])
    ],
    ['service-desk-8x8-sounds-v4', JSON.stringify(sounds)]
  ])
  const session = new Map()
  if (options.callHistory) {
    session.set('service-desk-8x8-call-history-v1', JSON.stringify(options.callHistory))
  }
  if (options.shortBreaks) {
    storage.set('service-desk-8x8-short-breaks-v1', JSON.stringify(options.shortBreaks))
  }
  class Node {
    constructor (tag, text = '') {
      this.tagName = tag.toUpperCase()
      this.nodeType = tag === '#text' ? 3 : 1
      this.ownerDocument = document
      this.children = []
      this.parentElement = null
      this.attributes = {}
      this.style = {}
      this.className = ''
      this._text = text
      this.value = ''
      this.checked = false
      this.disabled = false
      this.listeners = new Map()
      this.clicks = 0
      this.classList = {
        contains: (c) => this.className.split(/\s+/).includes(c),
        add: (c) => this.classList.toggle(c, true),
        remove: (c) => this.classList.toggle(c, false),
        toggle: (c, force) => {
          // Match DOMTokenList toggling without duplicating class tokens.
          const set = new Set(this.className.split(/\s+/).filter(Boolean))
          const value = force === undefined ? !set.has(c) : force
          if (value) set.add(c)
          else set.delete(c)
          this.className = [...set].join(' ')
          return value
        }
      }
    }

    set textContent (s) {
      this._text = String(s)
      this.children = []
    }

    get textContent () {
      return this._text + this.children.map((c) => c.textContent).join('')
    }

    append (...nodes) {
      for (const n of nodes) {
        // append moves an existing node instead of cloning it or keeping two parents.
        if (n.parentElement) {
          n.parentElement.children = n.parentElement.children.filter((c) => c !== n)
        }
        this.children.push(n)
        n.parentElement = this
        n.ownerDocument = this.ownerDocument
      }
    }

    insertBefore (node, reference) {
      // Reconciliation can add a new call before an existing focused editor.
      if (node === reference) return node
      node.remove()
      const index = reference ? this.children.indexOf(reference) : this.children.length
      this.children.splice(index, 0, node)
      node.parentElement = this
      node.ownerDocument = this.ownerDocument
      return node
    }

    setAttribute (k, v) {
      this.attributes[k] = String(v)
    }

    getAttribute (k) {
      // The browser reflects these common DOM properties as attributes.
      return this.attributes[k] ?? (['type', 'id', 'title'].includes(k) ? (this[k] ?? null) : null)
    }

    matches (selector) {
      // This fixture implements only the tag, class, ID and attribute selectors used by 8x8 readers.
      const tag = selector.match(/^[a-z][\w-]*/i)?.[0]
      if (tag && tag.toUpperCase() !== this.tagName) return false
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1))
      if (selector.startsWith('#')) return this.id === selector.slice(1)
      // Capture an attribute name and optional quoted value for presence/equality checks.
      for (const match of selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
        const value = this.getAttribute(match[1])
        if (
          value === null ||
          value === undefined ||
          (match[2] !== undefined && value !== match[2])
        ) {
          return false
        }
      }
      return true
    }

    querySelectorAll (selector) {
      const found = []
      const visit = (node) => {
        for (const c of node.children) {
          // Descend through every child, collecting elements that match any selector alternative.
          if (c.nodeType === 1 && selector.split(',').some((s) => c.matches(s.trim()))) {
            found.push(c)
          }
          visit(c)
        }
      }
      visit(this)
      return found
    }

    querySelector (selector) {
      return this.querySelectorAll(selector)[0] ?? null
    }

    closest (selector) {
      // Include the element itself before walking up its parent chain.
      for (let node = this; node; node = node.parentElement) {
        if (node.matches(selector)) return node
      }
      return null
    }

    getClientRects () {
      return this.hidden ? [] : [{}]
    }

    contains (target) {
      for (let node = target; node; node = node.parentElement) if (node === this) return true
      return false
    }

    addEventListener (name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set())
      this.listeners.get(name).add(listener)
    }

    removeEventListener (name, listener) {
      this.listeners.get(name)?.delete(listener)
    }

    click () {
      this.clicks++
      if (this.tagName === 'A') downloads.push({ href: this.href, filename: this.download })
      return this.onclick?.()
    }

    attachShadow () {
      this.shadowRoot = new Node('shadow-root')
      return this.shadowRoot
    }

    remove () {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((node) => node !== this)
        this.parentElement = null
      }
    }
  }
  // Node construction begins after its document exists; the class retains this same owner.
  const document = {
    listeners: new Map(),
    createElement: (tag) => new Node(tag),
    createElementNS: (_namespace, tag) => new Node(tag),
    createTextNode: (t) => new Node('#text', t),
    querySelectorAll: (s) => document.body.querySelectorAll(s),
    addEventListener: (name, listener) => {
      if (!document.listeners.has(name)) document.listeners.set(name, new Set())
      document.listeners.get(name).add(listener)
    },
    removeEventListener: (name, listener) => document.listeners.get(name)?.delete(listener)
  }
  document.body = new Node('body')
  document.body.ownerDocument = document
  const add = (tag, parent, attrs = {}, text = '') => {
    const node = new Node(tag, text)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    parent.append(node)
    return node
  }
  const header = add('span', document.body)
  const meStatus = add('div', header, {
    'data-test-id': 'user-status',
    'data-status-value': 'Available'
  })
  const timerWrapper = add('span', header)
  const meTimer = add('div', timerWrapper, { 'data-test-id': 'user-presence-timer' }, '0s')
  const meReason = add('span', header, { title: 'Lunch' }, 'Lunch')
  meReason.hidden = true
  const group = add('div', document.body, { 'data-test-id': 'virtuoso-item-list' })
  const agents = {}
  function login (name, statusLabel = 'Available', seconds = 0) {
    const row = add('div', group, { 'data-test-id': 'agent-item', 'aria-label': name })
    add('span', row, { 'data-test-id': 'agent-name-label', title: name }, name)
    const status = add('div', row, { 'data-status-value': statusLabel })
    const timer = add('div', row, { 'data-test-id': 'user-presence-timer' }, seconds + 's')
    agents[name] = { row, status, timer }
  }
  for (const name of ['Alex Agent', 'Casey Agent']) login(name)
  const queues = []
  for (const name of [
    'ITS Academic Hotline',
    'ITS Internal TRNFR',
    'ITS Outbound',
    'ITS Service Desk'
  ]) {
    const row = add('div', document.body, { 'data-test-id': 'queue-item' })
    add('span', row, { 'data-test-id': 'queue-name', title: name }, name)
    const cell = add('span', row, { role: 'gridcell', title: '0 Interactions waiting' }, '0')
    const wait = add(
      'span',
      row,
      { role: 'gridcell', title: '0 minutes 0 seconds Longest waiting time' },
      '0m 0s'
    )
    queues.push({ row, cell, wait })
  }
  const schedule = (fn, ms) => {
    const id = ++nextId
    jobs.set(id, { fn, ms })
    return id
  }
  const audioContexts = []
  class AudioContext {
    constructor () {
      this.state = 'running'
      this.currentTime = 0
      this.destination = {}
      this.sinkId = ''
      this.notes = []
      this.gains = []
      this.resumeCount = 0
      audioContexts.push(this)
    }

    async setSinkId (id) {
      if (options.beforeSink) await options.beforeSink(id, this)
      if (options.rejectOutput === id || options.rejectSink?.(id, this)) {
        throw Error('NotAllowedError')
      }
      if (id && !devices.some((d) => d.kind === 'audiooutput' && d.deviceId === id)) {
        throw Error('NotFoundError')
      }
      this.sinkId = id
    }

    resume () {
      this.resumeCount++
      this.state = 'running'
      return Promise.resolve()
    }

    close () {
      this.state = 'closed'
      return Promise.resolve()
    }

    createOscillator () {
      // Record scheduling and routing per context so tests can detect duplicated or leaked tones.
      const oscillator = {
        frequency: { value: 0 },
        stops: [],
        connect: (gain) => {
          oscillator.gain = gain
        },
        disconnect: () => {
          oscillator.disconnected = true
        },
        start: (time) => {
          oscillator.startTime = time
        },
        stop: (time) => {
          oscillator.stops.push(time)
        }
      }
      this.notes.push(oscillator)
      return oscillator
    }

    createGain () {
      const gain = {
        values: [],
        gain: {
          setValueAtTime: (value, time) => gain.values.push({ value, time }),
          linearRampToValueAtTime: (value, time) => gain.values.push({ value, time })
        },
        connect: (destination) => {
          gain.destination = destination
        },
        disconnect: () => {
          gain.disconnected = true
        }
      }
      this.gains.push(gain)
      return gain
    }
  }
  class Notification {
    static permission = 'granted'
    constructor (title, options) {
      this.title = title
      this.options = options
      this.closed = false
      notifications.push(this)
    }

    close () {
      this.closed = true
    }
  }
  if (options.noOutputSelection) delete AudioContext.prototype.setSinkId
  const devices = options.devices || [
    {
      kind: 'audiooutput',
      deviceId: 'default',
      label: 'Default - Desk Speakers',
      groupId: 'desk-speakers'
    },
    { kind: 'audiooutput', deviceId: 'speakers', label: 'Desk Speakers', groupId: 'desk-speakers' },
    {
      kind: 'audiooutput',
      deviceId: 'headset',
      label: 'Support Headset',
      groupId: 'support-headset'
    },
    { kind: 'audioinput', deviceId: 'default', label: 'Default - Desk Microphone' }
  ]
  const deviceListeners = new Set()
  let microphoneRequests = 0
  const mediaDevices = {
    enumerateDevices: async () => {
      if (options.enumerationFails) throw Error('NotAllowedError')
      return devices
    },
    getUserMedia: async () => {
      microphoneRequests++
      throw Error('Unexpected microphone capture')
    },
    addEventListener: (name, fn) => {
      if (name === 'devicechange') deviceListeners.add(fn)
    },
    removeEventListener: (name, fn) => {
      if (name === 'devicechange') deviceListeners.delete(fn)
    }
  }
  if (options.outputPicker) {
    mediaDevices.selectAudioOutput = async (request) =>
      options.beforePicker
        ? options.beforePicker(request)
        : {
            kind: 'audiooutput',
            deviceId: 'headset',
            label: 'Support Headset'
          }
  }
  const window = {
    document,
    location: { hostname: 'vcc-au2.8x8.com', origin: 'https://vcc-au2.8x8.com' },
    navigator: { onLine: true, mediaDevices },
    AudioContext,
    Notification,
    Blob,
    TextDecoder,
    URL: {
      createObjectURL: (blob) => {
        const url = 'blob:fixture-' + blobs.size
        blobs.set(url, blob)
        return url
      },
      revokeObjectURL: (url) => revokedUrls.push(url)
    },
    ...(options.savePicker ? { showSaveFilePicker: options.savePicker } : {}),
    addEventListener: (name, listener) => {
      if (!rootListeners.has(name)) rootListeners.set(name, new Set())
      rootListeners.get(name).add(listener)
    },
    removeEventListener: (name, listener) => rootListeners.get(name)?.delete(listener),
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    sessionStorage: {
      getItem: (k) => {
        if (options.blockSessionStorage) throw Error('Session storage blocked')
        return session.get(k) ?? null
      },
      setItem: (k, v) => {
        if (options.blockSessionStorage) throw Error('Session storage blocked')
        session.set(k, v)
      }
    },
    setInterval: schedule,
    setTimeout: schedule,
    clearInterval: (id) => jobs.delete(id),
    clearTimeout: (id) => jobs.delete(id),
    getComputedStyle: (n) => ({
      display: n.classList.contains('hidden') ? 'none' : 'block',
      visibility: 'visible'
    }),
    MutationObserver: class {
      observe () {}
      disconnect () {}
    },
    focus () {}
  }
  window.top = window
  document.defaultView = window
  class Clock extends Date {
    constructor (...args) {
      // Explicit date arguments retain normal Date behaviour; empty construction uses fake time.
      super(...(args.length ? args : [now]))
    }

    static now () {
      return now
    }
  }
  // Add test-only entry points inside the running closure without publishing
  // debug controls in the real prototype. Whitespace changes must remain harmless.
  const controllerPattern =
    /root\.__itsCallAssist = \{\s*destroy,\s*inspect:\s*\(\) => lastSample\s*\}[ \t]*;?/
  const source = original.replace(
    controllerPattern,
    `root.__itsCallAssist = {
      destroy,
      inspect: () => lastSample,
      debug: () => ({
        activeReminder,
        reminderLifetimes: [...reminderLifetimes].map(([key, value]) => [key, { ...value }]),
        playing: [...sounds.keys()],
        muted,
        audioOutput: audio?.sinkId,
        secondaryOutput: secondaryAudio?.sinkId,
        secondaryEnabled: secondaryRingerEnabled,
        secondaryReady: secondaryOutputReady
      }),
      groupRules,
      parseCallNotesText,
      importCallNotesText,
      exportCallNotesText,
      rescan: safeScan
    }`
  )
  assert.notEqual(
    source,
    original,
    'The production controller must be instrumented for this fixture'
  )
  // A missing-page startup exercises the real first scan, rather than hiding data afterwards.
  options.beforeStart?.({ header, group, queues, document, window })
  // Extension scenarios hydrate asynchronous storage before executing the same core.
  if (!options.deferStart) {
    vm.runInNewContext(
      source,
      { window, location: window.location, Date: Clock, console },
      { timeout: 1000 }
    )
  }
  const ui = () => document.body.querySelector('#its-call-assist-panel').shadowRoot
  const scan = () => {
    now += 2000
    window.__itsCallAssist?.rescan?.()
  }
  const setMe = (status, seconds, reason = 'Lunch') => {
    meStatus.setAttribute('data-status-value', status)
    meTimer.textContent = seconds + 's'
    meReason.hidden = !['On Break', 'Break'].includes(status)
    meReason.setAttribute('title', reason)
    meReason.textContent = reason
    scan()
  }
  const other = (name, status, seconds) => {
    agents[name].status.setAttribute('data-status-value', status)
    agents[name].timer.textContent = seconds + 's'
  }
  const clock = (seconds) => {
    const s = String(seconds % 60).padStart(2, '0')
    const m = Math.floor(seconds / 60)
    return m >= 60
      ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}`
      : `${String(m).padStart(2, '0')}:${s}`
  }
  let personalPage = null
  let breakTimer = null
  let wrapTimer = null
  let interactionTimer = null
  function callInfo (card, label, value) {
    const list = card.querySelector('ul') || add('ul', card)
    const row = add('li', list)
    add('span', row, {}, label)
    const wrapper = add('div', row)
    add('span', wrapper, { title: String(value) }, String(value))
    return row
  }
  function showCall (details = {}) {
    const {
      number = '+155501001',
      queue = 'Demo Service Queue',
      transactionId = 'demo-101',
      seconds = 12,
      waitSeconds = 15,
      info = true,
      onHold = false,
      ringing = false
    } = details
    hideMain()
    personalPage = add('article', document.body, { 'data-test-id': 'phone-card-test-id' })
    add('div', personalPage, { 'data-test-id': 'user-status', 'data-status-value': 'Busy' }, 'Busy')
    add('h1', personalPage, { 'data-test-id': 'active-call-name' }, number || 'Anonymous')
    add('span', personalPage, { 'data-test-id': 'active-call-number' }, number || 'Anonymous')
    interactionTimer = add(
      'div',
      personalPage,
      {
        'data-test-id': ringing ? 'progress-timer' : 'interaction-timer',
        'aria-label': ringing ? 'Incoming call' : 'Interaction',
        role: 'timer'
      },
      clock(seconds)
    )
    add(
      'button',
      personalPage,
      { 'data-test-id': 'disposition-tab_TAB', role: 'tab', 'aria-selected': 'false' },
      'Disposition'
    )
    if (onHold) {
      add(
        'div',
        personalPage,
        { 'data-test-id': 'hold-timer', 'aria-label': 'On hold', role: 'timer' },
        '00:05'
      )
    }
    if (info) {
      if (number) callInfo(personalPage, 'Phone number', number)
      if (queue) callInfo(personalPage, 'Queue', queue)
      if (transactionId) callInfo(personalPage, 'Transaction ID', transactionId)
      callInfo(personalPage, 'Queue wait duration', clock(waitSeconds))
      callInfo(personalPage, 'Channel name', queue || 'Demo Channel')
      callInfo(personalPage, 'Channel number', '+155509999')
      callInfo(personalPage, 'Caller name', 'Native display name must not be used')
    }
    scan()
  }
  function hideMain () {
    header.hidden = true
    group.hidden = true
    for (const q of queues) q.row.hidden = true
    personalPage?.remove()
  }
  function showBreak (seconds, reason = 'Lunch') {
    hideMain()
    personalPage = add('div', document.body)
    add('h1', personalPage, { 'aria-describedby': 'timeCounter' }, 'On Break for:')
    const wrapper = add('div', personalPage)
    breakTimer = add(
      'div',
      wrapper,
      { id: 'timeCounter', role: 'timer', 'data-test-id': 'on-break-timer' },
      clock(seconds)
    )
    add('span', personalPage, { title: reason }, reason)
    scan()
  }
  function showWrapUp (remaining, details = {}) {
    hideMain()
    personalPage = add('article', document.body, { 'data-test-id': 'phone-card-test-id' })
    add('div', personalPage, { 'data-test-id': 'wrap-up-label' }, 'Wrap up')
    add(
      'div',
      personalPage,
      {
        'data-test-id': 'interaction-time-label',
        role: 'timer',
        'aria-label':
          details.seconds === undefined ? '42 minutes 0 seconds' : `${details.seconds} seconds`
      },
      details.seconds === undefined ? '42:00' : clock(details.seconds)
    )
    wrapTimer = add(
      'div',
      personalPage,
      { 'data-test-id': 'progress-timer', role: 'timer', 'aria-label': 'Wrap up' },
      clock(remaining)
    )
    for (const [key, label] of [
      ['number', 'Phone number'],
      ['queue', 'Queue'],
      ['transactionId', 'Transaction ID']
    ]) {
      if (details[key]) callInfo(personalPage, label, details[key])
    }
    if (details.waitSeconds !== undefined) {
      callInfo(personalPage, 'Queue wait duration', clock(details.waitSeconds))
    }
    scan()
  }
  function restoreMain (status = 'Available', seconds = 0) {
    personalPage?.remove()
    personalPage = null
    header.hidden = false
    group.hidden = false
    for (const q of queues) q.row.hidden = false
    setMe(status, seconds)
  }
  const waiting = (n, seconds = 0, index = 3) => {
    const q = queues[index]
    q.cell.textContent = String(n)
    q.cell.setAttribute('title', `${n} Interactions waiting`)
    q.wait.textContent = `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    q.wait.setAttribute(
      'title',
      `${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds Longest waiting time`
    )
  }
  return {
    window,
    ui,
    scan,
    setMe,
    other,
    jobs,
    storage,
    session,
    notifications,
    downloads,
    blobs,
    revokedUrls,
    pointerDown: (target, path) => {
      const composed = path || []
      if (!path) for (let node = target; node; node = node.parentElement) composed.push(node)
      const event = { type: 'pointerdown', isTrusted: true, target, composedPath: () => composed }
      for (const listener of document.listeners.get('pointerdown') || []) listener(event)
    },
    pageHide: () => {
      for (const listener of rootListeners.get('pagehide') || []) listener()
    },
    queues,
    group,
    header,
    meTimer,
    meStatus,
    meReason,
    login,
    logout: (name) => agents[name].row.remove(),
    agents,
    audioContexts,
    devices,
    deviceListeners,
    microphoneRequests: () => microphoneRequests,
    deviceChanged: () => {
      for (const fn of deviceListeners) fn()
    },
    showBreak,
    showCall,
    callTime: (seconds) => {
      interactionTimer.textContent = clock(seconds)
      scan()
    },
    setCallInfo: (label, value) => {
      const row = personalPage
        .querySelectorAll('li')
        .find((r) => r.querySelector('span')?.textContent === label)
      if (value === null) row?.remove()
      else if (row) {
        const text = row.querySelector('span[title]')
        text.setAttribute('title', value)
        text.textContent = value
      } else callInfo(personalPage, label, value)
      scan()
    },
    caller: (value) => {
      const input = ui().querySelector('#its-caller-identifier')
      input.value = value
      input.oninput()
    },
    notes: (value) => {
      const input = ui().querySelector('#its-caller-notes')
      input.value = value
      input.oninput()
    },
    importFile: (file) => {
      const input = ui().querySelector('input[type="file"]')
      input.files = [file]
      return input.onchange()
    },
    showShortBreak: (seconds) => showBreak(seconds, 'Short Break'),
    breakReason: (reason) => {
      const label = personalPage.querySelector('span[title]')
      label.setAttribute('title', reason)
      label.textContent = reason
      scan()
    },
    showWrapUp,
    restoreMain,
    breakTime: (seconds) => {
      breakTimer.textContent = clock(seconds)
      scan()
    },
    wrapTime: (remaining) => {
      wrapTimer.textContent = clock(remaining)
      scan()
    },
    personalPage: () => personalPage,
    setTime: (time) => {
      now = time
    },
    advance: (ms) => {
      now += ms
      window.__itsCallAssist.rescan()
    },
    rerun: () =>
      vm.runInNewContext(
        source,
        { window, location: window.location, Date: Clock, console },
        { timeout: 1000 }
      ),
    runScript: (text, extras = {}) => vm.runInNewContext(
      text,
      { window, location: window.location, Date: Clock, console, ...extras },
      { timeout: 1000 }
    ),
    reload: () => {
      window.__itsCallAssist.destroy()
      vm.runInNewContext(
        source,
        { window, location: window.location, Date: Clock, console },
        { timeout: 1000 }
      )
    },
    debug: () => window.__itsCallAssist.debug(),
    checkbox: (name) => ui().querySelector(`[aria-label="G1: ${name}"]`),
    button: (name) => {
      const buttons = ui().querySelectorAll('button')
      return buttons.find((n) => n.getAttribute('aria-label') === name) || buttons.find((n) => n.textContent === name)
    },
    waiting,
    tick: (name, value) => {
      const b = ui().querySelector(`[aria-label="G1: ${name}"]`)
      b.checked = value
      b.onchange()
    },
    lunch: (minutes) => {
      const input = ui().querySelector('#its-my-lunch-minutes')
      input.value = String(minutes)
      input.oninput()
    }
  }
}
check('Me is selectable and reveals a 1–120 minute lunch slider', () => {
  const e = environment({ g1: ['Alex Agent'], lunchSeconds: 1800 })
  assert(e.checkbox('Me'))
  assert(e.ui().querySelector('.assistant-settings').classList.contains('hidden'))
  e.tick('Me', true)
  e.button('Settings').onclick()
  assert(!e.ui().querySelector('.assistant-settings').classList.contains('hidden'))
  assert.equal(e.window.__itsCallAssist.inspect().mode, 'covering')
  const slider = e.ui().querySelector('#its-my-lunch-minutes')
  assert.equal(slider.min, '1')
  assert.equal(slider.max, '120')
})
check('Self alone is valid G1 and Available/Busy stay silent despite waiting callers', () => {
  const e = environment()
  e.waiting(2)
  e.other('Alex Agent', 'On Break', 1900)
  e.setMe('Available', 5)
  e.setMe('Busy', 200)
  assert.equal(e.notifications.length, 0)
  assert.equal(e.debug().activeReminder, null)
  assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
})
check('Other agents going on break are silent while Me is in G1', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'], lunchSeconds: 1800 })
  e.setMe('Available', 2)
  e.other('Alex Agent', 'On Break', 1)
  e.setMe('Available', 4)
  assert.equal(e.notifications.length, 0)
})
check('Disposition has a strict greater-than-10-second boundary', () => {
  const e = environment()
  e.setMe('Wrap Up', 9)
  e.setMe('Wrap Up', 10)
  assert.equal(e.notifications.length, 0)
  e.setMe('Wrap Up', 11)
  assert.equal(e.debug().activeReminder.kind, 'disposition')
  assert(e.debug().playing.includes('disposition'))
  e.setMe('Wrap Up', 12)
  assert.equal(e.notifications.length, 1)
})
check('Wrap-up/Post-processing/Disposition label variants are recognised', () => {
  for (const status of [
    'Wrap Up',
    'Wrap-up',
    'Post Processing',
    'Post-processing',
    'Disposition'
  ]) {
    const e = environment()
    e.setMe(status, 11)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
  }
})
check('Completing disposition clears its sound and allows a later call episode', () => {
  const e = environment()
  e.setMe('Wrap Up', 11)
  e.setMe('Available', 0)
  assert(!e.debug().playing.includes('disposition'))
  e.setMe('Busy', 1)
  e.setMe('Wrap Up', 10)
  assert.equal(e.notifications.length, 1)
  e.setMe('Wrap Up', 11)
  assert.equal(e.notifications.length, 2)
})
check('A normal lunch stays silent including the exact selected duration', () => {
  const e = environment()
  e.setMe('On Break', 1799)
  e.setMe('On Break', 1800)
  assert.equal(e.notifications.length, 0)
  e.setMe('On Break', 1801)
  assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
  e.setMe('Available', 0)
  assert(!e.debug().playing.includes('lunchOverdue'))
})
check('Both lunch slider endpoints use strict greater-than boundaries', () => {
  for (const minutes of [1, 120]) {
    const e = environment({ g1: ['Me'], lunchMinutes: minutes })
    e.setMe('On Break', minutes * 60)
    assert.equal(e.notifications.length, 0)
    e.setMe('On Break', minutes * 60 + 1)
    assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
  }
})
check('Increasing lunch allowance cancels an overdue reminder; settings persist', () => {
  const e = environment({ g1: ['Me'], lunchSeconds: 600 })
  e.setMe('On Break', 601)
  e.lunch(20)
  assert.equal(e.debug().activeReminder, null)
  assert(!e.debug().playing.includes('lunchOverdue'))
  const saved = JSON.parse(e.storage.get('service-desk-8x8-preferences-v5'))
  assert.equal(saved.lunchMinutes, 20)
  assert.deepEqual(saved.g1, ['Me'])
})
check('G1 Other Work and Working Offline stay silent without an aged waiting caller', () => {
  const e = environment()
  for (const status of ['Other Work', 'Working Offline', 'Work Offline']) {
    e.setMe(status, 1)
    e.setMe(status, 2)
    assert.equal(e.debug().activeReminder, null)
    assert.equal(e.notifications.length, 0)
    assert(!e.debug().playing.includes('critical'))
  }
})
check('New sound settings have separate defaults and disabled repeat durations', () => {
  const e = environment()
  const cards = e.ui().querySelectorAll('fieldset')
  assert.equal(cards.length, 4)
  for (const [label, preset, volume] of [
    ['Alert: Complete Disposition', 'Urgent pulse', '80'],
    ['Alert: Lunch Break Finished', 'Digital ring', '85']
  ]) {
    const card = cards.find((n) => n.querySelector('legend').textContent === label)
    assert.equal(card.querySelector('select').value, preset)
    assert.equal(String(card.querySelector('[type="range"]').value), volume)
    assert(card.querySelector('[type="number"]').disabled)
    const repeat = card.querySelector('[type="checkbox"]')
    repeat.checked = false
    repeat.onchange()
    assert(!card.querySelector('[type="number"]').disabled)
  }
})
check('Mute and removal stop personal sounds; hidden queues retain a compact reminder', () => {
  for (const action of ['Mute', 'hidden', 'Remove']) {
    const e = environment()
    e.setMe('Wrap Up', 11)
    if (action === 'hidden') {
      e.queues[0].row.hidden = true
      e.scan()
      assert(e.ui().querySelector('.data-warning').classList.contains('hidden'))
      assert.equal(e.window.__itsCallAssist.inspect().view, 'disposition')
      assert(e.debug().playing.includes('disposition'))
    } else e.button(action === 'Remove' ? 'x' : action).onclick()
    if (action === 'Remove') {
      assert.equal(e.window.__itsCallAssist, undefined)
      assert.equal(e.jobs.size, 0)
    } else if (action !== 'hidden') assert(!e.debug().playing.includes('disposition'))
  }
})
check('Unticking Me preserves the current personal reminder in G2', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'], lunchSeconds: 1800 })
  e.setMe('Wrap Up', 11)
  e.tick('Me', false)
  assert(e.debug().playing.includes('disposition'))
  assert.equal(e.window.__itsCallAssist.inspect().mode, 'assisting')
})
check('G2 still reports another selected agent going on break', () => {
  const e = environment({ g1: ['Alex Agent'], lunchSeconds: 1800 })
  e.setMe('Available', 2)
  e.other('Alex Agent', 'On Break', 1)
  e.setMe('Available', 4)
  assert(e.notifications.some((n) => n.title === 'Info: G1 On Break'))
})
check('A finite custom reminder does not restart within the same condition', () => {
  const e = environment(
    { g1: ['Me'], lunchSeconds: 1800 },
    { disposition: { preset: 'Soft bell', volume: 40, seconds: 2, repeat: false } }
  )
  e.setMe('Wrap Up', 11)
  for (const { fn, ms } of [...e.jobs.values()]) if (ms === 2000) fn()
  e.setMe('Wrap Up', 12)
  assert(!e.debug().playing.includes('disposition'))
  assert.equal(e.notifications.length, 1)
})

check('Agents uses separate Name / Status / Time / G1 columns', () => {
  const e = environment()
  e.setMe('Available', 5)
  const table = e.ui().querySelector('table')
  assert.deepEqual(
    table
      .querySelector('thead')
      .querySelectorAll('th')
      .map((c) => c.textContent),
    ['Name', 'Status', 'Time', 'G1']
  )
  const rows = table.querySelector('tbody').querySelectorAll('tr')
  assert.equal(rows.length, 3)
  const cells = rows[0].querySelectorAll('td')
  assert.equal(cells.length, 4)
  assert.deepEqual(
    cells.map((c) => c.textContent),
    ['Me', 'Available', '5s', '']
  )
  assert.equal(cells[3].querySelector('input').getAttribute('aria-label'), 'G1: Me')
  assert(
    e
      .ui()
      .querySelectorAll('h4')
      .some((n) => n.textContent === 'Agents')
  )
})
check('Sounds and Settings replace main content and have top Back buttons', () => {
  const e = environment()
  const main = e.ui().querySelector('.main-view')
  const sounds = e.ui().querySelector('.sound-settings')
  const settings = e.ui().querySelector('.assistant-settings')
  assert(sounds.classList.contains('hidden'))
  assert(settings.classList.contains('hidden'))
  e.button('Settings').onclick()
  e.button('Open Sound Settings').onclick()
  assert(main.classList.contains('hidden'))
  assert(!sounds.classList.contains('hidden'))
  assert(settings.classList.contains('hidden'))
  assert.equal(sounds.children[0].querySelector('h3').textContent, 'Sound Settings')
  assert.equal(sounds.children[0].querySelector('button').textContent, 'Back')
  assert.equal(sounds.querySelectorAll('button').filter((n) => n.textContent === 'Back').length, 1)
  sounds.children[0].querySelector('button').onclick()
  assert(!settings.classList.contains('hidden'))
  assert(sounds.classList.contains('hidden'))
  settings.children[0].querySelector('button').onclick()
  assert(!main.classList.contains('hidden'))
  e.button('Settings').onclick()
  assert(main.classList.contains('hidden'))
  assert(!settings.classList.contains('hidden'))
  assert.equal(settings.children[0].querySelector('h3').textContent, 'Assistant Settings')
  assert.equal(settings.children[0].querySelector('button').textContent, 'Back')
  settings.children[0].querySelector('button').onclick()
  assert(!main.classList.contains('hidden'))
})
check('Monitoring continues in submenus; Back stops previews only', () => {
  const e = environment()
  e.button('Settings').onclick()
  e.button('Open Sound Settings').onclick()
  e.setMe('Wrap Up', 11)
  assert.equal(e.debug().activeReminder.kind, 'disposition')
  const sounds = e.ui().querySelector('.sound-settings')
  sounds
    .querySelectorAll('button')
    .find((n) => n.textContent === 'Preview')
    .onclick()
  assert(e.debug().playing.includes('preview'))
  sounds.children[0].querySelector('button').onclick()
  assert(!e.debug().playing.includes('preview'))
  assert(e.debug().playing.includes('disposition'))
  e.button('Settings').onclick()
  e.setMe('Available', 0)
  assert.equal(e.debug().activeReminder, null)
})
check('Disposition delay and descriptions update immediately', () => {
  const e = environment()
  e.setMe('Wrap Up', 10)
  assert.equal(e.notifications.length, 0)
  const input = e.ui().querySelector('#its-disposition-seconds')
  input.value = '5'
  input.onchange()
  assert.equal(e.debug().activeReminder.kind, 'disposition')
  const card = e
    .ui()
    .querySelectorAll('fieldset')
    .find((n) => n.querySelector('legend').textContent === 'Alert: Complete Disposition')
  assert(card.querySelector('.sound-description').textContent.includes('more than 5 seconds'))
  input.value = '20'
  input.onchange()
  assert.equal(e.debug().activeReminder, null)
  e.setMe('Wrap Up', 20)
  assert.equal(e.debug().activeReminder, null)
  e.setMe('Wrap Up', 21)
  assert.equal(e.debug().activeReminder.kind, 'disposition')
})
check('Desktop notifications can be disabled without silencing alerts', () => {
  const e = environment({ g1: ['Me'], lunchSeconds: 1800, desktopNotifications: false })
  e.setMe('Wrap Up', 11)
  assert.equal(e.notifications.length, 0)
  assert(e.debug().playing.includes('disposition'))
  const toggle = e.ui().querySelector('#its-desktop-notifications')
  toggle.checked = true
  toggle.onchange()
  e.setMe('Available', 1)
  e.setMe('Wrap Up', 11)
  assert.equal(e.notifications.length, 1)
  toggle.checked = false
  toggle.onchange()
  assert(e.notifications[0].closed)
  assert(e.debug().playing.includes('disposition'))
})
check('A hidden roster freezes agent data while Settings stays accessible and recovers in place', () => {
  const e = environment()
  e.button('Settings').onclick()
  e.group.hidden = true
  e.scan()
  assert(!e.ui().querySelector('.assistant-settings').classList.contains('hidden'))
  assert(e.ui().querySelector('.sound-settings').classList.contains('hidden'))
  assert(!e.ui().querySelector('.data-warning').classList.contains('hidden'))
  assert(e.ui().querySelector('.data-warning').textContent.includes('Agent information frozen'))
  assert(e.ui().querySelector('.data-warning').textContent.includes('Open 8x8 queue information'))
  assert(e.ui().querySelector('.data-warning').closest('.assistant-settings'))
  e.group.hidden = false
  e.scan()
  assert(!e.ui().querySelector('.assistant-settings').classList.contains('hidden'))
  assert(e.ui().querySelector('.data-warning').classList.contains('hidden'))
})

check(
  'Prototype reports version 1.2.0 and bottom controls put Call Notes before accessible mute and settings icons',
  () => {
    const e = environment()
    assert.equal(e.window.__itsCallAssist.version, '1.2.0')
    assert.deepEqual(
      e
        .ui()
        .querySelector('.controls')
        .querySelectorAll('button')
        .map((b) => b.getAttribute('aria-label') || b.textContent),
      ['Call Notes', 'Mute', 'Settings']
    )
    assert.deepEqual(
      e
        .ui()
        .querySelector('.window-actions')
        .querySelectorAll('button')
        .map((b) => b.textContent),
      ['-', 'x']
    )
    assert.equal(
      e.ui().querySelector('.release-version').querySelector('.footer-value').textContent,
      '1.2.0'
    )
    assert(e.ui().querySelector('.release-version').closest('.footer'))
    assert(!e.ui().querySelector('.title-block').textContent.includes('1.2.0'))
  }
)
check('Minimise and restore use the top button; close removes the assistant', () => {
  const e = environment()
  e.button('-').onclick()
  assert(e.ui().querySelector('.monitor-grid').parentElement.classList.contains('hidden'))
  e.button('+').onclick()
  assert(!e.ui().querySelector('.monitor-grid').parentElement.classList.contains('hidden'))
  e.button('x').onclick()
  assert.equal(e.window.__itsCallAssist, undefined)
  assert.equal(e.jobs.size, 0)
})
check('G2 explanation appears below Agents and the two finite-sound stop lines are gone', () => {
  const e = environment()
  assert(e.ui().querySelector('.agent-help').textContent.includes('Group 2 (G2)'))
  for (const label of ['Info: G1 On Break']) {
    const card = e
      .ui()
      .querySelectorAll('fieldset')
      .find((n) => n.querySelector('legend').textContent === label)
    assert(!card.querySelector('.sound-description').textContent.includes('Stops when'))
    assert(card.querySelector('.sound-description').textContent.includes('G2'))
  }
  assert(!e.ui().textContent.includes('outside G1'))
})
check('Each observed transition to Busy counts once, regardless of G1 selection', () => {
  const e = environment({ g1: ['Alex Agent'], lunchSeconds: 1800 })
  e.setMe('Busy', 0)
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  e.setMe('Busy', 3)
  e.setMe('Busy', 30)
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  e.setMe('Wrap Up', 1)
  e.setMe('Available', 1)
  e.setMe('Busy', 0)
  assert.equal(e.window.__itsCallAssist.statistics().total, 2)
})
check(
  'Calls keep counting while queues are hidden and when the status timer cannot be read',
  () => {
    const e = environment()
    e.queues[0].row.hidden = true
    e.meTimer.textContent = 'timer unavailable'
    e.meStatus.setAttribute('data-status-value', 'Busy')
    e.scan()
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    assert.equal(e.window.__itsCallAssist.inspect().unavailable, true)
    e.meStatus.setAttribute('data-status-value', 'Available')
    e.scan()
    e.meStatus.setAttribute('data-status-value', 'Busy')
    e.scan()
    assert.equal(e.window.__itsCallAssist.statistics().total, 2)
  }
)
check('An unreadable interval does not fabricate a Busy exit or count the same call twice', () => {
  const e = environment()
  e.setMe('Busy', 0)
  e.header.hidden = true
  e.scan()
  e.scan()
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  assert(e.window.__itsCallAssist.statistics().hadGaps)
  e.header.hidden = false
  e.setMe('Busy', 8)
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  assert(e.ui().querySelector('.statistics-note').textContent.includes('inaccuracies'))
})
check('A Busy timer reset alone is not counted as another call', () => {
  const e = environment()
  e.setMe('Busy', 120)
  e.setMe('Busy', 125)
  e.setMe('Busy', 0)
  e.setMe('Wrap Up', 0)
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
})
check(
  'Rerunning the prototype keeps daily statistics without duplicating an ongoing Busy period',
  () => {
    const e = environment()
    e.setMe('Busy', 0)
    e.rerun()
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    e.setMe('Busy', 5)
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    e.setMe('Available', 0)
    e.setMe('Busy', 0)
    assert.equal(e.window.__itsCallAssist.statistics().total, 2)
  }
)
check('Daily rollover uses Brisbane midnight and does not count an ongoing call again', () => {
  const e = environment()
  e.setTime(Date.parse('2026-10-12T13:59:50Z'))
  e.setMe('Busy', 0)
  assert.equal(e.window.__itsCallAssist.statistics().day, '2026-10-12')
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  e.setTime(Date.parse('2026-10-12T14:00:01Z'))
  e.setMe('Busy', 12)
  assert.equal(e.window.__itsCallAssist.statistics().day, '2026-10-13')
  assert.equal(e.window.__itsCallAssist.statistics().total, 0)
  e.setMe('Available', 0)
  e.setMe('Busy', 0)
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
})
check(
  'ITS queues are built in, start without stored configuration and have no queue editor',
  () => {
    const e = environment()
    e.storage.delete('service-desk-8x8-inbound-queues-v1')
    e.rerun()
    assert(!e.ui().querySelector('.main-view').classList.contains('hidden'))
    const inputs = e
      .ui()
      .querySelectorAll('input')
      .filter((n) => (n.getAttribute('aria-label') || '').startsWith('Inbound queue '))
    assert.equal(inputs.length, 0)
    assert(!e.ui().textContent.includes('Inbound Queue Names'))
    assert.equal(e.storage.has('service-desk-8x8-inbound-queues-v1'), false)
    assert.deepEqual(
      Array.from(e.window.__itsCallAssist.inspect().queues, (q) => q.name),
      ['ITS Academic Hotline', 'ITS Internal TRNFR', 'ITS Service Desk']
    )
    assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
  }
)
check(
  'Old queue preferences and bootstrap globals cannot redirect the three fixed ITS queues',
  () => {
    const e = environment({ g1: ['Alex Agent'] })
    e.storage.set(
      'service-desk-8x8-inbound-queues-v1',
      JSON.stringify(['ITS Outbound', 'Other Queue', 'Old Queue'])
    )
    e.window.__serviceDesk8x8Queues = ['ITS Outbound', 'Other Queue', 'Old Queue']
    e.rerun()
    e.other('Alex Agent', 'Busy', 200)
    e.setMe('Work Offline', 200)
    e.waiting(10, 400, 2)
    e.scan()
    assert.equal(
      e.window.__itsCallAssist.inspect().queues.reduce((total, q) => total + q.waiting, 0),
      0
    )
    assert.equal(e.debug().activeReminder, null)
    coveragePulse(e, 200, 201)
    coveragePulse(e, 201, 202)
    assert.equal(
      e.window.__itsCallAssist.inspect().queues.reduce((total, q) => total + q.waiting, 0),
      1
    )
    assert.equal(e.debug().activeReminder.kind, 'critical')
  }
)

check('Captured break page stays visible with only its status bar and no queue information', () => {
  const e = environment()
  e.showBreak(421)
  assert.equal(e.window.__itsCallAssist.inspect().me.seconds, 421)
  assert.equal(e.window.__itsCallAssist.inspect().view, 'break')
  assert(!e.ui().querySelector('.compact-view').classList.contains('hidden'))
  for (const cls of ['.main-view', '.sound-settings', '.assistant-settings', '.data-warning']) {
    assert(e.ui().querySelector(cls).classList.contains('hidden'))
  }
  assert.equal(e.ui().querySelector('.compact-elapsed').textContent, '7 min elapsed')
  assert.equal(e.ui().querySelector('.compact-countdown').textContent, '23 min left')
  assert.equal(e.ui().querySelector('.progress-track').getAttribute('aria-valuenow'), '7.02')
  assert.equal(e.ui().querySelector('.progress-track').getAttribute('aria-valuemax'), '30')
  assert(
    !e.ui().querySelector('.progress-track').getAttribute('aria-valuetext').includes('seconds')
  )
  assert.equal(e.notifications.length, 0)
})
check(
  'Hidden break page uses native elapsed time, alerts strictly after lunch, then restores main',
  () => {
    const e = environment({ g1: ['Me'], lunchSeconds: 60 })
    e.showBreak(59)
    e.breakTime(60)
    assert.equal(e.debug().activeReminder, null)
    e.breakTime(61)
    assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
    assert.equal(e.ui().querySelector('.compact-countdown').textContent, '<0.1 min overdue')
    e.breakTime(65)
    assert.equal(e.notifications.length, 1)
    e.restoreMain()
    assert.equal(e.debug().activeReminder, null)
    assert.equal(e.window.__itsCallAssist.inspect().view, 'main')
    assert(e.ui().querySelector('.compact-view').classList.contains('hidden'))
    assert(!e.ui().querySelector('.main-view').classList.contains('hidden'))
  }
)
check('Break timer supports hours and keeps working without saved queue names', () => {
  const e = environment({ g1: ['Me'], lunchSeconds: 7200 })
  e.showBreak(7199)
  e.storage.delete('service-desk-8x8-inbound-queues-v1')
  e.rerun()
  assert.equal(e.window.__itsCallAssist.inspect().view, 'break')
  e.breakTime(7200)
  assert.equal(e.window.__itsCallAssist.inspect().me.seconds, 7200)
  assert.equal(e.debug().activeReminder, null)
  e.breakTime(7201)
  assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
})
check('G2 gets lunch and disposition reminders on compact pages without G1 queue checks', () => {
  const e = environment({ g1: ['Alex Agent'], lunchMinutes: 1 })
  e.showBreak(60)
  e.breakTime(61)
  assert.equal(e.window.__itsCallAssist.inspect().view, 'break')
  assert(e.debug().playing.includes('lunchOverdue'))
  e.showWrapUp(120)
  e.wrapTime(100)
  assert.equal(e.window.__itsCallAssist.inspect().view, 'disposition')
  assert.equal(e.notifications.length, 2)
  assert(e.debug().playing.includes('disposition'))
})
check(
  'Unreadable or ambiguous break timers stop reminders instead of inventing elapsed time',
  () => {
    const e = environment({ g1: ['Me'], lunchSeconds: 5 })
    e.showBreak(6)
    e.breakTime(7)
    const timer = e.personalPage().querySelector('[data-test-id="on-break-timer"]')
    timer.textContent = '01:99'
    e.scan()
    assert.equal(e.debug().activeReminder, null)
    assert.equal(e.window.__itsCallAssist.inspect().unavailable, true)
    timer.textContent = '00:08'
    e.scan()
    const duplicate = e.window.document.createElement('div')
    duplicate.setAttribute('data-test-id', 'on-break-timer')
    duplicate.textContent = '00:08'
    e.personalPage().append(duplicate)
    e.scan()
    assert.equal(e.window.__itsCallAssist.inspect().unavailable, true)
  }
)
check(
  'Captured wrap-up countdown measures disposition time, ignoring the completed call timer',
  () => {
    const e = environment()
    e.showWrapUp(111)
    assert.equal(e.window.__itsCallAssist.inspect().me.seconds, 0)
    assert.equal(e.ui().querySelector('.compact-countdown').textContent, '10s left')
    e.wrapTime(102)
    assert.equal(e.window.__itsCallAssist.inspect().me.seconds, 9)
    assert.equal(e.debug().activeReminder, null)
    e.wrapTime(101)
    assert.equal(e.ui().querySelector('.compact-countdown').textContent, '0s left')
    assert.equal(e.debug().activeReminder, null)
    e.wrapTime(100)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
    assert.equal(e.ui().querySelector('.compact-countdown').textContent, '1s overdue')
    e.restoreMain()
    assert.equal(e.debug().activeReminder, null)
    assert(!e.ui().querySelector('.main-view').classList.contains('hidden'))
  }
)
check(
  'Disposition elapsed time survives rerunning and does not rewind when 8x8 extends its timer',
  () => {
    const e = environment()
    e.showWrapUp(111)
    e.wrapTime(100)
    assert.equal(e.window.__itsCallAssist.inspect().me.seconds, 11)
    e.wrapTime(105)
    assert.equal(e.window.__itsCallAssist.inspect().me.seconds, 11)
    e.rerun()
    assert(e.window.__itsCallAssist.inspect().me.seconds >= 11)
    e.wrapTime(99)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
    e.restoreMain('Busy', 1)
    e.showWrapUp(111)
    assert.equal(e.window.__itsCallAssist.inspect().me.seconds, 0)
  }
)
check('A disposition tab during an active call does not imply the call is in wrap-up', () => {
  const e = environment()
  e.setMe('Busy', 5)
  const tab = e.window.document.createElement('button')
  tab.setAttribute('data-test-id', 'disposition-tab_TAB')
  tab.setAttribute('aria-selected', 'true')
  tab.textContent = 'Disposition'
  e.window.document.body.append(tab)
  e.scan()
  assert.equal(e.window.__itsCallAssist.inspect().view, 'main')
  assert.equal(e.debug().activeReminder, null)
})
check(
  'A finished native countdown does not silence a disposition reminder while Wrap up remains open',
  () => {
    const e = environment()
    e.showWrapUp(5)
    e.wrapTime(0)
    e.advance(11000)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
    e.advance(31000)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
    assert(e.debug().playing.includes('disposition'))
    e.restoreMain()
    assert.equal(e.debug().activeReminder, null)
  }
)
check(
  'Switching from a known disposition status to its dedicated page preserves elapsed time',
  () => {
    const e = environment()
    e.setMe('Wrap Up', 11)
    e.showWrapUp(100)
    assert(e.window.__itsCallAssist.inspect().me.seconds >= 11)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
  }
)
check(
  'Call statistics recognise hidden wrap-up and break status without adding false calls',
  () => {
    const e = environment()
    e.setMe('Busy', 0)
    e.showWrapUp(111)
    e.wrapTime(110)
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    assert.equal(e.window.__itsCallAssist.statistics().hadGaps, false)
    e.restoreMain('Busy', 0)
    assert.equal(e.window.__itsCallAssist.statistics().total, 2)
    e.showBreak(60)
    e.breakTime(61)
    assert.equal(e.window.__itsCallAssist.statistics().total, 2)
  }
)
check('Monitoring combines inbound callers into one total and timestamps the whole update', () => {
  const e = environment()
  e.waiting(3)
  for (const [index, value] of [
    [0, 2],
    [1, 4],
    [2, 50]
  ]) {
    e.queues[index].cell.textContent = String(value)
    e.queues[index].cell.setAttribute('title', `${value} Interactions waiting`)
  }
  e.setMe('Available', 5)
  assert.equal(e.ui().querySelector('.queue-total').textContent, '9')
  const monitor = e.ui().querySelector('.monitoring-summary').textContent
  assert(!monitor.includes('Demo'))
  assert(!monitor.includes('MONITORING'))
  assert(!monitor.includes('Checked'))
  assert(e.ui().querySelector('.last-updated').textContent.startsWith('Last updated'))
  assert(!e.ui().querySelector('time').textContent.includes('—'))
})

check(
  'Confirmed absent rows disappear while saved G1 membership returns with a fresh sign-in row',
  () => {
    const e = environment({ g1: ['Alex Agent'], lunchMinutes: 30 })
    const original = e.checkbox('Alex Agent')
    e.logout('Alex Agent')
    e.scan()
    e.scan()
    assert.equal(e.checkbox('Alex Agent'), null)
    assert(e.window.__itsCallAssist.inspect().selected.includes('Alex Agent'))
    assert(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1.includes('Alex Agent'))
    assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
    e.login('Alex Agent', 'Busy', 3)
    e.scan()
    const fresh = e.checkbox('Alex Agent')
    assert(fresh)
    assert.notEqual(fresh, original)
    assert.equal(fresh.checked, true)
  }
)
check('Removing the last online agents leaves only Me and still allows selecting Me', () => {
  const e = environment({ g1: ['Alex Agent', 'Casey Agent'] })
  e.logout('Alex Agent')
  e.logout('Casey Agent')
  e.scan()
  e.scan()
  assert.equal(e.ui().querySelector('tbody').querySelectorAll('tr').length, 1)
  assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
  e.tick('Me', true)
  assert.equal(e.window.__itsCallAssist.inspect().mode, 'covering')
})
check('A saved selection for an already signed-out agent cannot block the main assistant', () => {
  const e = environment({ g1: ['Former Agent'] })
  assert.equal(e.checkbox('Former Agent'), null)
  assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
  assert.deepEqual(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1, [
    'Former Agent'
  ])
})
check('Hidden roster, break and disposition pages do not erase saved G1 members', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'] })
  e.group.hidden = true
  e.scan()
  assert(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1.includes('Alex Agent'))
  e.group.hidden = false
  e.scan()
  e.showBreak(30)
  e.showWrapUp(111)
  e.restoreMain()
  assert(e.checkbox('Alex Agent').checked)
  assert(e.window.__itsCallAssist.inspect().selected.includes('Alex Agent'))
})
check('New agents appear immediately and Me stays first with the same row styling', () => {
  const e = environment()
  e.login('AAA Agent')
  e.scan()
  const rows = e.ui().querySelector('tbody').querySelectorAll('tr')
  assert.equal(rows[0].querySelector('td').textContent, 'Me')
  assert(e.checkbox('AAA Agent'))
  assert.equal(rows[0].className, rows[1].className)
  assert.equal(e.ui().querySelector('.author').textContent, 'Author: Joshua Lavagna-Slater')
})
check('Version 1.0.2 settings migrate to minute lunches and one caller waiting delay', () => {
  const e = environment(
    { g1: ['Me'], lunchSeconds: 2700, coverSeconds: 360, callSeconds: 240, dispositionSeconds: 10 },
    {},
    { rawPreferences: true }
  )
  const sample = e.window.__itsCallAssist.inspect()
  assert.equal(sample.lunchMinutes, 45)
  assert.equal(sample.waitingAlertSeconds, 360)
  assert.equal(sample.dispositionSeconds, 20)
  const saved = JSON.parse(e.storage.get('service-desk-8x8-preferences-v5'))
  assert.equal(saved.lunchMinutes, 45)
  assert.equal(saved.lunchSeconds, undefined)
  assert.equal(saved.callSeconds, undefined)
  assert.equal(saved.coverSeconds, undefined)
  assert.equal(saved.settingsVersion, 3)
  e.rerun()
  assert.equal(e.window.__itsCallAssist.inspect().lunchMinutes, 45)
  assert.equal(e.window.__itsCallAssist.inspect().waitingAlertSeconds, 360)
})
check(
  'Disposition defaults to 20 seconds and a newly chosen 10-second value stays unchanged',
  () => {
    const e = environment({ g1: ['Me'] }, {}, { rawPreferences: true })
    assert.equal(e.window.__itsCallAssist.inspect().dispositionSeconds, 20)
    e.setMe('Wrap Up', 20)
    assert.equal(e.debug().activeReminder, null)
    e.setMe('Wrap Up', 21)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
    const delay = e.ui().querySelector('#its-disposition-seconds')
    delay.value = '10'
    delay.onchange()
    e.rerun()
    assert.equal(e.window.__itsCallAssist.inspect().dispositionSeconds, 10)
  }
)
check('Minute lunch input and slider agree, while delay settings and sound choices persist', () => {
  const e = environment(
    {
      g1: ['Me'],
      lunchMinutes: 45,
      dispositionSeconds: 15,
      waitingAlertSeconds: 360,
      desktopNotifications: false
    },
    { critical: { preset: 'Soft bell', volume: 32, seconds: 4, repeat: false } }
  )
  const exact = e.ui().querySelector('#its-my-lunch-exact-minutes')
  exact.value = '1'
  exact.onchange()
  assert.equal(e.ui().querySelector('#its-my-lunch-minutes').value, '1')
  e.lunch(20)
  assert.equal(exact.value, '20')
  e.setMe('On Break', 1200)
  assert.equal(e.debug().activeReminder, null)
  e.setMe('On Break', 1201)
  assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
  const delay = e.ui().querySelector('#its-waiting-alert-seconds')
  delay.value = '7'
  delay.onchange()
  const saved = JSON.parse(e.storage.get('service-desk-8x8-preferences-v5'))
  assert.equal(saved.waitingAlertSeconds, 7)
  assert.equal(saved.lunchMinutes, 20)
  assert.equal(saved.dispositionSeconds, 15)
  const card = e
    .ui()
    .querySelectorAll('fieldset')
    .find((n) => n.querySelector('legend').textContent === 'Alert: Change Status To Available')
  assert.equal(card.querySelector('select').value, 'Soft bell')
  assert(card.querySelector('.sound-description').textContent.includes('at least 7 seconds'))
  assert(!e.ui().querySelector('#its-call-seconds'))
  assert(!e.ui().querySelector('#its-cover-seconds'))
  assert(
    !e
      .ui()
      .querySelectorAll('fieldset')
      .some((n) => n.querySelector('legend').textContent === 'Info: Caller Waiting')
  )
})
check(
  'One cover alert uses an inclusive caller wait boundary and accepts mixed unavailable G1 states',
  () => {
    const context = environment().window.__itsCallAssist
    const agents = [
      { name: 'A', status: 'Busy', seconds: 1 },
      { name: 'B', status: 'On Break', seconds: 300 },
      { name: 'C', status: 'Working Offline', seconds: 2 }
    ]
    const queues = [
      { waiting: 1, waitSeconds: 59 },
      { waiting: 0, waitSeconds: 0 },
      { waiting: 0, waitSeconds: 0 }
    ]
    const me = { status: 'Work Offline' }
    assert.equal(context.groupRules(agents, queues, me, 60).critical, false)
    queues[0].waitSeconds = 60
    assert.equal(context.groupRules(agents, queues, me, 60).critical, true)
    agents[2].status = 'Available'
    assert.equal(context.groupRules(agents, queues, me, 60).critical, false)
    agents[2].status = 'Wrap Up'
    assert.equal(context.groupRules(agents, queues, me, 60).critical, true)
    me.status = 'Available'
    assert.equal(context.groupRules(agents, queues, me, 60).critical, false)
    me.status = 'Work Offline'
    assert.equal(context.groupRules([], queues, me, 60).critical, false)
    queues[0].waitSeconds = null
    assert.equal(context.groupRules(agents, queues, me, 60).critical, false)
  }
)
function coveragePulse (e, age, tick = 1) {
  e.other('Alex Agent', 'Busy', tick)
  e.waiting(1, age)
  e.setMe('Work Offline', tick)
}
check(
  'Live coverage repeats only after a caller reaches the delay, regardless of short Busy time',
  () => {
    const e = environment({ g1: ['Alex Agent'], waitingAlertSeconds: 60 })
    coveragePulse(e, 58, 1)
    coveragePulse(e, 59, 2)
    assert.equal(e.notifications.length, 0)
    assert.equal(e.debug().playing.length, 0)
    coveragePulse(e, 60, 3)
    assert.equal(e.debug().activeReminder.kind, 'critical')
    assert(e.debug().playing.includes('critical'))
    coveragePulse(e, 61, 4)
    assert.equal(e.notifications.length, 1)
    e.other('Alex Agent', 'Available', 0)
    e.setMe('Work Offline', 5)
    assert.equal(e.debug().activeReminder, null)
    coveragePulse(e, 62, 6)
    coveragePulse(e, 63, 7)
    assert.equal(e.debug().activeReminder.kind, 'critical')
    e.setMe('Available', 0)
    assert.equal(e.debug().activeReminder, null)
  }
)
check('Nobody being Available is not enough without a caller waiting for the required time', () => {
  const e = environment({ g1: ['Alex Agent'], waitingAlertSeconds: 60 })
  e.other('Alex Agent', 'Working Offline', 1)
  e.setMe('Work Offline', 1)
  e.other('Alex Agent', 'Working Offline', 2)
  e.setMe('Work Offline', 2)
  assert.equal(e.debug().activeReminder, null)
  assert.equal(e.notifications.length, 0)
})
check('Ending or replacing the oldest waiting call stops the coverage sound', () => {
  const e = environment({ g1: ['Alex Agent'], waitingAlertSeconds: 60 })
  coveragePulse(e, 60, 1)
  coveragePulse(e, 61, 2)
  assert.equal(e.debug().activeReminder.kind, 'critical')
  coveragePulse(e, 2, 3)
  assert.equal(e.debug().activeReminder, null)
  coveragePulse(e, 60, 4)
  assert.equal(e.debug().activeReminder.kind, 'critical')
  e.waiting(0)
  e.setMe('Work Offline', 5)
  assert.equal(e.debug().activeReminder, null)
})
check('Unavailable longest-wait data does not produce a fabricated caller delay', () => {
  const e = environment({ g1: ['Alex Agent'], waitingAlertSeconds: 60 })
  coveragePulse(e, 60, 1)
  coveragePulse(e, 61, 2)
  e.queues[3].wait.textContent = 'unreadable'
  e.queues[3].wait.setAttribute('title', 'unknown Longest waiting time')
  e.setMe('Work Offline', 3)
  assert.equal(e.debug().activeReminder, null)
  assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
  assert(e.ui().querySelector('.monitoring-state').textContent.includes('caller time'))
})
check('Outbound waits and unselected G2 agents cannot control the coverage alert', () => {
  const e = environment({ g1: ['Alex Agent'], waitingAlertSeconds: 60 })
  e.waiting(10, 900, 2)
  e.other('Alex Agent', 'Busy', 1)
  e.setMe('Work Offline', 1)
  e.other('Alex Agent', 'Busy', 2)
  e.setMe('Work Offline', 2)
  assert.equal(e.debug().activeReminder, null)
  e.queues[2].row.hidden = true
  coveragePulse(e, 60, 3)
  coveragePulse(e, 61, 4)
  assert.equal(e.debug().activeReminder.kind, 'critical')
  assert.equal(e.window.__itsCallAssist.inspect().queues.length, 3)
  assert.equal(e.ui().querySelector('.queue-total').textContent, '1')
})
check('G1 users on a call do not receive a phone-cover alert', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 1 })
  e.other('Alex Agent', 'Busy', 1)
  e.waiting(3, 300)
  e.setMe('Busy', 1)
  e.other('Alex Agent', 'Busy', 2)
  e.waiting(3, 301)
  e.setMe('Busy', 2)
  assert.equal(e.notifications.length, 0)
  assert.equal(e.debug().activeReminder, null)
})
check(
  'G1 Working Offline requires a caller strictly beyond the delay and no other G1 member Available',
  () => {
    const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 60 })
    coveragePulse(e, 59, 1)
    coveragePulse(e, 60, 2)
    assert.equal(e.debug().activeReminder, null)
    coveragePulse(e, 61, 3)
    assert.equal(e.debug().activeReminder.kind, 'critical')
    assert(e.debug().playing.includes('critical'))
    const reason = e.ui().querySelector('.reminder-reason').textContent
    assert(reason.includes('"Work Offline" in G1'))
    assert(reason.includes('No other signed-in G1 member is "Available"'))
    assert(reason.includes('longer than 60 seconds'))
    assert.equal(e.notifications.length, 1)
    e.other('Alex Agent', 'Available', 0)
    e.waiting(1, 62)
    e.setMe('Work Offline', 4)
    assert.equal(e.debug().activeReminder, null)
    assert(!e.debug().playing.includes('critical'))
    coveragePulse(e, 63, 5)
    assert.equal(e.debug().activeReminder.kind, 'critical')
    e.waiting(1, 60)
    e.setMe('Work Offline', 6)
    assert.equal(e.debug().activeReminder, null)
  }
)
check(
  'G1 Other Work is permitted even with an overdue caller and all other phone agents Busy',
  () => {
    const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 5 })
    for (const status of ['Other Work', 'Available', 'Busy']) {
      for (const tick of [1, 2]) {
        e.other('Alex Agent', 'Busy', tick)
        e.waiting(2, 900 + tick)
        e.setMe(status, tick)
        assert.equal(e.debug().activeReminder, null)
        assert.equal(e.notifications.length, 0)
      }
    }
  }
)
check(
  'The only signed-in G1 member gets a Working Offline queue reminder, but unselected Available agents do not cover G1',
  () => {
    const e = environment({ g1: ['Me'], waitingAlertSeconds: 5 })
    e.waiting(1, 6)
    e.setMe('Working Offline', 1)
    e.waiting(1, 7)
    e.setMe('Working Offline', 2)
    assert.equal(e.debug().activeReminder.kind, 'critical')
    assert(
      e.ui().querySelector('.reminder-reason').textContent.includes('only signed-in G1 member')
    )
    e.setMe('Other Work', 3)
    assert.equal(e.debug().activeReminder, null)
    e.waiting(0)
    e.setMe('Working Offline', 4)
    assert.equal(e.debug().activeReminder, null)
  }
)
check(
  'G1 queue cover accepts other non-Available G1 states and removes signed-out members from the decision',
  () => {
    for (const status of ['On Break', 'Working Offline', 'Other Work', 'Wrap Up']) {
      const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 5 })
      for (const tick of [1, 2]) {
        e.other('Alex Agent', status, tick)
        e.waiting(1, 6 + tick)
        e.setMe('Working Offline', tick)
      }
      assert.equal(e.debug().activeReminder.kind, 'critical')
      e.logout('Alex Agent')
      e.waiting(1, 9)
      e.setMe('Working Offline', 3)
      e.waiting(1, 10)
      e.setMe('Working Offline', 4)
      assert.equal(e.debug().activeReminder.kind, 'critical')
      assert(!e.checkbox('Alex Agent'))
    }
  }
)
const monitoringState = (e) => e.ui().querySelector('.monitoring-state').textContent
check(
  'A complete readable first snapshot reports Live without waiting for every G1 timer to change',
  () => {
    for (const g1 of [['Me'], ['Alex Agent', 'Casey Agent'], []]) {
      const e = environment({ g1 })
      assert.equal(monitoringState(e), 'Live')
      assert.equal(e.debug().activeReminder, null)
      assert.equal(e.notifications.length, 0)
    }
  }
)
check('An unchanged G1 timer cannot make readable queue monitoring flicker', () => {
  const e = environment({ g1: ['Alex Agent', 'Casey Agent'] })
  for (const tick of [1, 2]) {
    e.other('Alex Agent', 'Available', tick)
    e.other('Casey Agent', 'Available', tick)
    e.setMe('Available', tick)
  }
  for (let tick = 3; tick <= 30; tick++) {
    e.other('Alex Agent', 'Available', tick)
    e.setMe('Available', tick)
    assert.equal(monitoringState(e), 'Live')
  }
})
check('Menus, mute, timing edits and G1 edits do not reset a healthy monitoring indicator', () => {
  const e = environment({ g1: ['Alex Agent'] })
  e.other('Alex Agent', 'Available', 1)
  e.setMe('Available', 1)
  e.other('Alex Agent', 'Available', 2)
  e.setMe('Available', 2)
  e.button('Settings').onclick()
  e.scan()
  assert.equal(monitoringState(e), 'Live')
  e.button('Open Sound Settings').onclick()
  e.scan()
  assert.equal(monitoringState(e), 'Live')
  e.ui().querySelector('.sound-settings').querySelector('button').onclick()
  const delay = e.ui().querySelector('#its-waiting-alert-seconds')
  delay.value = '120'
  delay.onchange()
  assert.equal(monitoringState(e), 'Live')
  e.ui().querySelector('.assistant-settings').querySelector('button').onclick()
  e.tick('Casey Agent', true)
  assert.equal(monitoringState(e), 'Live')
  e.button('Mute').onclick()
  assert.equal(monitoringState(e), 'Live')
  e.button('Unmute').onclick()
  assert.equal(monitoringState(e), 'Live')
  e.tick('Alex Agent', false)
  e.tick('Casey Agent', false)
  assert.equal(monitoringState(e), 'Live')
})
check('Unchanged queue counts stay Live because quiet queues do not imply a failed reader', () => {
  const e = environment({ g1: ['Alex Agent'] })
  e.other('Alex Agent', 'Available', 1)
  e.setMe('Available', 1)
  e.advance(31000)
  assert.equal(monitoringState(e), 'Live')
  e.button('Settings').onclick()
  e.scan()
  e.tick('Casey Agent', true)
  e.ui().querySelector('#its-waiting-alert-seconds').onchange()
  e.scan()
  assert.equal(monitoringState(e), 'Live')
  e.waiting(2, 30)
  e.scan()
  e.advance(3600000)
  assert.equal(monitoringState(e), 'Live')
  assert.equal(e.ui().querySelector('.queue-total').textContent, '2')
  assert.equal(e.debug().activeReminder, null)
  e.setMe('Available', 32)
  assert.equal(monitoringState(e), 'Live')
})
check('Minute/hour-only agent clocks never expire queue monitoring', () => {
  const e = environment({ g1: ['Alex Agent'] })
  e.meTimer.textContent = '5m'
  e.agents['Alex Agent'].timer.textContent = '1h 2m'
  e.agents['Casey Agent'].timer.textContent = '3h'
  e.scan()
  e.advance(30000)
  assert.equal(monitoringState(e), 'Live')
  e.advance(31000)
  assert.equal(monitoringState(e), 'Live')
  e.meTimer.textContent = '6m'
  e.scan()
  e.advance(61000)
  assert.equal(monitoringState(e), 'Live')
  e.advance(60000)
  assert.equal(monitoringState(e), 'Live')
  e.meTimer.textContent = '7m'
  e.scan()
  assert.equal(monitoringState(e), 'Live')
})
check(
  'Timer formatting, status casing and roster order do not affect the queue reader status',
  () => {
    const e = environment({ g1: ['Alex Agent'] })
    e.setMe('Available', 1)
    e.advance(31000)
    assert.equal(monitoringState(e), 'Live')
    e.meTimer.textContent = '1 second'
    e.meStatus.setAttribute('data-status-value', ' available ')
    e.group.append(e.agents['Alex Agent'].row)
    e.scan()
    assert.equal(monitoringState(e), 'Live')
  }
)
check(
  'Unknown waiting ages and missing queues retain their specific messages and recover on readable data',
  () => {
    const e = environment()
    e.waiting(1, 60)
    e.queues[3].wait.textContent = 'unknown'
    e.scan()
    assert.equal(monitoringState(e), 'Waiting for caller time')
    e.waiting(1, 61)
    e.scan()
    assert.equal(monitoringState(e), 'Live')
    e.queues[0].row.hidden = true
    e.scan()
    assert(monitoringState(e).includes('Queue data unavailable'))
    e.queues[0].row.hidden = false
    e.scan()
    assert.equal(monitoringState(e), 'Live')
    e.header.hidden = true
    e.scan()
    assert(e.window.__itsCallAssist.inspect().unavailable)
    e.header.hidden = false
    e.scan()
    assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
    assert.equal(monitoringState(e), 'Live')
  }
)
check(
  'Offline monitoring keeps its connection message and recovers from a complete readable snapshot',
  () => {
    const e = environment()
    e.window.navigator.onLine = false
    e.scan()
    assert.equal(monitoringState(e), 'Waiting for connection')
    e.button('Settings').onclick()
    e.scan()
    assert.equal(monitoringState(e), 'Waiting for connection')
    e.window.navigator.onLine = true
    e.scan()
    assert.equal(monitoringState(e), 'Live')
  }
)
check(
  'A Live badge never permits a cover alert from a stale caller age while other clocks update',
  () => {
    const e = environment({ g1: ['Alex Agent'], waitingAlertSeconds: 5 })
    coveragePulse(e, 6, 1)
    coveragePulse(e, 7, 2)
    assert.equal(e.debug().activeReminder.kind, 'critical')
    for (let tick = 3; tick <= 20; tick++) {
      e.other('Alex Agent', 'Busy', tick)
      e.setMe('Work Offline', tick)
      assert.equal(monitoringState(e), 'Live')
    }
    assert.equal(e.debug().activeReminder, null)
    assert.equal(e.notifications.length, 1)
  }
)
check(
  'A Live badge never bypasses a stale G1 status when the own clock and caller age keep updating',
  () => {
    const e = environment({ g1: ['Alex Agent'], waitingAlertSeconds: 5 })
    coveragePulse(e, 6, 1)
    coveragePulse(e, 7, 2)
    assert.equal(e.debug().activeReminder.kind, 'critical')
    for (let tick = 3; tick <= 20; tick++) {
      e.waiting(1, tick + 5)
      e.setMe('Work Offline', tick)
      assert.equal(monitoringState(e), 'Live')
    }
    assert.equal(e.debug().activeReminder, null)
    assert.equal(e.notifications.length, 1)
  }
)
check('A long polling gap does not force readable queues to wait for an agent-clock update', () => {
  const e = environment({ g1: ['Alex Agent'] })
  e.setMe('Available', 1)
  e.setTime(170000)
  e.scan()
  assert.equal(monitoringState(e), 'Live')
  assert.equal(e.debug().activeReminder, null)
})
check(
  'Monitoring follows count changes in exactly the three ITS queues and excludes outbound numbers',
  () => {
    const e = environment({ g1: [] })
    e.waiting(2, 30, 0)
    e.waiting(3, 45, 1)
    e.waiting(4, 60, 3)
    e.waiting(99, 999, 2)
    e.scan()
    assert.equal(e.ui().querySelector('.queue-total').textContent, '9')
    assert.equal(monitoringState(e), 'Live')
    e.waiting(0, 0, 0)
    e.waiting(0, 0, 1)
    e.waiting(1, 65, 3)
    e.scan()
    assert.equal(e.ui().querySelector('.queue-total').textContent, '1')
    assert.equal(monitoringState(e), 'Live')
    e.waiting(0, 0, 3)
    e.scan()
    assert.equal(e.ui().querySelector('.queue-total').textContent, '0')
    assert.equal(monitoringState(e), 'Live')
  }
)
check('G1 caller alerts stop when native queue times become unreadable or stale', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 5 })
  coveragePulse(e, 6, 1)
  coveragePulse(e, 7, 2)
  assert.equal(e.debug().activeReminder.kind, 'critical')
  e.queues[3].wait.textContent = 'unreadable'
  e.setMe('Working Offline', 3)
  assert.equal(e.debug().activeReminder, null)
  coveragePulse(e, 9, 4)
  coveragePulse(e, 10, 5)
  assert.equal(e.debug().activeReminder.kind, 'critical')
  e.advance(31000)
  assert.equal(e.debug().activeReminder, null)
})
check(
  'Each sound has its own notification checkbox, defaults on, and preserves existing audio preferences',
  () => {
    const e = environment(
      {},
      { critical: { preset: 'Soft bell', volume: 32, seconds: 4, repeat: false } }
    )
    for (const kind of ['lunch', 'critical', 'disposition', 'lunchOverdue']) {
      const toggle = e.ui().querySelector(`#its-sound-${kind}-desktop-notification`)
      assert(toggle.checked)
      assert.equal(toggle.parentElement.textContent, 'Send desktop notification')
    }
    const cfg = JSON.parse(e.storage.get('service-desk-8x8-sounds-v4')).critical
    assert.deepEqual(cfg, {
      preset: 'Soft bell',
      volume: 32,
      seconds: 4,
      repeat: false,
      desktopNotification: true
    })
  }
)
check(
  'Per-sound notification opt-outs suppress popups while every type keeps its tone and visible reason',
  () => {
    const cases = [
      [
        'lunch',
        { g1: ['Alex Agent'] },
        (e) => {
          e.setMe('Available', 1)
          e.other('Alex Agent', 'On Break', 1)
          e.setMe('Available', 2)
        }
      ],
      [
        'critical',
        { g1: ['Me'], waitingAlertSeconds: 5 },
        (e) => {
          e.waiting(1, 6)
          e.setMe('Working Offline', 1)
          e.waiting(1, 7)
          e.setMe('Working Offline', 2)
        }
      ],
      ['disposition', { g1: ['Me'] }, (e) => e.setMe('Wrap Up', 11)],
      ['lunchOverdue', { g1: ['Me'], lunchMinutes: 1 }, (e) => e.setMe('On Break', 61)]
    ]
    for (const [kind, prefs, trigger] of cases) {
      const e = environment(prefs, { [kind]: { desktopNotification: false } })
      trigger(e)
      assert.equal(e.notifications.length, 0)
      assert(e.debug().playing.includes(kind))
      const card = e.ui().querySelector('.current-reminders').querySelector(`[data-kind="${kind}"]`)
      assert(card)
      assert(card.querySelector('.reminder-reason').textContent.length > 20)
      assert.equal(card.querySelector('.reminder-state').textContent, 'Sound playing')
      assert(!e.ui().querySelector('.current-reminders').classList.contains('hidden'))
    }
  }
)
check(
  'Changing one notification checkbox closes only its popup and keeps audio, other preferences and persistence intact',
  () => {
    const e = environment()
    e.setMe('Wrap Up', 11)
    const notice = e.notifications.at(-1)
    const toggle = e.ui().querySelector('#its-sound-disposition-desktop-notification')
    toggle.checked = false
    toggle.onchange()
    assert(notice.closed)
    assert(e.debug().playing.includes('disposition'))
    const card = toggle.closest('fieldset')
    const volume = card.querySelector('[type="range"]')
    volume.value = '24'
    volume.oninput()
    const saved = JSON.parse(e.storage.get('service-desk-8x8-sounds-v4'))
    assert.equal(saved.disposition.desktopNotification, false)
    assert.equal(saved.disposition.volume, 24)
    assert.equal(saved.critical.desktopNotification, true)
    toggle.checked = true
    toggle.onchange()
    assert.equal(e.notifications.length, 2)
    assert(e.debug().playing.includes('disposition'))
    toggle.checked = false
    toggle.onchange()
    e.rerun()
    assert(!e.ui().querySelector('#its-sound-disposition-desktop-notification').checked)
  }
)
check('The global notification toggle remains the master control for all per-sound choices', () => {
  const e = environment({ g1: ['Me'], desktopNotifications: false })
  e.setMe('Wrap Up', 11)
  const toggle = e.ui().querySelector('#its-sound-disposition-desktop-notification')
  toggle.checked = true
  toggle.onchange()
  assert.equal(e.notifications.length, 0)
  assert(e.debug().playing.includes('disposition'))
  assert(e.ui().querySelector('.reminder-reason').textContent.includes('Wrap up'))
})
check('Active reminders sit above footer details and survive minimising or opening menus', () => {
  const e = environment({ g1: ['Alex Agent'], waitingAlertSeconds: 5 })
  coveragePulse(e, 6, 1)
  coveragePulse(e, 7, 2)
  const banner = e.ui().querySelector('.current-reminders')
  const bottom = banner.parentElement
  assert(bottom.classList.contains('assistant-bottom'))
  assert(bottom.children.indexOf(banner) < bottom.children.indexOf(e.ui().querySelector('.footer')))
  assert(banner.textContent.includes('"Work Offline" in G2'))
  assert(banner.textContent.includes('at least 5 seconds'))
  e.button('-').onclick()
  assert(!bottom.classList.contains('hidden'))
  assert(!banner.classList.contains('hidden'))
  e.button('Settings').onclick()
  assert(!banner.classList.contains('hidden'))
  e.setMe('Available', 0)
  assert(banner.classList.contains('hidden'))
  assert.equal(banner.querySelectorAll('.current-reminder').length, 0)
})
check(
  'Lunch and disposition alerts show their reasons beside compact progress and remain clear when muted',
  () => {
    const e = environment({ g1: ['Me'], lunchMinutes: 1 })
    e.showBreak(60)
    e.breakTime(61)
    const banner = e.ui().querySelector('.current-reminders')
    assert(!banner.classList.contains('hidden'))
    assert(!banner.parentElement.classList.contains('hidden'))
    assert(e.ui().querySelector('.footer').classList.contains('hidden'))
    assert(banner.textContent.includes('longer than your 1-minute lunch break'))
    e.ui().querySelector('.compact-actions').querySelector('button').onclick()
    assert(banner.textContent.includes('Sound muted'))
    e.restoreMain()
    assert(banner.classList.contains('hidden'))
    e.showWrapUp(240)
    e.wrapTime(229)
    assert(banner.textContent.includes('more than 10 seconds'))
    assert(banner.textContent.includes('Complete the fields and click Wrap up'))
  }
)
check(
  'Sound previews have a separate reason card without a popup or hiding the active alert',
  () => {
    const e = environment()
    e.setMe('Wrap Up', 11)
    const count = e.notifications.length
    e.ui()
      .querySelector('fieldset')
      .querySelectorAll('button')
      .find((b) => b.textContent === 'Preview')
      .onclick()
    const banner = e.ui().querySelector('.current-reminders')
    assert.equal(banner.querySelectorAll('.current-reminder').length, 2)
    const preview = banner.querySelector('[data-kind="preview"]')
    assert(preview.textContent.includes('Testing your selected "Gentle chime"'))
    assert.equal(e.notifications.length, count)
    e.button('Stop preview').onclick()
    assert.equal(banner.querySelectorAll('.current-reminder').length, 1)
    assert(e.debug().playing.includes('disposition'))
  }
)
check(
  'Finite information cards accurately show when the sound has ended and clear when the break ends',
  () => {
    const e = environment({ g1: ['Alex Agent'] })
    e.other('Alex Agent', 'On Break', 1)
    e.setMe('Available', 1)
    e.other('Alex Agent', 'On Break', 2)
    e.setMe('Available', 2)
    const banner = e.ui().querySelector('.current-reminders')
    assert(banner.textContent.includes('Alex Agent (G1) is "On Break"'))
    for (const { fn, ms } of [...e.jobs.values()]) if (ms === 2000) fn()
    assert(banner.textContent.includes('Sound finished'))
    assert(!e.debug().playing.includes('lunch'))
    e.other('Alex Agent', 'Available', 0)
    e.setMe('Available', 3)
    assert(banner.classList.contains('hidden'))
  }
)
check(
  'Settings omit the internal sound introduction, duplicate lunch value and bounds, and use the requested descriptions',
  () => {
    const e = environment()
    assert(!e.ui().querySelector('.sound-intro'))
    assert(!e.ui().querySelector('.lunch-value'))
    assert(!e.ui().querySelector('.lunch-limits'))
    const queues = e.ui().querySelector('#its-waiting-alert-seconds').closest('.settings-card')
    assert.equal(
      queues.querySelector('.settings-description').textContent,
      'How long a caller must be waiting before the "Change Status to Available" sound plays. Only used when you are in G2, are not available, and every signed-in G1 member is busy.'
    )
    const text = e.ui().querySelector('.assistant-settings').textContent
    assert(!text.includes('Inbound Queue Names'))
    assert(!text.includes('These names are stored only in this browser'))
    assert(!text.includes('Do not include an outbound queue'))
  }
)
check(
  'G2 personal reminders retain strict configured boundaries without any selected G1 agents',
  () => {
    const e = environment({ g1: [], lunchMinutes: 1, dispositionSeconds: 20 })
    e.showBreak(59)
    e.breakTime(60)
    assert.equal(e.debug().activeReminder, null)
    e.breakTime(61)
    assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
    e.showWrapUp(120)
    e.wrapTime(100)
    assert.equal(e.debug().activeReminder, null)
    e.wrapTime(99)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
    assert.equal(e.window.__itsCallAssist.inspect().mode, 'assisting')
  }
)
check('G2 lunch and disposition alerts work even when no queue configuration is available', () => {
  const e = environment({ g1: [], lunchMinutes: 1 })
  e.showBreak(60)
  e.storage.delete('service-desk-8x8-inbound-queues-v1')
  e.rerun()
  e.breakTime(61)
  assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
  e.showWrapUp(120)
  e.wrapTime(109)
  assert.equal(e.debug().activeReminder.kind, 'disposition')
  assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
})
check(
  'Changing either personal group keeps the current reminder and does not send another popup',
  () => {
    const e = environment({ g1: ['Me', 'Alex Agent'] })
    e.setMe('Wrap Up', 11)
    const count = e.notifications.length
    e.tick('Me', false)
    e.tick('Alex Agent', false)
    e.tick('Me', true)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
    assert(e.debug().playing.includes('disposition'))
    assert.equal(e.notifications.length, count)
  }
)
check('G2 personal sounds respect individual desktop notification opt-outs', () => {
  const e = environment(
    { g1: [], lunchMinutes: 1 },
    { lunchOverdue: { desktopNotification: false }, disposition: { desktopNotification: false } }
  )
  e.showBreak(60)
  e.breakTime(61)
  assert(e.debug().playing.includes('lunchOverdue'))
  e.showWrapUp(120)
  e.wrapTime(109)
  assert(e.debug().playing.includes('disposition'))
  assert.equal(e.notifications.length, 0)
  assert(e.ui().querySelector('.current-reminders').textContent.includes('Complete Disposition'))
})
check('Personal sound and timing descriptions explicitly apply in both G1 and G2', () => {
  const e = environment({ g1: [] })
  for (const kind of ['disposition', 'lunchOverdue']) {
    const card = e.ui().querySelector(`#its-sound-${kind}-desktop-notification`).closest('fieldset')
    assert(
      card.querySelector('.sound-description').textContent.includes('G1 or G2') ||
        card.querySelector('.sound-description').textContent.includes('in G1 and G2')
    )
    assert(!card.querySelector('.sound-description').textContent.includes('ticked "Me"'))
  }
  const lunch = e.ui().querySelector('.lunch-settings')
  assert(lunch.textContent.includes('Used in both G1 and G2'))
  assert(
    e
      .ui()
      .querySelector('#its-disposition-seconds')
      .closest('.settings-card')
      .textContent.includes('Used in both G1 and G2')
  )
})
check(
  'Temporary row replacement restores its checkbox without ever changing saved membership',
  () => {
    const e = environment({ g1: ['Alex Agent', 'Casey Agent'] })
    e.logout('Alex Agent')
    e.scan()
    assert(e.checkbox('Alex Agent').checked)
    assert(e.checkbox('Alex Agent').disabled)
    e.login('Alex Agent', 'Available', 3)
    e.scan()
    assert(e.checkbox('Alex Agent').checked)
    assert(!e.checkbox('Alex Agent').disabled)
    assert.deepEqual(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1, [
      'Alex Agent',
      'Casey Agent'
    ])
  }
)
check(
  'Filtering or virtual scrolling cannot erase G1 choices or make missing coverage look Available',
  () => {
    const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 5 })
    e.group.setAttribute('style', 'padding-top: 32px; padding-bottom: 64px;')
    e.agents['Alex Agent'].row.hidden = true
    for (const tick of [1, 2, 3]) {
      e.waiting(1, 20 + tick)
      e.setMe('Working Offline', tick)
    }
    assert.equal(e.debug().activeReminder, null)
    assert.equal(e.notifications.length, 0)
    assert(e.window.__itsCallAssist.inspect().unavailable)
    assert.deepEqual(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1, [
      'Me',
      'Alex Agent'
    ])
    e.group.setAttribute('style', 'padding-top: 0px; padding-bottom: 0px;')
    e.agents['Alex Agent'].row.hidden = false
    e.scan()
    assert(e.checkbox('Alex Agent').checked)
    assert(!e.window.__itsCallAssist.inspect().unavailable)
  }
)
check(
  'A nonzero Virtuoso row index also prevents treating offscreen G1 agents as signed out',
  () => {
    const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 5 })
    e.agents['Alex Agent'].row.hidden = true
    e.agents['Casey Agent'].row.setAttribute('data-item-index', '1')
    e.waiting(1, 20)
    e.setMe('Working Offline', 1)
    e.waiting(1, 21)
    e.setMe('Working Offline', 2)
    assert.equal(e.debug().activeReminder, null)
    assert(e.window.__itsCallAssist.inspect().unavailable)
    assert(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1.includes('Alex Agent'))
  }
)
check(
  'Saved membership survives a full table refresh and rerunning while the selected agent is absent',
  () => {
    const e = environment({ g1: ['Alex Agent'] })
    e.logout('Alex Agent')
    e.scan()
    e.scan()
    e.rerun()
    assert.deepEqual(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1, [
      'Alex Agent'
    ])
    assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
    e.login('Alex Agent', 'Available', 1)
    e.scan()
    assert(e.checkbox('Alex Agent').checked)
  }
)
check('Changing another checkbox does not discard an absent previously selected agent', () => {
  const e = environment({ g1: ['Alex Agent'] })
  e.logout('Alex Agent')
  e.scan()
  e.scan()
  e.tick('Casey Agent', true)
  assert.deepEqual(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1, [
    'Alex Agent',
    'Casey Agent'
  ])
  e.login('Alex Agent')
  e.scan()
  assert(e.checkbox('Alex Agent').checked)
  assert(e.checkbox('Casey Agent').checked)
})
check(
  'Only explicit unticking clears a saved G1 role and keeps it cleared on a later table refresh',
  () => {
    const e = environment({ g1: ['Alex Agent'] })
    e.tick('Alex Agent', false)
    e.logout('Alex Agent')
    e.scan()
    e.scan()
    e.login('Alex Agent')
    e.scan()
    assert(!e.checkbox('Alex Agent').checked)
    e.rerun()
    assert(!e.checkbox('Alex Agent').checked)
    assert.deepEqual(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1, [])
  }
)
check(
  'Mute stops all tones and previews while updates, counters and notifications continue',
  () => {
    const e = environment()
    e.setMe('Wrap Up', 11)
    assert(e.debug().playing.includes('disposition'))
    e.button('Mute').onclick()
    assert(e.debug().muted)
    assert.equal(e.debug().playing.length, 0)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
    assert(
      e
        .ui()
        .querySelectorAll('button')
        .filter((b) => b.textContent === 'Preview')
        .every((b) => b.disabled)
    )
    e.setMe('Available', 1)
    e.setMe('Wrap Up', 11)
    assert.equal(e.debug().activeReminder.kind, 'disposition')
    assert(e.notifications.at(-1).options.silent)
    const stamp = e.ui().querySelector('.last-updated').textContent
    e.setMe('Busy', 0)
    e.waiting(4)
    e.other('Alex Agent', 'Busy', 400)
    e.setMe('Busy', 4)
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    assert.equal(e.ui().querySelector('.queue-total').textContent, '4')
    assert.notEqual(e.ui().querySelector('.last-updated').textContent, stamp)
    assert.equal(e.window.__itsCallAssist.inspect().me.timer, '4s')
    assert.equal(e.debug().playing.length, 0)
  }
)
check(
  'Unmute resumes the current alert without duplicating its notification and mute persists on rerun',
  () => {
    const e = environment()
    e.setMe('Wrap Up', 11)
    e.button('Mute').onclick()
    const count = e.notifications.length
    e.button('Unmute').onclick()
    assert(e.debug().playing.includes('disposition'))
    assert.equal(e.notifications.length, count)
    e.button('Mute').onclick()
    e.rerun()
    assert(e.debug().muted)
    assert.equal(e.debug().playing.length, 0)
    assert.deepEqual(
      e
        .ui()
        .querySelector('.controls')
        .querySelectorAll('button')
        .map((b) => b.getAttribute('aria-label') || b.textContent),
      ['Call Notes', 'Unmute', 'Settings']
    )
  }
)
check(
  'Compact break time and progress continue while muted and can be unmuted from the bar',
  () => {
    const e = environment({ g1: ['Me'], lunchMinutes: 1 })
    e.showBreak(20)
    e.ui().querySelector('.compact-actions').querySelector('button').onclick()
    const width = e.ui().querySelector('.progress-fill').style.width
    e.breakTime(70)
    assert.equal(e.ui().querySelector('.compact-elapsed').textContent, '1.2 min elapsed')
    assert.notEqual(e.ui().querySelector('.progress-fill').style.width, width)
    assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
    assert.equal(e.debug().playing.length, 0)
    assert(e.notifications.at(-1).options.silent)
    e.ui().querySelector('.compact-actions').querySelector('button').onclick()
    assert(e.debug().playing.includes('lunchOverdue'))
  }
)
check('Last-hour statistics expire while muted, rather than freezing', () => {
  const e = environment()
  e.setMe('Busy', 0)
  e.setMe('Available', 0)
  e.button('Mute').onclick()
  e.advance(3601000)
  assert.equal(
    e.ui().querySelector('.statistics').querySelectorAll('.stat-value')[1].textContent,
    '0'
  )
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
})
check(
  'Unmute also resumes a customised repeating break information sound without another popup',
  () => {
    const e = environment({ g1: ['Alex Agent'] }, { lunch: { repeat: true } })
    e.other('Alex Agent', 'On Break', 1)
    e.setMe('Available', 1)
    assert(e.debug().playing.includes('lunch'))
    const count = e.notifications.length
    e.button('Mute').onclick()
    e.button('Unmute').onclick()
    assert(e.debug().playing.includes('lunch'))
    assert.equal(e.notifications.length, count)
  }
)

const asyncChecks = []
function asyncCheck (name, fn) {
  asyncChecks.push({ name, fn })
}
asyncCheck(
  'Desktop notification test sends a popup without an alert sound or false delivery claim',
  async () => {
    const e = environment()
    e.button('Settings').onclick()
    await e.button('Test desktop notification').onclick()
    assert.equal(e.notifications.length, 1)
    assert.equal(e.notifications[0].title, '8x8 Assistant: Test Notification')
    assert.equal(e.debug().playing.length, 0)
    assert.equal(e.debug().activeReminder, null)
    assert(
      e.ui().querySelector('.notification-feedback').textContent.includes('If no popup appeared')
    )
  }
)
asyncCheck(
  'Notification permissions require the documented manual Edge allow-list steps',
  async () => {
    const e = environment()
    const instructions = e.ui().querySelector('.notification-instructions').textContent
    for (const text of [
      'Privacy, search and services',
      'All permissions',
      'Allowed to send notifications',
      'Add site',
      'https://vcc-au2.8x8.com'
    ]) {
      assert(instructions.includes(text))
    }
    let requests = 0
    e.window.Notification.requestPermission = async () => {
      requests++
      return 'granted'
    }
    for (const permission of ['default', 'denied']) {
      e.window.Notification.permission = permission
      await e.button('Test desktop notification').onclick()
      assert.equal(e.notifications.length, 0)
      assert(e.ui().querySelector('.notification-feedback').textContent.includes('Edge settings'))
    }
    assert.equal(requests, 0)
  }
)
asyncCheck(
  'Muted notification tests still work quietly and disabled, unsupported or failed tests report correctly',
  async () => {
    const muted = environment({ g1: ['Me'], muted: true })
    await muted.button('Test desktop notification').onclick()
    assert.equal(muted.notifications.length, 1)
    assert(muted.notifications[0].options.silent)
    assert.equal(muted.debug().playing.length, 0)
    const off = environment({ g1: ['Me'], desktopNotifications: false })
    assert(off.button('Test desktop notification').disabled)
    await off.button('Test desktop notification').onclick()
    assert.equal(off.notifications.length, 0)
    const missing = environment()
    delete missing.window.Notification
    await missing.button('Test desktop notification').onclick()
    assert(
      missing.ui().querySelector('.notification-feedback').textContent.includes('not supported')
    )
    const failed = environment()
    failed.window.Notification = class {
      static permission = 'granted'
      constructor () {
        throw Error('Blocked')
      }
    }
    await failed.button('Test desktop notification').onclick()
    assert(
      failed.ui().querySelector('.notification-feedback').textContent.includes('could not be sent')
    )
  }
)
asyncCheck(
  'Output controls are in Sound Settings, input is removed, and routing affects only assistant audio',
  async () => {
    const e = environment()
    await e.button('Refresh devices').onclick()
    const input = e.ui().querySelector('[aria-label="Assistant input device"]')
    const output = e.ui().querySelector('[aria-label="Assistant output device"]')
    assert.equal(input, null)
    assert(!e.ui().textContent.includes('Input Device'))
    assert(output.closest('.sound-settings'))
    assert(!output.closest('.assistant-settings'))
    assert.equal(output.querySelector('option').textContent, 'Desk Speakers (Default)')
    const phoneAudio = new e.window.AudioContext()
    output.value = 'headset'
    await output.onchange()
    assert.equal(e.debug().audioOutput, 'headset')
    assert.equal(phoneAudio.sinkId, '')
    assert.equal(phoneAudio.state, 'running')
    assert.equal(
      JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).outputDeviceId,
      'headset'
    )
    assert.equal(e.microphoneRequests(), 0)
    output.value = ''
    await output.onchange()
    assert.equal(e.debug().audioOutput, '')
  }
)
asyncCheck(
  'A saved assistant output restores on rerun and a removed device falls back to Default',
  async () => {
    const e = environment()
    await e.button('Refresh devices').onclick()
    const output = e.ui().querySelector('[aria-label="Assistant output device"]')
    output.value = 'headset'
    await output.onchange()
    e.rerun()
    await e.button('Refresh devices').onclick()
    assert.equal(e.debug().audioOutput, 'headset')
    e.devices.splice(
      e.devices.findIndex((d) => d.deviceId === 'headset'),
      1
    )
    e.deviceChanged()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(e.debug().audioOutput, '')
    assert.equal(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).outputDeviceId, '')
    e.button('x').onclick()
    assert.equal(e.deviceListeners.size, 0)
  }
)
asyncCheck(
  'Permission failure keeps the previous output and unsupported browsers retain a usable Default',
  async () => {
    const e = environment({}, {}, { rejectOutput: 'headset' })
    await e.button('Refresh devices').onclick()
    const output = e.ui().querySelector('[aria-label="Assistant output device"]')
    output.value = 'headset'
    await output.onchange()
    assert.equal(e.debug().audioOutput, '')
    assert.equal(output.value, '')
    const old = environment(
      { g1: ['Me'], outputDeviceId: 'headset' },
      {},
      { noOutputSelection: true }
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert(old.ui().querySelector('[aria-label="Assistant output device"]').disabled)
    assert.equal(old.debug().audioOutput, '')
    old.setMe('Wrap Up', 11)
    assert(old.debug().playing.includes('disposition'))
    assert.equal(old.microphoneRequests(), 0)
  }
)
asyncCheck(
  'Browser output picker and unavailable device listing handle permissions without microphone capture',
  async () => {
    const e = environment({}, {}, { outputPicker: true })
    await e.button('Choose output device').onclick()
    assert.equal(e.debug().audioOutput, 'headset')
    assert.equal(e.microphoneRequests(), 0)
    const failed = environment({}, {}, { enumerationFails: true })
    await failed.button('Refresh devices').onclick()
    assert.equal(failed.debug().audioOutput, '')
    assert(failed.ui().textContent.includes('Could not list audio devices'))
  }
)
asyncCheck('Output routing works while muted without starting a tone', async () => {
  const e = environment({ g1: ['Me'], muted: true })
  await e.button('Refresh devices').onclick()
  const output = e.ui().querySelector('[aria-label="Assistant output device"]')
  output.value = 'headset'
  await output.onchange()
  e.setMe('Wrap Up', 11)
  assert.equal(e.debug().playing.length, 0)
  e.button('Unmute').onclick()
  assert(e.debug().playing.includes('disposition'))
  assert.equal(e.debug().audioOutput, 'headset')
})
asyncCheck(
  'Closing during an output switch prevents a late preference write or sound restart',
  async () => {
    let finish
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const e = environment({}, {}, { beforeSink: () => pending })
    await e.button('Refresh devices').onclick()
    const output = e.ui().querySelector('[aria-label="Assistant output device"]')
    output.value = 'headset'
    const changing = output.onchange()
    await Promise.resolve()
    e.button('x').onclick()
    finish()
    await changing
    assert.equal(e.window.__itsCallAssist, undefined)
    assert.equal(e.jobs.size, 0)
    assert.equal(e.deviceListeners.size, 0)
    assert.equal(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).outputDeviceId, '')
  }
)
function ringerControls (e) {
  return {
    primary: e.ui().querySelector('[aria-label="Assistant output device"]'),
    toggle: e.ui().querySelector('#its-secondary-ringer'),
    secondary: e.ui().querySelector('[aria-label="Assistant secondary ringer device"]')
  }
}
async function configureRinger (e, primaryId = 'headset', secondaryId = 'speakers') {
  await e.button('Refresh devices').onclick()
  const controls = ringerControls(e)
  controls.primary.value = primaryId
  await controls.primary.onchange()
  controls.toggle.checked = true
  await controls.toggle.onchange()
  controls.secondary.value = secondaryId
  await controls.secondary.onchange()
  return controls
}
function assertStopped (context) {
  // Scheduled end times alone do not prove an immediate mute; stop() without a time must be present.
  for (const note of context.notes) {
    assert(note.stops.includes(undefined))
    assert(note.disconnected)
    assert(note.gain.disconnected)
  }
}
asyncCheck(
  'Secondary Ringer defaults off, reveals its own selector when enabled and lists outputs only',
  async () => {
    const e = environment()
    await e.button('Refresh devices').onclick()
    const { toggle, secondary } = ringerControls(e)
    assert(toggle.closest('.audio-devices').closest('.sound-settings'))
    assert.equal(toggle.checked, false)
    assert(secondary.closest('.secondary-options').classList.contains('hidden'))
    assert(secondary.disabled)
    assert.equal(e.audioContexts.length, 1)
    toggle.checked = true
    await toggle.onchange()
    assert(!secondary.closest('.secondary-options').classList.contains('hidden'))
    assert(!secondary.disabled)
    assert.equal(secondary.querySelector('option').textContent, 'Desk Speakers (Default)')
    assert.equal(secondary.querySelectorAll('option').length, 3)
    assert(!secondary.textContent.includes('Microphone'))
    assert.equal(e.microphoneRequests(), 0)
  }
)
asyncCheck(
  'Alerts duplicate their exact pattern and volume using each output clock without touching 8x8 audio',
  async () => {
    const e = environment({ g1: ['Me'] }, { disposition: { volume: 63 } })
    const phoneAudio = new e.window.AudioContext()
    await configureRinger(e)
    const primary = e.audioContexts[0]
    const secondary = e.audioContexts[2]
    primary.currentTime = 50
    secondary.currentTime = 123
    e.setMe('Wrap Up', 11)
    assert(primary.notes.length > 0)
    assert.equal(primary.notes.length, secondary.notes.length)
    // Compare relative times, rather than assuming the two independent audio clocks are equal.
    const pattern = (context) =>
      context.notes.map((n) => ({
        frequency: n.frequency.value,
        wave: n.type,
        offset: Number((n.startTime - context.currentTime).toFixed(4)),
        peak: n.gain.values[1].value
      }))
    assert.deepEqual(pattern(primary), pattern(secondary))
    assert.equal(primary.notes[0].gain.values[1].value, (0.3 * 63) / 100)
    for (const context of [primary, secondary]) {
      assert(context.gains.every((gain) => gain.destination === context.destination))
    }
    assert.equal(phoneAudio.sinkId, '')
    assert.equal(phoneAudio.notes.length, 0)
    assert.equal(phoneAudio.state, 'running')
    assert.equal(e.notifications.length, 1)
    e.window.__itsCallAssist.destroy()
    assert.equal(phoneAudio.state, 'running')
    assert.equal(primary.state, 'closed')
    assert.equal(secondary.state, 'closed')
  }
)
asyncCheck(
  'Selecting the same output twice, including its Default alias, plays each tone only once',
  async () => {
    for (const [primaryId, secondaryId] of [
      ['headset', 'headset'],
      ['', ''],
      ['', 'speakers'],
      ['speakers', '']
    ]) {
      const e = environment()
      await configureRinger(e, primaryId, secondaryId)
      e.setMe('Wrap Up', 11)
      assert(e.audioContexts[0].notes.length > 0)
      assert.equal(e.audioContexts[1].notes.length, 0)
      assert(e.ui().querySelector('.secondary-feedback').textContent.includes('Sounds play once'))
    }
  }
)
asyncCheck('A Communications alias for the primary headset cannot double its volume', async () => {
  const e = environment()
  e.devices.push({
    kind: 'audiooutput',
    deviceId: 'communications',
    label: 'Communications - Support Headset',
    groupId: 'support-headset'
  })
  await configureRinger(e, 'headset', 'communications')
  e.setMe('Wrap Up', 11)
  assert(e.audioContexts[0].notes.length > 0)
  assert.equal(e.audioContexts[1].notes.length, 0)
  assert(e.ui().querySelector('.secondary-feedback').textContent.includes('Sounds play once'))
})
asyncCheck(
  'Repeating alarms reach both outputs; Mute and a cleared condition stop all scheduled notes',
  async () => {
    const e = environment()
    await configureRinger(e)
    e.setMe('Wrap Up', 11)
    const [primary, secondary] = e.audioContexts
    const cycle = [...e.jobs.values()].find(({ ms }) => Math.round(ms) === 900)
    const firstCount = primary.notes.length
    cycle.fn()
    assert.equal(primary.notes.length, firstCount * 2)
    assert.equal(secondary.notes.length, firstCount * 2)
    e.button('Mute').onclick()
    assertStopped(primary)
    assertStopped(secondary)
    assert.equal(e.debug().playing.length, 0)
    const popups = e.notifications.length
    e.button('Unmute').onclick()
    assert(e.debug().playing.includes('disposition'))
    assert.equal(e.notifications.length, popups)
    e.setMe('Available', 0)
    assertStopped(primary)
    assertStopped(secondary)
    assert.equal(e.debug().playing.length, 0)
  }
)
asyncCheck(
  'Enabling the ringer during a finite preview preserves its original deadline and primary notes',
  async () => {
    const e = environment({ secondaryDeviceId: 'headset' })
    await e.button('Refresh devices').onclick()
    e.ui()
      .querySelector('fieldset')
      .querySelectorAll('button')
      .find((b) => b.textContent === 'Preview')
      .onclick()
    const deadline = [...e.jobs.entries()].find(([, job]) => job.ms === 2000)
    const primary = e.audioContexts[0]
    const originalCount = primary.notes.length
    e.advance(1000)
    const { toggle } = ringerControls(e)
    toggle.checked = true
    await toggle.onchange()
    assert.equal(primary.notes.length, originalCount)
    assert(primary.notes.every((n) => !n.disconnected))
    assert(e.audioContexts[1].notes.length > 0)
    assert.equal(e.jobs.get(deadline[0]), deadline[1])
    deadline[1].fn()
    assertStopped(primary)
    assertStopped(e.audioContexts[1])
    assert(!e.debug().playing.includes('preview'))
    assert.equal(e.notifications.length, 0)
  }
)
asyncCheck(
  'Turning the ringer off closes only its context and preserves its choice when turned on again',
  async () => {
    const e = environment()
    const controls = await configureRinger(e)
    e.setMe('Wrap Up', 11)
    const [primary, oldSecondary] = e.audioContexts
    const originalCount = primary.notes.length
    const originalJobs = [...e.jobs.keys()]
    controls.toggle.checked = false
    await controls.toggle.onchange()
    assert.equal(oldSecondary.state, 'closed')
    assertStopped(oldSecondary)
    assert.equal(primary.state, 'running')
    assert.equal(primary.notes.length, originalCount)
    assert(primary.notes.every((n) => !n.disconnected))
    assert.deepEqual([...e.jobs.keys()], originalJobs)
    assert.equal(
      JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).secondaryDeviceId,
      'speakers'
    )
    controls.toggle.checked = true
    await controls.toggle.onchange()
    assert.equal(e.audioContexts[2].sinkId, 'speakers')
    assert(e.audioContexts[2].notes.length > 0)
    assert.equal(primary.notes.length, originalCount)
    assert.equal(e.notifications.length, 1)
  }
)
asyncCheck(
  'Saved secondary-ringer preferences survive reruns and both old contexts are closed',
  async () => {
    const e = environment({
      g1: ['Me'],
      outputDeviceId: 'headset',
      secondaryRingerEnabled: true,
      secondaryDeviceId: 'speakers'
    })
    await e.button('Refresh devices').onclick()
    assert.equal(e.debug().audioOutput, 'headset')
    assert.equal(e.debug().secondaryOutput, 'speakers')
    const previous = [...e.audioContexts]
    e.rerun()
    await e.button('Refresh devices').onclick()
    assert(previous.every((context) => context.state === 'closed'))
    assert(ringerControls(e).toggle.checked)
    assert.equal(ringerControls(e).secondary.value, 'speakers')
    assert.equal(e.debug().secondaryOutput, 'speakers')
    e.setMe('Wrap Up', 11)
    assert(e.audioContexts.slice(-2).every((context) => context.notes.length > 0))
  }
)
asyncCheck(
  'A denied secondary switch keeps both previous outputs and does not restart the primary alert',
  async () => {
    let secondContext = null
    const e = environment(
      { g1: ['Me'] },
      {},
      { rejectSink: (id, context) => id === 'headset' && context === secondContext }
    )
    const { secondary } = await configureRinger(e)
    secondContext = e.audioContexts[1]
    e.setMe('Wrap Up', 11)
    const primaryCount = e.audioContexts[0].notes.length
    secondary.value = 'headset'
    assert.equal(await secondary.onchange(), false)
    assert.equal(e.debug().audioOutput, 'headset')
    assert.equal(e.debug().secondaryOutput, 'speakers')
    assert.equal(secondary.value, 'speakers')
    assert.equal(e.audioContexts[0].notes.length, primaryCount)
    assert(e.ui().querySelector('.secondary-feedback').textContent.includes('Could not use'))
    assert(e.debug().playing.includes('disposition'))
    assert.equal(e.notifications.length, 1)
  }
)
asyncCheck(
  'An unplugged secondary device falls back to Default without switching the primary or doubling a matching output',
  async () => {
    const e = environment()
    await configureRinger(e)
    e.setMe('Wrap Up', 11)
    const secondContext = e.audioContexts[1]
    const primaryCount = e.audioContexts[0].notes.length
    e.devices.splice(
      e.devices.findIndex((d) => d.deviceId === 'speakers'),
      1
    )
    e.devices[0].label = 'Default - Support Headset'
    e.devices[0].groupId = 'support-headset'
    e.deviceChanged()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(e.debug().audioOutput, 'headset')
    assert.equal(e.debug().secondaryOutput, '')
    assert.equal(ringerControls(e).secondary.value, '')
    assert.equal(e.audioContexts[0].notes.length, primaryCount)
    assertStopped(secondContext)
    assert.equal(e.microphoneRequests(), 0)
  }
)
asyncCheck(
  'An unsupported browser disables Secondary Ringer and still plays reminders on Default',
  async () => {
    const e = environment(
      { g1: ['Me'], secondaryRingerEnabled: true, secondaryDeviceId: 'headset' },
      {},
      { noOutputSelection: true }
    )
    await e.button('Refresh devices').onclick()
    const { toggle, secondary } = ringerControls(e)
    assert(toggle.disabled)
    assert.equal(toggle.checked, false)
    assert(secondary.closest('.secondary-options').classList.contains('hidden'))
    assert.equal(e.audioContexts.length, 1)
    e.setMe('Wrap Up', 11)
    assert(e.audioContexts[0].notes.length > 0)
    assert(e.ui().querySelector('.secondary-feedback').textContent.includes('unavailable'))
  }
)
asyncCheck(
  'Configuring both outputs while muted never starts tones; Unmute uses the selected pair',
  async () => {
    const e = environment({ g1: ['Me'], muted: true })
    await configureRinger(e)
    e.setMe('Wrap Up', 11)
    assert(e.audioContexts.every((context) => context.notes.length === 0))
    e.button('Unmute').onclick()
    assert(e.audioContexts.every((context) => context.notes.length > 0))
    assert.equal(e.debug().audioOutput, 'headset')
    assert.equal(e.debug().secondaryOutput, 'speakers')
  }
)
asyncCheck(
  'A saved enabled secondary ringer stays editable when the assistant starts muted',
  async () => {
    const e = environment({
      g1: ['Me'],
      muted: true,
      outputDeviceId: 'headset',
      secondaryRingerEnabled: true,
      secondaryDeviceId: 'speakers'
    })
    await e.button('Refresh devices').onclick()
    const { toggle, secondary } = ringerControls(e)
    assert(toggle.checked)
    assert.equal(secondary.disabled, false)
    assert.equal(e.audioContexts.length, 0)
    secondary.value = ''
    await secondary.onchange()
    assert.equal(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).secondaryDeviceId, '')
    e.setMe('Wrap Up', 11)
    assert(e.audioContexts.every((context) => context.notes.length === 0))
    e.button('Unmute').onclick()
    await e.button('Refresh devices').onclick()
    assert.equal(e.debug().audioOutput, 'headset')
    assert.equal(e.debug().secondaryOutput, '')
    assert(e.audioContexts.every((context) => context.notes.length > 0))
  }
)
asyncCheck(
  'Rapid secondary choices keep the latest selection while the primary alert continues',
  async () => {
    let block = false
    let finish
    let secondContext = null
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const e = environment(
      { g1: ['Me'] },
      {},
      { beforeSink: (id, context) => (block && context === secondContext ? pending : undefined) }
    )
    const { secondary } = await configureRinger(e)
    secondContext = e.audioContexts[1]
    e.setMe('Wrap Up', 11)
    block = true
    secondary.value = 'headset'
    const first = secondary.onchange()
    await Promise.resolve()
    secondary.value = ''
    const latest = secondary.onchange()
    const primaryCount = e.audioContexts[0].notes.length
    assert(e.debug().playing.includes('disposition'))
    assert.equal(e.debug().secondaryReady, false)
    const cycle = [...e.jobs.values()].find(({ ms }) => Math.round(ms) === 900)
    cycle.fn()
    assert(e.audioContexts[0].notes.length > primaryCount)
    finish()
    await Promise.all([first, latest])
    assert.equal(e.debug().secondaryOutput, '')
    assert.equal(secondary.value, '')
    assert.equal(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).secondaryDeviceId, '')
    assert.equal(e.debug().audioOutput, 'headset')
    assert.equal(e.notifications.length, 1)
  }
)
asyncCheck(
  'Switching Secondary Ringer off during a pending route prevents late writes or playback',
  async () => {
    let block = false
    let finish
    let secondContext = null
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const e = environment(
      { g1: ['Me'] },
      {},
      { beforeSink: (id, context) => (block && context === secondContext ? pending : undefined) }
    )
    const { toggle, secondary } = await configureRinger(e)
    secondContext = e.audioContexts[1]
    e.setMe('Wrap Up', 11)
    block = true
    secondary.value = 'headset'
    const changing = secondary.onchange()
    await Promise.resolve()
    toggle.checked = false
    await toggle.onchange()
    const saved = e.storage.get('service-desk-8x8-preferences-v5')
    const notes = secondContext.notes.length
    finish()
    await changing
    assert.equal(e.storage.get('service-desk-8x8-preferences-v5'), saved)
    assert.equal(secondContext.state, 'closed')
    assert.equal(secondContext.notes.length, notes)
    assert.equal(e.debug().secondaryEnabled, false)
    assert.equal(e.debug().audioOutput, 'headset')
    assert(e.debug().playing.includes('disposition'))
  }
)
asyncCheck(
  'Closing during a secondary switch stops both outputs and rejects late routing side effects',
  async () => {
    let block = false
    let finish
    let secondContext = null
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    const e = environment(
      { g1: ['Me'] },
      {},
      { beforeSink: (id, context) => (block && context === secondContext ? pending : undefined) }
    )
    const { secondary } = await configureRinger(e)
    secondContext = e.audioContexts[1]
    e.setMe('Wrap Up', 11)
    block = true
    secondary.value = 'headset'
    const changing = secondary.onchange()
    await Promise.resolve()
    const saved = e.storage.get('service-desk-8x8-preferences-v5')
    e.button('x').onclick()
    finish()
    await changing
    assert.equal(e.storage.get('service-desk-8x8-preferences-v5'), saved)
    assert(e.audioContexts.every((context) => context.state === 'closed'))
    e.audioContexts.forEach(assertStopped)
    assert.equal(e.window.__itsCallAssist, undefined)
    assert.equal(e.jobs.size, 0)
    assert.equal(e.deviceListeners.size, 0)
  }
)
asyncCheck(
  'The secondary output picker is isolated, and an outstanding picker cannot re-enable a disabled ringer',
  async () => {
    let finish
    let pending = false
    const picker = new Promise((resolve) => {
      finish = resolve
    })
    const e = environment(
      { g1: ['Me'] },
      {},
      {
        outputPicker: true,
        beforePicker: () =>
          pending ? picker : { kind: 'audiooutput', deviceId: 'headset', label: 'Support Headset' }
      }
    )
    const { toggle } = ringerControls(e)
    toggle.checked = true
    await toggle.onchange()
    await e.button('Choose secondary ringer device').onclick()
    assert.equal(e.debug().audioOutput, '')
    assert.equal(e.debug().secondaryOutput, 'headset')
    pending = true
    const choosing = e.button('Choose secondary ringer device').onclick()
    toggle.checked = false
    await toggle.onchange()
    finish({ kind: 'audiooutput', deviceId: 'speakers' })
    await choosing
    assert.equal(e.debug().secondaryEnabled, false)
    assert.equal(
      JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).secondaryDeviceId,
      'headset'
    )
    assert.equal(e.microphoneRequests(), 0)
  }
)
check(
  'Captured Short Break label selects a separate view and never triggers the lunch sound',
  () => {
    for (const g1 of [['Me'], []]) {
      const e = environment({ g1, lunchMinutes: 1 })
      e.showShortBreak(339)
      e.breakTime(340)
      assert.equal(e.window.__itsCallAssist.inspect().view, 'shortBreak')
      assert.equal(e.ui().querySelector('.compact-title').textContent, 'Short break')
      assert.equal(e.ui().querySelector('.short-today').textContent, '5 min')
      assert.equal(e.ui().querySelector('.short-current').textContent, '5 min')
      assert(e.ui().querySelector('.compact-countdown').classList.contains('hidden'))
      assert.equal(e.debug().activeReminder, null)
      assert.equal(e.notifications.length, 0)
      assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 340)
    }
  }
)
check(
  'Completed minutes accumulate across short breaks without losing their partial minutes',
  () => {
    const e = environment({ g1: [], lunchMinutes: 1 })
    e.showShortBreak(35)
    assert.equal(e.ui().querySelector('.short-today').textContent, '0 min')
    e.restoreMain()
    e.showShortBreak(30)
    assert.equal(e.ui().querySelector('.short-current').textContent, '0 min')
    assert.equal(e.ui().querySelector('.short-today').textContent, '1 min')
    assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 65)
    e.breakTime(85)
    assert.equal(e.ui().querySelector('.short-today').textContent, '2 min')
  }
)
check('An unchanged short-break clock cannot accumulate guessed wall time', () => {
  const e = environment()
  e.showShortBreak(60)
  e.advance(120000)
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 60)
  assert.equal(e.ui().querySelector('.short-today').textContent, '1 min')
  e.breakTime(120)
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 120)
})
check('Native short-break timer resets start a new measured break', () => {
  const e = environment()
  e.showShortBreak(75)
  e.breakTime(10)
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 85)
  assert.equal(e.ui().querySelector('.short-current').textContent, '0 min')
})
check('Short-break totals and the current clock survive reruns without double counting', () => {
  const e = environment()
  e.showShortBreak(65)
  e.rerun()
  e.rerun()
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 65)
  e.breakTime(125)
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 125)
  e.button('Mute').onclick()
  e.breakTime(185)
  assert.equal(e.ui().querySelector('.short-today').textContent, '3 min')
  assert.equal(e.debug().playing.length, 0)
})
check('Saved partial short-break minutes survive closing and a later run', () => {
  const e = environment({}, {}, { shortBreaks: { day: '1970-01-01', seconds: 35, active: null } })
  e.showShortBreak(30)
  assert.equal(e.ui().querySelector('.short-today').textContent, '1 min')
  e.button('x').onclick()
  const saved = JSON.parse(e.storage.get('service-desk-8x8-short-breaks-v1'))
  assert.equal(saved.seconds, 65)
  assert.equal(saved.active.elapsed, 30)
})
check(
  'Switching between Lunch and Short Break stops the correct reminder without mixing totals',
  () => {
    const e = environment({ g1: [], lunchMinutes: 1 })
    e.showBreak(61)
    e.breakTime(62)
    assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
    e.showShortBreak(75)
    assert.equal(e.debug().activeReminder, null)
    assert(!e.debug().playing.includes('lunchOverdue'))
    assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 75)
    e.showBreak(100)
    e.breakTime(101)
    assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
    assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 75)
  }
)
check('Missing, conflicting or ambiguous break reasons never assume Lunch', () => {
  for (const reason of ['', 'Other break', 'Short Break']) {
    const e = environment({ g1: [], lunchMinutes: 1 })
    e.showBreak(100, reason)
    if (reason === 'Short Break') {
      e.personalPage().querySelector('span[title]').textContent = 'Lunch'
    }
    e.breakTime(101)
    assert.equal(e.window.__itsCallAssist.inspect().view, 'otherBreak')
    assert.equal(e.debug().activeReminder, null)
    assert.equal(e.ui().querySelector('.compact-allowance').textContent, 'Lunch timer is not used')
  }
  const e = environment({ g1: [], lunchMinutes: 1 })
  e.showBreak(100)
  const duplicate = e.window.document.createElement('span')
  duplicate.setAttribute('title', 'Short Break')
  duplicate.textContent = 'Short Break'
  e.personalPage().append(duplicate)
  e.breakTime(101)
  assert.equal(e.window.__itsCallAssist.inspect().view, 'otherBreak')
  assert.equal(e.debug().activeReminder, null)
})
check('An unknown reason does not count uncertain time twice when Short Break returns', () => {
  const e = environment()
  e.showShortBreak(30)
  e.breakReason('')
  e.breakTime(50)
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 30)
  e.breakReason('Short Break')
  e.breakTime(60)
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 40)
})
check(
  'Hidden or invalid short-break clocks stop counting without inventing an elapsed interval',
  () => {
    const e = environment()
    e.showShortBreak(30)
    const timer = e.personalPage().querySelector('[data-test-id="on-break-timer"]')
    timer.textContent = 'timer unavailable'
    e.advance(120000)
    assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 30)
    assert.equal(e.debug().activeReminder, null)
    e.breakTime(45)
    assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 45)
  }
)
check('Brisbane midnight splits an ongoing Short Break and resets only the daily total', () => {
  const e = environment()
  e.setTime(Date.parse('2026-10-13T23:59:56+10:00'))
  e.showShortBreak(58)
  assert.equal(e.ui().querySelector('.short-today').textContent, '0 min')
  e.setTime(Date.parse('2026-10-14T00:00:01+10:00'))
  e.breakTime(63)
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().day, '2026-10-14')
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 3)
  e.setTime(Date.parse('2026-10-14T00:01:00+10:00'))
  e.breakTime(122)
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 62)
  assert.equal(e.ui().querySelector('.short-today').textContent, '1 min')
})
check('Starting after midnight counts only today from a break that began yesterday', () => {
  const e = environment()
  e.setTime(Date.parse('2026-10-14T00:00:03+10:00'))
  e.showShortBreak(600)
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 5)
})
check(
  'Short-break totals discard corrupt storage and old totals without losing a current break',
  () => {
    for (const saved of [
      null,
      { day: '1970-01-01', seconds: -60 },
      { day: '1969-12-31', seconds: 100 }
    ]) {
      const e = environment({}, {}, { shortBreaks: saved })
      e.showShortBreak(60)
      assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 60)
    }
  }
)
check('Short-break view works without queue settings and survives group changes', () => {
  const e = environment({ g1: [], lunchMinutes: 1 })
  e.showShortBreak(60)
  e.storage.delete('service-desk-8x8-inbound-queues-v1')
  e.rerun()
  e.tick('Me', true)
  e.tick('Me', false)
  e.breakTime(120)
  assert.equal(e.window.__itsCallAssist.inspect().view, 'shortBreak')
  assert.equal(e.ui().querySelector('.short-today').textContent, '2 min')
  assert.equal(e.debug().activeReminder, null)
})
check('Header break reasons also distinguish Short Break, Lunch and an unspecified break', () => {
  const e = environment({ g1: [], lunchMinutes: 1 })
  e.setMe('On Break', 100, 'Short Break')
  assert.equal(e.window.__itsCallAssist.inspect().view, 'shortBreak')
  assert.equal(e.window.__itsCallAssist.shortBreakStatistics().seconds, 100)
  e.setMe('On Break', 110, '')
  assert.equal(e.window.__itsCallAssist.inspect().view, 'otherBreak')
  assert.equal(e.debug().activeReminder, null)
  e.setMe('On Break', 120, 'Lunch')
  e.setMe('On Break', 121, 'Lunch')
  assert.equal(e.debug().activeReminder.kind, 'lunchOverdue')
})
check('Lunch displays and accessible progress stay in minutes at both timing boundaries', () => {
  const e = environment({ g1: [], lunchMinutes: 1 })
  e.showBreak(59)
  assert.equal(e.ui().querySelector('.compact-countdown').textContent, '<0.1 min left')
  assert.equal(e.ui().querySelector('.compact-allowance').textContent, '1 min allowance')
  e.breakTime(60)
  assert.equal(e.ui().querySelector('.compact-countdown').textContent, '0 min left')
  e.breakTime(61)
  assert.equal(e.ui().querySelector('.compact-countdown').textContent, '<0.1 min overdue')
  assert(
    !e.ui().querySelector('.progress-track').getAttribute('aria-valuetext').includes('seconds')
  )
  const card = e
    .ui()
    .querySelector('#its-sound-lunchOverdue-desktop-notification')
    .closest('fieldset')
  assert(card.textContent.includes('Never plays for "Short Break"'))
})
check(
  'Virtual queue scrolling keeps controls, roster updates and counters open with a labelled last-read total',
  () => {
    const e = environment()
    e.waiting(2, 10)
    e.scan()
    e.queues[3].row.remove()
    e.setMe('Busy', 0)
    const sample = e.window.__itsCallAssist.inspect()
    assert.equal(sample.unavailable, false)
    assert.equal(sample.queuesReadable, false)
    assert.equal(e.ui().querySelector('.queue-total').textContent, '2')
    assert.equal(
      e.ui().querySelector('.queue-count-label').textContent,
      'Last read callers waiting'
    )
    assert(e.ui().querySelector('.monitoring-state').textContent.includes('Scroll back'))
    assert(!e.ui().querySelector('.main-view').classList.contains('hidden'))
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    e.button('Settings').onclick()
    e.scan()
    assert(!e.ui().querySelector('.assistant-settings').classList.contains('hidden'))
  }
)
check(
  'Missing queue rows stop an active cover alarm and require fresh data again on recovery',
  () => {
    const e = environment({ g1: ['Alex Agent'], waitingAlertSeconds: 10 })
    coveragePulse(e, 11, 1)
    coveragePulse(e, 12, 2)
    assert.equal(e.debug().activeReminder.kind, 'critical')
    e.queues[0].row.hidden = true
    coveragePulse(e, 13, 3)
    assert.equal(e.debug().activeReminder, null)
    assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
    e.queues[0].row.hidden = false
    coveragePulse(e, 14, 4)
    assert.equal(e.debug().activeReminder, null)
    coveragePulse(e, 15, 5)
    assert.equal(e.debug().activeReminder.kind, 'critical')
  }
)
check('Missing or inconsistent queue counts never show a guessed live total', () => {
  const e = environment()
  e.queues[0].cell.setAttribute('title', '9 Interactions waiting')
  e.scan()
  assert.equal(e.window.__itsCallAssist.inspect().queuesReadable, false)
  assert.equal(e.ui().querySelector('.queue-total').textContent, '0')
  assert.equal(e.ui().querySelector('.queue-count-label').textContent, 'Last read callers waiting')
  assert.equal(e.debug().activeReminder, null)
})
check('G1 break information still works when queue rows are unmounted', () => {
  const e = environment({ g1: ['Alex Agent'] })
  e.queues[0].row.remove()
  e.setMe('Available', 1)
  e.other('Alex Agent', 'On Break', 1)
  e.setMe('Available', 2)
  assert(e.debug().playing.includes('lunch'))
  assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
})
check(
  'Main panel has its fitting layout while settings and personal views retain their own layout',
  () => {
    const e = environment()
    assert(e.ui().querySelector('.panel').classList.contains('main-panel'))
    e.button('Settings').onclick()
    assert(!e.ui().querySelector('.panel').classList.contains('main-panel'))
    e.ui().querySelector('.assistant-settings').querySelector('button').onclick()
    assert(e.ui().querySelector('.panel').classList.contains('main-panel'))
    e.showShortBreak(60)
    assert(!e.ui().querySelector('.panel').classList.contains('main-panel'))
    assert(e.ui().querySelector('.panel').classList.contains('compact'))
  }
)
check(
  'Connected and held calls show an editable identifier without requiring queues or agents',
  () => {
    for (const onHold of [false, true]) {
      const e = environment({ g1: [], lunchMinutes: 1 })
      e.showCall({ onHold, seconds: 100 })
      assert.equal(e.window.__itsCallAssist.inspect().view, 'call')
      assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
      assert(!e.ui().querySelector('.call-view').classList.contains('hidden'))
      assert(e.ui().querySelector('.compact-view').classList.contains('hidden'))
      assert.equal(
        e.ui().querySelector('.call-badge').textContent,
        onHold ? 'On hold' : 'Connected'
      )
      assert.equal(e.ui().querySelector('.call-duration').textContent, '01:40')
      assert.equal(e.ui().querySelector('#its-caller-identifier').disabled, false)
      assert(
        e.ui().querySelector('.caller-label').textContent.includes('Caller name or student number')
      )
      assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
      assert.equal(e.window.__itsCallAssist.statistics().total, 1)
      assert.equal(e.debug().activeReminder, null)
    }
  }
)
check(
  'A finished card without Info cannot create a disposition duplicate or a second counted call',
  () => {
    const e = environment({ g1: [] })
    e.showCall()
    e.caller('Alex Example')
    e.showWrapUp(120, { seconds: 20 })
    e.showCall({ info: false, seconds: 21 })
    e.scan()
    e.restoreMain()
    const history = e.window.__itsCallAssist.callHistorySession()
    assert.equal(history.records.length, 1)
    assert.equal(history.records[0].caller, 'Alex Example')
    assert.equal(history.pending.length, 0)
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  }
)
check(
  'The finished-interaction guard survives reruns and refreshes while its reference is hidden',
  () => {
    const e = environment({ g1: [] })
    e.showCall({ info: false })
    e.caller('00123456')
    e.showWrapUp(120, { seconds: 20 })
    e.showCall({ info: false, seconds: 25 })
    e.rerun()
    e.reload()
    e.scan()
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
    assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 0)
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  }
)
check(
  'Disposition markers outrank a lingering active timer even with an empty Wrap up label',
  () => {
    const e = environment({ g1: [] })
    e.showCall()
    e.caller('Alex')
    e.showWrapUp(120, { seconds: 20 })
    const page = e.personalPage()
    page.querySelector('[data-test-id="wrap-up-label"]').textContent = ''
    const stale = e.window.document.createElement('div')
    stale.setAttribute('data-test-id', 'interaction-timer')
    stale.setAttribute('aria-label', 'Interaction')
    stale.textContent = '00:20'
    page.append(stale)
    e.scan()
    assert.equal(e.window.__itsCallAssist.inspect().view, 'disposition')
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    page.querySelector('[data-test-id="wrap-up-label"]').remove()
    page.querySelector('[data-test-id="progress-timer"]').remove()
    e.scan()
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 0)
  }
)
check(
  'A lingering Busy header after Wrap up does not count again before a genuine new interaction',
  () => {
    const e = environment()
    e.showCall()
    e.showWrapUp(120, { seconds: 20 })
    e.restoreMain('Busy', 30)
    e.setMe('Busy', 31)
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    e.showCall({ transactionId: 'demo-next', seconds: 1 })
    assert.equal(e.window.__itsCallAssist.statistics().total, 2)
    e.caller('Casey')
    e.showWrapUp(120, { transactionId: 'demo-next', seconds: 20 })
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 2)
  }
)
check(
  'A confirmed idle state permits a genuine next call from the same number without a reference',
  () => {
    const e = environment()
    for (const name of ['Alex', 'Casey']) {
      e.showCall({ info: false })
      e.caller(name)
      e.showWrapUp(120, { seconds: 20 })
      e.restoreMain()
    }
    assert.equal(e.window.__itsCallAssist.statistics().total, 2)
    assert.deepEqual(
      Array.from(e.window.__itsCallAssist.callHistorySession().records, (r) => r.caller),
      ['Alex', 'Casey']
    )
  }
)
check(
  'A distinct known call reference permits the next call without requiring an idle snapshot',
  () => {
    const e = environment()
    e.showCall({ transactionId: 'demo-first' })
    e.caller('Alex')
    e.showWrapUp(120, { transactionId: 'demo-first', seconds: 20 })
    e.showCall({ transactionId: 'demo-next', seconds: 1 })
    e.caller('Casey')
    e.showWrapUp(120, { transactionId: 'demo-next', seconds: 10 })
    assert.equal(e.window.__itsCallAssist.statistics().total, 2)
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 2)
  }
)
check('Wrap up saves the identifier and every readable call detail exactly once', () => {
  const e = environment({ g1: [] })
  e.showCall({ seconds: 100, waitSeconds: 15 })
  e.caller('  Alex   Example  ')
  e.showWrapUp(120, {
    transactionId: 'demo-101',
    number: '+155501001',
    queue: 'Demo Service Queue',
    seconds: 105,
    waitSeconds: 17
  })
  e.wrapTime(119)
  e.scan()
  const history = e.window.__itsCallAssist.callHistorySession()
  assert.equal(history.pending.length, 0)
  assert.equal(history.records.length, 1)
  const record = history.records[0]
  assert.equal(record.caller, 'Alex Example')
  assert.equal(record.number, '+155501001')
  assert.equal(record.queue, 'Demo Service Queue')
  assert.equal(record.transactionId, 'demo-101')
  assert.equal(record.durationSeconds, 105)
  assert.equal(record.durationComplete, true)
  assert.equal(record.waitSeconds, 17)
  assert.equal(record.channel, 'Demo Service Queue')
  assert.equal(record.channelNumber, '+155509999')
  assert(record.completedAt >= record.detectedAt)
  assert.equal(record.callerInput, undefined)
})
check(
  'Student numbers remain text, including leading zeros, and blank identifiers become Unknown',
  () => {
    for (const [entered, expected] of [
      ['00123456', '00123456'],
      ['', 'Unknown'],
      ['   ', 'Unknown']
    ]) {
      const e = environment()
      e.showCall()
      e.caller(entered)
      e.showWrapUp(120, { seconds: 20 })
      assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, expected)
    }
  }
)
check('8x8 native display names never substitute for the optional agent-entered identifier', () => {
  const e = environment()
  e.showCall()
  e.showWrapUp(120, { seconds: 20 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Unknown')
})
check('Typing, polling, timer updates and G1 changes preserve the current draft', () => {
  const e = environment()
  e.showCall()
  e.caller('Alex ')
  e.callTime(20)
  e.scan()
  e.tick('Me', false)
  e.tick('Me', true)
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, 'Alex ')
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending[0].callerInput, 'Alex ')
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
  e.caller('Alex Example')
  e.showWrapUp(120, { seconds: 25 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Alex Example')
})
check('Opening the 8x8 Disposition tab during a call does not finalise the call', () => {
  const e = environment()
  e.showCall()
  e.caller('Alex')
  e.personalPage()
    .querySelector('[data-test-id="disposition-tab_TAB"]')
    .setAttribute('aria-selected', 'true')
  e.scan()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending[0].callerInput, 'Alex')
  assert.equal(e.debug().activeReminder, null)
})
check('Ringing offers and a Busy header alone do not invent detailed call-history entries', () => {
  const e = environment()
  e.showCall({ ringing: true })
  e.scan()
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 0)
  e.restoreMain('Busy', 10)
  e.showWrapUp(120)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
})
check(
  'Call references separate repeated calls from the same number and reset the input for the next caller',
  () => {
    const e = environment()
    e.showCall({ transactionId: 'demo-a' })
    e.caller('First Caller')
    e.showWrapUp(120, { transactionId: 'demo-a', seconds: 20 })
    e.showCall({ transactionId: 'demo-b', seconds: 0 })
    assert.equal(e.ui().querySelector('#its-caller-identifier').value, '')
    e.caller('Second Caller')
    e.showWrapUp(120, { transactionId: 'demo-b', seconds: 30 })
    const records = e.window.__itsCallAssist.callHistorySession().records
    assert.equal(records.length, 2)
    assert.equal(records[0].caller, 'First Caller')
    assert.equal(records[1].caller, 'Second Caller')
    assert.notEqual(records[0].id, records[1].id)
  }
)
check(
  'Replaced call DOM and unavailable Info tabs retain the typed identifier and previously read details',
  () => {
    const e = environment()
    e.showCall()
    e.caller('00123456')
    e.showCall({ info: false, seconds: 25 })
    assert.equal(e.ui().querySelector('#its-caller-identifier').value, '00123456')
    assert.equal(e.ui().querySelector('.call-queue').textContent, 'Demo Service Queue')
    e.showWrapUp(120, { seconds: 30 })
    const record = e.window.__itsCallAssist.callHistorySession().records[0]
    assert.equal(record.caller, '00123456')
    assert.equal(record.queue, 'Demo Service Queue')
    assert.equal(record.waitSeconds, 15)
    assert.equal(record.transactionId, 'demo-101')
  }
)
check('Late-arriving Info fields enrich the same draft rather than starting another call', () => {
  const e = environment()
  e.showCall({ info: false })
  e.caller('Alex')
  e.setCallInfo('Transaction ID', 'demo-late')
  e.setCallInfo('Queue', 'Demo Transfer Queue')
  e.setCallInfo('Queue wait duration', '00:25')
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 1)
  e.showWrapUp(120, { transactionId: 'demo-late', seconds: 30 })
  const record = e.window.__itsCallAssist.callHistorySession().records[0]
  assert.equal(record.caller, 'Alex')
  assert.equal(record.queue, 'Demo Transfer Queue')
  assert.equal(record.waitSeconds, 25)
})
check('Switching between phone interactions keeps each draft bound to its own reference', () => {
  const e = environment()
  e.showCall({ transactionId: 'demo-a', number: '+155501001' })
  e.caller('Alex')
  e.showCall({ transactionId: 'demo-b', number: '+155501002' })
  e.caller('Casey')
  e.showCall({ transactionId: 'demo-a', number: '+155501001', seconds: 20 })
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, 'Alex')
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 2)
  e.showWrapUp(120, { transactionId: 'demo-b', number: '+155501002', seconds: 25 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Casey')
  e.showWrapUp(120, { transactionId: 'demo-a', number: '+155501001', seconds: 30 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[1].caller, 'Alex')
})
check('An unrelated Wrap up reference cannot finalise or steal another call draft', () => {
  const e = environment()
  e.showCall({ transactionId: 'demo-a' })
  e.caller('Alex')
  e.showWrapUp(120, { transactionId: 'demo-b', seconds: 30 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending[0].callerInput, 'Alex')
  e.showWrapUp(120, { transactionId: 'demo-a', seconds: 35 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Alex')
})
check(
  'Refreshing or rerunning during a call preserves its draft and does not duplicate statistics',
  () => {
    const e = environment()
    e.showCall()
    e.caller('00123456')
    e.rerun()
    assert.equal(e.ui().querySelector('#its-caller-identifier').value, '00123456')
    e.reload()
    assert.equal(e.ui().querySelector('#its-caller-identifier').value, '00123456')
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
    assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 1)
    e.showWrapUp(120, { seconds: 20 })
    e.rerun()
    e.reload()
    e.scan()
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
  }
)
check(
  'Caller details use tab-session storage and never leak into durable preferences or statistics',
  () => {
    const e = environment()
    e.showCall()
    e.caller('Unique Caller Identifier')
    e.showWrapUp(120, { seconds: 20 })
    const saved = e.session.get('service-desk-8x8-call-history-v1')
    assert(saved.includes('Unique Caller Identifier'))
    assert(saved.includes('+155501001'))
    for (const value of e.storage.values()) {
      assert(!value.includes('Unique Caller Identifier'))
      assert(!value.includes('+155501001'))
    }
    assert.equal(environment().window.__itsCallAssist.callHistorySession().records.length, 0)
  }
)
check(
  'Blocked session storage keeps call history usable and preserves a draft on prototype rerun',
  () => {
    const e = environment({}, {}, { blockSessionStorage: true })
    e.showCall()
    e.caller('Alex')
    e.rerun()
    assert.equal(e.ui().querySelector('#its-caller-identifier').value, 'Alex')
    e.showWrapUp(120, { seconds: 20 })
    e.rerun()
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Alex')
  }
)
check(
  'Missing call HTML never finalises a draft; an observed return to idle recovers a missed Wrap up',
  () => {
    const e = environment()
    e.showCall({ seconds: 100 })
    e.caller('Alex')
    e.personalPage().hidden = true
    e.advance(30000)
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
    assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 1)
    e.restoreMain()
    const record = e.window.__itsCallAssist.callHistorySession().records[0]
    assert.equal(record.caller, 'Alex')
    assert.equal(record.durationSeconds, 100)
    assert.equal(record.durationComplete, false)
  }
)
check(
  'Wrap up finalises even when its countdown is unreadable, independently of the disposition alarm',
  () => {
    const e = environment()
    e.showCall()
    e.caller('Alex')
    e.showWrapUp(120, { seconds: 20 })
    e.personalPage().querySelector('[data-test-id="progress-timer"]').textContent = 'Unknown'
    e.scan()
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].durationSeconds, 20)
    assert.equal(e.debug().activeReminder, null)
  }
)
check(
  'Mismatched caller headings and Info rows disable editing until identity is readable again',
  () => {
    const e = environment()
    e.showCall()
    e.caller('Alex')
    e.personalPage().querySelector('[data-test-id="active-call-number"]').textContent = '+155501999'
    e.scan()
    assert.equal(e.ui().querySelector('#its-caller-identifier').disabled, true)
    assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 1)
    e.caller('Should not be assigned')
    assert.equal(e.window.__itsCallAssist.callHistorySession().pending[0].callerInput, 'Alex')
    e.showCall({ seconds: 25 })
    e.showWrapUp(120, { seconds: 30 })
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Alex')
  }
)
check(
  'Unreadable Info values and anonymous numbers remain unavailable without losing the call',
  () => {
    const e = environment()
    e.showCall({ number: null, queue: null, transactionId: null })
    e.caller('Alex')
    e.showWrapUp(120, { seconds: 20 })
    const record = e.window.__itsCallAssist.callHistorySession().records[0]
    assert.equal(record.caller, 'Alex')
    assert.equal(record.number, null)
    assert.equal(record.queue, null)
    assert.equal(record.transactionId, null)
  }
)
check('Ambiguous visible phone cards cannot create or finalise an arbitrary call', () => {
  const e = environment()
  e.showCall()
  e.caller('Alex')
  const second = e.window.document.createElement('article')
  second.setAttribute('data-test-id', 'phone-card-test-id')
  second.textContent = 'A second phone interaction'
  e.window.document.body.append(second)
  e.scan()
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 1)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
  second.remove()
  e.showWrapUp(120, { seconds: 20 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Alex')
})
check(
  'Call Notes is separate, shows note totals instead of observed call statistics and returns to main',
  () => {
    const e = environment()
    e.showCall()
    e.caller('Alex')
    e.showWrapUp(120, { seconds: 20 })
    e.restoreMain()
    e.button('Call Notes').onclick()
    assert(!e.ui().querySelector('.call-history').classList.contains('hidden'))
    assert(e.ui().querySelector('.main-view').classList.contains('hidden'))
    assert(e.ui().querySelector('.panel').classList.contains('history-panel'))
    const history = e
      .ui()
      .querySelector('.history-statistics')
      .querySelectorAll('.stat-value')
      .map((n) => n.textContent)
    assert.deepEqual(history, ['1', '0', '1', '1'])
    assert.equal(
      e.ui().querySelector('.history-session-count').textContent,
      'This session'
    )
    assert.equal(e.ui().querySelector('.history-caller').textContent, 'Alex')
    e.ui().querySelector('.call-history').querySelector('button').onclick()
    assert(e.ui().querySelector('.call-history').classList.contains('hidden'))
    assert(!e.ui().querySelector('.main-view').classList.contains('hidden'))
  }
)
check(
  'History searches names, student numbers, formatted phones and queues, and lists the newest call first',
  () => {
    const e = environment()
    for (const [id, caller, number, queue] of [
      ['a', 'Alex Example', '+155501001', 'Demo Academic Queue'],
      ['b', '00123456', '+155501002', 'Demo Service Queue']
    ]) {
      e.showCall({ transactionId: id, number, queue })
      e.caller(caller)
      e.showWrapUp(120, { transactionId: id, number, queue, seconds: 20 })
    }
    e.restoreMain()
    e.button('Call Notes').onclick()
    assert.equal(e.ui().querySelectorAll('.history-caller')[0].textContent, '00123456')
    const search = e.ui().querySelector('.history-search')
    for (const [query, expected] of [
      ['alex', 'Alex Example'],
      ['00123456', '00123456'],
      ['+1 555 01002', '00123456'],
      ['Academic', 'Alex Example']
    ]) {
      search.value = query
      search.oninput()
      assert.equal(e.ui().querySelectorAll('.history-card').length, 1)
      assert.equal(e.ui().querySelector('.history-caller').textContent, expected)
    }
    search.value = 'No matching caller'
    search.oninput()
    assert(e.ui().querySelector('.history-empty').textContent.includes('No matching call notes'))
    search.value = ''
    search.oninput()
    assert.equal(e.ui().querySelectorAll('.history-card').length, 2)
  }
)
check('Polling does not rebuild history cards or reset their scroll and expanded details', () => {
  const e = environment()
  e.showCall()
  e.showWrapUp(120, { seconds: 20 })
  e.restoreMain()
  e.button('Call Notes').onclick()
  const card = e.ui().querySelector('.history-card')
  const details = card.querySelector('details')
  details.open = true
  e.ui().querySelector('.history-list').scrollTop = 90
  e.scan()
  e.scan()
  assert.equal(e.ui().querySelector('.history-card'), card)
  assert.equal(details.open, true)
  assert.equal(e.ui().querySelector('.history-list').scrollTop, 90)
})
check(
  'History renders caller text safely and captures native duration instead of Busy, hold or wrap clocks',
  () => {
    const e = environment()
    e.showCall({ onHold: true, seconds: 100, waitSeconds: 65 })
    e.caller('<img src=x onerror=alert(1)>')
    e.showWrapUp(5, { seconds: 110 })
    e.restoreMain()
    e.button('Call Notes').onclick()
    assert.equal(
      e.ui().querySelector('.history-caller').textContent,
      '<img src=x onerror=alert(1)>'
    )
    assert.equal(e.ui().querySelector('.history-caller').children.length, 0)
    assert.equal(e.ui().querySelector('.history-duration').textContent, 'Duration 01:50')
    assert.equal(e.ui().querySelector('.history-wait').textContent, 'Queue wait 01:05')
  }
)
check('Midnight resets daily statistics while the session history keeps completed calls', () => {
  const e = environment()
  e.setTime(Date.parse('2026-10-13T23:59:50+10:00'))
  e.showCall()
  e.showWrapUp(120, { seconds: 20 })
  e.restoreMain()
  e.setTime(Date.parse('2026-10-14T00:00:03+10:00'))
  e.scan()
  e.button('Call Notes').onclick()
  assert.equal(e.window.__itsCallAssist.statistics().total, 0)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
  assert(e.ui().querySelector('.history-day').textContent.includes('13 Oct 2026'))
  assert.equal(
    e.ui().querySelector('.history-statistics').querySelector('.stat-value').textContent,
    '1'
  )
})
check('Muted calls still record identifiers and history independently of every sound', () => {
  const e = environment({ muted: true, g1: [] })
  e.showCall()
  e.caller('Alex')
  assert(e.ui().querySelector('.call-heading').querySelector('[aria-label="Unmute"]'))
  e.showWrapUp(120, { seconds: 20 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Alex')
  assert.equal(e.debug().playing.length, 0)
})
check(
  'History snapshots cannot mutate internal records and delayed input cannot rewrite a finalised name',
  () => {
    const e = environment()
    e.showCall()
    e.caller('Alex')
    e.showWrapUp(120, { seconds: 20 })
    e.caller('Changed too late')
    const snapshot = e.window.__itsCallAssist.callHistorySession()
    snapshot.records[0].caller = 'Changed through snapshot'
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Alex')
  }
)
check(
  'Saved session data restores valid history, drops corrupt records and continues its sequence',
  () => {
    const e = environment(
      {},
      {},
      {
        callHistory: {
          records: [
            {
              id: 1,
              detectedAt: 0,
              completedAt: 1,
              caller: 'Restored Caller',
              number: '+155501001'
            },
            { id: 1, detectedAt: 0, completedAt: 1, caller: 'Duplicate' },
            { id: -1, detectedAt: 0, completedAt: 1 },
            { id: 2, detectedAt: 'invalid', completedAt: 1 }
          ],
          pending: [],
          nextId: 2
        }
      }
    )
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
    e.showCall({ transactionId: 'new-call' })
    e.showWrapUp(120, { transactionId: 'new-call', seconds: 20 })
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[1].id, 2)
  }
)
check('A stale connected card for a previously saved reference never creates another draft', () => {
  const e = environment()
  e.showCall()
  e.showWrapUp(120, { seconds: 20 })
  e.showCall({ seconds: 25 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 0)
  assert.equal(e.ui().querySelector('#its-caller-identifier').disabled, true)
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
})
check('Hold time is labelled as the last read segment rather than a guessed total', () => {
  const e = environment()
  e.showCall({ onHold: true, seconds: 20 })
  e.showCall({ info: false, seconds: 25 })
  e.showWrapUp(120, { seconds: 30 })
  e.restoreMain()
  e.button('Call Notes').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].holdSeconds, 5)
  assert(e.ui().querySelector('.history-extra').textContent.includes('Hold time last read: 00:05'))
})
check(
  'Unknown or contradictory native call durations never become guessed complete durations',
  () => {
    const e = environment()
    e.showCall({ seconds: 20 })
    e.showWrapUp(120, { seconds: 10 })
    const record = e.window.__itsCallAssist.callHistorySession().records[0]
    assert.equal(record.durationSeconds, 20)
    assert.equal(record.durationComplete, false)
  }
)
check('Call capture works without configured waiting queues and preserves all caller data', () => {
  const e = environment({ g1: [] })
  e.showCall({ queue: 'Demo Outbound Queue' })
  e.caller('Alex')
  e.storage.delete('service-desk-8x8-inbound-queues-v1')
  e.rerun()
  assert.equal(e.window.__itsCallAssist.inspect().view, 'call')
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, 'Alex')
  e.showWrapUp(120, { seconds: 20 })
  assert.equal(
    e.window.__itsCallAssist.callHistorySession().records[0].queue,
    'Demo Outbound Queue'
  )
})
check('Invalid dates in saved session data cannot stop history rendering', () => {
  const e = environment(
    {},
    {},
    {
      callHistory: {
        records: [{ id: 1, detectedAt: 1e100, completedAt: 1e100, caller: 'Invalid Date' }],
        pending: []
      }
    }
  )
  e.button('Call Notes').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
  assert(e.ui().querySelector('.history-empty'))
})
check('On-call History shortcut keeps the draft and Back restores the caller field', () => {
  const e = environment()
  e.showCall()
  e.caller('Alex')
  e.ui()
    .querySelector('.call-heading')
    .querySelectorAll('button')
    .find((b) => b.textContent === 'Call Notes')
    .onclick()
  assert(!e.ui().querySelector('.call-history').classList.contains('hidden'))
  assert(e.ui().querySelector('.call-view').classList.contains('hidden'))
  e.callTime(20)
  assert(!e.ui().querySelector('.call-history').classList.contains('hidden'))
  e.ui().querySelector('.call-history').querySelector('button').onclick()
  assert(!e.ui().querySelector('.call-view').classList.contains('hidden'))
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, 'Alex')
})
check('Wrap up takes priority over an on-call History view and finalises the identifier', () => {
  const e = environment()
  e.showCall()
  e.caller('Alex')
  e.ui()
    .querySelector('.call-heading')
    .querySelectorAll('button')
    .find((b) => b.textContent === 'Call Notes')
    .onclick()
  e.showWrapUp(120, { seconds: 20 })
  assert.equal(e.window.__itsCallAssist.inspect().view, 'disposition')
  assert(!e.ui().querySelector('.compact-view').classList.contains('hidden'))
  assert(e.ui().querySelector('.call-history').classList.contains('hidden'))
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Alex')
})

// These scenarios use completed fictional calls so saved-record editing exercises
// the same capture, finalisation, persistence and counters as an ordinary session.
function editableHistory (callers = ['Alex Example']) {
  const e = environment({ g1: [] })
  callers.forEach((caller, index) => {
    const transactionId = 'demo-edit-' + index
    e.showCall({ transactionId })
    e.caller(caller)
    e.showWrapUp(120, { transactionId, seconds: 20 })
    e.restoreMain()
  })
  e.button('Call Notes').onclick()
  return e
}
function historyCard (e, id = 1) {
  return e
    .ui()
    .querySelectorAll('.history-card')
    .find((card) => card.getAttribute('data-call-id') === String(id))
}
function editIdentifier (card, value) {
  const input = card.querySelector('.history-edit-input')
  input.value = value
  input.oninput()
  return input
}
check(
  'Caller type is a prediction for names, usernames and exact six-to-nine-digit student numbers',
  () => {
    const examples = [
      ['Alex Example', 'Staff'],
      ['aexample', 'Staff'],
      ['Élodie Example', 'Staff'],
      ['学员', 'Staff'],
      ['staff123', 'Staff'],
      ['123456', 'Student'],
      ['00123456', 'Student'],
      ['123456789', 'Student'],
      ['12345', 'Unknown'],
      ['1234567890', 'Unknown'],
      ['12 3456', 'Unknown'],
      ['', 'Unknown'],
      [' UNKNOWN ', 'Unknown'],
      ['???', 'Unknown']
    ]
    const e = editableHistory(examples.map(([caller]) => caller))
    const records = e.window.__itsCallAssist.callHistorySession().records
    examples.forEach(([, expected], index) => {
      assert.equal(records[index].callerPrediction, expected)
      assert.equal(
        historyCard(e, index + 1).querySelector('.history-prediction').textContent,
        'Caller type (prediction): ' + expected
      )
    })
    assert.equal(historyCard(e).querySelector('.prediction-note'), null)
    assert(historyCard(e).querySelector('.history-prediction').title.includes('prediction'))
  }
)
check('The pen becomes a tick and saves only the identifier and updated prediction', () => {
  const e = editableHistory([''])
  const card = historyCard(e)
  const button = card.querySelector('.history-edit-toggle')
  const original = e.window.__itsCallAssist.callHistorySession().records[0]
  const sessionBefore = e.session.get('service-desk-8x8-call-history-v1')
  const total = e.window.__itsCallAssist.statistics().total
  assert.equal(button.textContent, '✎')
  button.onclick()
  assert.equal(button.textContent, '✓')
  assert(card.classList.contains('editing'))
  assert.equal(card.querySelector('.history-edit-input').value, '')
  editIdentifier(card, '00123456')
  e.scan()
  assert.equal(e.session.get('service-desk-8x8-call-history-v1'), sessionBefore)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Unknown')
  button.onclick()
  const saved = e.window.__itsCallAssist.callHistorySession().records[0]
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), {
    ...original,
    caller: '00123456',
    callerPrediction: 'Student'
  })
  assert.equal(button.textContent, '✎')
  assert.equal(e.window.__itsCallAssist.statistics().total, total)
  assert.equal(e.debug().activeReminder, null)
  assert.equal(e.notifications.length, 0)
  e.reload()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, '00123456')
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].callerPrediction, 'Student')
  for (const value of e.storage.values()) assert(!value.includes('00123456'))
})
check(
  'Editing a student number to a staff username refreshes the prediction without replacing its card',
  () => {
    const e = editableHistory(['00123456'])
    const card = historyCard(e)
    const details = card.querySelector('details')
    details.open = true
    card.querySelector('.history-edit-toggle').onclick()
    editIdentifier(card, '  aexample  ')
    card.querySelector('.history-edit-toggle').onclick()
    assert.equal(historyCard(e), card)
    assert.equal(details.open, true)
    assert.equal(card.querySelector('.history-caller').textContent, 'aexample')
    assert.equal(
      card.querySelector('.history-prediction').textContent,
      'Caller type (prediction): Staff'
    )
  }
)
check(
  'Back and Settings save an edit and restore the updated identifier and prediction',
  () => {
    for (const destination of ['Back', 'Settings']) {
      const e = editableHistory(['Alex'])
      const card = historyCard(e)
      const button = card.querySelector('.history-edit-toggle')
      button.onclick()
      editIdentifier(card, '00123456')
      if (destination === 'Back') { e.ui().querySelector('.call-history').querySelector('button').onclick() } else e.button('Settings').onclick()
      assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, '00123456')
      assert.equal(
        e.window.__itsCallAssist.callHistorySession().records[0].callerPrediction,
        'Student'
      )
      assert.equal(button.textContent, '✎')
      assert(!card.classList.contains('editing'))
      // A delayed handler from a hidden card cannot reopen an editor.
      button.onclick()
      e.button('Call Notes').onclick()
      assert.equal(button.textContent, '✎')
      button.onclick()
      assert.equal(card.querySelector('.history-edit-input').value, '00123456')
    }
  }
)
check(
  'Only one saved call can be edited and switching records saves the first draft',
  () => {
    const e = editableHistory(['Alex', 'Casey'])
    const first = historyCard(e, 1)
    const second = historyCard(e, 2)
    first.querySelector('.history-edit-toggle').onclick()
    editIdentifier(first, '00123456')
    second.querySelector('.history-edit-toggle').onclick()
    assert.equal(first.querySelector('.history-edit-toggle').textContent, '✎')
    assert.equal(second.querySelector('.history-edit-toggle').textContent, '✓')
    assert.equal(e.ui().querySelectorAll('.editing').length, 1)
    editIdentifier(second, '987654')
    second.querySelector('.history-edit-toggle').onclick()
    const records = e.window.__itsCallAssist.callHistorySession().records
    assert.equal(records[0].caller, '00123456')
    assert.equal(records[1].caller, '987654')
    assert.equal(records[1].callerPrediction, 'Student')
    assert.equal(e.window.__itsCallAssist.statistics().total, 2)
  }
)
check(
  'Enter confirms an edit, Escape cancels it and a confirmed blank name becomes Unknown',
  () => {
    const e = editableHistory()
    const card = historyCard(e)
    const button = card.querySelector('.history-edit-toggle')
    button.onclick()
    const input = editIdentifier(card, 'Discard me')
    let prevented = 0
    input.onkeydown({ key: 'Escape', preventDefault: () => prevented++ })
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Alex Example')
    button.onclick()
    editIdentifier(card, '   ')
    input.onkeydown({ key: 'Enter', preventDefault: () => prevented++ })
    assert.equal(prevented, 2)
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Unknown')
    assert.equal(
      e.window.__itsCallAssist.callHistorySession().records[0].callerPrediction,
      'Unknown'
    )
  }
)
check(
  'Polling and a Brisbane day change preserve the saved-call editor and its unsaved text',
  () => {
    const e = editableHistory()
    const card = historyCard(e)
    card.querySelector('.history-edit-toggle').onclick()
    const input = editIdentifier(card, 'Alex ')
    e.ui().querySelector('.history-list').scrollTop = 75
    e.scan()
    e.setTime(Date.parse('2026-10-14T00:00:03+10:00'))
    e.scan()
    assert.equal(historyCard(e), card)
    assert.equal(card.querySelector('.history-edit-input'), input)
    assert.equal(input.value, 'Alex ')
    assert.equal(card.querySelector('.history-edit-toggle').textContent, '✓')
    assert.equal(e.ui().querySelector('.history-list').scrollTop, 75)
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Alex Example')
  }
)
check('Search saves the current draft before filtering and includes its updated identifier', () => {
  const e = editableHistory(['Alex', 'Casey'])
  const card = historyCard(e)
  const button = card.querySelector('.history-edit-toggle')
  const search = e.ui().querySelector('.history-search')
  button.onclick()
  editIdentifier(card, 'Updated Alex')
  search.value = 'Casey'
  search.oninput()
  assert(!card.parentElement)
  assert.equal(button.textContent, '✎')
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Updated Alex')
  button.onclick()
  assert.equal(button.textContent, '✎')
  search.value = 'Updated Alex'
  search.oninput()
  button.onclick()
  editIdentifier(card, '00123456')
  button.onclick()
  assert(!historyCard(e))
  search.value = '00123456'
  search.oninput()
  assert.equal(historyCard(e), card)
  assert.equal(card.querySelector('.history-caller').textContent, '00123456')
})
check(
  'Disposition saves a history edit without overwriting the current caller or creating another count',
  () => {
    const e = editableHistory(['Alex'])
    e.showCall({ transactionId: 'demo-new' })
    e.caller('Casey')
    e.ui()
      .querySelector('.call-heading')
      .querySelectorAll('button')
      .find((b) => b.textContent === 'Call Notes')
      .onclick()
    const card = historyCard(e)
    card.querySelector('.history-edit-toggle').onclick()
    editIdentifier(card, 'Updated Alex')
    e.showWrapUp(120, { transactionId: 'demo-new', seconds: 20 })
    assert.equal(card.querySelector('.history-edit-toggle').textContent, '✎')
    const records = e.window.__itsCallAssist.callHistorySession().records
    assert.deepEqual(
      Array.from(records, (r) => r.caller),
      ['Updated Alex', 'Casey']
    )
    assert.equal(e.window.__itsCallAssist.statistics().total, 2)
  }
)
check('A rerun or refresh finalises the active saved-record editor', () => {
  for (const restart of ['rerun', 'reload']) {
    const e = editableHistory()
    const card = historyCard(e)
    card.querySelector('.history-edit-toggle').onclick()
    editIdentifier(card, 'Updated Alex')
    e[restart]()
    e.button('Call Notes').onclick()
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, 'Updated Alex')
    assert.equal(historyCard(e).querySelector('.history-edit-toggle').textContent, '✎')
  }
})
check(
  'Blocked session storage retains confirmed history edits in memory through a prototype rerun',
  () => {
    const e = environment({ g1: [] }, {}, { blockSessionStorage: true })
    e.showCall()
    e.showWrapUp(120, { seconds: 20 })
    e.restoreMain()
    e.button('Call Notes').onclick()
    const card = historyCard(e)
    card.querySelector('.history-edit-toggle').onclick()
    editIdentifier(card, '00123456')
    card.querySelector('.history-edit-toggle').onclick()
    e.rerun()
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].caller, '00123456')
    assert.equal(
      e.window.__itsCallAssist.callHistorySession().records[0].callerPrediction,
      'Student'
    )
    assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  }
)
check(
  'Saved edits remain plain text and old records derive predictions from their current identifier',
  () => {
    const e = environment(
      {},
      {},
      {
        callHistory: {
          records: [
            { id: 1, detectedAt: 0, completedAt: 1, caller: '00123456', callerPrediction: 'Staff' },
            { id: 2, detectedAt: 2, completedAt: 3, caller: 'Alex Example' }
          ]
        }
      }
    )
    e.button('Call Notes').onclick()
    assert.equal(
      e.window.__itsCallAssist.callHistorySession().records[0].callerPrediction,
      'Student'
    )
    assert.equal(e.window.__itsCallAssist.callHistorySession().records[1].callerPrediction, 'Staff')
    const card = historyCard(e)
    card.querySelector('.history-edit-toggle').onclick()
    editIdentifier(card, '<img src=x onerror=alert(1)>')
    card.querySelector('.history-edit-toggle').onclick()
    assert.equal(card.querySelector('.history-caller').textContent, '<img src=x onerror=alert(1)>')
    assert.equal(card.querySelector('.history-caller').children.length, 0)
    assert.equal(e.window.__itsCallAssist.statistics().total, 0)
  }
)
function editNoteFields (card, { caller, notes, jobNumber }) {
  if (caller !== undefined) editIdentifier(card, caller)
  for (const [selector, value] of [['.history-notes-input', notes], ['.history-job-input', jobNumber]]) {
    if (value === undefined) continue
    const input = card.querySelector(selector)
    input.value = value
    input.oninput()
  }
}
check('On-call multiline notes survive polling, held calls, restarts and finalisation', () => {
  const e = environment({ g1: [] })
  e.showCall()
  e.caller('00123456')
  e.notes('First line\nSecond line\n  useful detail')
  const field = e.ui().querySelector('#its-caller-notes')
  e.callTime(18)
  assert.equal(e.ui().querySelector('#its-caller-notes'), field)
  assert.equal(field.value, 'First line\nSecond line\n  useful detail')
  e.setCallInfo('Queue', null)
  e.rerun()
  assert.equal(e.ui().querySelector('#its-caller-notes').value, field.value)
  e.showCall({ onHold: true, seconds: 19 })
  assert.equal(e.ui().querySelector('#its-caller-notes').value, field.value)
  e.showWrapUp(120, { seconds: 22 })
  const record = e.window.__itsCallAssist.callHistorySession().records[0]
  assert.equal(record.notes, 'First line\nSecond line\n  useful detail')
  assert.equal(record.caller, '00123456')
  assert.equal(record.jobNumber, '')
  assert.equal(record.durationSeconds, 22)
  e.restoreMain()
  e.button('Call Notes').onclick()
  const notes = historyCard(e).querySelector('.history-notes')
  assert(!notes.classList.contains('hidden'))
  assert.equal(notes.textContent, record.notes)
  assert.equal(notes.closest('details'), null)
  for (const value of e.storage.values()) assert(!value.includes('useful detail'))
})
check('Notes stay bound to their interaction and late or ambiguous events cannot overwrite them', () => {
  const e = environment({ g1: [] })
  e.showCall({ transactionId: 'notes-first' })
  e.notes('First caller notes')
  const oldInput = e.ui().querySelector('#its-caller-notes')
  e.showCall({ transactionId: 'notes-second' })
  assert.equal(oldInput.value, '')
  e.notes('Second caller notes')
  e.showWrapUp(120, { transactionId: 'notes-second', seconds: 20 })
  oldInput.value = 'Late event'
  oldInput.oninput()
  e.showCall({ transactionId: 'notes-first' })
  assert.equal(oldInput.value, 'First caller notes')
  e.showWrapUp(120, { transactionId: 'notes-first', seconds: 25 })
  assert.deepEqual(Array.from(e.window.__itsCallAssist.callHistorySession().records, (call) => call.notes), ['Second caller notes', 'First caller notes'])
})
check('The pen edits name, notes and job together; clicking outside saves all three', () => {
  const e = editableHistory()
  const card = historyCard(e)
  const original = e.window.__itsCallAssist.callHistorySession().records[0]
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { caller: '00123456', notes: 'Password reset\nCaller confirmed access', jobNumber: 'REQ123456' })
  e.scan()
  assert.equal(card.querySelector('.history-notes-input').value, 'Password reset\nCaller confirmed access')
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].notes, '')
  e.pointerDown(e.window.document.body)
  const record = e.window.__itsCallAssist.callHistorySession().records[0]
  assert.deepEqual(JSON.parse(JSON.stringify(record)), { ...original, caller: '00123456', callerPrediction: 'Student', notes: 'Password reset\nCaller confirmed access', jobNumber: 'REQ123456' })
  assert.equal(card.querySelector('.history-job').textContent, 'Job: REQ123456')
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  assert.equal(e.notifications.length, 0)
})
check('Shadow DOM clicks within the edited card preserve its draft, caret node and all fields', () => {
  const e = editableHistory()
  const card = historyCard(e)
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { notes: 'Draft line', jobNumber: 'INC1234567' })
  const input = card.querySelector('.history-notes-input')
  e.pointerDown(e.window.document.body.querySelector('#its-call-assist-panel'), [input, card, e.ui()])
  e.scan()
  assert.equal(card.querySelector('.history-edit-toggle').textContent, '✓')
  assert.equal(card.querySelector('.history-notes-input'), input)
  assert.equal(input.value, 'Draft line')
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].notes, '')
})
check('Back and switching records commit every editable field; only the new record stays in edit mode', () => {
  const e = editableHistory(['Alex', 'Casey'])
  const first = historyCard(e, 1)
  first.querySelector('.history-edit-toggle').onclick()
  editNoteFields(first, { notes: 'First note', jobNumber: 'INC1234567' })
  const second = historyCard(e, 2)
  second.querySelector('.history-edit-toggle').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].notes, 'First note')
  editNoteFields(second, { notes: 'Second note', jobNumber: 'REQ123456' })
  e.ui().querySelector('.call-history').querySelector('button').onclick()
  const records = e.window.__itsCallAssist.callHistorySession().records
  assert.equal(records[1].notes, 'Second note')
  assert.equal(records[1].jobNumber, 'REQ123456')
  assert.equal(e.ui().querySelectorAll('.editing').length, 0)
})
check('Notes allow Enter for a new line, Ctrl+Enter saves, and Escape cancels all editable fields', () => {
  const e = editableHistory()
  const card = historyCard(e)
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { notes: 'Saved note', jobNumber: 'INC1234567' })
  let prevented = 0
  const event = { key: 'Enter', preventDefault: () => prevented++ }
  card.querySelector('.history-notes-input').onkeydown(event)
  assert.equal(prevented, 0)
  card.querySelector('.history-notes-input').onkeydown({ ...event, ctrlKey: true })
  assert.equal(prevented, 1)
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { caller: 'Student', notes: 'Cancel this', jobNumber: 'REQ999999' })
  card.querySelector('.history-job-input').onkeydown({ key: 'Escape', preventDefault () {} })
  const record = e.window.__itsCallAssist.callHistorySession().records[0]
  assert.equal(record.caller, 'Alex Example')
  assert.equal(record.notes, 'Saved note')
  assert.equal(record.jobNumber, 'INC1234567')
})
check('Page navigation and blocked-storage reruns autosave names, notes and jobs', () => {
  for (const restart of ['pageHide', 'rerun']) {
    const e = environment({ g1: [] }, {}, { blockSessionStorage: restart === 'rerun' })
    e.showCall()
    e.showWrapUp(120, { seconds: 20 })
    e.restoreMain()
    e.button('Call Notes').onclick()
    const card = historyCard(e)
    card.querySelector('.history-edit-toggle').onclick()
    editNoteFields(card, { caller: '00123456', notes: 'Persist this note', jobNumber: 'INC1234567' })
    e[restart]()
    const record = e.window.__itsCallAssist.callHistorySession().records[0]
    assert.equal(record.notes, 'Persist this note')
    assert.equal(record.jobNumber, 'INC1234567')
    assert.equal(record.callerPrediction, 'Student')
  }
})
check('Notes and job numbers are searchable, and search punctuation does not autosave during polling', () => {
  const e = editableHistory()
  const card = historyCard(e)
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { notes: 'Reset VPN | account', jobNumber: 'INC1234567' })
  card.querySelector('.history-edit-toggle').onclick()
  const search = e.ui().querySelector('.history-search')
  for (const value of ['VPN |', 'inc1234567']) {
    search.value = value
    search.oninput()
    assert.equal(historyCard(e), card)
  }
  search.value = 'VPN |'
  search.oninput()
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { notes: 'New unsaved value' })
  e.scan()
  assert.equal(card.querySelector('.history-edit-toggle').textContent, '✓')
})
check('Deleting and undoing a call note preserve counters, timings, alerts and saved-session privacy', () => {
  const e = editableHistory(['Alex', 'Casey'])
  const card = historyCard(e)
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { notes: 'Short hang-up', jobNumber: 'INC1234567' })
  card.querySelector('.history-delete').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
  assert.equal(historyCard(e), undefined)
  assert.equal(e.window.__itsCallAssist.statistics().total, 2)
  e.button('Undo delete').onclick()
  const restored = e.window.__itsCallAssist.callHistorySession().records.find((call) => call.id === 1)
  assert.equal(restored.notes, 'Short hang-up')
  assert.equal(restored.jobNumber, 'INC1234567')
  assert.equal(restored.durationSeconds, 20)
  assert.equal(e.notifications.length, 0)
  historyCard(e).querySelector('.history-delete').onclick()
  e.reload()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
  assert.equal(e.window.__itsCallAssist.statistics().total, 2)
})
check('Deleting a record cannot resurrect its call during late disposition renders or a restart', () => {
  const e = editableHistory(['Alex'])
  historyCard(e).querySelector('.history-delete').onclick()
  e.showWrapUp(120, { transactionId: 'demo-edit-0', seconds: 20 })
  e.showCall({ transactionId: 'demo-edit-0', info: false, seconds: 21 })
  e.rerun()
  e.scan()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending.length, 0)
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  e.showCall({ transactionId: 'genuine-next', seconds: 1 })
  e.showWrapUp(120, { transactionId: 'genuine-next', seconds: 2 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
  assert.equal(e.window.__itsCallAssist.statistics().total, 2)
})
check('TXT round trips every call detail, multiline notes, leading zeros and delimiter-like content', () => {
  const e = editableHistory(['Name: Alex Example'])
  const card = historyCard(e)
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { notes: 'Notes: preserve this\n--------------------\n[Call details]\n\\file\n  indented line', jobNumber: 'REQ001234' })
  card.querySelector('.history-edit-toggle').onclick()
  const record = e.window.__itsCallAssist.callHistorySession().records[0]
  const text = e.window.__itsCallAssist.exportCallNotesText()
  assert(text.includes('REQ001234'))
  assert(text.includes('\r\n[Call details]\r\n'))
  const imported = environment({ g1: [] })
  assert.deepEqual(JSON.parse(JSON.stringify(imported.window.__itsCallAssist.importCallNotesText(text))), { added: 1, skipped: 0 })
  assert.deepEqual(JSON.parse(JSON.stringify(imported.window.__itsCallAssist.callHistorySession().records[0])), JSON.parse(JSON.stringify(record)))
  assert.equal(imported.window.__itsCallAssist.statistics().total, 0)
  imported.reload()
  assert.deepEqual(JSON.parse(JSON.stringify(imported.window.__itsCallAssist.callHistorySession().records[0])), JSON.parse(JSON.stringify(record)))
})
check('Legacy TXT accepts different separators, blank templates, multiline notes and non-INC tickets', () => {
  const e = environment({ g1: [] })
  const text = '\uFEFF' + [
    '-'.repeat(47), '00123456', 'Alex Example helped with setup', 'Access is now working', 'IMS0012345',
    '-'.repeat(47), '', '', '-'.repeat(20), 'unknown', 'NO JOB NUMBER',
    '-'.repeat(20), 'Caller name: Casey Example', 'Notes: Login problem', 'Job Number: REQ001234',
    '-'.repeat(25), 'Name/SID:', 'Notes: Name not supplied', 'no job number', '-'.repeat(25)
  ].join('\r\n')
  const result = e.window.__itsCallAssist.importCallNotesText(text)
  assert.equal(result.added, 4)
  const records = e.window.__itsCallAssist.callHistorySession().records
  assert.equal(records[0].caller, '00123456')
  assert.equal(records[0].notes, 'Alex Example helped with setup\nAccess is now working')
  assert.equal(records[0].jobNumber, 'IMS0012345')
  assert.equal(records[1].notes, '')
  assert.equal(records[1].jobNumber, '')
  assert.equal(records[2].jobNumber, 'REQ001234')
  assert.equal(records[3].caller, 'Unknown')
  for (const call of records) {
    assert.equal(call.detectedAt, null)
    assert.equal(call.completedAt, null)
    assert.equal(call.durationSeconds, null)
  }
  e.button('Call Notes').onclick()
  assert.equal(e.ui().querySelector('.history-day').textContent, 'Call date unknown')
  assert.equal(e.window.__itsCallAssist.statistics().total, 0)
  e.reload()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 4)
})
check('TXT omits missing notes, exports NO JOB NUMBER and preserves unknown metadata', () => {
  const e = editableHistory([''])
  const text = e.window.__itsCallAssist.exportCallNotesText()
  assert(text.includes('\r\nUnknown\r\nNO JOB NUMBER\r\n[Call details]'))
  const other = environment()
  other.window.__itsCallAssist.importCallNotesText(text)
  assert.equal(other.window.__itsCallAssist.callHistorySession().records[0].caller, 'Unknown')
  const legacy = other.window.__itsCallAssist.parseCallNotesText('Unknown\nNO JOB NUMBER')[0]
  assert.equal(legacy.notes, '')
  assert.equal(legacy.jobNumber, '')
  assert.equal(legacy.durationComplete, false)
})
check('An empty name line imports as Unknown without consuming the first line of notes', () => {
  const e = environment()
  const records = e.window.__itsCallAssist.parseCallNotesText('--------------------\n\nFirst note line\nSecond note line\nREQ123456\n--------------------')
  assert.equal(records.length, 1)
  assert.equal(records[0].caller, 'Unknown')
  assert.equal(records[0].notes, 'First note line\nSecond note line')
  assert.equal(records[0].jobNumber, 'REQ123456')
})
check('Import limits and contradictory detail types reject the whole file before adding records', () => {
  const e = editableHistory()
  const exportText = e.window.__itsCallAssist.exportCallNotesText()
  for (const text of [
    ('--------------------\nAlex\nNO JOB NUMBER\n').repeat(2001),
    exportText.replace('Full duration recorded: Yes', 'Full duration recorded: Maybe'),
    exportText.replace('First detected:', 'First detected: invalid date\nUnrecognised label:'),
    exportText.replace('Queue:', 'Queue: {"bad":true}\nUnrecognised label:').replace('Queue: {"bad":true}', 'Queue: "unfinished')
  ]) {
    assert.throws(() => e.window.__itsCallAssist.importCallNotesText(text))
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
  }
})
check('Importing during an active call preserves the on-call name and notes until Wrap up', () => {
  const e = environment({ g1: [] })
  e.showCall()
  e.caller('Current Caller')
  e.notes('Current call notes')
  e.window.__itsCallAssist.importCallNotesText('Old Caller\nImported notes\nREQ123456')
  e.scan()
  assert.equal(e.ui().querySelector('#its-caller-identifier').value, 'Current Caller')
  assert.equal(e.ui().querySelector('#its-caller-notes').value, 'Current call notes')
  e.showWrapUp(120, { seconds: 20 })
  const records = e.window.__itsCallAssist.callHistorySession().records
  assert.equal(records[0].caller, 'Old Caller')
  assert.equal(records[1].notes, 'Current call notes')
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
})
check('Exported lower-bound durations and unknown dates retain their exact meaning after import', () => {
  const e = environment({ g1: [] })
  e.showCall({ seconds: 17 })
  e.notes('Missed wrap-up sample')
  e.restoreMain()
  e.window.__itsCallAssist.importCallNotesText('Old Caller\nNO JOB NUMBER')
  const other = environment()
  other.window.__itsCallAssist.importCallNotesText(e.window.__itsCallAssist.exportCallNotesText())
  const native = other.window.__itsCallAssist.callHistorySession().records.find((call) => call.origin === '8x8')
  const legacy = other.window.__itsCallAssist.callHistorySession().records.find((call) => call.origin === 'text')
  assert.equal(native.durationSeconds, 17)
  assert.equal(native.durationComplete, false)
  assert.equal(legacy.detectedAt, null)
  assert.equal(legacy.completedAt, null)
})
check('Repeated assistant and legacy imports skip duplicates while preserving identical calls within a file', () => {
  const e = environment()
  const text = '--------------------\nAlex\nSame issue\nINC1234567\n--------------------\nAlex\nSame issue\nINC1234567\n--------------------'
  assert.equal(e.window.__itsCallAssist.importCallNotesText(text).added, 2)
  assert.equal(e.window.__itsCallAssist.importCallNotesText(text).skipped, 2)
  const exported = e.window.__itsCallAssist.exportCallNotesText()
  assert.equal(e.window.__itsCallAssist.importCallNotesText(exported).skipped, 2)
  e.reload()
  assert.equal(e.window.__itsCallAssist.importCallNotesText(exported).skipped, 2)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 2)
})
check('Imports preserve an existing edited record and assign fresh local row numbers to distinct records', () => {
  const e = editableHistory()
  const exported = e.window.__itsCallAssist.exportCallNotesText()
  const card = historyCard(e)
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { notes: 'Edited locally' })
  const result = e.window.__itsCallAssist.importCallNotesText(exported)
  assert.equal(result.skipped, 1)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].notes, 'Edited locally')
  e.window.__itsCallAssist.importCallNotesText('Casey\nDifferent issue\nREQ123456')
  assert.deepEqual(Array.from(e.window.__itsCallAssist.callHistorySession().records, (call) => call.id), [1, 2])
  const newer = e.window.__itsCallAssist.exportCallNotesText()
  const other = environment()
  other.window.__itsCallAssist.importCallNotesText('Existing\nNO JOB NUMBER')
  other.window.__itsCallAssist.importCallNotesText(newer)
  const original = e.window.__itsCallAssist.callHistorySession().records[0]
  const restored = other.window.__itsCallAssist.callHistorySession().records.find((call) => call.recordKey === original.recordKey)
  assert(restored.id > 1)
  assert.equal(restored.originalId, original.originalId)
  assert.equal(restored.recordKey, original.recordKey)
})
check('Import does not hide a genuine new call just because its reference was in a TXT file', () => {
  const source = editableHistory()
  const text = source.window.__itsCallAssist.exportCallNotesText()
  const e = environment({ g1: [] })
  e.window.__itsCallAssist.importCallNotesText(text)
  e.showCall({ transactionId: 'demo-edit-0' })
  e.notes('New observed call')
  e.showWrapUp(120, { transactionId: 'demo-edit-0', seconds: 20 })
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 2)
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[1].notes, 'New observed call')
})
check('A deleted exported record can be reimported without Undo adding a duplicate', () => {
  const e = editableHistory()
  const text = e.window.__itsCallAssist.exportCallNotesText()
  historyCard(e).querySelector('.history-delete').onclick()
  e.window.__itsCallAssist.importCallNotesText(text)
  e.button('Undo delete').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
})
check('Malformed or oversized imports fail atomically and never evaluate caller text as HTML', () => {
  const e = editableHistory()
  const controller = e.window.__itsCallAssist
  const count = controller.callHistorySession().records.length
  const exported = controller.exportCallNotesText()
  for (const bad of ['', '--------------------\n--------------------', 'a\u0000b', 'a'.repeat(5 * 1024 * 1024 + 1), exported.replace('Duration seconds: 20', 'Duration seconds: -1'), exported.replace('(TXT v1)', '(TXT v99)'), 'Alex\n' + 'x'.repeat(20001) + '\nNO JOB NUMBER', exported.replace('[Call details]', '[Call details]\nSource: text')]) {
    assert.throws(() => controller.importCallNotesText(bad))
    assert.equal(controller.callHistorySession().records.length, count)
  }
  controller.importCallNotesText('<img src=x onerror=alert(1)>\n<script>private</script>\nINC1234567')
  const card = historyCard(e, 2)
  assert.equal(card.querySelector('.history-caller').children.length, 0)
  assert.equal(card.querySelector('.history-notes').children.length, 0)
  assert.equal(card.querySelector('.history-notes').textContent, '<script>private</script>')
})
asyncCheck('Export opens a save-location picker and commits all records, including outside the search filter', async () => {
  let pickerOptions
  const writes = []
  let closed = false
  const e = environment({ g1: [] }, {}, {
    savePicker: async (options) => {
      pickerOptions = options
      return { createWritable: async () => ({ write: async (text) => writes.push(text), close: async () => { closed = true }, abort: async () => {} }) }
    }
  })
  e.showCall()
  e.showWrapUp(120, { seconds: 20 })
  e.restoreMain()
  e.button('Call Notes').onclick()
  historyCard(e).querySelector('.history-edit-toggle').onclick()
  editNoteFields(historyCard(e), { notes: 'Exported draft', jobNumber: 'INC1234567' })
  const search = e.ui().querySelector('.history-search')
  search.value = 'No matching call'
  search.oninput()
  await e.button('Export TXT').onclick()
  assert(pickerOptions.suggestedName.endsWith('.txt'))
  assert.equal(pickerOptions.types[0].accept['text/plain'][0], '.txt')
  assert.equal(writes.length, 1)
  assert(writes[0].includes('Exported draft'))
  assert(writes[0].includes('INC1234567'))
  assert.equal(closed, true)
  assert(e.ui().querySelector('.history-transfer-status').textContent.includes('selected location'))
})
asyncCheck('Save-picker cancellation writes nothing and keeps notes intact without starting a download', async () => {
  const e = environment({}, {}, { savePicker: async () => { const error = Error('Cancelled'); error.name = 'AbortError'; throw error } })
  e.window.__itsCallAssist.importCallNotesText('Alex\nNO JOB NUMBER')
  e.button('Call Notes').onclick()
  await e.button('Export TXT').onclick()
  assert.equal(e.downloads.length, 0)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
  assert.equal(e.ui().querySelector('.history-transfer-status').textContent, 'Export cancelled.')
  assert.equal(e.button('Export TXT').disabled, false)
})
asyncCheck('A denied save picker offers an explicit TXT download with a filename and the full text', async () => {
  const e = environment({}, {}, { savePicker: async () => { const error = Error('Blocked'); error.name = 'SecurityError'; throw error } })
  e.window.__itsCallAssist.importCallNotesText('Alex\nUseful note\nREQ123456')
  e.button('Call Notes').onclick()
  await e.button('Export TXT').onclick()
  assert.equal(e.downloads.length, 0)
  assert(!e.button('Download TXT').classList.contains('hidden'))
  e.button('Download TXT').onclick()
  assert.equal(e.downloads.length, 1)
  const download = e.downloads[0]
  assert(download.filename.endsWith('.txt'))
  assert((await e.blobs.get(download.href).text()).includes('Useful note'))
  for (const { fn, ms } of e.jobs.values()) if (ms === 30000) fn()
  assert(e.revokedUrls.includes(download.href))
})
asyncCheck('Unsupported save-location APIs use a Notepad TXT download and explain Edge-controlled location', async () => {
  const e = editableHistory()
  await e.button('Export TXT').onclick()
  assert.equal(e.downloads.length, 1)
  const file = e.blobs.get(e.downloads[0].href)
  assert.equal(file.type, 'text/plain;charset=utf-8')
  assert((await file.text()).includes('Alex Example'))
  assert(e.ui().querySelector('.history-transfer-status').textContent.includes('download settings'))
})
asyncCheck('A failed write aborts the file stream and offers a download without claiming success', async () => {
  let aborted = false
  let closed = false
  const e = environment({}, {}, { savePicker: async () => ({ createWritable: async () => ({ write: async () => { throw Error('Disk full') }, close: async () => { closed = true }, abort: async () => { aborted = true } }) }) })
  e.window.__itsCallAssist.importCallNotesText('Alex\nNO JOB NUMBER')
  await e.button('Export TXT').onclick()
  assert.equal(aborted, true)
  assert.equal(closed, false)
  assert.equal(e.ui().querySelector('.history-transfer-status').getAttribute('data-error'), 'true')
  assert.equal(e.button('Export TXT').disabled, false)
})
asyncCheck('Closing during a save picker or stream creation rejects late writes', async () => {
  for (const stage of ['picker', 'stream']) {
    let resolve
    const pending = new Promise((_resolve) => { resolve = _resolve })
    let writes = 0
    let aborted = false
    let markCreated
    const creating = new Promise((resolve) => { markCreated = resolve })
    const stream = { write: async () => { writes++ }, close: async () => {}, abort: async () => { aborted = true } }
    const handle = { createWritable: async () => { markCreated(); return stage === 'stream' ? pending : stream } }
    const e = environment({}, {}, { savePicker: async () => stage === 'picker' ? pending : handle })
    e.window.__itsCallAssist.importCallNotesText('Alex\nNO JOB NUMBER')
    const exporting = e.button('Export TXT').onclick()
    if (stage === 'stream') await creating
    e.window.__itsCallAssist.destroy()
    resolve(stage === 'picker' ? handle : stream)
    await exporting
    assert.equal(writes, 0)
    assert.equal(aborted, stage === 'stream')
  }
})
asyncCheck('Import opens a local file selector, accepts UTF-8 and UTF-16 Notepad files, and can select again', async () => {
  const text = '--------------------\n00123456\nA useful note\nINC1234567\n--------------------'
  for (const encoding of ['utf8', 'utf16le', 'utf16be']) {
    const e = environment()
    e.button('Call Notes').onclick()
    e.button('Import TXT').onclick()
    const input = e.ui().querySelector('input[type="file"]')
    assert.equal(input.clicks, 1)
    assert(input.accept.includes('.txt'))
    let bytes = Buffer.from(text, encoding === 'utf8' ? 'utf8' : 'utf16le')
    if (encoding !== 'utf8') {
      bytes = Buffer.concat([Buffer.from([255, 254]), bytes])
      if (encoding === 'utf16be') bytes.swap16()
    }
    const file = { size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
    await e.importFile(file)
    const record = e.window.__itsCallAssist.callHistorySession().records[0]
    assert.equal(record.caller, '00123456')
    assert.equal(record.notes, 'A useful note')
    assert.equal(record.jobNumber, 'INC1234567')
    assert.equal(input.value, '')
    await e.importFile(file)
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
    assert(e.ui().querySelector('.history-transfer-status').textContent.includes('already present'))
  }
})
asyncCheck('Import errors, cancelled selections and oversized files leave existing records intact', async () => {
  const e = editableHistory()
  const count = e.window.__itsCallAssist.callHistorySession().records.length
  const input = e.ui().querySelector('input[type="file"]')
  input.files = []
  await input.onchange()
  assert(e.ui().querySelector('.history-transfer-status').classList.contains('hidden'))
  for (const file of [{ size: 6 * 1024 * 1024, text: async () => { throw Error('Should not read') } }, { size: 5, text: async () => { throw Error('File unavailable') } }, { size: 1, text: async () => '' }]) {
    await e.importFile(file)
    assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, count)
    assert.equal(e.ui().querySelector('.history-transfer-status').getAttribute('data-error'), 'true')
    assert.equal(e.button('Import TXT').disabled, false)
  }
})
asyncCheck('Closing during import rejects its late file contents without changing session data', async () => {
  let resolve
  const pending = new Promise((_resolve) => { resolve = _resolve })
  const e = editableHistory()
  const importing = e.importFile({ size: 100, text: async () => pending })
  e.window.__itsCallAssist.destroy()
  const before = e.session.get('service-desk-8x8-call-history-v1')
  resolve('Casey\nLate import\nREQ123456')
  await importing
  assert.equal(e.session.get('service-desk-8x8-call-history-v1'), before)
})
function agentSnapshot (e) {
  return e.ui().querySelector('tbody').querySelectorAll('tr').map((row) => ({
    name: row.querySelector('.agent-name').textContent,
    status: row.querySelector('.agent-status').textContent,
    timer: row.querySelector('.agent-time').textContent,
    colour: row.querySelector('.agent-status').getAttribute('data-state')
  }))
}
check('Missing Groups freezes names, statuses, timers and colours, then catches up without losing G1', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'] })
  e.other('Alex Agent', 'Working Offline', 75)
  e.setMe('Available', 50)
  const snapshot = agentSnapshot(e)
  const row = e.checkbox('Alex Agent').closest('tr')
  const lastRead = e.ui().querySelector('.data-last-read').textContent
  e.group.hidden = true
  e.other('Alex Agent', 'Busy', 2)
  e.setMe('Busy', 3)
  e.advance(60000)
  assert.deepEqual(agentSnapshot(e), snapshot)
  assert.equal(e.checkbox('Alex Agent').closest('tr'), row)
  assert.equal(e.ui().querySelector('.data-last-read').textContent, lastRead)
  assert.equal(e.ui().querySelector('.agent-data-badge').textContent, 'Last read')
  assert.equal(e.ui().querySelector('.agents').getAttribute('data-frozen'), 'true')
  assert(e.checkbox('Alex Agent').checked)
  assert(e.checkbox('Alex Agent').disabled)
  assert(!e.ui().querySelector('.main-view').classList.contains('hidden'))
  assert(!e.ui().querySelector('.footer').classList.contains('hidden'))
  e.group.hidden = false
  e.scan()
  const caughtUp = agentSnapshot(e)
  assert.equal(caughtUp[0].status, 'Busy')
  assert.equal(caughtUp.find((agent) => agent.name === 'Alex Agent').timer, '2s')
  assert.equal(e.ui().querySelector('.agent-data-badge').textContent, 'Live')
  assert(e.ui().querySelector('.data-warning').classList.contains('hidden'))
  assert(!e.checkbox('Alex Agent').disabled)
})
check('Missing own presence freezes the whole table instead of replacing Me or pruning other agents', () => {
  const e = environment({ g1: ['Alex Agent'] })
  e.setMe('Working Offline', 30)
  const snapshot = agentSnapshot(e)
  e.header.hidden = true
  e.logout('Alex Agent')
  e.login('New Agent', 'Busy', 7)
  e.scan()
  e.advance(5000)
  assert.deepEqual(agentSnapshot(e), snapshot)
  assert.equal(e.checkbox('New Agent'), null)
  assert(e.checkbox('Me').disabled)
  assert(!e.ui().textContent.includes('Unable to Assist'))
  e.header.hidden = false
  e.scan()
  assert.equal(e.checkbox('Alex Agent'), null)
  assert(e.checkbox('New Agent'))
  assert(JSON.parse(e.storage.get('service-desk-8x8-preferences-v5')).g1.includes('Alex Agent'))
})
check('A partial virtual list freezes cached agents without inferring sign-out or advancing timers', () => {
  const e = environment({ g1: ['Alex Agent'] })
  const snapshot = agentSnapshot(e)
  const list = e.ui().querySelector('.agents')
  list.scrollTop = 55
  e.group.setAttribute('style', 'padding-top: 30px; padding-bottom: 30px;')
  e.agents['Alex Agent'].row.hidden = true
  e.other('Casey Agent', 'Busy', 50)
  e.scan()
  assert.deepEqual(agentSnapshot(e), snapshot)
  assert.equal(list.scrollTop, 55)
  assert(e.window.__itsCallAssist.inspect().agentsFrozen)
  assert.equal(e.debug().activeReminder, null)
  e.group.setAttribute('style', 'padding-top: 0px; padding-bottom: 0px;')
  e.agents['Alex Agent'].row.hidden = false
  e.scan()
  assert.equal(agentSnapshot(e).find((agent) => agent.name === 'Casey Agent').timer, '50s')
  assert(!e.window.__itsCallAssist.inspect().agentsFrozen)
})
check('Readable queues keep their own Live total while the agent table is frozen', () => {
  const e = environment({ g1: ['Alex Agent'] })
  const snapshot = agentSnapshot(e)
  e.group.hidden = true
  e.waiting(2, 400, 0)
  e.waiting(3, 450, 1)
  e.waiting(4, 500, 3)
  e.scan()
  assert.deepEqual(agentSnapshot(e), snapshot)
  assert.equal(monitoringState(e), 'Live')
  assert.equal(e.ui().querySelector('.queue-total').textContent, '9')
  assert.equal(e.debug().activeReminder, null)
  e.waiting(0, 0, 0)
  e.waiting(0, 0, 1)
  e.waiting(0, 0, 3)
  e.scan()
  assert.equal(e.ui().querySelector('.queue-total').textContent, '0')
})
check('Missing queues alone leave agents live, and missing all data freezes both displayed snapshots', () => {
  const e = environment()
  e.waiting(2, 15, 0)
  e.scan()
  for (const queue of e.queues) queue.row.hidden = true
  e.setMe('Working Offline', 42)
  assert.equal(agentSnapshot(e)[0].timer, '42s')
  assert.equal(e.ui().querySelector('.agent-data-badge').textContent, 'Live')
  assert(e.ui().querySelector('.data-warning').classList.contains('hidden'))
  const snapshot = agentSnapshot(e)
  const updated = e.ui().querySelector('.last-updated').querySelector('time').textContent
  e.header.hidden = e.group.hidden = true
  e.scan()
  e.advance(120000)
  assert.deepEqual(agentSnapshot(e), snapshot)
  assert.equal(e.ui().querySelector('.queue-total').textContent, '2')
  assert(e.ui().querySelector('.queue-count-label').textContent.includes('Last read'))
  assert.equal(e.ui().querySelector('.last-updated').querySelector('time').textContent, updated)
})
check('An unreadable G1 timer freezes the table and stops a repeating alert until fresh recovery', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 5 })
  coveragePulse(e, 6, 1)
  coveragePulse(e, 7, 2)
  assert.equal(e.debug().activeReminder.kind, 'critical')
  const snapshot = agentSnapshot(e)
  e.agents['Alex Agent'].timer.textContent = 'unreadable'
  e.setMe('Working Offline', 99)
  assert.deepEqual(agentSnapshot(e), snapshot)
  assert.equal(e.debug().activeReminder, null)
  assert(!e.debug().playing.includes('critical'))
  e.agents['Alex Agent'].timer.textContent = '3s'
  e.scan()
  assert.equal(e.debug().activeReminder, null)
  coveragePulse(e, 8, 100)
  assert.equal(e.debug().activeReminder, null)
  coveragePulse(e, 9, 101)
  assert.equal(e.debug().activeReminder.kind, 'critical')
})
check('An unrelated unreadable G2 row freezes display without altering a fresh G1 alert rule', () => {
  const e = environment({ g1: ['Me', 'Alex Agent'], waitingAlertSeconds: 5 })
  e.agents['Casey Agent'].timer.textContent = 'unreadable'
  coveragePulse(e, 6, 1)
  coveragePulse(e, 7, 2)
  assert(e.window.__itsCallAssist.inspect().agentsFrozen)
  assert.equal(e.window.__itsCallAssist.inspect().unavailable, false)
  assert.equal(e.debug().activeReminder.kind, 'critical')
})
check('Call Notes stays open and editable during a data gap, including polling and recovery', () => {
  const e = editableHistory()
  const card = historyCard(e)
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { caller: '00123456', notes: 'Keep typing\nSecond line', jobNumber: 'REQ123456' })
  const input = card.querySelector('.history-notes-input')
  e.ui().querySelector('.history-list').scrollTop = 40
  e.header.hidden = e.group.hidden = true
  for (const queue of e.queues) queue.row.hidden = true
  e.scan()
  e.advance(30000)
  assert(!e.ui().querySelector('.call-history').classList.contains('hidden'))
  assert(e.ui().querySelector('.data-warning').closest('.call-history'))
  assert.equal(historyCard(e), card)
  assert.equal(card.querySelector('.history-notes-input'), input)
  assert.equal(input.value, 'Keep typing\nSecond line')
  assert.equal(card.querySelector('.history-edit-toggle').textContent, '✓')
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].notes, '')
  e.header.hidden = e.group.hidden = false
  for (const queue of e.queues) queue.row.hidden = false
  e.scan()
  assert(!e.ui().querySelector('.call-history').classList.contains('hidden'))
  assert.equal(card.querySelector('.history-edit-toggle').textContent, '✓')
  assert.equal(e.ui().querySelector('.history-list').scrollTop, 40)
  e.ui().querySelector('.call-history').querySelector('button').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].notes, 'Keep typing\nSecond line')
})
check('Call Notes can be opened, edited and deleted after the whole 8x8 information panel disappears', () => {
  const e = editableHistory()
  e.ui().querySelector('.call-history').querySelector('button').onclick()
  e.header.hidden = e.group.hidden = true
  for (const queue of e.queues) queue.row.hidden = true
  e.scan()
  e.button('Call Notes').onclick()
  const card = historyCard(e)
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { notes: 'Saved while information was hidden', jobNumber: 'INC1234567' })
  card.querySelector('.history-edit-toggle').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].notes, 'Saved while information was hidden')
  card.querySelector('.history-delete').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 0)
  e.button('Undo delete').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 1)
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
})
check('Frozen warnings follow the current menu and remain visible when the main table is minimised', () => {
  const e = environment()
  e.group.hidden = true
  e.scan()
  const warning = e.ui().querySelector('.data-warning')
  assert(warning.closest('.main-view'))
  e.button('-').onclick()
  assert(e.ui().querySelector('.main-content').classList.contains('hidden'))
  assert(!warning.classList.contains('hidden'))
  e.button('Settings').onclick()
  assert(warning.closest('.assistant-settings'))
  e.button('Open Sound Settings').onclick()
  assert(warning.closest('.sound-settings'))
  assert.equal(e.ui().querySelector('.sound-settings').children[1], warning)
  assert.equal(warning.getAttribute('role'), 'status')
  assert.equal(warning.getAttribute('aria-live'), 'polite')
  e.ui().querySelector('.sound-settings').querySelector('button').onclick()
  e.ui().querySelector('.assistant-settings').querySelector('button').onclick()
  assert(warning.closest('.main-view'))
})
check('Sound Settings and manual previews remain usable while monitoring lacks agent information', () => {
  const e = environment()
  e.group.hidden = true
  e.scan()
  e.button('Settings').onclick()
  e.button('Open Sound Settings').onclick()
  const preview = e.ui().querySelector('fieldset').querySelectorAll('button').find((button) => button.textContent === 'Preview')
  preview.onclick()
  assert(e.debug().playing.includes('preview'))
  e.scan()
  assert(!e.debug().playing.includes('preview'))
  assert(e.ui().querySelector('[data-kind="preview"]').textContent.includes('Sound finished'))
  assert.equal(e.notifications.length, 0)
  e.button('Stop preview').onclick()
  assert(!e.debug().playing.includes('preview'))
})
check('Starting without readable data keeps menus available and clearly shows that nothing was read yet', () => {
  const e = environment({}, {}, {
    beforeStart: ({ header, group, queues }) => {
      header.hidden = group.hidden = true
      for (const queue of queues) queue.row.hidden = true
    }
  })
  assert(e.window.__itsCallAssist.inspect().agentsFrozen)
  assert.equal(agentSnapshot(e)[0].status, 'Not yet read')
  assert.equal(agentSnapshot(e)[0].timer, '—')
  assert(e.ui().querySelector('.data-last-read').textContent.includes('No live agent information'))
  assert.equal(e.ui().querySelector('.queue-total').textContent, '—')
  e.button('Call Notes').onclick()
  assert(e.ui().querySelector('.history-empty'))
  e.ui().querySelector('.call-history').querySelector('button').onclick()
  e.button('Settings').onclick()
  assert(!e.ui().querySelector('.assistant-settings').classList.contains('hidden'))
  e.header.hidden = e.group.hidden = false
  for (const queue of e.queues) queue.row.hidden = false
  e.scan()
  assert(!e.window.__itsCallAssist.inspect().agentsFrozen)
  assert(!e.ui().querySelector('.assistant-settings').classList.contains('hidden'))
})
check('Unreadable own timers freeze the table but readable Busy transitions keep statistics accurate', () => {
  const e = environment()
  const snapshot = agentSnapshot(e)
  e.meTimer.textContent = 'unreadable'
  e.meStatus.setAttribute('data-status-value', 'Busy')
  e.scan()
  assert.deepEqual(agentSnapshot(e), snapshot)
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  e.button('Call Notes').onclick()
  assert.equal(e.ui().querySelector('.history-statistics').querySelector('.notes-total').textContent, '0')
  e.meStatus.setAttribute('data-status-value', 'Available')
  e.scan()
  e.meStatus.setAttribute('data-status-value', 'Busy')
  e.scan()
  assert.equal(e.window.__itsCallAssist.statistics().total, 2)
})
check('A missing phone card preserves an explicitly open Call Notes editor when the same call returns', () => {
  const e = editableHistory()
  e.showCall({ transactionId: 'frozen-connected-call' })
  e.caller('Current Caller')
  e.ui().querySelector('.call-heading').querySelectorAll('button').find((button) => button.textContent === 'Call Notes').onclick()
  const card = historyCard(e)
  card.querySelector('.history-edit-toggle').onclick()
  editNoteFields(card, { notes: 'Editing an earlier call' })
  e.personalPage().hidden = true
  e.scan()
  assert(!e.ui().querySelector('.call-history').classList.contains('hidden'))
  e.personalPage().hidden = false
  e.scan()
  assert(!e.ui().querySelector('.call-history').classList.contains('hidden'))
  assert.equal(card.querySelector('.history-edit-toggle').textContent, '✓')
  assert.equal(e.window.__itsCallAssist.callHistorySession().pending[0].callerInput, 'Current Caller')
})
check('Call Notes opened during a call-data gap remains open on recovery; real Wrap up still takes priority', () => {
  const e = environment({ g1: [] })
  e.showCall()
  e.notes('Unfinished call draft')
  e.personalPage().hidden = true
  e.scan()
  e.button('Call Notes').onclick()
  e.personalPage().hidden = false
  e.scan()
  assert(!e.ui().querySelector('.call-history').classList.contains('hidden'))
  e.showWrapUp(120, { seconds: 20 })
  assert(!e.ui().querySelector('.compact-view').classList.contains('hidden'))
  assert(e.ui().querySelector('.call-history').classList.contains('hidden'))
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].notes, 'Unfinished call draft')
})
check('Ambiguous agent identities freeze the table until a complete unambiguous roster returns', () => {
  const e = environment({ g1: ['Alex Agent'] })
  const snapshot = agentSnapshot(e)
  e.login('Alex Agent', 'Busy', 500)
  e.scan()
  assert.deepEqual(agentSnapshot(e), snapshot)
  assert(e.window.__itsCallAssist.inspect().agentsFrozen)
  assert.equal(e.debug().activeReminder, null)
  e.agents['Alex Agent'].row.remove()
  e.scan()
  assert(!e.window.__itsCallAssist.inspect().agentsFrozen)
})
check('A reader error keeps Call Notes accessible and frozen data out of monitoring until recovery', () => {
  const e = editableHistory()
  const query = e.window.document.querySelectorAll
  const snapshot = agentSnapshot(e)
  e.window.document.querySelectorAll = () => { throw Error('Simulated page replacement') }
  const warn = console.warn
  try {
    console.warn = () => {}
    e.scan()
  } finally {
    console.warn = warn
  }
  assert.deepEqual(agentSnapshot(e), snapshot)
  assert(!e.ui().querySelector('.call-history').classList.contains('hidden'))
  assert(e.window.__itsCallAssist.inspect().agentsFrozen)
  assert(monitoringState(e).includes('Queue data unavailable'))
  historyCard(e).querySelector('.history-edit-toggle').onclick()
  editNoteFields(historyCard(e), { notes: 'Still accessible' })
  historyCard(e).querySelector('.history-edit-toggle').onclick()
  e.window.document.querySelectorAll = query
  e.scan()
  assert(!e.window.__itsCallAssist.inspect().agentsFrozen)
  assert.equal(e.window.__itsCallAssist.callHistorySession().records[0].notes, 'Still accessible')
})
asyncCheck('Frozen Call Notes still imports and exports local TXT without depending on 8x8 panels', async () => {
  const e = editableHistory()
  e.header.hidden = e.group.hidden = true
  for (const queue of e.queues) queue.row.hidden = true
  e.scan()
  await e.importFile({ size: 100, text: async () => 'Imported Caller\nImported while frozen\nREQ123456' })
  await e.button('Export TXT').onclick()
  assert.equal(e.window.__itsCallAssist.callHistorySession().records.length, 2)
  assert.equal(e.downloads.length, 1)
  const exported = await e.blobs.get(e.downloads[0].href).text()
  assert(exported.includes('Imported while frozen'))
  assert.equal(e.window.__itsCallAssist.statistics().total, 1)
  assert(e.window.__itsCallAssist.inspect().agentsFrozen)
})
;(async () => {
  for (const { name, fn } of asyncChecks) {
    await fn()
    passed++
    console.log('PASS:', name)
  }
  console.log(`${passed} scenarios passed.`)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
