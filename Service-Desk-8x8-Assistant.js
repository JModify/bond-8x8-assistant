/* Service Desk 8x8 Assistant — v1.0.5
 * Author: Joshua Lavagna-Slater
 * Run in the existing logged-in 8x8 tab: DevTools > Sources > Snippets >
 * New snippet. Paste this entire file, then press Ctrl+Enter.
 * Open queue information using the button to the right of your status,
 * next to the bell. Enter the three inbound queue names in Assistant > Settings.
 * In 8x8 Groups > Filter, choose your group and tick every User status.
 * Select the G1 agents, including Me when covering phones; Mute silences tones.
 * Lunch and disposition reminders apply in both G1 and G2.
 * Browser audio may require a click in the page; normal interactions enable it.
 * No downloads, external requests, credentials, or second login are used.
 * Reads rendered queue/agent HTML; never changes your availability or answers calls.
 * Keep the three inbound queue rows and selected agents rendered in the sidebar.
 * Background browser throttling, page freezing, logout, closure and refresh
 * can delay/stop monitoring. Rerun after a refresh. Not a guaranteed alarm service.
 * In G2, assistance uses the break, waiting and coverage rules.
 * In G1, Me gets queue-based Working Offline, disposition and lunch reminders.
 * Timings are configurable in Assistant Settings. Only one personal alarm runs.
 * G1 selections, assistant settings and sounds persist when storage is permitted.
 * Break and disposition pages use compact personal timers without queue information.
 * Other missing queue/group information hides the controls until it returns.
 * Muting keeps monitoring, timers, notifications and statistics running.
 * Statistics record observed Busy starts, not 8x8's complete historical call totals.
 */
(() => {
  'use strict'
  let root = window
  // Reuse the same-origin top page so rerunning inside an iframe cannot create
  // a second assistant. Cross-origin frames are intentionally left alone.
  try {
    if (window.top.location.origin === window.location.origin) root = window.top
  } catch {
    // The browser denies access to a cross-origin top page; use this window.
  }
  if (root.location.hostname !== 'vcc-au2.8x8.com') {
    throw new Error('Run this snippet in your existing vcc-au2.8x8.com tab.')
  }
  // Carry an ongoing disposition timer across a snippet restart, then remove
  // the previous assistant's observers, audio and panel before starting again.
  const resumedWrapUp = root.__itsCallAssist?.wrapUpSession?.()
  root.__itsCallAssist?.destroy()
  const doc = root.document
  const VERSION = '1.0.5'
  const SCAN_INTERVAL_MS = 1000
  const ROSTER_SETTLE_MS = SCAN_INTERVAL_MS
  const FRESHNESS_WINDOW_MS = 30000
  const SECONDS_PER_MINUTE = 60
  const MILLISECONDS_PER_SECOND = 1000
  let wrapUpSession = resumedWrapUp || null
  // Page labels may contain repeated whitespace or missing text nodes.
  const normaliseText = value =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  // Status comparisons ignore letter case, while displayed labels stay intact.
  const normaliseStatus = value => normaliseText(value).toLowerCase()
  const QUEUE_CONFIG_KEY = 'service-desk-8x8-inbound-queues-v1'
  function validQueueNames (value) {
    if (!Array.isArray(value) || value.length !== 3) return false
    // Blank labels cannot identify a queue, and duplicate labels double-count it.
    const allNamesPresent = value.every(name => typeof name === 'string' && normaliseText(name))
    const allNamesUnique = new Set(value.map(normaliseText)).size === 3
    return allNamesPresent && allNamesUnique
  }
  let QUEUES = []
  // Corrupt or inaccessible site storage falls back to the normal setup menu.
  try {
    const value = JSON.parse(root.localStorage.getItem(QUEUE_CONFIG_KEY) || 'null')
    if (validQueueNames(value)) QUEUES = value.map(normaliseText)
  } catch {
    // Monitoring starts after the user supplies valid queue names.
  }
  // A private configured download may seed queue names without publishing them.
  if (!QUEUES.length && validQueueNames(root.__serviceDesk8x8Queues)) {
    QUEUES = root.__serviceDesk8x8Queues.map(normaliseText)
  }
  function parseDuration (text) {
    const value = normaliseStatus(text)
    if (!value) return null
    // Accept the MM:SS and H:MM:SS clocks shown on break and wrap-up pages.
    if (/^\d+:\d{2}(?::\d{2})?$/.test(value)) {
      const clock = value.split(':').map(Number)
      // Only the first component may exceed 59; later components are base 60.
      if (clock.slice(1).some(part => part >= SECONDS_PER_MINUTE)) return null
      const seconds = clock.reduce((total, part) => total * SECONDS_PER_MINUTE + part, 0)
      return Number.isSafeInteger(seconds) ? seconds : null
    }
    // Capture a numeric amount and its unit from labels such as "2m 10s".
    const unitPattern = /(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g
    const parts = [...value.matchAll(unitPattern)]
    // Any unmatched text makes the timer ambiguous; never guess its duration.
    if (!parts.length || normaliseText(value.replace(unitPattern, ''))) return null
    const unitSeconds = { h: 3600, m: SECONDS_PER_MINUTE, s: 1 }
    // The first unit letter identifies hours, minutes or seconds for each match.
    const seconds = parts.reduce((total, match) => total + Number(match[1]) * unitSeconds[match[2][0]], 0)
    return Number.isSafeInteger(seconds) ? seconds : null
  }
  function isVisible (node) {
    // A detached or collapsed row is not evidence of an agent's current status.
    if (!node || !node.getClientRects().length) return false
    const view = node.ownerDocument.defaultView
    // A visible-looking child can still belong to a hidden parent panel.
    for (let ancestor = node; ancestor?.nodeType === 1; ancestor = ancestor.parentElement) {
      const css = view.getComputedStyle(ancestor)
      const hidden = ancestor.hidden || css.display === 'none'
      const invisible = css.visibility === 'hidden' || css.visibility === 'collapse'
      if (hidden || invisible) return false
    }
    return true
  }
  function getReadableDocuments () {
    const found = []
    const seen = new Set()
    function walk (pageDocument) {
      // Avoid revisiting the same document while descending through nested frames.
      if (!pageDocument || seen.has(pageDocument)) return
      seen.add(pageDocument)
      found.push(pageDocument)
      for (const frame of pageDocument.querySelectorAll('iframe,frame')) {
        try {
          if (isVisible(frame)) walk(frame.contentDocument)
        } catch {
          // Browser permissions prevent reading cross-origin frames.
        }
      }
    }
    walk(doc)
    return found
  }
  function agentRows (docs) {
    // Collect live rows across readable frames and skip hidden duplicate panels.
    return docs.flatMap(d => [...d.querySelectorAll('[data-test-id="agent-item"]')].filter(isVisible))
  }
  // Only inspect the supplied status markers. Never read caller names or details.
  function readPersonalPage (docs) {
    // Dedicated personal markers remain visible while queue and roster panels vanish.
    const breaks = docs
      .flatMap(d => [...d.querySelectorAll('[data-test-id="on-break-timer"]')])
      .filter(isVisible)
    const wraps = docs
      .flatMap(d => [...d.querySelectorAll('[data-test-id="wrap-up-label"]')])
      .filter(node => isVisible(node) && dispositionStatus(node.textContent))
    if (breaks.length === 1 && !wraps.length) {
      const timer = breaks[0]
      const text = normaliseText(timer.textContent)
      const seconds = parseDuration(text)
      if (seconds === null) return null
      // Break length is enough for this reminder; no other page details are read.
      return { kind: 'break', status: 'On Break', timer: text, seconds, liveTimer: text }
    }
    if (wraps.length === 1 && !breaks.length) {
      // Scope the countdown to the active phone card, not another interaction tab.
      const card = wraps[0].closest('[data-test-id="phone-card-test-id"]')
      const timer = card?.querySelector('[data-test-id="progress-timer"][aria-label="Wrap up"]')
      if (!isVisible(timer)) return null
      const text = normaliseText(timer.textContent)
      const remaining = parseDuration(text)
      if (remaining === null) return null
      // This is 8x8's countdown, not time spent in disposition. The separate
      // interaction-time-label is the finished call's duration and is ignored.
      return { kind: 'disposition', status: 'Wrap Up', remaining, liveTimer: text }
    }
    return null
  }
  function pagePresence (page) {
    if (page.kind === 'break') {
      wrapUpSession = null
      return { name: 'Me', ...page }
    }
    const now = Date.now()
    if (!wrapUpSession) wrapUpSession = { startedAt: now, initialRemaining: page.remaining }
    // A header timer can supply elapsed time before the dedicated page appears.
    if (!Number.isFinite(wrapUpSession.initialRemaining)) {
      wrapUpSession.initialRemaining = page.remaining + (wrapUpSession.elapsed || 0)
    }
    // Wall time advances between page updates; a native countdown jump catches up
    // after browser throttling. Taking the maximum prevents either clock rewinding.
    const wallElapsed = Math.floor((now - wrapUpSession.startedAt) / MILLISECONDS_PER_SECOND)
    const countdownElapsed = wrapUpSession.initialRemaining - page.remaining
    const seconds = Math.max(
      0,
      wrapUpSession.elapsed || 0,
      wallElapsed,
      countdownElapsed
    )
    wrapUpSession.elapsed = seconds
    return { name: 'Me', ...page, seconds, timer: seconds + 's' }
  }
  const agentName = row =>
    // The name label's title is reliable even when its visible text is truncated.
    normaliseText(
      row.querySelector('[data-test-id="agent-name-label"]')?.getAttribute('title') ||
        row.getAttribute('aria-label')
    )
  function readAgentAndQueues (docs, name) {
    const errors = []
    // A unique name match is required; duplicate rows must not choose an agent at random.
    const candidates = agentRows(docs).filter(r => agentName(r) === name)
    let agent = null
    if (name === 'Me') {
      agent = readMyPresence(docs)
      if (!agent) errors.push('Your status or timer is unreadable')
    } else if (candidates.length !== 1) {
      errors.push(
        `Agent row ${candidates.length ? 'ambiguous' : 'missing'}: ${name || '(choose an agent)'}`
      )
    } else {
      const row = candidates[0]
      const status = normaliseText(
        row.querySelector('[data-status-value]')?.getAttribute('data-status-value')
      )
      const timer = normaliseText(row.querySelector('[data-test-id="user-presence-timer"]')?.textContent)
      const seconds = parseDuration(timer)
      if (!status || seconds === null) errors.push('Agent status or timer unreadable')
      else agent = { name, status, timer, seconds }
    }
    // Only the three exact configured inbound names are read; outbound rows are ignored.
    const rows = docs.flatMap(d =>
      [...d.querySelectorAll('[data-test-id="queue-item"]')].filter(isVisible)
    )
    const queues = QUEUES.map(name => {
      // Queue names come from the label title, preserving the user's exact spelling.
      const matches = rows.filter(
        r => normaliseText(r.querySelector('[data-test-id="queue-name"]')?.getAttribute('title')) === name
      )
      if (matches.length !== 1) {
        errors.push(`Queue row ${matches.length ? 'ambiguous' : 'missing'}: ${name}`)
        return { name, waiting: null }
      }
      // Accessible cell titles identify the waiting count without assuming column order.
      const cells = [...matches[0].querySelectorAll('[role="gridcell"][title]')]
      const cellsWaiting = cells.filter(c =>
        /^\d+\s+Interactions? waiting$/i.test(normaliseText(c.getAttribute('title')))
      )
      // Read only a single numeric waiting-count cell, then cross-check its title.
      const waiting =
        cellsWaiting.length === 1 && /^\d+$/.test(normaliseText(cellsWaiting[0].textContent))
          ? Number(normaliseText(cellsWaiting[0].textContent))
          : null
      const titleCount =
        cellsWaiting.length === 1
          ? Number(cellsWaiting[0].getAttribute('title').match(/^\d+/)?.[0])
          : null
      // Mismatched text and title can occur midway through a page update.
      if (waiting === null || waiting !== titleCount || !Number.isSafeInteger(waiting)) {
        errors.push(`Waiting count unreadable: ${name}`)
        return { name, waiting: null }
      }
      // The real caller age is 8x8's Longest waiting time, not an agent's Busy timer.
      const waits = cells.filter(c =>
        /\sLongest waiting time$/i.test(normaliseText(c.getAttribute('title')))
      )
      // No waiting caller has zero age; a waiting caller with unreadable age stays unknown.
      let waitSeconds = waiting === 0 ? 0 : null
      if (waiting > 0 && waits.length === 1) {
        const labelled = parseDuration(
          normaliseText(waits[0].getAttribute('title')).replace(/\sLongest waiting time$/i, '')
        )
        const displayed = parseDuration(normaliseText(waits[0].textContent))
        // Require both representations to agree before enabling a timed queue alert.
        if (labelled !== null && displayed !== null && labelled === displayed) {
          waitSeconds = labelled
        }
      }
      return { name, waiting, waitSeconds }
    })
    return { agent, queues, errors }
  }
  function readMyPresence (docs) {
    const page = readPersonalPage(docs)
    if (page) return pagePresence(page)
    const candidates = []
    for (const pageDocument of docs) {
      for (const timer of pageDocument.querySelectorAll('[data-test-id="user-presence-timer"]')) {
        // Ignore agent-row timers: only the user's header represents Me here.
        if (!isVisible(timer) || timer.closest('[data-test-id="agent-item"]')) continue
        // The supplied header nests the timer one level below the status wrapper.
        let wrapper = timer.parentElement
        for (let depth = 0; wrapper && depth < 4; depth++, wrapper = wrapper.parentElement) {
          // Pair exactly one status with exactly one timer, avoiding open status menus.
          const states = [...wrapper.querySelectorAll('[data-status-value]')].filter(isVisible)
          const timers = wrapper.querySelectorAll('[data-test-id="user-presence-timer"]')
          if (states.length === 1 && timers.length === 1) {
            const status = normaliseText(states[0].getAttribute('data-status-value'))
            const text = normaliseText(timer.textContent)
            const seconds = parseDuration(text)
            if (status && seconds !== null) {
              candidates.push({ name: 'Me', status, timer: text, seconds })
            }
            break
          }
        }
      }
    }
    // Multiple plausible headers are ambiguous and must not produce an alert.
    const me = candidates.length === 1 ? candidates[0] : null
    if (me && dispositionStatus(me.status)) {
      // A readable elapsed header clock gives an earlier start than first page detection.
      wrapUpSession = {
        startedAt: Date.now() - me.seconds * 1000,
        elapsed: me.seconds,
        initialRemaining: null
      }
    } else if (me) wrapUpSession = null
    return me
  }
  function readCounterPresence (docs) {
    const page = readPersonalPage(docs)
    if (page) return { status: page.status }
    // Statistics need a status transition, even if queues or the status timer are hidden.
    const states = docs
      .flatMap(d => [...d.querySelectorAll('[data-test-id="user-status"][data-status-value]')])
      .filter(node => !node.closest('[data-test-id="agent-item"]') && isVisible(node))
    if (states.length !== 1) {
      // An open status picker can add icons. The header's own timer identifies
      // the actual presence in that case; no queue or group counts are read.
      const me = readMyPresence(docs)
      return me ? { status: me.status } : null
    }
    const status = normaliseText(states[0].getAttribute('data-status-value'))
    return status ? { status } : null
  }
  // 8x8 uses several spellings for the same state across its header and phone card.
  const normaliseStatusLabel = status => normaliseText(normaliseStatus(status).replace(/[-_]/g, ' '))
  const offlineStatuses = new Set(['work offline', 'working offline'])
  const dispositionStatuses = new Set(['wrap up', 'wrapup', 'post processing', 'postprocessing', 'disposition'])
  const unavailableStatuses = new Set(['busy', 'on break', 'break', 'other work', ...offlineStatuses, ...dispositionStatuses])

  function workingOffline (status) {
    return offlineStatuses.has(normaliseStatusLabel(status))
  }

  function dispositionStatus (status) {
    return dispositionStatuses.has(normaliseStatusLabel(status))
  }

  function personalPageKind (me) {
    if (!me) return ''
    if (['on break', 'break'].includes(normaliseStatus(me.status))) return 'break'
    if (dispositionStatus(me.status)) return 'disposition'
    return ''
  }

  function callerWaitReached (queue, delaySeconds, selfInG1) {
    // Unknown ages cannot prove that a caller has exceeded the configured delay.
    if (!(queue.waiting > 0) || !Number.isFinite(queue.waitSeconds)) return false
    // G1 requires strictly longer than the delay; retain G2's inclusive boundary.
    return selfInG1 ? queue.waitSeconds > delaySeconds : queue.waitSeconds >= delaySeconds
  }

  function groupRules (agents, queues, me = null, waitingAlertSeconds = 180, selfInG1 = false) {
    // Check every configured queue before interpreting any waiting caller's age.
    const queueCountsReadable = queues.length === QUEUES.length && queues.every(queue => queue.waiting !== null)
    const callerNeedsCover = queueCountsReadable && queues.some(queue => callerWaitReached(queue, waitingAlertSeconds, selfInG1))

    // Me cannot count as another G1 agent available to cover their own offline state.
    const covering = selfInG1 ? agents.filter(agent => agent.name !== 'Me') : agents
    const ownStatusEligible = !!me?.status && (selfInG1 ? workingOffline(me.status) : normaliseStatus(me.status) !== 'available')
    // In G1, Me is sufficient to make a group; G2 needs another signed-in G1 agent.
    const hasPhoneGroup = selfInG1 || covering.length > 0
    // G1 needs no other Available agent; G2 accepts only recognised unavailable states.
    const nobodyCanTakeCall = covering.every(agent => selfInG1
      ? normaliseStatus(agent.status) !== 'available'
      : unavailableStatuses.has(normaliseStatusLabel(agent.status)))

    return {
      // Break information is separate from the phone-cover alarm and is G2-only.
      lunch: agents.filter(agent => normaliseStatus(agent.status) === 'on break').map(agent => agent.name),
      critical: ownStatusEligible && callerNeedsCover && hasPhoneGroup && nobodyCanTakeCall
    }
  }

  function personalRule (me, lunchMinutes, dispositionSeconds = 20) {
    // Personal reminders depend only on a readable own state and elapsed timer.
    if (!me || !me.status || !Number.isFinite(me.seconds)) return null
    const status = normaliseStatus(me.status)
    if (dispositionStatus(status)) {
      // The reminder begins after the limit, including in G2.
      if (me.seconds <= dispositionSeconds) return null
      return {
        kind: 'disposition',
        title: 'Alert: Complete Disposition',
        body: `You have been in disposition for more than ${dispositionSeconds} seconds. Complete the fields and click Wrap up.`
      }
    }
    if (status === 'on break' || status === 'break') {
      // Lunch settings use minutes; the page clock and comparison use seconds.
      const lunchSeconds = lunchMinutes * SECONDS_PER_MINUTE
      if (me.seconds <= lunchSeconds) return null
      return {
        kind: 'lunchOverdue',
        title: 'Alert: Lunch Break Finished',
        body: `You have been "On Break" for longer than your ${lunchMinutes}-minute lunch break. Change your status to "Available".`
      }
    }
    // Other Work and Working Offline are permitted. Only the queue-based
    // coverage rule can request an availability change from Working Offline.
    return null
  }
  const host = doc.createElement('div')
  host.id = 'its-call-assist-panel'
  host.style.cssText =
    'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:calc(100vw - 36px)'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  // Keep assistant styles inside its shadow root so the 8x8 controls are unaffected.
  style.textContent = `
    :host {
      font:
        13px/1.45 system-ui,
        sans-serif;
      color: #172235;
    }
    * {
      box-sizing: border-box;
    }
    .panel {
      width: 470px;
      max-width: 100%;
      max-height: 85vh;
      overflow: auto;
      background: #fff;
      border: 1px solid #b5c6dc;
      border-radius: 12px;
      box-shadow: 0 8px 35px #0004;
      padding: 16px;
    }
    h3 {
      margin: 0 0 10px;
      font-size: 16px;
    }
    label {
      display: block;
      margin: 8px 0;
    }
    select,
    input[type="text"] {
      display: block;
      width: 100%;
      padding: 6px;
      border: 1px solid #a4b2c7;
      border-radius: 5px;
      background: white;
      color: #172235;
    }
    button {
      cursor: pointer;
      padding: 6px 9px;
      margin: 4px 4px 0 0;
      border: 1px solid #afbdd0;
      background: #eef3fa;
      color: #172235;
      border-radius: 5px;
    }
    button.primary {
      background: #245dc1;
      color: white;
    }
    .small {
      font-size: 11px;
      color: #526176;
    }
    pre {
      font: 12px/1.5 system-ui;
      white-space: pre-wrap;
      margin: 10px 0;
    }
    .alert {
      padding: 9px;
      background: #fff0cb;
      border-radius: 6px;
      margin-top: 8px;
    }
    .hidden {
      display: none !important;
    }
    .agents {
      max-height: 240px;
      overflow: auto;
      border: 1px solid #d7e0ec;
      border-radius: 6px;
      margin: 8px 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
    }
    th,
    td {
      text-align: left;
      padding: 6px;
    }
    th {
      background: #eef3fa;
      position: sticky;
      top: 0;
    }
    td {
      border-top: 1px solid #e4eaf2;
    }
    .state {
      display: block;
      color: #526176;
      font-size: 11px;
    }
    input[type="checkbox"] {
      cursor: pointer;
      width: 16px;
      height: 16px;
    }
    .unavailable {
      font-weight: 600;
    }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .top button {
      margin: 0;
      padding: 2px 7px;
    }
    
    .menu-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 18px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e4eaf2;
      position: sticky;
      top: 0;
      z-index: 2;
      background: #fff;
    }
    .menu-header h3 {
      margin: 0;
    }
    .menu-header button {
      margin: 0;
      flex-shrink: 0;
      padding: 6px 10px;
    }
    .sound-category {
      min-width: 0;
      margin: 0 0 20px;
      padding: 12px 14px 14px;
      border: 1px solid #d7e0ec;
      border-radius: 8px;
      background: #f8faff;
    }
    .sound-category legend {
      padding: 0 6px;
      font-weight: 600;
      font-size: 12px;
    }
    .sound-description {
      margin-bottom: 12px;
    }
    .sound-description p {
      margin: 0 0 8px;
    }
    .sound-description p:last-child {
      margin-bottom: 0;
    }
    .sound-description ul {
      margin: 0 0 8px;
      padding-left: 18px;
    }
    .sound-description li {
      margin-bottom: 5px;
    }
    .sound-field {
      display: grid;
      gap: 6px;
      margin: 12px 0;
      font-weight: 500;
    }
    .sound-settings select,
    .sound-settings input[type="number"],
    .assistant-settings input[type="number"] {
      width: 100%;
      padding: 8px;
      border: 1px solid #a4b2c7;
      border-radius: 5px;
      background: #fff;
      color: #172235;
      font: inherit;
    }
    .volume-control {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .volume-control input {
      flex: 1;
      min-width: 0;
      width: 100%;
      margin: 0;
      accent-color: #245dc1;
      cursor: pointer;
    }
    .volume-value {
      flex: 0 0 42px;
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .repeat-control {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 14px 0;
    }
    .repeat-control input {
      flex-shrink: 0;
      margin: 0;
      accent-color: #245dc1;
    }
    .sound-field.disabled {
      color: #8993a2;
    }
    .sound-settings input:disabled {
      background: #edf0f4;
      border-color: #d7dde6;
      color: #8993a2;
      cursor: not-allowed;
    }
    .sound-actions {
      display: flex;
      gap: 8px;
      margin-top: 20px;
      padding-top: 4px;
    }
    .sound-actions button {
      margin: 0;
    }
    .settings-card {
      margin: 0 0 20px;
      padding: 14px;
      border: 1px solid #d7e0ec;
      border-radius: 8px;
      background: #f8faff;
    }
    .settings-card h4 {
      margin: 0 0 6px;
      font-size: 13px;
    }
    .settings-description {
      margin: 0 0 14px;
      font-size: 12px;
      color: #526176;
    }
    .setting-value {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }
    .assistant-settings .setting-value input {
      width: 85px;
    }
    .section-heading {
      margin: 14px 0 8px;
      font-size: 13px;
      font-weight: 600;
    }
    .agent-table {
      table-layout: fixed;
    }
    .agent-table th:nth-child(1) {
      width: 34%;
    }
    .agent-table th:nth-child(2) {
      width: 30%;
    }
    .agent-table th:nth-child(3) {
      width: 25%;
    }
    .agent-table th:nth-child(4) {
      width: 11%;
    }
    .agent-table th:last-child,
    .agent-table td:last-child {
      text-align: center;
    }
    .agent-table td {
      vertical-align: middle;
      padding: 8px 6px;
    }
    .agent-name {
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .agent-time {
      white-space: nowrap;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .agent-status {
      display: inline-block;
      max-width: 100%;
      padding: 2px 5px;
      border-radius: 4px;
      background: #edf1f6;
      color: #526176;
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .agent-status[data-state="available"] {
      background: #e6f5ed;
      color: #17633a;
    }
    .agent-status[data-state="busy"] {
      background: #fdeceb;
      color: #9a2c27;
    }
    .agent-status[data-state="working offline"],
    .agent-status[data-state="work offline"] {
      background: #fff0dc;
      color: #a95005;
    }
    .agent-status[data-state="wrap up"],
    .agent-status[data-state="post processing"] {
      background: #f0eafb;
      color: #654293;
    }
    .agent-table input[type="checkbox"] {
      margin: 0;
      accent-color: #245dc1;
      vertical-align: middle;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid #e4eaf2;
    }
    .footer-details {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
    }
    .footer-detail {
      font-size: 10px;
      color: #526176;
      font-variant-numeric: tabular-nums;
    }
    .footer-detail time,
    .footer-value {
      display: block;
      font-size: 12px;
      color: #172235;
      margin-top: 2px;
    }
    .assistant-bottom {
      position: sticky;
      bottom: -16px;
      background: #fff;
      padding-bottom: 2px;
      z-index: 3;
    }
    .current-reminders {
      margin: 14px 0 0;
      padding: 0;
      background: none;
      display: grid;
      gap: 9px;
    }
    .current-reminder {
      --notice-accent: #b85809;
      --notice-bg: #fff7e8;
      padding: 12px 14px;
      border: 1px solid #e6c489;
      border-left: 4px solid var(--notice-accent);
      border-radius: 9px;
      background: var(--notice-bg);
      box-shadow: 0 3px 10px #1722350a;
      overflow-wrap: anywhere;
    }
    .current-reminder[data-severity="info"] {
      --notice-accent: #245dc1;
      --notice-bg: #edf4ff;
      border-color: #b8cee9;
      border-left-color: var(--notice-accent);
    }
    .current-reminder[data-severity="preview"] {
      --notice-accent: #7650a5;
      --notice-bg: #f4f0fc;
      border-color: #d5c7ea;
      border-left-color: var(--notice-accent);
    }
    .reminder-heading {
      display: flex;
      align-items: flex-start;
      gap: 9px;
    }
    .reminder-mark {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 21px;
      height: 21px;
      border-radius: 50%;
      background: var(--notice-accent);
      color: white;
      font-weight: 700;
      font-size: 12px;
    }
    .reminder-title {
      font-size: 12px;
      line-height: 1.5;
      color: #172235;
    }
    .reminder-reason {
      margin: 7px 0 0;
      font-size: 12px;
      color: #3f4c60;
      line-height: 1.5;
    }
    .reminder-state {
      display: block;
      margin-top: 7px;
      font-size: 10px;
      color: var(--notice-accent);
      font-weight: 600;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .controls button {
      margin: 0;
      padding: 6px 8px;
      font-size: 12px;
    }
    .agent-help {
      margin: 8px 0 14px;
    }
    .title-block h3 {
      margin: 0;
    }
    .author {
      margin-top: 3px;
    }
    .window-actions {
      display: flex;
      gap: 5px;
      align-self: flex-start;
    }
    .top .window-actions button {
      width: 27px;
      height: 27px;
      padding: 0;
      font-size: 17px;
      line-height: 1;
    }
    .monitor-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
    }
    .monitor-grid > section {
      min-width: 0;
    }
    .monitoring-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid #d7e0ec;
      border-radius: 8px;
      background: #f8faff;
    }
    .queue-count {
      display: flex;
      align-items: baseline;
      gap: 9px;
    }
    .queue-total {
      font-size: 28px;
      line-height: 1;
      font-weight: 650;
      color: #245dc1;
      font-variant-numeric: tabular-nums;
    }
    .monitoring-state {
      max-width: 45%;
      font-size: 10px;
      color: #526176;
      text-align: right;
    }
    .monitoring-state[data-state="live"] {
      color: #17633a;
    }
    .statistics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .stat {
      min-width: 0;
      padding: 11px 10px;
      border: 1px solid #d7e0ec;
      border-radius: 8px;
      background: #f8faff;
    }
    .stat-label {
      display: block;
      font-size: 11px;
      color: #526176;
    }
    .stat-value {
      display: block;
      margin-top: 5px;
      font-size: 20px;
      line-height: 1.2;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .stat-total {
      color: #245dc1;
    }
    .statistics-note {
      font-size: 10px;
      color: #526176;
      margin-top: 10px;
    }
    .notification-feedback {
      margin: 10px 0 0;
      color: #526176;
      font-size: 11px;
    }
    .compact-view {
      width: 100%;
      --progress-colour: #245dc1;
      --progress-soft: #eaf1fe;
    }
    .panel.compact {
      width: 390px;
      padding: 14px 16px;
    }
    .compact-view[data-kind="disposition"] {
      --progress-colour: #7650a5;
      --progress-soft: #f2edfb;
    }
    .compact-view[data-overdue="true"] {
      --progress-colour: #b85809;
      --progress-soft: #fff1dc;
    }
    .compact-heading {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 10px;
    }
    .compact-title {
      font-weight: 650;
      font-size: 13px;
    }
    .compact-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .compact-actions button {
      margin: 0;
      padding: 3px 6px;
      font-size: 10px;
    }
    .compact-countdown {
      color: var(--progress-colour);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .progress-track {
      height: 9px;
      border-radius: 99px;
      background: var(--progress-soft);
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: var(--progress-colour);
      position: relative;
      overflow: hidden;
      transition: width 0.65s linear;
    }
    .progress-fill::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, #fff6, transparent);
      transform: translateX(-100%);
      animation: assist-shimmer 3s ease-in-out infinite;
    }
    .compact-view[data-overdue="true"] .progress-fill {
      animation: assist-pulse 1.8s ease-in-out infinite;
    }
    .compact-meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 10px;
      color: #526176;
      margin-top: 8px;
      font-variant-numeric: tabular-nums;
    }
    @keyframes assist-shimmer {
      to {
        transform: translateX(100%);
      }
    }
    @keyframes assist-pulse {
      50% {
        opacity: 0.65;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .progress-fill {
        transition: none;
      }
      .progress-fill,
      .progress-fill::after {
        animation: none !important;
      }
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    @media (max-width: 380px) {
      .stat {
        padding: 9px 7px;
      }
      .stat-label {
        font-size: 10px;
      }
      .stat-value {
        font-size: 17px;
      }
    }
  `
  shadow.append(style)
  function createElement (tag, text, parent, className) {
    const element = doc.createElement(tag)
    // Labels are plain text, so agent names and page values cannot become HTML.
    if (text) element.textContent = text
    if (className) element.className = className
    parent?.append(element)
    return element
  }
  const panel = createElement('section', '', shadow, 'panel')
  const unavailableBox = createElement(
    'div',
    'Unable to Assist: Open 8x8 agent queue information.',
    panel,
    'unavailable hidden'
  )
  const compactView = createElement('div', '', panel, 'compact-view hidden')
  const compactHeading = createElement('div', '', compactView, 'compact-heading')
  const compactTitle = createElement('span', '', compactHeading, 'compact-title')
  const compactActions = createElement('span', '', compactHeading, 'compact-actions')
  const compactCountdown = createElement('span', '', compactActions, 'compact-countdown')
  const compactMute = createElement('button', 'Mute', compactActions)
  const progressTrack = createElement('div', '', compactView, 'progress-track')
  progressTrack.setAttribute('role', 'progressbar')
  progressTrack.setAttribute('aria-valuemin', '0')
  const progressFill = createElement('div', '', progressTrack, 'progress-fill')
  const compactMeta = createElement('div', '', compactView, 'compact-meta')
  const compactElapsed = createElement('span', '', compactMeta, 'compact-elapsed')
  const compactAllowance = createElement('span', '', compactMeta, 'compact-allowance')
  const normalView = createElement('div', '', panel, 'main-view')
  const top = createElement('div', '', normalView, 'top')
  const titleBlock = createElement('div', '', top, 'title-block')
  createElement('h3', 'Service Desk 8x8 Assistant', titleBlock)
  createElement('div', 'Author: Joshua Lavagna-Slater', titleBlock, 'small author')
  const windowActions = createElement('div', '', top, 'window-actions')
  const minimize = createElement('button', '-', windowActions)
  minimize.title = 'Minimise assistant'
  minimize.setAttribute('aria-label', 'Minimise assistant')
  const remove = createElement('button', 'x', windowActions)
  remove.title = 'Close assistant'
  remove.setAttribute('aria-label', 'Close assistant')
  const content = createElement('div', '', normalView)
  createElement('h4', 'Agents', content, 'section-heading')
  const agentContainer = createElement('div', '', content, 'agents')
  const table = createElement('table', '', agentContainer, 'agent-table')
  const head = createElement('tr', '', createElement('thead', '', table))
  createElement('th', 'Name', head)
  createElement('th', 'Status', head)
  createElement('th', 'Time', head)
  createElement('th', 'G1', head)
  const agentList = createElement('tbody', '', table)
  createElement(
    'div',
    'Group 1 (G1) refers to any agent covering phones. An agent which is not in Group 1 is considered Group 2 (G2).',
    content,
    'small agent-help'
  )
  const monitorGrid = createElement('div', '', content, 'monitor-grid')
  const monitoringSection = createElement('section', '', monitorGrid)
  createElement('h4', 'Monitoring', monitoringSection, 'section-heading')
  const statusBox = createElement('div', '', monitoringSection, 'monitoring-summary')
  const queueCount = createElement('div', '', statusBox, 'queue-count')
  const queueTotal = createElement('span', '—', queueCount, 'queue-total')
  createElement('span', 'Callers waiting', queueCount, 'small')
  const monitorState = createElement('span', 'Inspecting page…', statusBox, 'monitoring-state')
  const statisticsSection = createElement('section', '', monitorGrid)
  createElement('h4', 'Statistics', statisticsSection, 'section-heading')
  const statisticsBody = createElement('div', '', statisticsSection, 'statistics')
  function createStatistic (label, className) {
    const box = createElement('div', '', statisticsBody, 'stat')
    createElement('span', label, box, 'stat-label')
    return createElement('span', '—', box, 'stat-value' + (className ? ' ' + className : ''))
  }
  const callTotal = createStatistic('Calls taken today', 'stat-total')
  const callsHour = createStatistic('Calls in the last hour')
  const lastCall = createStatistic('Last call detected')
  createElement(
    'div',
    'Counter detects calls while this assistant is open. Hidden or closed periods may create inaccuracies.',
    statisticsSection,
    'statistics-note'
  )
  const soundPanel = createElement('section', '', panel, 'menu-view sound-settings hidden')
  const settingsPanel = createElement('section', '', panel, 'menu-view assistant-settings hidden')
  const soundHeader = createElement('div', '', soundPanel, 'menu-header')
  createElement('h3', 'Sound Settings', soundHeader)
  const soundBack = createElement('button', 'Back', soundHeader)
  const settingsHeader = createElement('div', '', settingsPanel, 'menu-header')
  createElement('h3', 'Assistant Settings', settingsHeader)
  const settingsBack = createElement('button', 'Back', settingsHeader)
  const bottom = createElement('div', '', panel, 'assistant-bottom')
  const banner = createElement('div', '', bottom, 'alert current-reminders hidden')
  banner.setAttribute('role', 'region')
  banner.setAttribute('aria-label', 'Current assistant reminders')
  banner.setAttribute('aria-live', 'polite')
  const footer = createElement('div', '', bottom, 'footer')
  const footerDetails = createElement('div', '', footer, 'footer-details')
  const updateSection = createElement('div', 'Last updated', footerDetails, 'footer-detail last-updated')
  const lastUpdated = createElement('time', '—', updateSection)
  const versionSection = createElement('div', 'Version', footerDetails, 'footer-detail release-version')
  createElement('span', VERSION, versionSection, 'footer-value')
  const controls = createElement('div', '', footer, 'controls')
  const muteButton = createElement('button', 'Mute', controls)
  const settingsButton = createElement('button', 'Settings', controls)
  doc.body.append(host)
  let destroyed = false
  let audio = null
  let muted = false
  let audioOutputReady = true
  let lastScan = Date.now()
  let unavailable = false
  let compactKind = ''
  const reminders = new Map()
  const reminderWidgets = new Map()
  let activeView = QUEUES.length ? 'main' : 'settings'
  let activeReminder = null
  const PREFERENCES_KEY = 'service-desk-8x8-preferences-v5'
  let preferences = {}
  // Validate the stored shape before reading fields; browser storage can be edited.
  try {
    const value = JSON.parse(root.localStorage.getItem(PREFERENCES_KEY) || '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) preferences = value
  } catch {
    // Invalid JSON or blocked storage uses defaults for this run.
  }
  // This set owns persistent G1 membership. Roster refreshes never remove entries;
  // only an explicit checkbox change may alter the user's saved choices.
  const selected = new Set(
    Array.isArray(preferences.g1)
      ? preferences.g1.filter(name => typeof name === 'string' && normaliseText(name)).map(normaliseText)
      : []
  )
  // Numeric settings are whole values bounded by their corresponding UI controls.
  const settingNumber = (value, fallback, min, max) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback
  function secondsPreference (key, legacy, fallback, max) {
    let value = preferences[key]
    // Convert an older minute setting only when a seconds value is not present.
    if (!Number.isFinite(value) && Number.isFinite(preferences[legacy])) {
      value = preferences[legacy] * SECONDS_PER_MINUTE
    }
    return settingNumber(value, fallback, 1, max)
  }
  let storedLunchMinutes = preferences.lunchMinutes
  // Version 1.0.2 stored lunch in seconds; preserve its duration when migrating.
  if (!Number.isFinite(storedLunchMinutes) && Number.isFinite(preferences.lunchSeconds)) {
    storedLunchMinutes = preferences.lunchSeconds / SECONDS_PER_MINUTE
  }
  let lunchMinutes = settingNumber(storedLunchMinutes, 30, 1, 120)
  // Upgrade the old default once; a deliberately chosen 10-second delay stays 10.
  const oldDispositionDefault = preferences.settingsVersion !== 3 && preferences.dispositionSeconds === 10
  const dispositionValue = oldDispositionDefault ? 20 : preferences.dispositionSeconds
  let dispositionSeconds = settingNumber(dispositionValue, 20, 1, 120)
  // Preserve the former Extra Phone Cover Delay under its current setting name.
  let waitingAlertSeconds = Number.isFinite(preferences.waitingAlertSeconds)
    ? settingNumber(preferences.waitingAlertSeconds, 180, 1, 3600)
    : secondsPreference('coverSeconds', 'coverMinutes', 180, 3600)
  muted = preferences.muted === true
  // AudioContext uses an empty sink ID for the operating system's default device.
  let outputDeviceId =
    typeof preferences.outputDeviceId === 'string' && preferences.outputDeviceId !== 'default'
      ? preferences.outputDeviceId
      : ''
  // An absent field retains previous releases' enabled notification default.
  let desktopNotifications =
    typeof preferences.desktopNotifications === 'boolean' ? preferences.desktopNotifications : true
  const soundsCard = createElement('div', '', settingsPanel, 'settings-card')
  createElement('h4', 'Sound Settings', soundsCard)
  createElement(
    'p',
    'Choose the sound, volume, duration and repeat option for each reminder.',
    soundsCard,
    'settings-description'
  )
  createElement('button', 'Open Sound Settings', soundsCard).onclick = () => openView('sounds')
  const queuesCard = createElement('div', '', settingsPanel, 'settings-card')
  createElement('h4', 'Inbound Queue Names', queuesCard)
  createElement(
    'p',
    'Enter the exact names of the three inbound queues to monitor. Do not touch unless you know what you are doing.',
    queuesCard,
    'settings-description'
  )
  const queueInputs = [0, 1, 2].map(index => {
    const label = createElement('label', `Queue ${index + 1}`, queuesCard, 'sound-field')
    const input = createElement('input', '', label)
    input.type = 'text'
    input.value = QUEUES[index] || ''
    input.setAttribute('aria-label', `Inbound queue ${index + 1}`)
    return input
  })
  const queueError = createElement(
    'p',
    QUEUES.length ? '' : 'Enter three queue names to start monitoring.',
    queuesCard,
    'small'
  )
  for (const input of queueInputs) {
    input.onchange = () => {
      // Apply all three fields together so an incomplete edit never changes monitoring.
      const names = queueInputs.map(field => normaliseText(field.value))
      if (!validQueueNames(names)) {
        queueError.textContent = 'Enter three different queue names.'
        return
      }
      QUEUES = names
      root.__serviceDesk8x8Queues = [...names]
      try {
        root.localStorage.setItem(QUEUE_CONFIG_KEY, JSON.stringify(names))
      } catch {
        // The validated in-memory names still work if site storage is unavailable.
      }
      queueError.textContent = ''
      reset()
      safeScan()
    }
  }
  const lunchPanel = createElement('div', '', settingsPanel, 'settings-card lunch-settings')
  createElement('h4', 'Lunch Break Length', lunchPanel)
  createElement('p', 'Length of my lunch break. Used in both G1 and G2.', lunchPanel, 'settings-description')
  const lunchLabel = createElement('label', '', lunchPanel)
  lunchLabel.setAttribute('aria-label', 'Lunch break length in minutes')
  const lunchRow = createElement('span', '', lunchLabel, 'volume-control')
  const lunchSlider = createElement('input', '', lunchRow)
  lunchSlider.type = 'range'
  lunchSlider.min = '1'
  lunchSlider.max = '120'
  lunchSlider.step = '1'
  lunchSlider.id = 'its-my-lunch-minutes'
  lunchSlider.setAttribute('aria-label', 'Lunch break length in minutes')
  const lunchExactRow = createElement('label', '', lunchPanel, 'setting-value')
  const lunchExact = createElement('input', '', lunchExactRow)
  lunchExact.type = 'number'
  lunchExact.min = '1'
  lunchExact.max = '120'
  lunchExact.step = '1'
  lunchExact.id = 'its-my-lunch-exact-minutes'
  lunchExact.setAttribute('aria-label', 'Exact lunch break length in minutes')
  createElement('span', 'minutes', lunchExactRow)
  lunchSlider.value = lunchExact.value = String(lunchMinutes)
  const savePreferences = () => {
    // Save every chosen G1 name, including names absent from the current roster.
    try {
      root.localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify({
          settingsVersion: 3,
          g1: [...selected],
          lunchMinutes,
          dispositionSeconds,
          waitingAlertSeconds,
          desktopNotifications,
          muted,
          outputDeviceId
        })
      )
    } catch {
      // Blocked storage cannot prevent monitoring during this page session.
    }
  }
  // Write the converted values once so a later run never multiplies them again.
  savePreferences()
  const STATISTICS_KEY = 'service-desk-8x8-statistics-v1'
  const STATISTICS_ZONE = 'Australia/Brisbane'
  function dayKey (time) {
    // An explicit Brisbane date avoids resetting daily counts at the computer's timezone.
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: STATISTICS_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(time))
    // Read named date parts rather than relying on locale-specific separator order.
    const part = name => parts.find(p => p.type === name).value
    return `${part('year')}-${part('month')}-${part('day')}`
  }
  const statistics = { day: dayKey(Date.now()), calls: [], hadGaps: false, lastPresence: null }
  try {
    const value = JSON.parse(root.localStorage.getItem(STATISTICS_KEY) || '{}')
    if (value && typeof value === 'object') {
      if (value.day === statistics.day && Array.isArray(value.calls)) {
        // Retain only real timestamps from today; future or invalid entries cannot count as calls.
        statistics.calls = value.calls.filter(
          time => Number.isFinite(time) && time <= Date.now() && dayKey(time) === statistics.day
        )
        statistics.hadGaps = value.hadGaps === true
      }
      // Last observed status survives daily rollover, avoiding a duplicate ongoing Busy period.
      const last = value.lastPresence
      if (last && typeof last.status === 'string' && Number.isFinite(last.seenAt)) {
        statistics.lastPresence = { status: normaliseStatus(last.status), seenAt: last.seenAt }
      }
    }
  } catch {
    // Corrupt saved statistics start a new observed counter without interrupting monitoring.
  }
  let lastStatisticsSave = 0
  function saveStatistics () {
    try {
      root.localStorage.setItem(STATISTICS_KEY, JSON.stringify(statistics))
      lastStatisticsSave = Date.now()
    } catch {
      // Statistics remain usable in memory when the browser blocks persistence.
    }
  }
  function renderStatistics () {
    setText(callTotal, String(statistics.calls.length))
    const now = Date.now()
    // A rolling hour differs from the Brisbane calendar-day total.
    const hourMilliseconds = SECONDS_PER_MINUTE * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND
    setText(callsHour, String(statistics.calls.filter(time => time >= now - hourMilliseconds).length))
    const latest = statistics.calls.at(-1)
    setText(
      lastCall,
      latest === undefined
        ? '—'
        : new Date(latest).toLocaleTimeString('en-AU', {
          timeZone: STATISTICS_ZONE,
          hour: '2-digit',
          minute: '2-digit'
        })
    )
  }
  function countCalls (docs) {
    const now = Date.now()
    const today = dayKey(now)
    let changed = false
    // Midnight clears totals but leaves the last observed presence intact.
    if (statistics.day !== today) {
      statistics.day = today
      statistics.calls = []
      statistics.hadGaps = false
      changed = true
    }
    const presence = readCounterPresence(docs)
    const old = statistics.lastPresence
    if (!presence) {
      if (!statistics.hadGaps) {
        statistics.hadGaps = true
        changed = true
      }
    } else {
      const status = normaliseStatus(presence.status)
      const wasBusy = old?.status === 'busy'
      const busy = status === 'busy'
      // Preserve the last presence through hidden periods. An unknown sample is
      // never treated as leaving Busy, preventing duplicate counts on recovery.
      // Timer resets alone are not proof of another call. Do not infer calls
      // from missing data or from a timer changing during post-processing.
      const newCall = busy && !wasBusy
      if (newCall) {
        statistics.calls.push(now)
        changed = true
      }
      if (!old || status !== old.status) changed = true
      statistics.lastPresence = { status, seenAt: now }
    }
    if (changed || now - lastStatisticsSave >= 15000) saveStatistics()
    renderStatistics()
  }
  const agentWidgets = new Map()
  const freshness = new Map()
  const previous = new Map()
  const lunchLatched = new Set()
  let rosterRoot = null
  let rosterVisible = false
  let rosterComplete = false
  let rosterSettled = false
  let rosterSnapshot = { signature: null, changedAt: Date.now() }
  const notices = new Map()
  const observers = new Map()
  const interactionDocs = new Set()
  let lastSample = null
  const setText = (n, text) => {
    if (n.textContent !== text) n.textContent = text
  }
  function entireRosterRendered (list, rows) {
    if (!list) return false
    const css = list.ownerDocument.defaultView.getComputedStyle(list)
    // Virtuoso pads the list for rows outside the viewport. A scrolled,
    // partial list cannot prove that an absent selected agent signed out.
    const inline = String(list.getAttribute('style') || '')
    function padding (side) {
      // Prefer resolved browser CSS; inline padding also works in captured DOM fixtures.
      const computed = css['padding' + side]
      const pattern = new RegExp('padding-' + side.toLowerCase() + ':\\s*([\\d.]+)')
      const captured = inline.match(pattern)?.[1]
      return Number.parseFloat(computed || captured || '0')
    }
    if (padding('Top') > 0 || padding('Bottom') > 0) return false
    // Virtuoso stores each rendered row's original index on its surrounding item.
    const indexes = rows
      .map(row => row.closest('[data-item-index]')?.getAttribute('data-item-index'))
      .filter(value => value !== null && value !== undefined)
      .map(Number)
      .sort((a, b) => a - b)
    // A nonzero first index or an index gap also identifies a partial window.
    return indexes.every((value, index) => Number.isInteger(value) && value === index)
  }
  function refreshAgents (docs) {
    const current = new Map()
    const me = readMyPresence(docs)
    if (me) current.set('Me', me)
    const rows = agentRows(docs)
    // Keep the list container so a genuinely empty, still-visible roster is readable.
    if (rows.length) {
      rosterRoot = rows[0].closest('[data-test-id="virtuoso-item-list"]') || rows[0].parentElement
    }
    // An empty visible list differs from a hidden Groups panel during navigation.
    rosterVisible =
      rows.length > 0 ||
      !!(rosterRoot && docs.includes(rosterRoot.ownerDocument) && isVisible(rosterRoot))
    rosterComplete = rosterVisible && entireRosterRendered(rosterRoot, rows)
    // Names alone identify membership changes; advancing timers must not delay pruning.
    const signature = JSON.stringify(rows.map(agentName).sort())
    if (signature !== rosterSnapshot.signature) {
      rosterSnapshot = { signature, changedAt: Date.now() }
    }
    // Give list remounts one polling interval to settle before pruning rows.
    rosterSettled = rosterComplete && Date.now() - rosterSnapshot.changedAt >= ROSTER_SETTLE_MS
    // Hidden group rows on a personal page never imply an agent has signed out.
    const personal = !!personalPageKind(me)
    for (const row of rows) {
      const name = agentName(row)
      if (!name) continue
      const status = normaliseText(
        row.querySelector('[data-status-value]')?.getAttribute('data-status-value')
      )
      const timer = normaliseText(row.querySelector('[data-test-id="user-presence-timer"]')?.textContent)
      // Build a fresh readable-presence map independently of saved G1 membership.
      current.set(name, { name, status, timer, seconds: parseDuration(timer) })
    }
    if (rosterSettled && !personal) {
      // Saved membership is a user choice, separate from current sign-in.
      // Removing an absent row must never untick or overwrite that choice.
      for (const [name, widget] of agentWidgets) {
        if (name !== 'Me' && !current.has(name)) {
          widget.row.remove()
          agentWidgets.delete(name)
          freshness.delete(name)
          freshness.delete('coverage:' + name)
          previous.delete(name)
          lunchLatched.delete(name)
        }
      }
    }
    // Retain existing rows while the page is incomplete; remove them only after settling.
    const names = new Set([
      'Me',
      ...current.keys(),
      ...(!rosterSettled || personal ? agentWidgets.keys() : [])
    ])
    // Me is always first; the remaining names use normal alphabetical ordering.
    for (const name of [...names].sort((a, b) =>
      a === 'Me' ? -1 : b === 'Me' ? 1 : a.localeCompare(b)
    )) {
      let widget = agentWidgets.get(name)
      if (!widget) {
        const row = createElement('tr', '', agentList)
        createElement('td', name, row, 'agent-name')
        const statusCell = createElement('td', '', row)
        const state = createElement('span', '', statusCell, 'agent-status')
        const timer = createElement('td', '', row, 'agent-time')
        const selectionCell = createElement('td', '', row)
        const box = createElement('input', '', selectionCell)
        box.type = 'checkbox'
        box.checked = selected.has(name)
        box.setAttribute('aria-label', 'G1: ' + name)
        widget = { row, box, state, timer }
        agentWidgets.set(name, widget)
        box.onchange = () => {
          // The checkbox is the single authority allowed to change saved group membership.
          if (box.checked) selected.add(name)
          else selected.delete(name)
          savePreferences()
          reset(true)
          safeScan()
        }
      }
      const agent = current.get(name)
      // A recreated widget inherits its saved role instead of defaulting back to G2.
      widget.box.checked = selected.has(name)
      // A temporarily missing row cannot be edited as if it were a live agent.
      widget.box.disabled = !agent && name !== 'Me'
      setText(widget.state, agent?.status || 'Not currently loaded')
      setText(widget.timer, agent?.timer || '—')
      widget.state.setAttribute('data-state', normaliseStatus(agent?.status))
      agentList.append(widget.row)
    }
    return current
  }
  function showUnavailable (value) {
    unavailable = value
    syncViews()
    unavailableBox.classList.toggle('hidden', !value)
    if (value) {
      stopSound('preview')
      reset()
    }
  }
  function syncViews () {
    // Personal timers take priority over menus; missing data hides all regular controls.
    const compact = !!compactKind && !unavailable
    panel.classList.toggle('compact', compact)
    compactView.classList.toggle('hidden', !compact)
    normalView.classList.toggle('hidden', unavailable || compact || activeView !== 'main')
    soundPanel.classList.toggle('hidden', unavailable || compact || activeView !== 'sounds')
    settingsPanel.classList.toggle('hidden', unavailable || compact || activeView !== 'settings')
    bottom.classList.toggle('hidden', unavailable)
    footer.classList.toggle('hidden', compact || activeView !== 'main')
  }
  function renderCompact (me, kind) {
    // Both personal states use seconds internally, regardless of the lunch UI's minutes.
    const allowance = kind === 'break' ? lunchMinutes * SECONDS_PER_MINUTE : dispositionSeconds
    const elapsed = me.seconds
    // Once overdue, show elapsed overrun instead of a negative countdown.
    const remaining = Math.max(0, allowance - elapsed)
    const overdue = elapsed > allowance
    compactKind = kind
    compactView.setAttribute('data-kind', kind)
    compactView.setAttribute('data-overdue', String(overdue))
    const label = kind === 'break' ? 'Lunch break' : 'Complete disposition'
    setText(compactTitle, label)
    setText(compactCountdown, overdue ? `${elapsed - allowance}s overdue` : `${remaining}s left`)
    setText(compactElapsed, `${elapsed}s elapsed`)
    setText(compactAllowance, `${allowance}s allowance`)
    // Clamp the fill to the track while the overdue label can continue counting upward.
    progressFill.style.width = `${Math.min(100, (elapsed / allowance) * 100)}%`
    progressTrack.setAttribute('aria-label', label)
    progressTrack.setAttribute('aria-valuemax', String(allowance))
    progressTrack.setAttribute('aria-valuenow', String(Math.min(allowance, elapsed)))
    progressTrack.setAttribute(
      'aria-valuetext',
      `${elapsed} seconds elapsed, ${overdue ? elapsed - allowance + ' seconds overdue' : remaining + ' seconds left'}`
    )
    syncViews()
  }
  function openView (view) {
    // Leaving Sound Settings cancels the sample sound, while actual reminders continue.
    if (activeView === 'sounds' && view !== 'sounds') stopSound('preview')
    activeView = view
    syncViews()
    panel.scrollTop = 0
    if (view === 'sounds') refreshAudioDevices()
  }
  settingsButton.onclick = () => openView('settings')
  soundBack.onclick = () => openView('settings')
  settingsBack.onclick = () => openView('main')
  function prepareSound () {
    if (muted || destroyed) return
    try {
      const AudioConstructor = root.AudioContext || root.webkitAudioContext
      // Keep one assistant-owned context; never reuse the phone application's context.
      if (AudioConstructor && !audio) {
        audio = new AudioConstructor()
        if (outputDeviceId) {
          audioOutputReady = false
          // Restore the saved sink asynchronously; playback waits for it to finish.
          setAssistantOutput(outputDeviceId)
        }
      }
      // A user gesture can unlock suspended browser audio; later gestures can retry failure.
      if (audio && audio.state !== 'running') audio.resume().catch(() => {})
    } catch (e) {
      console.warn('Service Desk 8x8 Assistant sound:', e.message)
    }
  }
  function enableAlerts (event) {
    // Only real keyboard or pointer actions can satisfy browser audio restrictions.
    if (!event?.isTrusted || destroyed) return
    prepareSound()
  }
  // All sounds are generated locally: no downloaded audio or network requests.
  const PRESETS = {
    'Gentle chime': { notes: [523, 659, 784], wave: 'sine', pace: 0.32 },
    'Soft bell': { notes: [880, 1320], wave: 'sine', pace: 0.5 },
    'Ascending chime': { notes: [440, 554, 659, 880], wave: 'sine', pace: 0.25 },
    'Descending chime': { notes: [880, 659, 554, 440], wave: 'sine', pace: 0.25 },
    Doorbell: { notes: [660, 520], wave: 'sine', pace: 0.6 },
    'Double ping': { notes: [1047, 1047], wave: 'sine', pace: 0.25 },
    'Triple beep': { notes: [880, 660, 880], wave: 'triangle', pace: 0.27 },
    'Low pulse': { notes: [220, 220, 330], wave: 'triangle', pace: 0.4 },
    Radar: { notes: [1200, 0, 1200, 0], wave: 'sine', pace: 0.2 },
    'Digital ring': { notes: [740, 988, 740, 988], wave: 'square', pace: 0.15 },
    'Urgent pulse': { notes: [1000, 0, 1000, 0, 1000], wave: 'square', pace: 0.18 },
    'Two-tone alarm': { notes: [880, 660, 880, 660], wave: 'square', pace: 0.3 },
    'Fast alarm': { notes: [1200, 800, 1200, 800], wave: 'square', pace: 0.16 },
    'High alert': { notes: [1500, 1000, 1500], wave: 'triangle', pace: 0.2 },
    'Warning buzzer': { notes: [180, 240, 180, 240], wave: 'sawtooth', pace: 0.3 },
    'Rising siren': { notes: [400, 600, 800, 1000, 1200], wave: 'triangle', pace: 0.18 }
  }
  const definitions = {
    lunch: {
      label: 'Info: G1 On Break',
      description: () => [
        'Plays when someone you have ticked in G1 is "On Break". This includes someone already on break when monitoring starts.',
        'Plays only when you are in G2. Silent while the Change Status To Available alert is active.'
      ],
      preset: 'Gentle chime',
      volume: 45,
      seconds: 2,
      repeat: false
    },
    critical: {
      label: 'Alert: Change Status To Available',
      description: () => [
        `If you are in G1: plays only when you are "Working Offline", no other signed-in G1 member is "Available", and a caller has waited longer than ${timeWords(waitingAlertSeconds, 'second')}. This also applies when you are the only signed-in G1 member.`,
        'Being in "Other Work" does not trigger this alert when you are in G1. Lunch and disposition have their own reminders below.',
        `If you are in G2: plays when you are not "Available", a caller has waited for at least ${timeWords(waitingAlertSeconds, 'second')}, and every signed-in G1 member is unavailable.`,
        'Unavailable means "Busy", "On Break", "Working Offline", "Other Work", or finishing disposition. At least one signed-in agent must be ticked in G1.',
        'With Repeat ticked, it keeps playing while the conditions above are true. It stops when you become "Available", a G1 member becomes "Available", or no caller is waiting long enough. In G1, leaving "Working Offline" also stops it.'
      ],
      preset: 'Two-tone alarm',
      volume: 100,
      seconds: 10,
      repeat: true
    },
    disposition: {
      label: 'Alert: Complete Disposition',
      description: () => [
        `Plays when you spend more than ${timeWords(dispositionSeconds, 'second')} in disposition. Applies whether you are in G1 or G2.`,
        'Disposition is the step after a call where you complete the call details and click "Wrap up". The sound stops when you leave this step.'
      ],
      preset: 'Urgent pulse',
      volume: 80,
      seconds: 10,
      repeat: true
    },
    lunchOverdue: {
      label: 'Alert: Lunch Break Finished',
      description: () => [
        `Plays when your "On Break" time is longer than your lunch length in Assistant Settings (currently ${timeWords(lunchMinutes, 'minute')}). Applies whether you are in G1 or G2.`,
        'Reminds you to return to "Available". Stops when you leave "On Break".'
      ],
      preset: 'Digital ring',
      volume: 85,
      seconds: 10,
      repeat: true
    }
  }
  function timeWords (value, unit) {
    // Keep timing explanations grammatical for a one-second or one-minute setting.
    return `${value} ${unit}${value === 1 ? '' : 's'}`
  }
  const SOUND_KEY = 'service-desk-8x8-sounds-v4'
  let saved = {}
  try {
    const value = JSON.parse(root.localStorage.getItem(SOUND_KEY) || '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value
  } catch {
    // Missing or corrupt sound settings use each sound's documented defaults.
  }
  const soundSettings = {}
  for (const [kind, definition] of Object.entries(definitions)) {
    const configured = saved[kind] || {}
    // Validate each saved field independently so adding an option preserves old choices.
    soundSettings[kind] = {
      preset: PRESETS[configured.preset] ? configured.preset : definition.preset,
      volume: Number.isFinite(configured.volume) ? Math.max(0, Math.min(100, configured.volume)) : definition.volume,
      seconds: Number.isFinite(configured.seconds) ? Math.max(1, Math.min(120, configured.seconds)) : definition.seconds,
      repeat: typeof configured.repeat === 'boolean' ? configured.repeat : definition.repeat,
      desktopNotification: typeof configured.desktopNotification === 'boolean' ? configured.desktopNotification : true
    }
  }
  const sounds = new Map()
  function soundPlaybackState (kind, soundKind) {
    // An active reminder can remain visible while its finite sound has ended.
    const configuration = soundSettings[soundKind]
    if (muted) return 'Sound muted'
    if (!configuration.volume) return 'Sound volume is 0%'
    if (sounds.has(kind)) return 'Sound playing'
    if (!audioOutputReady) return 'Connecting sound output'
    if (audio?.state !== 'running') return 'Click the page to enable sound'
    return 'Sound finished'
  }
  function syncReminderBox () {
    const ordered = []
    for (const [kind, widget] of reminderWidgets) {
      if (!reminders.has(kind)) {
        widget.card.remove()
        reminderWidgets.delete(kind)
      }
    }
    // Show actionable alerts first, then informational events and temporary previews.
    for (const kind of ['critical', 'disposition', 'lunchOverdue', 'lunch', 'preview']) {
      const reminder = reminders.get(kind)
      if (!reminder) continue
      let widget = reminderWidgets.get(kind)
      if (!widget) {
        const card = createElement('article', '', banner, 'current-reminder')
        card.setAttribute('data-kind', kind)
        // Severity controls only the card's appearance, never its playback conditions.
        const severity = { preview: 'preview', lunch: 'info' }[kind] || 'alert'
        card.setAttribute('data-severity', severity)
        const heading = createElement('div', '', card, 'reminder-heading')
        const mark = createElement(
          'span',
          { alert: '!', preview: '♫', info: 'i' }[severity],
          heading,
          'reminder-mark'
        )
        mark.setAttribute('aria-hidden', 'true')
        widget = {
          card,
          title: createElement('strong', '', heading, 'reminder-title'),
          body: createElement('p', '', card, 'reminder-reason'),
          state: createElement('span', '', card, 'reminder-state')
        }
        reminderWidgets.set(kind, widget)
      }
      setText(widget.title, reminder.title)
      setText(widget.body, reminder.body)
      // A preview uses the selected reminder's configuration under its own job key.
      const state = soundPlaybackState(kind, reminder.soundKind || kind)
      setText(widget.state, state)
      ordered.push(widget.card)
    }
    // Keep unchanged live-region nodes in place during normal polling.
    if (ordered.some((card, index) => banner.children[index] !== card)) {
      for (const card of ordered) banner.append(card)
    }
    banner.classList.toggle('hidden', !reminders.size)
  }
  function stopSound (kind) {
    const job = sounds.get(kind)
    if (job) {
      root.clearInterval(job.interval)
      root.clearTimeout(job.timeout)
      // Stop already scheduled notes as well as the interval that creates new ones.
      for (const oscillator of job.nodes) {
        try {
          oscillator.stop()
        } catch {
          // A note that ended naturally cannot be stopped a second time.
        }
      }
      sounds.delete(kind)
    }
    if (kind === 'preview') reminders.delete('preview')
    syncReminderBox()
  }
  function playSound (kind, preview = false) {
    // Browser gesture restrictions and output switching can temporarily block audio.
    if (muted || destroyed || !audioOutputReady || audio?.state !== 'running') return
    // A single preview may coexist with the actual reminder without replacing its job.
    const key = preview ? 'preview' : kind
    stopSound(key)
    // Snapshot the configuration; editing a playing sound explicitly restarts it below.
    const configuration = { ...soundSettings[kind] }
    const preset = PRESETS[configuration.preset]
    const job = { nodes: new Set(), interval: null, timeout: null }
    sounds.set(key, job)
    if (preview) {
      reminders.set('preview', {
        soundKind: kind,
        title: `Preview: ${definitions[kind].label}`,
        body: `Testing your selected "${configuration.preset}" sound for this reminder.`
      })
    }
    syncReminderBox()
    const start = Date.now()
    // Previews stay short and never repeat, even when the real alert repeats forever.
    const total = preview ? Math.min(3, configuration.seconds) : configuration.seconds
    const endless = configuration.repeat && !preview
    const cycle = () => {
      // A replaced job must not schedule notes after a settings or output change.
      if (sounds.get(key) !== job) return
      // Use wall time for the finite deadline so delayed timer callbacks cannot extend it.
      const remaining = endless ? Infinity : total - (Date.now() - start) / MILLISECONDS_PER_SECOND
      if (remaining <= 0) {
        stopSound(key)
        return
      }
      preset.notes.forEach((frequencyHz, noteIndex) => {
        // Zero-frequency entries are intentional rests between audible notes.
        const offset = noteIndex * preset.pace
        if (!frequencyHz || offset >= remaining) return
        const oscillator = audio.createOscillator()
        const gain = audio.createGain()
        // Schedule on the audio clock; shorten the final note to the remaining duration.
        const noteStart = audio.currentTime + offset
        const noteLength = Math.min(preset.pace * 0.8, remaining - offset)
        oscillator.type = preset.wave
        oscillator.frequency.value = frequencyHz
        // Brief attack and release ramps avoid abrupt waveform clicks.
        gain.gain.setValueAtTime(0, noteStart)
        // Leave gain headroom, apply the volume percentage, and cap attack at 15 ms.
        gain.gain.linearRampToValueAtTime((0.3 * configuration.volume) / 100, noteStart + Math.min(0.015, noteLength / 3))
        gain.gain.linearRampToValueAtTime(0, noteStart + noteLength)
        oscillator.connect(gain)
        // Only this assistant's audio destination is affected by its output selection.
        gain.connect(audio.destination)
        job.nodes.add(oscillator)
        oscillator.start(noteStart)
        // A short tail allows the release ramp to finish before disconnecting the node.
        oscillator.stop(noteStart + noteLength + 0.01)
        oscillator.onended = () => {
          job.nodes.delete(oscillator)
          oscillator.disconnect()
          gain.disconnect()
        }
      })
    }
    cycle()
    // Repeat whole note sequences, with a minimum interval to avoid overly tight loops.
    const cycleInterval = Math.max(250, preset.notes.length * preset.pace * MILLISECONDS_PER_SECOND)
    job.interval = root.setInterval(cycle, cycleInterval)
    // A finite sound also has a hard stop independent of its repeating cycle timer.
    if (!endless) job.timeout = root.setTimeout(() => stopSound(key), total * MILLISECONDS_PER_SECOND)
  }
  const saveSounds = () => {
    try {
      root.localStorage.setItem(SOUND_KEY, JSON.stringify(soundSettings))
    } catch {
      // The selected sounds remain active in memory when persistent storage is blocked.
    }
  }
  saveSounds()
  const devicesCard = createElement('div', '', soundPanel, 'settings-card audio-devices')
  const soundDescriptions = new Map()
  const previewButtons = []
  function refreshSoundDescriptions () {
    // Explanations reflect the current timing settings instead of stale default values.
    for (const [kind, parent] of soundDescriptions) {
      parent.textContent = ''
      for (const part of definitions[kind].description()) {
        if (Array.isArray(part)) {
          const list = createElement('ul', '', parent)
          for (const text of part) createElement('li', text, list)
        } else createElement('p', part, parent)
      }
    }
  }
  // Build every sound card from the same definition so its options remain consistent.
  for (const [kind, definition] of Object.entries(definitions)) {
    const section = createElement('fieldset', '', soundPanel, 'sound-category')
    createElement('legend', definition.label, section)
    soundDescriptions.set(kind, createElement('div', '', section, 'small sound-description'))
    const choice = createElement('select', '', createElement('label', 'Sound type', section, 'sound-field'))
    for (const name of Object.keys(PRESETS)) {
      const option = createElement('option', name, choice)
      option.value = name
    }
    choice.value = soundSettings[kind].preset
    const volumeLabel = createElement('label', 'Volume', section, 'sound-field')
    const volumeRow = createElement('span', '', volumeLabel, 'volume-control')
    const volume = createElement('input', '', volumeRow)
    volume.type = 'range'
    volume.min = 0
    volume.max = 100
    volume.value = soundSettings[kind].volume
    const value = createElement('span', volume.value + '%', volumeRow, 'volume-value')
    const durationLabel = createElement('label', 'Duration (seconds, 1–120)', section, 'sound-field')
    const seconds = createElement('input', '', durationLabel)
    seconds.type = 'number'
    seconds.min = 1
    seconds.max = 120
    seconds.value = soundSettings[kind].seconds
    const repeatLabel = createElement('label', '', section, 'repeat-control')
    const repeat = createElement('input', '', repeatLabel)
    repeat.type = 'checkbox'
    repeat.checked = soundSettings[kind].repeat
    repeatLabel.append(doc.createTextNode('Repeat until condition clears'))
    const notificationLabel = createElement('label', '', section, 'repeat-control')
    const notification = createElement('input', '', notificationLabel)
    notification.type = 'checkbox'
    notification.checked = soundSettings[kind].desktopNotification
    notification.id = `its-sound-${kind}-desktop-notification`
    notificationLabel.append(doc.createTextNode('Send desktop notification'))
    notification.onchange = () => {
      // Per-sound notification changes do not restart or mute the sound itself.
      soundSettings[kind].desktopNotification = notification.checked
      saveSounds()
      if (!notification.checked) {
        notices.get(kind)?.close()
        notices.delete(kind)
      } else if (reminders.has(kind)) {
        const reminder = reminders.get(kind)
        sendDesktopNotification(kind, reminder.title, reminder.body)
      }
    }
    const syncDuration = () => {
      // Repeating reminders ignore a finite duration, so make that field visibly inactive.
      seconds.disabled = repeat.checked
      durationLabel.classList.toggle('disabled', repeat.checked)
    }
    syncDuration()
    const update = () => {
      // Save the complete card configuration without losing its notification preference.
      soundSettings[kind] = {
        preset: choice.value,
        volume: Number(volume.value),
        seconds: Math.max(1, Math.min(120, Number(seconds.value) || 1)),
        repeat: repeat.checked,
        desktopNotification: notification.checked
      }
      value.textContent = volume.value + '%'
      syncDuration()
      saveSounds()
      // Apply a changed tone to a playing job immediately; ended finite sounds stay ended.
      const active = sounds.has(kind)
      stopSound(kind)
      stopSound('preview')
      if (active) playSound(kind)
    }
    choice.onchange = update
    volume.oninput = update
    seconds.onchange = update
    repeat.onchange = update
    const preview = createElement('button', 'Preview', section)
    preview.disabled = muted
    previewButtons.push(preview)
    preview.onclick = () => {
      prepareSound()
      playSound(kind, true)
    }
  }
  refreshSoundDescriptions()
  const soundActions = createElement('div', '', soundPanel, 'sound-actions')
  createElement('button', 'Stop preview', soundActions).onclick = () => stopSound('preview')
  function applyTimingSettings () {
    savePreferences()
    refreshSoundDescriptions()
    safeScan()
  }
  function timingSetting (title, description, id, value, min, max, unit, assign) {
    const card = createElement('div', '', settingsPanel, 'settings-card')
    createElement('h4', title, card)
    createElement('p', description, card, 'settings-description')
    const label = createElement('label', '', card, 'setting-value')
    const input = createElement('input', '', label)
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.step = '1'
    input.id = id
    input.value = String(value)
    input.setAttribute('aria-label', title + ' in ' + unit)
    createElement('span', unit, label)
    input.onchange = () => {
      // Validate the edit before updating the rule and refreshing its explanation.
      const number = settingNumber(Number(input.value), value, min, max)
      input.value = String(number)
      assign(number)
      applyTimingSettings()
    }
    return input
  }
  timingSetting(
    'Disposition Reminder Delay',
    'Time allowed to finish the call details and click "Wrap up" before the reminder plays. Used in both G1 and G2.',
    'its-disposition-seconds',
    dispositionSeconds,
    1,
    120,
    'seconds',
    number => {
      dispositionSeconds = number
    }
  )
  timingSetting(
    'Caller Waiting Alert Delay',
    'How long a caller must be waiting before the "Change Status to Available" sound plays. Only used when you are in G2, are not available, and every signed-in G1 member is busy.',
    'its-waiting-alert-seconds',
    waitingAlertSeconds,
    1,
    3600,
    'seconds',
    number => {
      waitingAlertSeconds = number
    }
  )
  createElement('h4', 'Audio Devices', devicesCard)
  createElement(
    'p',
    'Output changes apply only to assistant sounds. Your 8x8 calls keep their own device settings.',
    devicesCard,
    'settings-description'
  )
  const outputChoice = createElement('select', '', createElement('label', 'Output Device', devicesCard, 'sound-field'))
  outputChoice.setAttribute('aria-label', 'Assistant output device')
  const defaultOutput = createElement('option', 'System default (Default)', outputChoice)
  defaultOutput.value = ''
  if (outputDeviceId) {
    createElement('option', 'Saved output device', outputChoice).value = outputDeviceId
    outputChoice.value = outputDeviceId
  }
  const AudioClass = root.AudioContext || root.webkitAudioContext
  // Feature-detect routing; unsupported browsers still retain normal default audio.
  const canRouteOutput = typeof AudioClass?.prototype?.setSinkId === 'function'
  const mediaDevices = root.navigator.mediaDevices
  outputChoice.disabled = !canRouteOutput
  const refreshDevicesButton = createElement('button', 'Refresh devices', devicesCard)
  refreshDevicesButton.disabled =
    !canRouteOutput || typeof mediaDevices?.enumerateDevices !== 'function'
  // Only display the browser output picker when that API is actually available.
  const chooseOutputButton =
    canRouteOutput && typeof mediaDevices?.selectAudioOutput === 'function'
      ? createElement('button', 'Choose output device', devicesCard)
      : null
  const deviceFeedback = createElement(
    'p',
    canRouteOutput
      ? 'Only output devices allowed by your browser appear here.'
      : 'This browser can only use the system default output for assistant sounds.',
    devicesCard,
    'small'
  )
  deviceFeedback.setAttribute('role', 'status')
  let outputChanges = Promise.resolve()
  function setAssistantOutput (id, note = '') {
    if (destroyed) return Promise.resolve(false)
    // Browser enumeration calls its default "default"; AudioContext expects an empty ID.
    const sinkId = id === 'default' ? '' : id
    audioOutputReady = false
    outputChoice.disabled = true
    syncMute()
    if (chooseOutputButton) chooseOutputButton.disabled = true
    // Serialise switches so rapid choices cannot overwrite each other's saved output.
    const change = outputChanges.then(async () => {
      if (destroyed) return false
      // Stop scheduled notes before routing, and remember an unfinished informational sound.
      const resumeLunch = sounds.has('lunch')
      for (const key of [...sounds.keys()]) stopSound(key)
      try {
        if (!audio && AudioClass) audio = new AudioClass()
        if (typeof audio?.setSinkId !== 'function') throw Error('Output selection unavailable')
        // This sink belongs exclusively to the context created by this assistant.
        await audio.setSinkId(sinkId)
        // Closing the assistant while awaiting permission must prevent a late save or restart.
        if (destroyed) return false
        outputDeviceId = sinkId
        savePreferences()
        outputChoice.value = sinkId
        setText(
          deviceFeedback,
          note ||
            (sinkId
              ? 'Assistant sounds now use the selected output device.'
              : 'Assistant sounds now use the system default output.')
        )
        return true
      } catch {
        if (destroyed) return false
        // Permission or device errors keep the context's previously working sink.
        outputDeviceId = typeof audio?.sinkId === 'string' ? audio.sinkId : ''
        savePreferences()
        outputChoice.value = outputDeviceId
        setText(
          deviceFeedback,
          'Could not use that output device. The assistant has kept its previous output.'
        )
        return false
      } finally {
        if (!destroyed) {
          audioOutputReady = true
          outputChoice.disabled = !canRouteOutput
          syncMute()
          if (chooseOutputButton) chooseOutputButton.disabled = false
          // Resume only current conditions; output changes never send another popup.
          if (!muted && activeReminder) playSound(activeReminder.kind)
          else if (!muted && lunchLatched.size && (resumeLunch || soundSettings.lunch.repeat)) {
            playSound('lunch')
          }
        }
      }
    })
    // A failed switch must not reject the chain and block all later choices.
    outputChanges = change.catch(() => false)
    return change
  }
  async function refreshAudioDevices () {
    if (destroyed || !canRouteOutput || typeof mediaDevices?.enumerateDevices !== 'function') return
    try {
      // Enumerate permitted speakers without opening a microphone or altering phone devices.
      const devices = await mediaDevices.enumerateDevices()
      // Wait until pending routing settles before rebuilding the selected option.
      await outputChanges
      if (destroyed) return
      // Exclude inputs and the duplicate default alias from the selectable output list.
      const available = devices.filter(
        d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default'
      )
      const defaultLabel = kind => {
        const label = devices.find(d => d.kind === kind && d.deviceId === 'default')?.label
        // Remove the browser's prefix while retaining the device name and clear default label.
        return (label ? label.replace(/^default\s*[-–—]\s*/i, '') : 'System default') + ' (Default)'
      }
      outputChoice.textContent = ''
      createElement('option', defaultLabel('audiooutput'), outputChoice).value = ''
      for (const [index, device] of available.entries()) {
        createElement('option', device.label || `Output device ${index + 1}`, outputChoice).value =
          device.deviceId
      }
      // A removed or no-longer-permitted speaker falls back to the system default.
      if (outputDeviceId && !available.some(d => d.deviceId === outputDeviceId)) {
        await setAssistantOutput(
          '',
          'Selected output is unavailable. Assistant sounds now use the system default.'
        )
      }
      outputChoice.value = outputDeviceId
      if (!available.length && !outputDeviceId) {
        setText(
          deviceFeedback,
          'Using the system default. Other outputs may need browser permission.'
        )
      }
    } catch {
      if (!destroyed) {
        setText(
          deviceFeedback,
          'Could not list audio devices. The assistant has kept its current output.'
        )
      }
    }
  }
  outputChoice.onchange = () => setAssistantOutput(outputChoice.value)
  refreshDevicesButton.onclick = () => refreshAudioDevices()
  if (chooseOutputButton) {
    chooseOutputButton.onclick = async () => {
      try {
        const device = await mediaDevices.selectAudioOutput(
          outputDeviceId ? { deviceId: outputDeviceId } : {}
        )
        if (destroyed) return
        // Only a valid output device from the browser picker can change the assistant's sink.
        if (device?.kind !== 'audiooutput' || typeof device.deviceId !== 'string') {
          throw Error('No output selected')
        }
        await setAssistantOutput(device.deviceId)
        await refreshAudioDevices()
      } catch {
        if (!destroyed) {
          setText(
            deviceFeedback,
            'No new output was selected. The assistant has kept its current output.'
          )
        }
      }
    }
  }
  const audioDeviceChanged = () => {
    refreshAudioDevices()
  }
  mediaDevices?.addEventListener?.('devicechange', audioDeviceChanged)
  const desktopCard = createElement('div', '', settingsPanel, 'settings-card')
  createElement('h4', 'Desktop Notifications', desktopCard)
  createElement(
    'p',
    'Allow desktop notifications for the sounds ticked in Sound Settings. Sounds and messages in the assistant still work when this is off.',
    desktopCard,
    'settings-description'
  )
  const notificationInstructions = createElement('div', '', desktopCard, 'small notification-instructions')
  createElement('p', 'Allow notifications manually in Microsoft Edge:', notificationInstructions)
  const notificationSteps = createElement('ol', '', notificationInstructions)
  createElement(
    'li',
    'Settings → Privacy, search and services → Site permissions → All permissions → Notifications.',
    notificationSteps
  )
  createElement('li', 'Under Allowed to send notifications, select Add site.', notificationSteps)
  createElement('li', 'Enter https://vcc-au2.8x8.com and select Add.', notificationSteps)
  const desktopLabel = createElement('label', '', desktopCard, 'repeat-control')
  const desktopToggle = createElement('input', '', desktopLabel)
  desktopToggle.type = 'checkbox'
  desktopToggle.checked = desktopNotifications
  desktopToggle.id = 'its-desktop-notifications'
  desktopLabel.append(doc.createTextNode('Show desktop notifications'))
  const notificationTest = createElement('button', 'Test desktop notification', desktopCard)
  const notificationFeedback = createElement(
    'p',
    'Use the test button to check whether a popup appears.',
    desktopCard,
    'notification-feedback'
  )
  notificationFeedback.setAttribute('role', 'status')
  notificationFeedback.setAttribute('aria-live', 'polite')
  let notificationTesting = false
  function syncNotificationTest () {
    notificationTest.disabled = destroyed || !desktopNotifications || notificationTesting
  }
  notificationTest.onclick = async () => {
    if (destroyed || !desktopNotifications || notificationTesting) return
    if (!('Notification' in root)) {
      setText(notificationFeedback, 'Desktop notifications are not supported in this browser.')
      return
    }
    notificationTesting = true
    syncNotificationTest()
    try {
      const permission = root.Notification.permission
      if (destroyed || !desktopNotifications) return
      if (permission !== 'granted') {
        setText(
          notificationFeedback,
          'Notifications are not allowed yet. Follow the Edge settings steps above, then try again.'
        )
        return
      }
      notices.get('test')?.close()
      const notice = new root.Notification('8x8 Assistant: Test Notification', {
        body: 'This is a test of your desktop notifications.',
        tag: 'its-call-assist-test',
        silent: muted
      })
      notices.set('test', notice)
      notice.onclick = () => {
        root.focus()
        notice.close()
      }
      setText(
        notificationFeedback,
        'Test notification sent. If no popup appeared, check your browser and computer notification settings.'
      )
    } catch {
      setText(
        notificationFeedback,
        'The notification could not be sent. Check your browser’s notification settings and try again.'
      )
    } finally {
      notificationTesting = false
      syncNotificationTest()
    }
  }
  syncNotificationTest()
  desktopToggle.onchange = event => {
    desktopNotifications = desktopToggle.checked
    savePreferences()
    if (!desktopNotifications) {
      for (const notice of notices.values()) notice.close()
      notices.clear()
    } else enableAlerts(event)
    syncNotificationTest()
  }
  function sendDesktopNotification (kind, title, body) {
    // Browser permission, the global switch and this sound's checkbox must all allow a popup.
    if (
      !destroyed &&
      desktopNotifications &&
      soundSettings[kind].desktopNotification &&
      'Notification' in root &&
      root.Notification.permission === 'granted'
    ) {
      try {
        notices.get(kind)?.close()
        // Tags replace this reminder's previous popup; mute requests silent OS delivery.
        const notice = new root.Notification(title, {
          body,
          tag: `its-call-assist-${kind}`,
          requireInteraction: true,
          silent: muted
        })
        notices.set(kind, notice)
        notice.onclick = () => {
          root.focus()
          notice.close()
        }
      } catch (e) {
        console.warn('Service Desk 8x8 Assistant notification:', e.message)
      }
    }
  }
  function notify (kind, title, body) {
    if (destroyed) return
    // The reason remains visible even if sound is muted or desktop notifications are off.
    reminders.set(kind, { title, body })
    try {
      playSound(kind)
    } catch {
      // A browser audio failure must not hide the reminder or prevent its popup.
    }
    syncReminderBox()
    sendDesktopNotification(kind, title, body)
  }
  function clearAlert (kind) {
    // Clearing a condition removes all three channels: tone, popup and reason card.
    stopSound(kind)
    notices.get(kind)?.close()
    notices.delete(kind)
    reminders.delete(kind)
    syncReminderBox()
  }
  function reset (preservePersonal = false) {
    // G1 checkbox edits invalidate cover decisions without interrupting personal reminders.
    const personalFreshness = preservePersonal ? freshness.get('personal') : null
    lunchLatched.clear()
    freshness.clear()
    previous.clear()
    if (personalFreshness) freshness.set('personal', personalFreshness)
    if (!preservePersonal || activeReminder?.kind === 'critical') activeReminder = null
    for (const k of ['lunch', 'critical', 'disposition', 'lunchOverdue']) {
      if (preservePersonal && ['disposition', 'lunchOverdue'].includes(k)) continue
      clearAlert(k)
    }
    syncReminderBox()
  }

  function coverReminder (me, covering, selfInG1) {
    // Explain the actual group and own status instead of showing a generic alarm message.
    const group = selfInG1 ? 'G1' : 'G2'
    const ownReason = `You are "${me.status}" in ${group}.`
    let coverageReason = 'No signed-in G1 member is "Available".'
    if (selfInG1) {
      coverageReason = covering.length
        ? 'No other signed-in G1 member is "Available".'
        : 'You are the only signed-in G1 member.'
    }
    // The wording mirrors the strict G1 and inclusive G2 caller-wait boundaries.
    const waitingBoundary = selfInG1 ? 'longer than' : 'at least'
    const callerReason = `A caller has waited ${waitingBoundary} ${timeWords(waitingAlertSeconds, 'second')}.`
    const action = 'Change your status to "Available" to take the call.'
    return {
      kind: 'critical',
      title: 'Alert: Change Status To Available',
      body: [ownReason, coverageReason, callerReason, action].join(' ')
    }
  }

  function syncReminder (reminder) {
    // Personal and phone-cover alarms are mutually exclusive; clear the old condition first.
    if (activeReminder && activeReminder.kind !== reminder?.kind) {
      clearAlert(activeReminder.kind)
      activeReminder = null
    }
    if (!reminder) return
    if (!activeReminder) {
      // Only entering a condition sends a new desktop notification.
      activeReminder = reminder
      notify(reminder.kind, reminder.title, reminder.body)
    } else {
      activeReminder = reminder
      reminders.set(reminder.kind, reminder)
      syncReminderBox()
      // Finite sounds stay finished; repeating sounds recover after audio/output interruptions.
      if (!sounds.has(reminder.kind) && soundSettings[reminder.kind].repeat) playSound(reminder.kind)
    }
  }
  function updateLunch (input) {
    lunchMinutes = settingNumber(Number(input.value), 30, 1, 120)
    lunchSlider.value = lunchExact.value = String(lunchMinutes)
    applyTimingSettings()
  }
  lunchSlider.oninput = () => updateLunch(lunchSlider)
  lunchExact.onchange = () => updateLunch(lunchExact)
  function observeFreshSample (key, signature, now, fallbackKey = null) {
    // Personal pages can inherit a just-observed header timer instead of starting stale.
    const old = freshness.get(key) || (fallbackKey ? freshness.get(fallbackKey) : null)
    let observation = old
    if (!old) {
      // One unchanged sample cannot prove the page is live; wait for its next update.
      observation = { signature, changedAt: now, observed: false }
    } else if (old.signature !== signature) {
      // Status or timer movement proves this sample has changed since first observation.
      observation = { signature, changedAt: now, observed: true }
    }
    freshness.set(key, observation)
    // Frozen page data must stop alerts even while the assistant's own interval runs.
    return observation.observed && now - observation.changedAt < FRESHNESS_WINDOW_MS
  }

  function syncPageObservers (docs) {
    // Navigation can replace iframe documents; detach observers from their old bodies.
    for (const [pageDocument, observer] of observers) {
      if (!docs.includes(pageDocument)) {
        observer.disconnect()
        observers.delete(pageDocument)
      }
    }
    for (const pageDocument of docs) {
      if (!observers.has(pageDocument) && pageDocument.body) {
        const observer = new root.MutationObserver(safeScan)
        // Watch the attributes used by the readers. The assistant's shadow UI is excluded.
        observer.observe(pageDocument.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['data-status-value', 'aria-label', 'title', 'hidden', 'style', 'class']
        })
        observers.set(pageDocument, observer)
      }
    }
    // Retain audio-unlock handlers only on documents that still belong to this page.
    for (const pageDocument of [...interactionDocs]) {
      if (!docs.includes(pageDocument)) {
        pageDocument.removeEventListener('pointerdown', enableAlerts, true)
        pageDocument.removeEventListener('keydown', enableAlerts, true)
        interactionDocs.delete(pageDocument)
      }
    }
    for (const pageDocument of docs) {
      if (!interactionDocs.has(pageDocument)) {
        pageDocument.addEventListener('pointerdown', enableAlerts, true)
        pageDocument.addEventListener('keydown', enableAlerts, true)
        interactionDocs.add(pageDocument)
      }
    }
  }

  function monitoringMessage (offline, fresh, queues) {
    if (!selected.size) return 'Select at least one G1 agent'
    if (offline) return 'Waiting for connection'
    if (!fresh) return 'Waiting for live updates'
    // Counts may remain readable while 8x8 has not yet exposed a caller's age.
    if (queues.some(queue => queue.waiting > 0 && queue.waitSeconds === null)) return 'Waiting for caller time'
    return 'Live'
  }

  function scan (docs) {
    if (destroyed) return
    const now = Date.now()
    const gap = now - lastScan
    lastScan = now
    syncPageObservers(docs)
    const current = refreshAgents(docs)
    const selfInG1 = selected.has('Me')
    const me = current.get('Me')
    const personalKind = personalPageKind(me)
    if (personalKind) {
      // A personal page has its own readable timer and needs no queue or G1 roster.
      lastSample = {
        me,
        agents: [],
        queues: [],
        selected: [...selected],
        mode: selfInG1 ? 'covering' : 'assisting',
        lunchMinutes,
        dispositionSeconds,
        waitingAlertSeconds,
        desktopNotifications,
        muted,
        unavailable: false,
        view: personalKind
      }
      showUnavailable(false)
      renderCompact(me, personalKind)
      setText(lastUpdated, new Date().toLocaleTimeString('en-AU', { hour12: false }))
      clearAlert('lunch')
      lunchLatched.clear()
      // Long browser suspensions invalidate previously observed live data.
      if (gap > FRESHNESS_WINDOW_MS) freshness.clear()
      // Dedicated wrap-up pages expose a countdown; headers expose an elapsed timer.
      const signature = me.status + '|' + (me.liveTimer || me.timer)
      const liveTimer = observeFreshSample('personal', signature, now, 'Me')
      // A native wrap-up timer can finish while mandatory fields still keep
      // the Wrap up page open. Keep its personal reminder until that page ends.
      const fresh =
        (liveTimer || (personalKind === 'disposition' && me.remaining === 0)) &&
        root.navigator.onLine !== false
      // Lunch and disposition are group-independent, including when no G1 member is selected.
      syncReminder(fresh ? personalRule(me, lunchMinutes, dispositionSeconds) : null)
      return
    }
    compactKind = ''
    freshness.delete('personal')
    // Remember all choices, but read only G1 agents present in this live roster.
    const presentG1 = [...selected].filter(name => current.has(name))
    const sample = readAgentAndQueues(
      docs,
      presentG1[0] || [...current.keys()].find(name => name !== 'Me') || 'Me'
    )
    // Validate each live selected agent; a missing saved name remains a preference only.
    const samples = presentG1.map(name => readAgentAndQueues(docs, name))
    const agents = samples.map(s => s.agent).filter(Boolean)
    // An incomplete or virtualised list cannot prove an absent selected member signed out.
    const missingG1 = [...selected].some(name => name !== 'Me' && !current.has(name))
    const missing =
      !current.has('Me') ||
      (!rosterVisible && agentWidgets.size > 1) ||
      (missingG1 && !rosterComplete) ||
      sample.errors.length > 0 ||
      samples.some(s => s.errors.length)
    lastSample = {
      me: current.get('Me') || null,
      agents,
      queues: sample.queues,
      selected: [...selected],
      mode: selfInG1 ? 'covering' : 'assisting',
      lunchMinutes,
      dispositionSeconds,
      waitingAlertSeconds,
      desktopNotifications,
      muted,
      unavailable: !!missing,
      view: 'main'
    }
    if (missing) {
      showUnavailable(true)
      freshness.clear()
      return
    }
    showUnavailable(false)
    if (gap > FRESHNESS_WINDOW_MS) freshness.clear()
    let fresh = true
    // G1 starts with its own live status; G2 observes the selected phone agents.
    for (const agent of selfInG1 ? [me] : agents) {
      const signature = `${agent.status}|${agent.timer}`
      if (!observeFreshSample(agent.name, signature, now)) fresh = false
    }
    const offline = root.navigator.onLine === false
    const heading = monitoringMessage(offline, fresh, sample.queues)
    setText(monitorState, heading)
    monitorState.setAttribute('data-state', heading === 'Live' ? 'live' : 'waiting')
    // The end user sees one total even though three inbound queues supply it.
    setText(queueTotal, String(sample.queues.reduce((total, queue) => total + queue.waiting, 0)))
    setText(lastUpdated, new Date().toLocaleTimeString('en-AU', { hour12: false }))
    if (!fresh || offline) {
      clearAlert('lunch')
      syncReminder(null)
      return
    }
    for (const agent of agents) {
      const old = previous.get(agent.name)
      // A state change or reset elapsed timer marks a new status episode.
      if (old && (normaliseStatus(old.status) !== normaliseStatus(agent.status) || agent.seconds < old.seconds)) {
        lunchLatched.delete(agent.name)
        if (agent.name === 'Me') syncReminder(null)
      }
      previous.set(agent.name, agent)
    }
    if (selfInG1) {
      clearAlert('lunch')
      lunchLatched.clear()
      if (!workingOffline(me.status)) {
        syncReminder(null)
        return
      }
    }
    // Only selected, signed-in G1 members determine whether phone cover is needed.
    const covering = selfInG1 ? agents.filter(agent => agent.name !== 'Me') : agents
    // Missing saved members may have signed out, but not during a list remount.
    let coverageFresh = (selfInG1 || covering.length > 0) && (!missingG1 || rosterSettled)
    // Keep cover checks separate from personal/header freshness observations.
    for (const agent of [me, ...covering]) {
      const key = 'coverage:' + agent.name
      const signature = agent.status + '|' + agent.timer
      if (!observeFreshSample(key, signature, now)) coverageFresh = false
    }
    let waitingFresh = false
    for (const queue of sample.queues) {
      const key = 'queue:' + queue.name
      // Caller count and age together detect both queue updates and replacement calls.
      const signature = queue.waiting + '|' + queue.waitSeconds
      const liveQueue = observeFreshSample(key, signature, now)
      if (callerWaitReached(queue, waitingAlertSeconds, selfInG1) && liveQueue) waitingFresh = true
    }
    const decision = groupRules(agents, sample.queues, me, waitingAlertSeconds, selfInG1)
    // An otherwise eligible condition stays silent unless both roster and queue are live.
    decision.critical = decision.critical && coverageFresh && waitingFresh
    if (decision.critical) {
      clearAlert('lunch')
      syncReminder(coverReminder(me, covering, selfInG1))
    } else syncReminder(null)
    if (selfInG1) return
    // Informational break sounds occur once per observed break episode, only in G2.
    const newBreaks = decision.lunch.filter(name => !lunchLatched.has(name))
    for (const name of [...lunchLatched]) {
      if (!decision.lunch.includes(name)) lunchLatched.delete(name)
    }
    if (!decision.lunch.length) clearAlert('lunch')
    if (newBreaks.length && !decision.critical) {
      notify(
        'lunch',
        'Info: G1 On Break',
        `${newBreaks.join(', ')} (G1) ${newBreaks.length === 1 ? 'is' : 'are'} "On Break".`
      )
      newBreaks.forEach(name => lunchLatched.add(name))
    }
  }
  function safeScan () {
    if (destroyed) return
    try {
      const docs = getReadableDocuments()
      // Statistics are independent of the queue view and continue even while muted.
      countCalls(docs)
      if (!QUEUES.length && !readPersonalPage(docs)) {
        compactKind = ''
        showUnavailable(false)
        openView('settings')
        return
      }
      scan(docs)
    } catch (e) {
      showUnavailable(true)
      console.warn('Service Desk 8x8 Assistant:', e.message)
    }
  }
  function syncMute () {
    for (const button of [muteButton, compactMute]) {
      setText(button, muted ? 'Unmute' : 'Mute')
      button.setAttribute('aria-pressed', String(muted))
      button.title = muted ? 'Unmute assistant sounds' : 'Mute assistant sounds'
    }
    for (const preview of previewButtons) preview.disabled = muted || !audioOutputReady
    syncReminderBox()
  }
  function toggleMute () {
    muted = !muted
    savePreferences()
    syncMute()
    if (muted) {
      // Only sound jobs stop; observers, personal timers and call counting keep running.
      for (const key of [...sounds.keys()]) stopSound(key)
      safeScan()
    } else {
      prepareSound()
      safeScan()
      const replay = () => {
        if (destroyed || muted) return
        if (activeReminder && !sounds.has(activeReminder.kind)) playSound(activeReminder.kind)
        else if (
          !activeReminder &&
          lunchLatched.size &&
          soundSettings.lunch.repeat &&
          !sounds.has('lunch')
        ) {
          playSound('lunch')
        }
      }
      // Replay after the browser resumes audio, without creating another desktop popup.
      if (audio?.state !== 'running') {
        audio
          ?.resume?.()
          .then(replay)
          .catch(() => {})
      } else replay()
    }
  }
  muteButton.onclick = compactMute.onclick = toggleMute
  syncMute()
  minimize.onclick = () => {
    content.classList.toggle('hidden')
    const collapsed = content.classList.contains('hidden')
    minimize.textContent = collapsed ? '+' : '-'
    minimize.title = collapsed ? 'Restore assistant' : 'Minimise assistant'
    minimize.setAttribute('aria-label', minimize.title)
  }
  function destroy () {
    // Set the shutdown flag before async output changes can resume sounds or save devices.
    saveStatistics()
    root.removeEventListener?.('pagehide', saveStatistics)
    destroyed = true
    root.clearInterval(interval)
    mediaDevices?.removeEventListener?.('devicechange', audioDeviceChanged)
    for (const key of [...sounds.keys()]) stopSound(key)
    for (const observer of observers.values()) observer.disconnect()
    for (const notice of notices.values()) notice.close()
    for (const pageDocument of interactionDocs) {
      pageDocument.removeEventListener('pointerdown', enableAlerts, true)
      pageDocument.removeEventListener('keydown', enableAlerts, true)
    }
    audio?.close().catch(() => {})
    host.remove()
    delete root.__itsCallAssist
  }
  remove.onclick = destroy
  // Polling advances time displays even when no mutation event fires.
  const interval = root.setInterval(safeScan, SCAN_INTERVAL_MS)
  root.__itsCallAssist = { destroy, inspect: () => lastSample }
  root.__itsCallAssist.version = VERSION
  // Return copies so restart support and inspection cannot mutate internal state.
  root.__itsCallAssist.wrapUpSession = () => (wrapUpSession ? { ...wrapUpSession } : null)
  root.__itsCallAssist.statistics = () => ({
    day: statistics.day,
    total: statistics.calls.length,
    calls: [...statistics.calls],
    hadGaps: statistics.hadGaps
  })
  // Preserve the latest observed call count when the page closes or navigates away.
  root.addEventListener?.('pagehide', saveStatistics)
  prepareSound()
  safeScan()
  refreshAudioDevices()
})()
