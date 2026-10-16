/* Service Desk 8x8 Assistant — Prototype v1.2.1
 * Author: Joshua Lavagna-Slater
 * JavaScript prototype for an organisation-approved Microsoft Edge extension.
 * The standalone prototype runs in the page; the extension is a separate build.
 * Run in the existing logged-in 8x8 tab: DevTools > Sources > Snippets >
 * New snippet. Paste this entire file, then press Ctrl+Enter.
 * Open queue information using the button to the right of your status,
 * next to the bell. The three ITS inbound queues are already included.
 * In 8x8 Groups > Filter, choose your group and tick every User status.
 * Select the G1 agents, including Me when covering phones; Mute silences tones.
 * Lunch and disposition reminders apply in both G1 and G2.
 * Browser audio may require a click in the page; normal interactions enable it.
 * Optional Secondary Ringer sends assistant sounds to a second output device.
 * No external requests, credentials or second login are used. TXT transfers are optional.
 * Reads rendered queue/agent HTML; never changes your availability or answers calls.
 * Keep selected agents rendered; scroll back to the inbound queues for live counts.
 * Background browser throttling, page freezing, logout, closure and refresh
 * can delay/stop monitoring. Rerun after a refresh. Not a guaranteed alarm service.
 * In G2, assistance uses the break, waiting and coverage rules.
 * In G1, Me gets queue-based Working Offline, disposition and lunch reminders.
 * Timings are configurable in Assistant Settings. Only one personal alarm runs.
 * G1 selections, assistant settings and sounds persist when storage is permitted.
 * Lunch, Short Break and disposition pages have separate compact personal views.
 * Short breaks accumulate today's minutes and never use the lunch reminder.
 * Missing queue rows keep controls open but suspend queue-based cover alerts.
 * Missing agent information freezes the last-read table; menus stay available.
 * Muting keeps monitoring, timers, notifications and statistics running.
 * Statistics record observed Busy starts, not 8x8's complete historical call totals.
 * Optional caller identifiers and notes are saved at Wrap up.
 * Add in-person notes manually; Call Notes totals describe saved notes, not observed calls.
 * Finished reminder messages close after the configured notification display time.
 * Drag the top-left corner to resize; double-click it to reset.
 * Call Notes uses this tab's session and an optional chosen Data location TXT file.
 * Auto-save needs file permission; crashes/power loss cannot guarantee a final save.
 */
;(() => {
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
    throw new Error('Run this prototype in your existing vcc-au2.8x8.com tab.')
  }
  // The packaged extension supplies hydrated, private storage and notification adapters.
  // The standalone prototype retains page/session behaviour without changing 8x8 storage.
  const deployment = root.__itsCallAssistRuntime || null
  const settingsStorage = deployment?.settingsStorage || root.localStorage
  const historyStorage = deployment?.historyStorage || root.sessionStorage
  // Resolve the browser API at use time so permission/support changes remain observable.
  const notificationClass = () => deployment?.Notification || root.Notification
  // Carry an ongoing disposition timer across a prototype restart, then remove
  // the previous assistant's observers, audio and panel before starting again.
  const resumedWrapUp = root.__itsCallAssist?.wrapUpSession?.()
  // Session storage normally handles restarts; this copy also supports blocked storage.
  // Finish a saved-record editor before taking the blocked-storage restart snapshot.
  root.__itsCallAssist?.finaliseCallNotes?.()
  const priorFileHandoff = root.__itsCallAssistDataShutdown
  let previousDataSource = root.__itsCallAssist?.dataFileSession ||
    (typeof priorFileHandoff?.session === 'function' ? priorFileHandoff.session : () => priorFileHandoff?.session)
  const resumedDataFile = previousDataSource?.()
  const previousAssistant = root.__itsCallAssist
  const previousShutdown = previousAssistant?.destroy() || priorFileHandoff?.promise
  const resumedCallHistory = previousAssistant?.callHistorySession?.()
  const doc = root.document
  const VERSION = deployment?.version || '1.2.1'
  const SCAN_INTERVAL_MS = 1000
  const ROSTER_SETTLE_MS = SCAN_INTERVAL_MS
  const FRESHNESS_WINDOW_MS = 30000
  const SECONDS_PER_MINUTE = 60
  const MILLISECONDS_PER_SECOND = 1000
  const MAX_NOTES_LENGTH = 20000
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024
  const MAX_IMPORT_RECORDS = 2000
  let wrapUpSession = resumedWrapUp || null
  // Page labels may contain repeated whitespace or missing text nodes.
  const normaliseText = (value) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  // Status comparisons ignore letter case, while displayed labels stay intact.
  const normaliseStatus = (value) => normaliseText(value).toLowerCase()
  // Monitor exactly these inbound queues; saved settings cannot redirect monitoring.
  const QUEUES = Object.freeze(['ITS Academic Hotline', 'ITS Internal TRNFR', 'ITS Service Desk'])
  function parseDuration (text) {
    const value = normaliseStatus(text)
    if (!value) return null
    // Accept the MM:SS and H:MM:SS clocks shown on break and wrap-up pages.
    if (/^\d+:\d{2}(?::\d{2})?$/.test(value)) {
      const clock = value.split(':').map(Number)
      // Only the first component may exceed 59; later components are base 60.
      if (clock.slice(1).some((part) => part >= SECONDS_PER_MINUTE)) return null
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
    const seconds = parts.reduce(
      (total, match) => total + Number(match[1]) * unitSeconds[match[2][0]],
      0
    )
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
    return docs.flatMap((d) =>
      [...d.querySelectorAll('[data-test-id="agent-item"]')].filter(isVisible)
    )
  }
  function breakLabelKind (label) {
    // The reason, rather than the shared On Break status, distinguishes the two timers.
    const value = normaliseStatusLabel(label)
    if (value === 'short break') return 'shortBreak'
    if (value === 'lunch' || value === 'lunch break') return 'break'
    return ''
  }
  function readBreakKind (wrapper, status = '') {
    // Both supplied break pages put their reason beside the timer's immediate wrapper.
    const labels = [...(wrapper?.querySelectorAll('span[title]') || [])].filter(
      (node) =>
        isVisible(node) &&
        (breakLabelKind(node.getAttribute('title')) || breakLabelKind(node.textContent))
    )
    if (labels.length === 1) {
      const labelled = breakLabelKind(labels[0].getAttribute('title'))
      const displayed = breakLabelKind(labels[0].textContent)
      // Conflicting title/text is a partial page update, not evidence of a lunch break.
      return labelled && labelled === displayed ? labelled : 'otherBreak'
    }
    if (labels.length > 1) return 'otherBreak'
    // Explicit header labels are also usable; an unspecified On Break is never assumed to be lunch.
    return breakLabelKind(status) || 'otherBreak'
  }
  function readCallField (card, label) {
    // Labelled Info rows identify values without relying on generated CSS or row order.
    const rows = [...card.querySelectorAll('li')].filter(
      (row) => isVisible(row) && normaliseStatus(row.querySelector('span')?.textContent) === label
    )
    if (rows.length !== 1) return null
    const values = [...rows[0].querySelectorAll('span[title]')].filter(isVisible)
    if (values.length !== 1) return null
    const labelled = normaliseText(values[0].getAttribute('title'))
    const displayed = normaliseText(values[0].textContent)
    // Reject inconsistent attributes while 8x8 replaces a call's Info rows.
    return labelled && labelled === displayed ? labelled : null
  }
  function phoneDigits (value) {
    // Formatting is preserved for display; a digits-only key matches + and spaced variants.
    return normaliseText(value).replace(/\D/g, '')
  }
  function readablePhone (value) {
    const text = normaliseText(value)
    // Anonymous labels and channel names must not become guessed telephone numbers.
    return /^[+\d][\d\s()+.-]*$/.test(text) && phoneDigits(text).length >= 3 ? text : null
  }
  function readCallPage (docs) {
    const cards = docs
      .flatMap((d) => [...d.querySelectorAll('[data-test-id="phone-card-test-id"]')])
      .filter(isVisible)
    // Multiple visible phone cards are ambiguous. Never attach a name to an arbitrary caller.
    if (cards.length !== 1) return null
    const card = cards[0]
    const wrap = [...card.querySelectorAll('[data-test-id="wrap-up-label"]')].filter(isVisible)
    const completedTimers = [
      ...card.querySelectorAll('[data-test-id="interaction-time-label"]')
    ].filter(isVisible)
    const wrapTimers = [
      ...card.querySelectorAll('[data-test-id="progress-timer"][aria-label="Wrap up"]')
    ].filter(isVisible)
    const timers = [
      ...card.querySelectorAll('[data-test-id="interaction-timer"][aria-label="Interaction"]')
    ].filter(isVisible)
    const headings = [
      ...card.querySelectorAll(
        '[data-test-id="active-call-name"],[data-test-id="active-call-number"]'
      )
    ].filter(isVisible)
    // Disposition has a completed-call timer and a Wrap up countdown. These markers
    // take precedence over a lingering active heading/timer during a partial rerender.
    // An offer countdown or the Disposition tab alone still cannot identify a call.
    const phase =
      wrap.length || completedTimers.length || wrapTimers.length
        ? 'disposition'
        : !wrap.length && timers.length === 1 && headings.length
            ? 'call'
            : ''
    if (!phase) return null
    const numberField = readablePhone(readCallField(card, 'phone number'))
    const numbers = [...card.querySelectorAll('[data-test-id="active-call-number"]')].filter(
      isVisible
    )
    const headingNumber = numbers.length === 1 ? readablePhone(numbers[0].textContent) : null
    // Prefer the labelled phone number; contradictory headings indicate an incomplete update.
    const number =
      numberField && headingNumber && phoneDigits(numberField) !== phoneDigits(headingNumber)
        ? null
        : numberField || headingNumber
    const timer =
      phase === 'call' ? timers[0] : completedTimers.length === 1 ? completedTimers[0] : null
    const timerText = normaliseText(timer?.textContent)
    const durationSeconds = timer ? parseDuration(timerText) : null
    const holdTimers = [
      ...card.querySelectorAll('[data-test-id="hold-timer"][aria-label="On hold"]')
    ].filter(isVisible)
    const onHold = phase === 'call' && holdTimers.length === 1
    return {
      phase,
      remaining: wrapTimers.length === 1 ? parseDuration(wrapTimers[0].textContent) : null,
      wrapTimer: wrapTimers.length === 1 ? normaliseText(wrapTimers[0].textContent) : '',
      number,
      queue: readCallField(card, 'queue'),
      channel: readCallField(card, 'channel name'),
      channelNumber: readablePhone(readCallField(card, 'channel number')),
      transactionId: readCallField(card, 'transaction id'),
      waitSeconds: parseDuration(readCallField(card, 'queue wait duration')),
      durationSeconds,
      timer: timerText,
      onHold,
      // This describes the current hold segment, rather than total hold time for the call.
      holdSeconds: onHold ? parseDuration(holdTimers[0].textContent) : null,
      identityConflict:
        !!numberField && !!headingNumber && phoneDigits(numberField) !== phoneDigits(headingNumber)
    }
  }
  // Personal page detection reads only status markers and the scoped active phone card.
  function readPersonalPage (docs) {
    // Dedicated personal markers remain visible while queue and roster panels vanish.
    const breaks = docs
      .flatMap((d) => [...d.querySelectorAll('[data-test-id="on-break-timer"]')])
      .filter(isVisible)
    const call = readCallPage(docs)
    if (breaks.length === 1 && !call) {
      const timer = breaks[0]
      const text = normaliseText(timer.textContent)
      const seconds = parseDuration(text)
      if (seconds === null) return null
      const kind = readBreakKind(timer.parentElement?.parentElement)
      return { kind, status: 'On Break', timer: text, seconds, liveTimer: text }
    }
    if (call?.phase === 'disposition' && !breaks.length) {
      if (call.remaining === null) return null
      // This is 8x8's countdown, not time spent in disposition. The separate
      // interaction-time-label is the finished call's duration and is ignored.
      return {
        kind: 'disposition',
        status: 'Wrap Up',
        remaining: call.remaining,
        liveTimer: call.wrapTimer
      }
    }
    if (!breaks.length) {
      if (call?.phase === 'call' && !closedCallPage(call)) {
        return {
          kind: 'call',
          status: 'Busy',
          seconds: call.durationSeconds,
          timer: call.timer,
          ...call
        }
      }
    }
    return null
  }
  function pagePresence (page) {
    if (page.kind !== 'disposition') {
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
    const seconds = Math.max(0, wrapUpSession.elapsed || 0, wallElapsed, countdownElapsed)
    wrapUpSession.elapsed = seconds
    return { name: 'Me', ...page, seconds, timer: seconds + 's' }
  }
  const agentName = (row) =>
    // The name label's title is reliable even when its visible text is truncated.
    normaliseText(
      row.querySelector('[data-test-id="agent-name-label"]')?.getAttribute('title') ||
        row.getAttribute('aria-label')
    )
  function readAgentAndQueues (docs, name) {
    const errors = []
    // A unique name match is required; duplicate rows must not choose an agent at random.
    const candidates = agentRows(docs).filter((r) => agentName(r) === name)
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
      const timer = normaliseText(
        row.querySelector('[data-test-id="user-presence-timer"]')?.textContent
      )
      const seconds = parseDuration(timer)
      if (!status || seconds === null) errors.push('Agent status or timer unreadable')
      else agent = { name, status, timer, seconds }
    }
    // Separate roster errors from queue errors: scrolling queues must not conceal the controls.
    const agentErrors = [...errors]
    const queueErrors = []
    // Only the three exact configured inbound names are read; outbound rows are ignored.
    const rows = docs.flatMap((d) =>
      [...d.querySelectorAll('[data-test-id="queue-item"]')].filter(isVisible)
    )
    const queues = QUEUES.map((name) => {
      // Queue names come from the label title, preserving the user's exact spelling.
      const matches = rows.filter(
        (r) =>
          normaliseText(r.querySelector('[data-test-id="queue-name"]')?.getAttribute('title')) ===
          name
      )
      if (matches.length !== 1) {
        queueErrors.push(`Queue row ${matches.length ? 'ambiguous' : 'missing'}: ${name}`)
        return { name, waiting: null }
      }
      // Accessible cell titles identify the waiting count without assuming column order.
      const cells = [...matches[0].querySelectorAll('[role="gridcell"][title]')]
      const cellsWaiting = cells.filter((c) =>
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
        queueErrors.push(`Waiting count unreadable: ${name}`)
        return { name, waiting: null }
      }
      // The real caller age is 8x8's Longest waiting time, not an agent's Busy timer.
      const waits = cells.filter((c) =>
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
    return { agent, queues, agentErrors, queueErrors, errors: [...agentErrors, ...queueErrors] }
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
              const isBreak = ['on break', 'break', 'lunch', 'lunch break', 'short break'].includes(
                normaliseStatusLabel(status)
              )
              const kind = isBreak ? readBreakKind(wrapper, status) : ''
              candidates.push({ name: 'Me', status, timer: text, seconds, kind })
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
    const card = readCallPage(docs)
    // A completed-call marker remains disposition even when its countdown is temporarily missing.
    if (card?.phase === 'disposition') return { status: 'Wrap Up' }
    if (card?.phase === 'call' && closedCallPage(card)) return null
    const page = readPersonalPage(docs)
    // Reopening a card already saved at Wrap up is not evidence of another Busy start.
    if (
      page?.kind === 'call' &&
      page.transactionId &&
      callHistory.completedTransactions.includes(page.transactionId)
    ) {
      return null
    }
    if (page) return { status: page.status }
    // Statistics need a status transition, even if queues or the status timer are hidden.
    const states = docs
      .flatMap((d) => [...d.querySelectorAll('[data-test-id="user-status"][data-status-value]')])
      .filter((node) => !node.closest('[data-test-id="agent-item"]') && isVisible(node))
    if (states.length !== 1) {
      // An open status picker can add icons. The header's own timer identifies
      // the actual presence in that case; no queue or group counts are read.
      const me = readMyPresence(docs)
      if (me && normaliseStatus(me.status) === 'busy' && callHistory.closedId !== null) return null
      return me ? { status: me.status } : null
    }
    const status = normaliseText(states[0].getAttribute('data-status-value'))
    // Busy can linger in the header after Wrap up. A new connected identity or an
    // observed idle state must release the completed interaction before counting again.
    if (normaliseStatus(status) === 'busy' && callHistory.closedId !== null) return null
    return status ? { status } : null
  }
  // 8x8 uses several spellings for the same state across its header and phone card.
  const normaliseStatusLabel = (status) =>
    normaliseText(normaliseStatus(status).replace(/[-_]/g, ' '))
  const offlineStatuses = new Set(['work offline', 'working offline'])
  const dispositionStatuses = new Set([
    'wrap up',
    'wrapup',
    'post processing',
    'postprocessing',
    'disposition'
  ])
  const unavailableStatuses = new Set([
    'busy',
    'on break',
    'break',
    'lunch',
    'lunch break',
    'short break',
    'other work',
    ...offlineStatuses,
    ...dispositionStatuses
  ])

  function workingOffline (status) {
    return offlineStatuses.has(normaliseStatusLabel(status))
  }

  function dispositionStatus (status) {
    return dispositionStatuses.has(normaliseStatusLabel(status))
  }

  function personalPageKind (me) {
    if (!me) return ''
    if (['call', 'break', 'shortBreak', 'otherBreak'].includes(me.kind)) return me.kind
    if (
      ['on break', 'break', 'lunch', 'lunch break', 'short break'].includes(
        normaliseStatusLabel(me.status)
      )
    ) {
      return breakLabelKind(me.status) || 'otherBreak'
    }
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
    const queueCountsReadable =
      queues.length === QUEUES.length && queues.every((queue) => queue.waiting !== null)
    const callerNeedsCover =
      queueCountsReadable &&
      queues.some((queue) => callerWaitReached(queue, waitingAlertSeconds, selfInG1))

    // Me cannot count as another G1 agent available to cover their own offline state.
    const covering = selfInG1 ? agents.filter((agent) => agent.name !== 'Me') : agents
    const ownStatusEligible =
      !!me?.status &&
      (selfInG1 ? workingOffline(me.status) : normaliseStatus(me.status) !== 'available')
    // In G1, Me is sufficient to make a group; G2 needs another signed-in G1 agent.
    const hasPhoneGroup = selfInG1 || covering.length > 0
    // G1 needs no other Available agent; G2 accepts only recognised unavailable states.
    const nobodyCanTakeCall = covering.every((agent) =>
      selfInG1
        ? normaliseStatus(agent.status) !== 'available'
        : unavailableStatuses.has(normaliseStatusLabel(agent.status))
    )

    return {
      // Break information is separate from the phone-cover alarm and is G2-only.
      lunch: agents
        .filter((agent) => normaliseStatus(agent.status) === 'on break')
        .map((agent) => agent.name),
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
    if (personalPageKind(me) === 'break') {
      // Lunch settings use minutes; the page clock and comparison use seconds.
      const lunchSeconds = lunchMinutes * SECONDS_PER_MINUTE
      if (me.seconds <= lunchSeconds) return null
      return {
        kind: 'lunchOverdue',
        title: 'Alert: Lunch Break Finished',
        body: `You have been on Lunch for longer than your ${lunchMinutes}-minute lunch break. Change your status to "Available".`
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
      --assistant-button-height: 32px;
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
    .resize-handle {
      position: absolute;
      top: -6px;
      left: -6px;
      width: 24px;
      height: 24px;
      padding: 3px;
      margin: 0;
      z-index: 3;
      border: 1px solid transparent;
      border-radius: 6px;
      background: #f2f7ff;
      color: #31577e;
      opacity: 0;
      cursor: nwse-resize;
      touch-action: none;
    }
    :host(:hover) .resize-handle,
    .resize-handle:focus-visible,
    .resize-handle.resizing { opacity: 1; }
    .panel.resized { display: flex; flex-direction: column; max-height: calc(100dvh - 36px); overflow: hidden; }
    .resized .main-view { flex: 1 1 auto; min-height: 0; }
    .resized .main-content { flex: 1 1 auto; min-height: 0; }
    .resized.main-panel .agents { flex: 1 1 auto; max-height: none; min-height: 50px; }
    .resized .menu-view:not(.hidden),
    .resized .call-view:not(.hidden) { flex: 1 1 auto; min-height: 0; overflow: auto; max-height: none; }
    .resized .call-history:not(.hidden) { display: flex; flex-direction: column; }
    .resized .call-history > :not(.history-list) { flex-shrink: 0; }
    .resized .history-list { flex: 1 1 auto; min-height: 80px; max-height: none; }
    .resized .assistant-bottom { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .resized .current-reminders { flex: 0 1 auto; min-height: 0; overflow: auto; }
    .resized .footer { flex-shrink: 0; }
    .data-file-status {
      display: block;
      width: 100%;
      margin: 6px 0 0;
      padding: 5px 8px;
      text-align: left;
      font-size: 11px;
      color: #276451;
      background: #edf7f2;
      border-color: #c4dfd2;
      flex-shrink: 0;
    }
    .data-file-status[data-attention="true"] { color: #8a4a12; background: #fff4e5; border-color: #e7c89e; }
    button[data-file-attention="true"] { position: relative; }
    button[data-file-attention="true"]::after {
      content: '';
      position: absolute;
      right: 1px;
      top: 1px;
      width: 7px;
      height: 7px;
      background: #b42332;
      border: 1px solid #fff;
      border-radius: 50%;
    }
    .data-location-status { white-space: pre-line; overflow-wrap: anywhere; }
    .data-location > .data-location-help { margin-top: 14px; }
    .panel.main-panel {
      display: flex;
      flex-direction: column;
      max-height: calc(100dvh - 36px);
      overflow: hidden;
      padding: 12px;
    }
    .main-view,
    .main-content {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .main-view {
      flex: 0 1 auto;
    }
    .main-content {
      flex: 0 1 auto;
    }
    .main-content > :not(.agents),
    .main-view > .top,
    .main-panel > .assistant-bottom {
      flex-shrink: 0;
    }
    .main-panel .agents {
      max-height: 200px;
      min-height: 58px;
      flex: 0 1 auto;
    }
    .main-panel .section-heading {
      margin: 8px 0 4px;
    }
    .main-panel .agents {
      margin: 6px 0;
    }
    .main-panel .agent-help {
      margin: 4px 0 0;
      font-size: 10px;
      line-height: 1.4;
    }
    .main-panel .monitoring-summary {
      padding: 8px 12px;
    }
    .main-panel .stat {
      padding: 8px 10px;
    }
    .main-panel .stat-label {
      font-size: 10px;
      line-height: 1.3;
    }
    .main-panel .stat-value {
      margin-top: 3px;
      font-size: 18px;
      line-height: 1.1;
    }
    .main-panel .statistics-note {
      margin-top: 5px;
      line-height: 1.35;
    }
    .main-panel .footer {
      margin-top: 8px;
      padding-top: 8px;
    }
    .main-panel .current-reminders {
      margin-top: 10px;
    }
    .main-panel .current-reminder {
      padding: 9px 11px;
    }
    .main-panel .reminder-reason {
      line-height: 1.4;
      margin-top: 5px;
      /* Long lists remain readable inside their card without displacing the footer. */
      max-height: 5.6em;
      overflow: auto;
      scrollbar-width: thin;
    }
    .main-panel .reminder-state {
      margin-top: 5px;
    }
    .main-panel .assistant-bottom {
      position: static;
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
    .agent-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .agent-data-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 7px;
      border-radius: 20px;
      background: #edf7f0;
      color: #17633a;
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
    }
    .agent-data-badge::before {
      content: '';
      width: 5px;
      height: 5px;
      background: currentColor;
      border-radius: 50%;
    }
    .agent-data-badge[data-frozen="true"] {
      color: #99520c;
      background: #fff1d9;
    }
    .agents[data-frozen="true"] .agent-status,
    .agents[data-frozen="true"] .agent-time {
      opacity: 0.7;
    }
    .data-warning {
      flex-shrink: 0;
      margin-top: 10px;
      padding: 9px 11px;
      border: 1px solid #e8cf9d;
      border-left: 3px solid #bd7a1c;
      border-radius: 8px;
      background: #fff8eb;
      color: #765018;
      font-size: 11px;
      line-height: 1.4;
    }
    .menu-view > .data-warning { margin-bottom: 16px; }
    .data-warning strong {
      display: block;
      color: #81500c;
      font-size: 12px;
    }
    .data-warning p {
      margin: 4px 0 0;
    }
    .data-warning .data-last-read {
      font-size: 10px;
      color: #826849;
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
    .secondary-ringer {
      margin-top: 16px;
      padding-top: 2px;
      border-top: 1px solid #d7e0ec;
    }
    .secondary-ringer .repeat-control {
      margin-bottom: 6px;
      font-weight: 600;
    }
    .device-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .device-actions button {
      margin: 0;
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
    .monitoring-state[data-state="unavailable"] {
      color: #a95005;
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
    .panel.call-panel {
      width: 420px;
      padding: 14px 16px;
    }
    .call-heading,
    .call-heading-actions {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .call-heading {
      justify-content: space-between;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .call-title {
      font-size: 14px;
      font-weight: 650;
    }
    .call-badge {
      padding: 3px 7px;
      border-radius: 99px;
      background: #e6f5ed;
      color: #17633a;
      font-size: 10px;
      font-weight: 600;
    }
    .call-badge[data-hold="true"] {
      background: #fff0dc;
      color: #a95005;
    }
    .call-heading-actions button {
      margin: 0;
      height: var(--assistant-button-height);
      font-size: 10px;
      padding: 3px 6px;
    }
    .call-duration {
      font-size: 13px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .call-information,
    .history-information {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 10px;
    }
    .call-information {
      padding: 11px 12px;
      border: 1px solid #d7e0ec;
      border-radius: 8px;
      background: #f8faff;
      margin-bottom: 12px;
    }
    .call-detail-label {
      display: block;
      font-size: 10px;
      color: #526176;
      margin-bottom: 3px;
    }
    .call-detail-value {
      display: block;
      font-size: 12px;
      font-weight: 550;
      overflow-wrap: anywhere;
    }
    .caller-label {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
    }
    .caller-label input,
    .caller-label textarea {
      margin-top: 7px;
      font: 13px system-ui;
      padding: 9px;
    }
    .caller-label input:focus,
    .caller-label textarea:focus,
    .history-edit-input:focus,
    .history-search:focus {
      outline: 2px solid #245dc1;
      outline-offset: 2px;
    }
    .caller-help {
      font-size: 10px;
      line-height: 1.5;
      margin: 8px 0 0;
      color: #526176;
    }
    .caller-notes-label {
      display: block;
      margin-top: 12px;
    }
    .caller-label textarea,
    .history-notes-input {
      width: 100%;
      min-height: 65px;
      resize: vertical;
      line-height: 1.5;
    }
    .caller-label textarea {
      border: 1px solid #a4b2c7;
      border-radius: 6px;
      color: #172235;
      background: #fff;
    }
    .history-transfer {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-bottom: 10px;
    }
    .history-transfer button {
      flex: 1 1 110px;
      margin: 0;
    }
    .history-transfer-status {
      padding: 8px 10px;
      border-radius: 6px;
      background: #edf4ff;
      color: #245dc1;
      font-size: 11px;
      line-height: 1.5;
      margin: 0 0 10px;
    }
    .history-transfer-status[data-error="true"] {
      background: #fff1ed;
      color: #a03d23;
    }
    .panel.history-panel {
      display: flex;
      flex-direction: column;
      max-height: calc(100dvh - 36px);
      overflow: hidden;
      padding: 14px;
    }
    .call-history {
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 0 1 auto;
    }
    .call-history > :not(.history-list),
    .history-panel > .assistant-bottom {
      flex-shrink: 0;
    }
    .call-history .menu-header {
      margin-bottom: 12px;
    }
    .history-statistics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border: 1px solid #d7e0ec;
      border-radius: 8px;
      background: #f8faff;
      padding: 10px 0;
      margin-bottom: 12px;
    }
    .history-stat {
      min-width: 0;
      padding: 0 10px;
      border-right: 1px solid #d7e0ec;
    }
    .history-stat:last-child {
      border-right: 0;
    }
    .history-stat .stat-value {
      font-size: 19px;
      margin: 0 0 4px;
    }
    .history-stat .stat-label {
      font-size: 10px;
    }
    .history-transfer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
    }
    .history-transfer button { margin: 0; }
    .history-transfer .history-add { margin-right: auto; }
    .history-source {
      display: inline-block;
      padding: 2px 6px;
      margin-top: 5px;
      border-radius: 99px;
      background: #e5f5f1;
      color: #147e78;
      font-size: 10px;
      font-weight: 600;
    }
    .history-card.new-note { border-style: dashed; }
    .controls { display: flex; align-items: center; gap: 6px; }
    .controls button { height: var(--assistant-button-height); margin: 0; }
    .controls .notes-shortcut { margin-right: 6px; }
    button.icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: var(--assistant-button-height);
      padding: 6px;
      margin: 0;
      flex-shrink: 0;
    }
    .button-icon { width: 19px; height: 19px; pointer-events: none; }
    .icon-button[aria-pressed="true"] {
      color: #b42332;
      background: #fff0f1;
      border-color: #e5a8ae;
    }
    .history-summary {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 9px;
    }
    .history-session-count {
      color: #245dc1;
      font-size: 11px;
      font-weight: 600;
    }
    .history-search {
      display: block;
      width: 100%;
      padding: 8px 9px;
      border: 1px solid #a4b2c7;
      border-radius: 6px;
      font: 12px system-ui;
      color: #172235;
      background: white;
      margin-bottom: 11px;
    }
    .history-list {
      min-height: 0;
      max-height: 460px;
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      padding-right: 3px;
    }
    .history-card {
      padding: 12px;
      margin-bottom: 9px;
      border: 1px solid #d7e0ec;
      border-radius: 8px;
      background: #fff;
    }
    .history-card-heading {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 10px;
    }
    .history-caller {
      margin: 0;
      font-size: 13px;
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .history-caller-slot {
      flex: 1;
      min-width: 0;
    }
    .history-card-actions {
      display: flex;
      align-items: center;
      gap: 7px;
      flex-shrink: 0;
    }
    .history-edit-toggle,
    .history-delete {
      width: 28px;
      height: 28px;
      padding: 0;
      margin: 0;
      color: #245dc1;
      font-size: 17px;
      line-height: 1;
      border-color: #c5d5ec;
      background: #f3f7ff;
    }
    .history-delete {
      color: #a03d23;
      background: #fff6f3;
      border-color: #ead2c9;
      font-size: 15px;
    }
    .history-card.editing {
      border-color: #8dafe0;
      background: #f8faff;
    }
    .history-notes {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 12px;
      line-height: 1.5;
      margin: 10px 0;
      color: #35445b;
    }
    .history-job {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      color: #245dc1;
      background: #edf4ff;
      border-radius: 5px;
      padding: 5px 7px;
      margin: 0 0 9px;
      overflow-wrap: anywhere;
    }
    .history-editor-fields label {
      display: block;
      margin: 10px 0;
      color: #35445b;
      font-size: 11px;
      font-weight: 600;
    }
    .history-editor-fields .history-edit-input {
      display: block;
      margin-top: 5px;
      font-weight: 400;
    }
    .history-edit-toggle.saving {
      color: #fff;
      background: #245dc1;
      border-color: #245dc1;
    }
    .history-edit-input {
      width: 100%;
      min-width: 0;
      padding: 7px 8px;
      border: 1px solid #245dc1;
      border-radius: 5px;
      font: inherit;
      color: #172235;
      background: #fff;
    }
    .history-card.editing .history-time {
      display: none;
    }
    .history-time {
      font-size: 10px;
      white-space: nowrap;
      color: #526176;
      font-variant-numeric: tabular-nums;
    }
    .history-timings {
      display: flex;
      gap: 6px 12px;
      flex-wrap: wrap;
      padding-top: 9px;
      margin-top: 9px;
      border-top: 1px solid #e4eaf2;
      font-size: 10px;
      color: #526176;
      font-variant-numeric: tabular-nums;
    }
    .history-extra {
      font-size: 10px;
      color: #526176;
      margin-top: 8px;
      overflow-wrap: anywhere;
    }
    .history-extra summary {
      cursor: pointer;
      color: #245dc1;
    }
    .history-extra p {
      margin: 5px 0 0;
    }
    .history-day {
      font-size: 10px;
      font-weight: 650;
      color: #526176;
      margin: 4px 0 8px;
    }
    .history-empty {
      padding: 24px 14px;
      border: 1px dashed #b5c6dc;
      border-radius: 8px;
      background: #f8faff;
      text-align: center;
      color: #526176;
      font-size: 12px;
      line-height: 1.6;
    }
    .history-note {
      font-size: 10px;
      line-height: 1.4;
      color: #526176;
      margin: 9px 0 0;
    }
    .compact-view[data-kind="disposition"] {
      --progress-colour: #7650a5;
      --progress-soft: #f2edfb;
    }
    .compact-view[data-kind="shortBreak"] {
      --progress-colour: #147e78;
      --progress-soft: #e5f5f1;
    }
    .short-break-summary {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 12px;
    }
    .short-break-summary > div {
      padding: 11px 12px;
      border-radius: 8px;
      background: var(--progress-soft);
    }
    .short-value {
      display: block;
      font-size: 24px;
      font-weight: 650;
      color: var(--progress-colour);
      font-variant-numeric: tabular-nums;
    }
    .short-label {
      display: block;
      margin-top: 3px;
      color: #526176;
      font-size: 10px;
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
    @media (max-height: 640px) {
      .panel.main-panel {
        padding: 10px;
      }
      .main-panel .section-heading {
        margin: 6px 0 3px;
        font-size: 12px;
        line-height: 1.3;
      }
      .main-panel .agents {
        min-height: 56px;
        margin: 4px 0;
      }
      .main-panel th,
      .main-panel td {
        padding: 4px 6px;
      }
      .main-panel .agent-help {
        font-size: 9.5px;
        line-height: 1.3;
      }
      .main-panel .monitoring-summary {
        padding: 6px 10px;
      }
      .main-panel .queue-total {
        font-size: 24px;
      }
      .main-panel .stat {
        padding: 6px 8px;
      }
      .main-panel .statistics-note {
        font-size: 9.5px;
        line-height: 1.3;
        margin-top: 4px;
      }
      .main-panel .current-reminder {
        padding: 7px 9px;
      }
      .main-panel .reminder-title,
      .main-panel .reminder-reason {
        font-size: 11px;
        line-height: 1.3;
      }
      .main-panel .reminder-mark {
        flex-basis: 18px;
        height: 18px;
        font-size: 11px;
      }
      .main-panel .reminder-state {
        font-size: 9px;
        line-height: 1.3;
        margin-top: 4px;
      }
    }
    @media (max-height: 520px) {
      .panel.main-panel {
        padding: 9px;
      }
      .main-panel .monitor-grid {
        grid-template-columns: minmax(115px, 1fr) minmax(0, 2fr);
        gap: 10px;
      }
      .main-panel .monitoring-summary {
        flex-direction: column;
        align-items: flex-start;
        gap: 5px;
      }
      .main-panel .queue-count {
        flex-wrap: wrap;
        gap: 4px;
      }
      .main-panel .queue-count .small {
        font-size: 9px;
      }
      .main-panel .monitoring-state {
        max-width: 100%;
        text-align: left;
      }
      .main-panel .statistics {
        gap: 4px;
      }
      .main-panel .stat {
        padding: 4px 5px;
      }
      .main-panel .stat-label {
        font-size: 9px;
      }
      .main-panel .stat-value {
        font-size: 16px;
      }
      .main-panel .current-reminders {
        margin-top: 8px;
      }
      .main-panel .footer {
        margin-top: 7px;
        padding-top: 7px;
      }
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
  function buttonIcon (button, paths) {
    // Fixed SVG paths avoid platform-dependent emoji and never interpret page/user text.
    button.textContent = ''
    button.classList.add('icon-button')
    button.type = 'button'
    const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'button-icon', 'aria-hidden': 'true' })) {
      icon.setAttribute(name, value)
    }
    for (const shape of paths) {
      const part = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
      part.setAttribute('d', shape)
      icon.append(part)
    }
    button.append(icon)
  }
  const panel = createElement('section', '', shadow, 'panel')
  const compactView = createElement('div', '', panel, 'compact-view hidden')
  const compactHeading = createElement('div', '', compactView, 'compact-heading')
  const compactTitle = createElement('span', '', compactHeading, 'compact-title')
  const compactActions = createElement('span', '', compactHeading, 'compact-actions')
  const compactCountdown = createElement('span', '', compactActions, 'compact-countdown')
  const compactMute = createElement('button', 'Mute', compactActions)
  const shortSummary = createElement('div', '', compactView, 'short-break-summary hidden')
  const shortTodayBox = createElement('div', '', shortSummary)
  const shortToday = createElement('span', '0 min', shortTodayBox, 'short-value short-today')
  createElement('span', 'Short breaks today', shortTodayBox, 'short-label')
  const shortCurrentBox = createElement('div', '', shortSummary)
  const shortCurrent = createElement('span', '0 min', shortCurrentBox, 'short-value short-current')
  createElement('span', 'This short break', shortCurrentBox, 'short-label')
  const progressTrack = createElement('div', '', compactView, 'progress-track')
  progressTrack.setAttribute('role', 'progressbar')
  progressTrack.setAttribute('aria-valuemin', '0')
  const progressFill = createElement('div', '', progressTrack, 'progress-fill')
  const compactMeta = createElement('div', '', compactView, 'compact-meta')
  const compactElapsed = createElement('span', '', compactMeta, 'compact-elapsed')
  const compactAllowance = createElement('span', '', compactMeta, 'compact-allowance')
  const callView = createElement('section', '', panel, 'call-view hidden')
  const callHeading = createElement('div', '', callView, 'call-heading')
  const callHeadingTitle = createElement('div', '', callHeading, 'call-heading-actions')
  createElement('span', 'On call', callHeadingTitle, 'call-title')
  const callBadge = createElement('span', 'Connected', callHeadingTitle, 'call-badge')
  const callActions = createElement('div', '', callHeading, 'call-heading-actions')
  const callElapsed = createElement('span', '—', callActions, 'call-duration')
  const callHistoryButton = createElement('button', 'Call Notes', callActions)
  callHistoryButton.title = 'Open Call Notes'
  const callMute = createElement('button', '', callActions)
  const callInformation = createElement('div', '', callView, 'call-information')
  function createCallDetail (parent, label, className) {
    const box = createElement('div', '', parent)
    createElement('span', label, box, 'call-detail-label')
    return createElement('span', 'Unavailable', box, 'call-detail-value ' + className)
  }
  const callNumber = createCallDetail(callInformation, 'Phone number', 'call-number')
  const callQueue = createCallDetail(callInformation, 'Queue', 'call-queue')
  const callerLabel = createElement(
    'label',
    'Caller name or student number (optional)',
    callView,
    'caller-label'
  )
  callerLabel.setAttribute('for', 'its-caller-identifier')
  const callerInput = createElement('input', '', callerLabel)
  callerInput.type = 'text'
  callerInput.id = 'its-caller-identifier'
  callerInput.maxLength = 160
  callerInput.autocomplete = 'off'
  callerInput.placeholder = 'Staff name or student number'
  callerInput.setAttribute('aria-describedby', 'its-caller-help')
  const callerHelp = createElement(
    'p',
    'Saves to Call Notes at Wrap up. Leave the name or ID blank for Unknown.',
    callView,
    'caller-help'
  )
  callerHelp.id = 'its-caller-help'
  const notesLabel = createElement('label', 'Notes (optional)', callView, 'caller-label caller-notes-label')
  notesLabel.setAttribute('for', 'its-caller-notes')
  const notesInput = createElement('textarea', '', notesLabel)
  notesInput.id = 'its-caller-notes'
  notesInput.rows = 3
  notesInput.maxLength = MAX_NOTES_LENGTH
  notesInput.placeholder = 'What the caller needs and any useful details'
  notesInput.setAttribute('aria-describedby', 'its-caller-help')
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
  const content = createElement('div', '', normalView, 'main-content')
  const agentHeading = createElement('div', '', content, 'agent-heading')
  createElement('h4', 'Agents', agentHeading, 'section-heading')
  const agentDataBadge = createElement('span', 'Live', agentHeading, 'agent-data-badge')
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
  const queueCountLabel = createElement(
    'span',
    'Callers waiting',
    queueCount,
    'small queue-count-label'
  )
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
  const historyPanel = createElement('section', '', panel, 'menu-view call-history hidden')
  const historyHeader = createElement('div', '', historyPanel, 'menu-header')
  createElement('h3', 'Call Notes', historyHeader)
  const historyBack = createElement('button', 'Back', historyHeader)
  const historyStatistics = createElement('div', '', historyPanel, 'history-statistics')
  function createHistoryStatistic (label, className) {
    const box = createElement('div', '', historyStatistics, 'history-stat')
    const value = createElement('span', '—', box, 'stat-value ' + className)
    createElement('span', label, box, 'stat-label')
    return value
  }
  const historyTotal = createHistoryStatistic('Total notes', 'notes-total')
  const historyStudents = createHistoryStatistic('Students (predicted)', 'notes-students')
  const historyStaff = createHistoryStatistic('Staff (predicted)', 'notes-staff')
  const historyMissingJobs = createHistoryStatistic('Missing job numbers', 'notes-missing-jobs')
  const historySummary = createElement('div', '', historyPanel, 'history-summary')
  createElement(
    'span',
    deployment?.persistent ? 'Saved in this browser' : 'This session',
    historySummary,
    'history-session-count'
  )
  const historyResults = createElement('span', '', historySummary, 'small')
  const historyTransfer = createElement('div', '', historyPanel, 'history-transfer')
  const historyAdd = createElement('button', '+ Add note', historyTransfer, 'primary history-add')
  historyAdd.title = 'Add an in-person note'
  const historyImport = createElement('button', 'Import TXT', historyTransfer)
  const historyExport = createElement('button', 'Export TXT', historyTransfer)
  const historyDownload = createElement('button', 'Download TXT', historyTransfer, 'hidden')
  const historyFile = createElement('input', '', historyPanel, 'hidden')
  historyFile.type = 'file'
  historyFile.accept = '.txt,text/plain'
  historyFile.setAttribute('aria-label', 'Import a Call Notes text file')
  const historyTransferStatus = createElement('p', '', historyPanel, 'history-transfer-status hidden')
  historyTransferStatus.setAttribute('role', 'status')
  historyTransferStatus.setAttribute('aria-live', 'polite')
  const historySearch = createElement('input', '', historyPanel, 'history-search')
  historySearch.type = 'search'
  historySearch.placeholder = 'Search name, ID, notes, job number, phone or queue'
  historySearch.setAttribute('aria-label', 'Search Call Notes')
  const historyList = createElement('div', '', historyPanel, 'history-list')
  historyList.setAttribute('role', 'region')
  historyList.setAttribute('aria-label', deployment?.persistent ? 'Saved calls, newest first' : 'Calls saved this session, newest first')
  historyList.tabIndex = 0
  // Persistent histories can span many days; keep each rendered page responsive.
  const historyPager = deployment?.historyPageSize
    ? createElement('div', '', historyPanel, 'history-summary hidden')
    : null
  const historyPrevious = historyPager ? createElement('button', 'Previous', historyPager) : null
  const historyPageLabel = historyPager ? createElement('span', '', historyPager, 'small') : null
  const historyNext = historyPager ? createElement('button', 'Next', historyPager) : null
  createElement(
    'p',
    deployment?.persistent
      ? 'Saved in this browser. The tick, clicking away or Back saves. Export TXT to keep a backup.'
      : 'Edit with the pen. The tick, clicking away or Back saves. Export TXT to keep a copy after this session.',
    historyPanel,
    'history-note'
  )
  const soundHeader = createElement('div', '', soundPanel, 'menu-header')
  createElement('h3', 'Sound Settings', soundHeader)
  const soundBack = createElement('button', 'Back', soundHeader)
  const settingsHeader = createElement('div', '', settingsPanel, 'menu-header')
  createElement('h3', 'Assistant Settings', settingsHeader)
  const settingsBack = createElement('button', 'Back', settingsHeader)
  const dataWarning = createElement('aside', '', panel, 'data-warning hidden')
  dataWarning.setAttribute('role', 'status')
  dataWarning.setAttribute('aria-live', 'polite')
  createElement('strong', 'Agent information frozen', dataWarning)
  createElement('p', 'Open 8x8 queue information for live updates.', dataWarning)
  const dataLastRead = createElement('p', '', dataWarning, 'data-last-read')
  const bottom = createElement('div', '', panel, 'assistant-bottom')
  const dataFileStatus = createElement('button', '', bottom, 'data-file-status hidden')
  dataFileStatus.title = 'Open Data location settings'
  const banner = createElement('div', '', bottom, 'alert current-reminders hidden')
  banner.setAttribute('role', 'region')
  banner.setAttribute('aria-label', 'Current assistant reminders')
  banner.setAttribute('aria-live', 'polite')
  const footer = createElement('div', '', bottom, 'footer')
  const footerDetails = createElement('div', '', footer, 'footer-details')
  const updateSection = createElement(
    'div',
    'Last updated',
    footerDetails,
    'footer-detail last-updated'
  )
  const lastUpdated = createElement('time', '—', updateSection)
  const versionSection = createElement(
    'div',
    'Version',
    footerDetails,
    'footer-detail release-version'
  )
  createElement('span', VERSION, versionSection, 'footer-value')
  const storageState = deployment?.persistent
    ? createElement('span', 'Saving…', footerDetails, 'small extension-storage-state')
    : null
  const stopStorageStatus = deployment?.onStorageStatus?.((status) => {
    if (storageState) storageState.textContent = status === 'saved' ? 'Saved in this browser' : status === 'error' ? 'Not saved — export a backup' : 'Saving…'
  })
  const controls = createElement('div', '', footer, 'controls')
  const historyButton = createElement('button', 'Call Notes', controls, 'notes-shortcut')
  const muteButton = createElement('button', '', controls)
  const settingsButton = createElement('button', '', controls)
  settingsButton.setAttribute('aria-label', 'Settings')
  settingsButton.title = 'Assistant settings'
  buttonIcon(settingsButton, [
    'M9.85 4.50L10.44 2.12L13.56 2.12L14.15 4.50L15.78 5.18L17.88 3.91L20.09 6.12L18.82 8.22L19.50 9.85L21.88 10.44L21.88 13.56L19.50 14.15L18.82 15.78L20.09 17.88L17.88 20.09L15.78 18.82L14.15 19.50L13.56 21.88L10.44 21.88L9.85 19.50L8.22 18.82L6.12 20.09L3.91 17.88L5.18 15.78L4.50 14.15L2.12 13.56L2.12 10.44L4.50 9.85L5.18 8.22L3.91 6.12L6.12 3.91L8.22 5.18Z',
    'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'
  ])
  doc.body.append(host)
  let destroyed = false
  let windowResizer = null
  let automaticData = null
  let audio = null
  let secondaryAudio = null
  let secondaryOutputReady = false
  let secondaryOutputPending = false
  let audioOutputDevices = []
  const AudioClass = root.AudioContext || root.webkitAudioContext
  // Each output uses an assistant-owned context; unsupported browsers retain default audio.
  const canRouteOutput = typeof AudioClass?.prototype?.setSinkId === 'function'
  const mediaDevices = root.navigator.mediaDevices
  let muted = false
  let audioOutputReady = true
  let lastScan = Date.now()
  let agentsFrozen = false
  let compactKind = ''
  let historyDuringCall = false
  const reminders = new Map()
  const reminderLifetimes = new Map()
  const noticeTimes = new Map()
  const reminderWidgets = new Map()
  let activeView = 'main'
  let activeReminder = null
  const PREFERENCES_KEY = 'service-desk-8x8-preferences-v5'
  let preferences = {}
  // Validate the stored shape before reading fields; browser storage can be edited.
  try {
    const value = JSON.parse(settingsStorage.getItem(PREFERENCES_KEY) || '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) preferences = value
  } catch {
    // Invalid JSON or blocked storage uses defaults for this run.
  }
  // This set owns persistent G1 membership. Roster refreshes never remove entries;
  // only an explicit checkbox change may alter the user's saved choices.
  const selected = new Set(
    Array.isArray(preferences.g1)
      ? preferences.g1
        .filter((name) => typeof name === 'string' && normaliseText(name))
        .map(normaliseText)
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
  const oldDispositionDefault =
    preferences.settingsVersion !== 3 && preferences.dispositionSeconds === 10
  const dispositionValue = oldDispositionDefault ? 20 : preferences.dispositionSeconds
  let dispositionSeconds = settingNumber(dispositionValue, 20, 1, 120)
  // Preserve the former Extra Phone Cover Delay under its current setting name.
  let waitingAlertSeconds = Number.isFinite(preferences.waitingAlertSeconds)
    ? settingNumber(preferences.waitingAlertSeconds, 180, 1, 3600)
    : secondsPreference('coverSeconds', 'coverMinutes', 180, 3600)
  let notificationDisplaySeconds = settingNumber(preferences.notificationDisplaySeconds, 5, 1, 300)
  muted = preferences.muted === true
  // AudioContext uses an empty sink ID for the operating system's default device.
  let outputDeviceId =
    typeof preferences.outputDeviceId === 'string' && preferences.outputDeviceId !== 'default'
      ? preferences.outputDeviceId
      : ''
  let secondaryRingerEnabled = preferences.secondaryRingerEnabled === true && canRouteOutput
  let secondaryDeviceId =
    typeof preferences.secondaryDeviceId === 'string' && preferences.secondaryDeviceId !== 'default'
      ? preferences.secondaryDeviceId
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
  const dataLocation = createElement('div', '', settingsPanel, 'settings-card data-location')
  createElement('h4', 'Data location', dataLocation)
  createElement('p', 'Choose a text file for automatic saving and restoring of Call Notes. Changes save while the assistant is open, with another save attempted when you leave.', dataLocation, 'settings-description')
  const dataLocationInfo = createElement('p', 'No data file selected.', dataLocation, 'settings-description data-location-status')
  dataLocationInfo.setAttribute('role', 'status')
  const dataChoose = createElement('button', 'Choose data file', dataLocation)
  const dataReconnect = createElement('button', 'Reconnect', dataLocation, 'hidden')
  const dataSave = createElement('button', 'Save now', dataLocation, 'hidden')
  const dataDisconnect = createElement('button', 'Disconnect', dataLocation, 'hidden')
  createElement('p', 'Use Edge’s file picker to choose the folder. The assistant reconnects when it starts; Edge may ask for access when you next click in 8x8. A crash or power loss can interrupt the latest save.', dataLocation, 'settings-description data-location-help')
  dataChoose.disabled = !!deployment || typeof root.showSaveFilePicker !== 'function'
  if (dataChoose.disabled) {
    dataLocationInfo.textContent = deployment
      ? 'The extension already saves Call Notes in this browser.'
      : 'Automatic file access is unavailable here. You can still use Export TXT and Import TXT.'
  }
  const lunchPanel = createElement('div', '', settingsPanel, 'settings-card lunch-settings')
  createElement('h4', 'Lunch Break Length', lunchPanel)
  createElement(
    'p',
    'Length of my lunch break. Used in both G1 and G2. Short breaks are counted separately.',
    lunchPanel,
    'settings-description'
  )
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
      settingsStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify({
          settingsVersion: 3,
          g1: [...selected],
          lunchMinutes,
          dispositionSeconds,
          waitingAlertSeconds,
          notificationDisplaySeconds,
          desktopNotifications,
          muted,
          outputDeviceId,
          secondaryRingerEnabled,
          secondaryDeviceId
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
    const part = (name) => parts.find((p) => p.type === name).value
    return `${part('year')}-${part('month')}-${part('day')}`
  }
  const statistics = { day: dayKey(Date.now()), calls: [], hadGaps: false, lastPresence: null }
  try {
    const value = JSON.parse(settingsStorage.getItem(STATISTICS_KEY) || '{}')
    if (value && typeof value === 'object') {
      if (value.day === statistics.day && Array.isArray(value.calls)) {
        // Retain only real timestamps from today; future or invalid entries cannot count as calls.
        statistics.calls = value.calls.filter(
          (time) => Number.isFinite(time) && time <= Date.now() && dayKey(time) === statistics.day
        )
        statistics.hadGaps = value.hadGaps === true
      }
      // Last observed status survives daily rollover, avoiding a duplicate ongoing Busy period.
      const last = value.lastPresence
      if (last && typeof last.status === 'string' && Number.isFinite(last.seenAt)) {
        statistics.lastPresence = { status: normaliseStatus(last.status), seenAt: last.seenAt }
        if (deployment && typeof last.transactionId === 'string') {
          statistics.lastPresence.transactionId = last.transactionId
        }
      }
    }
  } catch {
    // Corrupt saved statistics start a new observed counter without interrupting monitoring.
  }
  let lastStatisticsSave = 0
  function saveStatistics () {
    try {
      settingsStorage.setItem(STATISTICS_KEY, JSON.stringify(statistics))
      lastStatisticsSave = Date.now()
    } catch {
      // Statistics remain usable in memory when the browser blocks persistence.
    }
  }
  function renderStatistics () {
    // Observed call totals belong to the main menu; note totals have their own lifecycle.
    setText(callTotal, String(statistics.calls.length))
    const now = Date.now()
    // A rolling hour differs from the Brisbane calendar-day total.
    const hourMilliseconds = SECONDS_PER_MINUTE * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND
    const hourTotal = String(
      statistics.calls.filter((time) => time >= now - hourMilliseconds).length
    )
    setText(callsHour, hourTotal)
    const latest = statistics.calls.at(-1)
    const lastTime =
      latest === undefined
        ? '—'
        : new Date(latest).toLocaleTimeString('en-AU', {
          timeZone: STATISTICS_ZONE,
          hour: '2-digit',
          minute: '2-digit'
        })
    setText(lastCall, lastTime)
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
      const page = deployment && busy ? readCallPage(docs) : null
      const reference = page?.phase === 'call' && !page.identityConflict && !closedCallPage(page)
        ? page.transactionId
        : null
      const oldReference = old?.transactionId || (
        deployment && wasBusy
          ? callHistory.pending.find((call) => call.id === callHistory.currentId)?.transactionId
          : null
      )
      // Across a browser restart, two distinct connected references can prove a new
      // call even if Busy was the last observed status. Missing Info proves nothing.
      const newCall = busy && (!wasBusy || (reference && oldReference && reference !== oldReference))
      if (newCall) {
        statistics.calls.push(now)
        changed = true
      }
      if (!old || status !== old.status) changed = true
      statistics.lastPresence = { status, seenAt: now }
      if (deployment && busy && (reference || (wasBusy && oldReference))) {
        statistics.lastPresence.transactionId = reference || oldReference
      }
    }
    if (changed || now - lastStatisticsSave >= 15000) saveStatistics()
    renderStatistics()
  }
  const CALL_HISTORY_KEY = 'service-desk-8x8-call-history-v1'
  const callHistory = {
    startedAt: Date.now(),
    nextId: 1,
    currentId: null,
    closedId: null,
    closedCall: null,
    completedTransactions: [],
    pending: [],
    records: []
  }
  let historyRevision = 0
  let historyPage = 0
  let historyRenderKey = ''
  let historyRenderedQuery = ''
  let editingCallId = null
  let historyEdit = null
  let newManualRecord = null
  const touchedCallFields = new Map((Array.isArray(resumedDataFile?.touched) ? resumedDataFile.touched : [])
    .filter(([id, fields]) => Number.isSafeInteger(id) && Array.isArray(fields))
    .map(([id, fields]) => [id, new Set(fields.filter((key) => ['callerInput', 'notesInput'].includes(key)))]))
  const historyWidgets = new Map()
  const historyDays = new Map()
  let historyEmpty = null
  let transferBusy = false
  // Keep internal line breaks/indentation, normalise Windows endings and cap the editable size.
  const cleanNotes = (value) =>
    typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTES_LENGTH) : ''
  function cleanJobNumber (value) {
    // The readable TXT placeholder represents an absent ticket, not a literal job number.
    const text = normaliseText(value).slice(0, 80)
    return /^no\s+(?:job|ticket)(?:\s+number)?\.?$/i.test(text) ? '' : text
  }
  function newNoteKey () {
    // Exported keys identify records across tabs without relying on their local row numbers.
    return root.crypto?.randomUUID?.() ||
      `${Date.now()}-${callHistory.nextId}-${Math.random().toString(36).slice(2)}`
  }
  function predictCaller (value) {
    const text = normaliseText(value)
    // Identifiers remain strings: leading zeros are significant for student numbers.
    if (!text || normaliseStatus(text) === 'unknown') return 'Unknown'
    if (/^\d{6,9}$/.test(text)) return 'Student'
    // Names and usernames suggest staff; a student's name may produce the same guess.
    if (/\p{L}/u.test(text)) return 'Staff'
    return 'Unknown'
  }
  // Finite numbers can still exceed JavaScript's supported date range.
  const validCallTime = (time) => Number.isFinite(time) && Number.isFinite(new Date(time).getTime())
  function savedCall (value, pending) {
    // Session storage is editable. Validate its data before displaying it or restoring a draft.
    if (
      !value ||
      !Number.isSafeInteger(value.id) ||
      value.id < 1 ||
      !(validCallTime(value.detectedAt) || (!pending && value.detectedAt === null))
    ) {
      return null
    }
    if (!pending && !(validCallTime(value.completedAt) || value.completedAt === null)) {
      return null
    }
    const text = (key, limit = 200) =>
      typeof value[key] === 'string' ? normaliseText(value[key]).slice(0, limit) || null : null
    const seconds = (key) =>
      Number.isSafeInteger(value[key]) && value[key] >= 0 ? value[key] : null
    const call = {
      id: value.id,
      recordKey: text('recordKey', 180) || newNoteKey(),
      originalId: Number.isSafeInteger(value.originalId) && value.originalId > 0
        ? value.originalId
        : value.id,
      origin: ['text', 'manual'].includes(value.origin) ? value.origin : '8x8',
      detectedAt: value.detectedAt,
      transactionId: text('transactionId', 160),
      number: readablePhone(text('number', 80)),
      queue: text('queue'),
      channel: text('channel'),
      channelNumber: readablePhone(text('channelNumber', 80)),
      durationSeconds: seconds('durationSeconds'),
      waitSeconds: seconds('waitSeconds'),
      holdSeconds: seconds('holdSeconds')
    }
    if (value.recovered === true) call.recovered = true
    if (pending) {
      call.callerInput =
        typeof value.callerInput === 'string' ? value.callerInput.slice(0, 160) : ''
      call.notesInput = typeof value.notesInput === 'string'
        ? value.notesInput.slice(0, MAX_NOTES_LENGTH)
        : ''
    } else {
      call.caller = text('caller', 160) || 'Unknown'
      call.callerPrediction = predictCaller(call.caller)
      call.notes = cleanNotes(value.notes)
      call.jobNumber = cleanJobNumber(text('jobNumber', 80))
      call.completedAt = value.completedAt
      call.durationComplete = value.durationComplete === true
    }
    return call
  }
  try {
    const stored = historyStorage?.getItem(CALL_HISTORY_KEY)
    const saved = stored ? JSON.parse(stored) : resumedCallHistory
    if (saved && typeof saved === 'object') {
      if (validCallTime(saved.startedAt)) callHistory.startedAt = saved.startedAt
      const ids = new Set()
      // A completed record takes precedence over a duplicate pending draft.
      for (const [key, pending] of [
        ['records', false],
        ['pending', true]
      ]) {
        for (const value of Array.isArray(saved[key]) ? saved[key] : []) {
          const call = savedCall(value, pending)
          if (!call || ids.has(call.id)) continue
          ids.add(call.id)
          callHistory[key].push(call)
        }
      }
      // Never reuse a saved sequence number, even if storage lost its nextId field.
      callHistory.nextId = [...ids].reduce((next, id) => Math.max(next, id + 1), 1)
      if (Number.isSafeInteger(saved.nextId)) {
        callHistory.nextId = Math.max(callHistory.nextId, saved.nextId)
      }
      if (callHistory.pending.some((call) => call.id === saved.currentId)) {
        callHistory.currentId = saved.currentId
      }
      if (callHistory.records.some((call) => call.id === saved.closedId)) {
        callHistory.closedId = saved.closedId
        const record = callHistory.records.find((call) => call.id === saved.closedId)
        callHistory.closedCall = {
          id: record.id,
          transactionId: record.transactionId,
          number: record.number
        }
      }
      // Deleting a note must not release its interaction guard or permit disposition duplicates.
      if (Number.isSafeInteger(saved.closedCall?.id) && saved.closedCall.id > 0) {
        callHistory.closedCall = {
          id: saved.closedCall.id,
          transactionId: typeof saved.closedCall.transactionId === 'string'
            ? saved.closedCall.transactionId.slice(0, 160)
            : null,
          number: readablePhone(saved.closedCall.number)
        }
        callHistory.closedId = callHistory.closedCall.id
      }
      // Older sessions derive observed references once. Import never adds to this capture ledger.
      const transactions = Array.isArray(saved.completedTransactions)
        ? saved.completedTransactions
        : callHistory.records.map((call) => call.transactionId)
      callHistory.completedTransactions = [...new Set(transactions.filter(
        (value) => typeof value === 'string' && value && value.length <= 160
      ))]
      if (
        callHistory.closedCall?.transactionId &&
        !callHistory.completedTransactions.includes(callHistory.closedCall.transactionId)
      ) {
        callHistory.completedTransactions.push(callHistory.closedCall.transactionId)
      }
    }
  } catch {
    // An in-memory snapshot preserves drafts on rerun when the browser blocks session storage.
    if (resumedCallHistory) {
      Object.assign(callHistory, resumedCallHistory)
      if (!Array.isArray(resumedCallHistory.completedTransactions)) {
        callHistory.completedTransactions = callHistory.records.map((call) => call.transactionId).filter(Boolean)
      }
    }
  }
  // A blocked-storage upgrade from an older running prototype still needs the new guard ledger.
  if (!Array.isArray(callHistory.completedTransactions)) {
    callHistory.completedTransactions = callHistory.records.map((call) => call.transactionId).filter(Boolean)
  }
  if (!callHistory.closedCall && callHistory.closedId !== null) {
    const record = callHistory.records.find((call) => call.id === callHistory.closedId)
    if (record) callHistory.closedCall = { id: record.id, transactionId: record.transactionId, number: record.number }
  }
  // Older records and blocked-storage rerun snapshots derive the prediction from the identifier.
  for (const record of callHistory.records) {
    record.callerPrediction = predictCaller(record.caller)
    record.notes ||= ''
    record.jobNumber ||= ''
    record.recordKey ||= newNoteKey()
    record.originalId ||= record.id
    record.origin ||= '8x8'
  }
  function saveCallHistory () {
    automaticData?.changed()
    try {
      if (deployment?.saveHistory) {
        // Extension storage writes changing drafts separately from durable completed records.
        deployment.saveHistory(callHistory, historyRevision)
        return
      }
      // Keep the tab copy separate from preferences; the optional file writer runs independently.
      historyStorage?.setItem(CALL_HISTORY_KEY, JSON.stringify(callHistory))
    } catch {
      // History and draft editing remain usable in memory when storage is blocked or full.
    }
  }
  function currentCallDraft () {
    return callHistory.pending.find((call) => call.id === callHistory.currentId) || null
  }
  function closedCallPage (page) {
    if (
      page.transactionId &&
      callHistory.completedTransactions.includes(page.transactionId)
    ) {
      return true
    }
    const closed = callHistory.closedCall
    if (!closed) return false
    // A different known reference or caller proves a distinct interaction. Missing Info
    // during disposition cannot manufacture another call with an Unknown identifier.
    if (page.transactionId && closed.transactionId) {
      return page.transactionId === closed.transactionId
    }
    if (page.number && closed.number && phoneDigits(page.number) !== phoneDigits(closed.number)) {
      return false
    }
    return true
  }
  function matchesCallNumber (draft, page) {
    // Missing values do not contradict a draft; two readable different numbers do.
    return !draft.number || !page.number || phoneDigits(draft.number) === phoneDigits(page.number)
  }
  function matchingCallDraft (page) {
    // After a new document/session, only a stable reference can restore an older draft.
    // A repeated telephone number must never attach an earlier caller's notes to a new call.
    const eligible = callHistory.pending.filter((call) =>
      !deployment?.restoredDraftIds?.includes(call.id) ||
      (page.transactionId && call.transactionId === page.transactionId)
    )
    if (page.transactionId) {
      const exact = eligible.find((call) => call.transactionId === page.transactionId)
      if (exact) {
        // Once this document has verified a restored call, later hidden Info tabs
        // may keep using its current draft without demanding the reference again.
        if (deployment?.restoredDraftIds?.includes(exact.id)) {
          deployment.restoredDraftIds = deployment.restoredDraftIds.filter((id) => id !== exact.id)
        }
        return exact
      }
      // Info can appear after the caller starts typing. Adopt its reference into the same draft.
      const current = eligible.find((call) => call.id === callHistory.currentId)
      return current && !current.transactionId && matchesCallNumber(current, page) ? current : null
    }
    const current = eligible.find((call) => call.id === callHistory.currentId)
    if (current && matchesCallNumber(current, page)) return current
    const byNumber = page.number
      ? eligible.filter(
        (call) => call.number && phoneDigits(call.number) === phoneDigits(page.number)
      )
      : []
    // Two drafts for the same telephone number need a reference to resolve their identity.
    return byNumber.length === 1 ? byNumber[0] : null
  }
  function updateCallDetails (draft, page) {
    for (const key of [
      'transactionId',
      'number',
      'queue',
      'channel',
      'channelNumber',
      'waitSeconds',
      'holdSeconds'
    ]) {
      // Hidden Info tabs and partial renders cannot erase previously readable details.
      if (page[key] !== null && page[key] !== undefined) draft[key] = page[key]
    }
    if (Number.isFinite(page.durationSeconds)) {
      // The interaction timer is distinct from Busy, hold and disposition clocks.
      draft.durationSeconds = Math.max(draft.durationSeconds || 0, page.durationSeconds)
    }
  }
  function finishCall (draft, page = null) {
    // A shorter final clock contradicts an earlier sample; retain the measured lower bound.
    const finalDurationReadable =
      !!page &&
      Number.isFinite(page.durationSeconds) &&
      page.durationSeconds >= (draft.durationSeconds || 0)
    if (page) updateCallDetails(draft, page)
    const record = {
      ...draft,
      caller: normaliseText(draft.callerInput) || 'Unknown',
      callerPrediction: predictCaller(draft.callerInput),
      notes: cleanNotes(draft.notesInput),
      jobNumber: '',
      completedAt: Math.max(Date.now(), draft.detectedAt),
      // Only a final native timer confirms the complete duration. Earlier samples are a lower bound.
      durationComplete: finalDurationReadable
    }
    delete record.callerInput
    delete record.notesInput
    delete record.recovered
    callHistory.records.push(record)
    callHistory.closedId = record.id
    callHistory.closedCall = { id: record.id, transactionId: record.transactionId, number: record.number }
    if (record.transactionId && !callHistory.completedTransactions.includes(record.transactionId)) {
      callHistory.completedTransactions.push(record.transactionId)
    }
    callHistory.pending = callHistory.pending.filter((call) => call.id !== draft.id)
    if (callHistory.currentId === draft.id) {
      callHistory.currentId = null
      callerInput.disabled = true
      notesInput.disabled = true
    }
    historyRevision++
  }
  function trackCallHistory (docs) {
    const page = readCallPage(docs)
    // Completed records do not change during polling; avoid reserialising years of notes.
    const observation = () => JSON.stringify([
      callHistory.currentId, callHistory.closedId, callHistory.closedCall,
      callHistory.nextId, callHistory.pending, callHistory.records.length,
      callHistory.completedTransactions.length
    ])
    const before = observation()
    if (page?.identityConflict) {
      // Keep the draft unchanged while header and Info describe different callers.
    } else if (page?.phase === 'call') {
      // A stable transaction reference prevents repeated renders or restarts making duplicates.
      const alreadySaved = closedCallPage(page)
      if (alreadySaved) {
        callHistory.currentId = null
        callerInput.disabled = true
        notesInput.disabled = true
      } else {
        callHistory.closedId = null
        callHistory.closedCall = null
        let draft = matchingCallDraft(page)
        if (!draft) {
          draft = {
            id: callHistory.nextId++,
            recordKey: newNoteKey(),
            originalId: callHistory.nextId - 1,
            origin: '8x8',
            detectedAt: Date.now(),
            callerInput: '',
            notesInput: '',
            number: null,
            queue: null,
            transactionId: null,
            channel: null,
            channelNumber: null,
            waitSeconds: null,
            durationSeconds: null,
            holdSeconds: null
          }
          // Keep other pending drafts when 8x8 switches between interactions.
          callHistory.pending.push(draft)
        }
        callHistory.currentId = draft.id
        updateCallDetails(draft, page)
      }
    } else if (page?.phase === 'disposition') {
      const draft = matchingCallDraft(page)
      // An unfamiliar Wrap up reference cannot finalise another caller's draft.
      if (draft) finishCall(draft, page)
      else {
        // Restore the guard when upgrading an already-saved interaction still in Wrap up.
        const record = page.transactionId
          ? callHistory.records.find((call) => call.transactionId === page.transactionId)
          : callHistory.records.at(-1)
        if (page.transactionId && callHistory.completedTransactions.includes(page.transactionId)) {
          // A deleted note still has an observed reference. Restore its guard from the
          // native card without resurrecting the note or recording another call.
          callHistory.closedId = record?.id || callHistory.closedCall?.id || callHistory.nextId
          callHistory.closedCall = {
            id: callHistory.closedId,
            transactionId: page.transactionId,
            number: page.number || record?.number || null
          }
        }
      }
    } else if (!page) {
      const me = readMyPresence(docs)
      // Disappearing HTML alone proves nothing. A readable idle state can recover a
      // missed Wrap up transition; retain the last measured duration as a lower bound.
      if (
        me &&
        [
          'available',
          'other work',
          'work offline',
          'working offline',
          'on break',
          'short break',
          'lunch',
          'lunch break'
        ].includes(normaliseStatusLabel(me.status))
      ) {
        for (const draft of [...callHistory.pending]) finishCall(draft)
        // A confirmed return to idle permits another call, including the same telephone number.
        callHistory.closedId = null
        callHistory.closedCall = null
      }
    }
    if (observation() !== before) saveCallHistory()
    renderHistory()
  }
  function callClock (seconds) {
    if (!Number.isFinite(seconds)) return '—'
    // Call and queue-wait durations use a compact clock, without losing whole hours.
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE) % SECONDS_PER_MINUTE
    const remainder = seconds % SECONDS_PER_MINUTE
    const clock = `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    return hours ? `${hours}:${clock}` : clock
  }
  function historyTime (time) {
    if (time === null) return 'Time unknown'
    return new Date(time).toLocaleTimeString('en-AU', {
      timeZone: STATISTICS_ZONE,
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  function syncHistoryEditor (record, widget) {
    const editing = historyEdit?.id === record.id
    const adding = record === newManualRecord
    widget.card.classList.toggle('new-note', adding)
    widget.card.classList.toggle('editing', editing)
    widget.caller.classList.toggle('hidden', editing)
    widget.input.classList.toggle('hidden', !editing)
    widget.fields.classList.toggle('hidden', !editing)
    widget.notes.classList.toggle('hidden', editing || !record.notes)
    widget.job.classList.toggle('hidden', editing)
    widget.button.classList.toggle('saving', editing)
    setText(widget.caller, record.caller)
    setText(widget.button, editing ? '✓' : '✎')
    const action = editing ? 'Save call note' : 'Edit call note'
    widget.button.title = action
    widget.button.setAttribute('aria-label', `${action} for call #${record.id}`)
    setText(widget.deleteButton, adding ? '×' : '🗑')
    widget.deleteButton.title = adding ? 'Cancel new note' : 'Delete call note'
    widget.deleteButton.setAttribute('aria-label', adding ? 'Cancel new note' : `Delete call note #${record.id}`)
    setText(widget.prediction, 'Caller type (prediction): ' + record.callerPrediction)
    setText(widget.notes, record.notes || '')
    setText(widget.job, record.jobNumber ? 'Job: ' + record.jobNumber : 'No job number')
    setText(widget.savedAt, 'Saved at: ' + historyTime(record.completedAt))
    // Polling must leave the active editor's text, selection and caret untouched.
    if (!editing) {
      widget.input.value = record.caller === 'Unknown' ? '' : record.caller
      widget.notesInput.value = record.notes || ''
      widget.jobInput.value = record.jobNumber || ''
    }
  }
  function cancelHistoryEdit () {
    if (!historyEdit) return
    const id = historyEdit.id
    historyEdit = null
    automaticData?.changed()
    if (newManualRecord?.id === id) {
      // Escape/Cancel removes an unsaved manual draft without touching saved notes or call guards.
      newManualRecord = null
      historyWidgets.get(id)?.card.remove()
      historyWidgets.delete(id)
      historyRevision++
      renderHistory()
      return
    }
    const record = callHistory.records.find((call) => call.id === id)
    if (record) deployment?.finishEditor?.(record.recordKey, null)
    const widget = historyWidgets.get(id)
    if (record && widget) syncHistoryEditor(record, widget)
  }
  function beginHistoryEdit (record, widget) {
    if (
      destroyed ||
      activeView !== 'history' ||
      historyPanel.classList.contains('hidden') ||
      widget.card.parentElement !== historyList
    ) {
      return
    }
    // Commit the previous record before opening another; only one editor owns a draft.
    saveHistoryEdit()
    historyEdit = {
      id: record.id,
      value: record.caller === 'Unknown' ? '' : record.caller,
      notes: record.notes || '',
      jobNumber: record.jobNumber || ''
    }
    widget.input.value = historyEdit.value
    widget.notesInput.value = historyEdit.notes
    widget.jobInput.value = historyEdit.jobNumber
    syncHistoryEditor(record, widget)
    widget.input.focus?.({ preventScroll: true })
    widget.input.select?.()
  }
  function saveHistoryEdit (refresh = true) {
    if (destroyed || !historyEdit) return
    const adding = newManualRecord?.id === historyEdit.id
    const record = adding ? newManualRecord : callHistory.records.find((call) => call.id === historyEdit.id)
    if (!record) return cancelHistoryEdit()
    // Autosave changes user-entered fields and the prediction, never measured timings or counters.
    record.caller = normaliseText(historyEdit.value).slice(0, 160) || 'Unknown'
    record.callerPrediction = predictCaller(record.caller)
    record.notes = cleanNotes(historyEdit.notes)
    record.jobNumber = cleanJobNumber(historyEdit.jobNumber)
    if (record.recovered) {
      record.completedAt ??= Date.now()
    }
    if (adding) {
      // A manual note joins saved records only on confirmation/autosave, never the call counter.
      record.completedAt = Date.now()
      callHistory.records.push(record)
      newManualRecord = null
    }
    historyEdit = null
    historyRevision++
    saveCallHistory()
    deployment?.finishEditor?.(record.recordKey, {
      caller: record.caller,
      notes: record.notes,
      jobNumber: record.jobNumber
    })
    const widget = historyWidgets.get(record.id)
    if (widget) syncHistoryEditor(record, widget)
    // Filtering and personal-view changes already render; avoid recursive reconciliation.
    if (refresh) renderHistory()
  }
  function saveHistoryOutside (event) {
    if (!historyEdit || destroyed) return
    const card = historyWidgets.get(historyEdit.id)?.card
    // Shadow DOM retargets event.target to the host; its composed path retains the actual card.
    const inside = event.composedPath?.().includes(card) || card?.contains?.(event.target)
    if (!inside) saveHistoryEdit()
  }
  function checkpointHistoryEdit () {
    automaticData?.changed()
    if (!deployment?.checkpointEditor || !historyEdit || destroyed || newManualRecord?.id === historyEdit.id) return
    const record = callHistory.records.find((call) => call.id === historyEdit.id)
    if (!record) return
    // Extension-only checkpoints survive a browser close without committing an Escape-cancellable edit.
    deployment.checkpointEditor(record.recordKey, {
      caller: historyEdit.value,
      notes: historyEdit.notes,
      jobNumber: historyEdit.jobNumber
    })
  }
  let lastDeletedNote = null
  let transferMessageTimer = null
  const NOTE_FEEDBACK_MS = 5000
  const historyUndo = createElement('button', 'Undo delete', historyTransfer, 'hidden')
  function deleteHistoryRecord (record) {
    if (destroyed || activeView !== 'history' || historyPanel.classList.contains('hidden')) return
    saveHistoryEdit(false)
    if (!callHistory.records.some((call) => call.id === record.id)) return
    lastDeletedNote = record
    callHistory.records = callHistory.records.filter((call) => call.id !== record.id)
    historyWidgets.get(record.id)?.card.remove()
    historyWidgets.delete(record.id)
    historyRevision++
    saveCallHistory()
    renderHistory()
    historyUndo.classList.remove('hidden')
    transferMessage('Call note deleted. Undo restores it.', false, NOTE_FEEDBACK_MS)
  }
  historyUndo.onclick = () => {
    if (destroyed || !lastDeletedNote) return
    // Import may have already restored the same exported record while Undo was visible.
    if (!callHistory.records.some((call) => call.recordKey === lastDeletedNote.recordKey)) {
      callHistory.records.push(lastDeletedNote)
    }
    lastDeletedNote = null
    historyUndo.classList.add('hidden')
    historyRevision++
    saveCallHistory()
    renderHistory()
    transferMessage('Call note restored.', false, NOTE_FEEDBACK_MS)
  }
  historyAdd.onclick = () => {
    if (destroyed || activeView !== 'history' || historyPanel.classList.contains('hidden') || transferBusy) return
    if (newManualRecord) {
      historyWidgets.get(newManualRecord.id)?.input.focus?.({ preventScroll: true })
      return
    }
    saveHistoryEdit(false)
    const id = callHistory.nextId++
    newManualRecord = {
      id,
      recordKey: newNoteKey(),
      originalId: id,
      origin: 'manual',
      detectedAt: Date.now(),
      completedAt: null,
      caller: 'Unknown',
      callerPrediction: 'Unknown',
      notes: '',
      jobNumber: '',
      number: null,
      queue: null,
      transactionId: null,
      channel: null,
      channelNumber: null,
      durationSeconds: null,
      waitSeconds: null,
      holdSeconds: null,
      durationComplete: false
    }
    // Reserve the sequence number so a concurrent connected call cannot reuse it.
    saveCallHistory()
    historySearch.value = ''
    historyPage = 0
    historyRevision++
    renderHistory()
    const widget = historyWidgets.get(id)
    beginHistoryEdit(newManualRecord, widget)
    historyList.scrollTop = 0
  }
  const NOTE_SEPARATOR = '--------------------'
  const NOTE_DETAILS = '[Call details]'
  // Every stored detail has a readable label and a type; unknown values remain unknown.
  const NOTE_TEXT_FIELDS = [
    ['Record key', 'recordKey', 'text'],
    ['Original entry number', 'originalId', 'integer'],
    ['Source', 'origin', 'source'],
    ['First detected', 'detectedAt', 'date'],
    ['Saved at', 'completedAt', 'date'],
    ['Phone number', 'number', 'text'],
    ['Queue', 'queue', 'text'],
    ['Call reference', 'transactionId', 'text'],
    ['Channel', 'channel', 'text'],
    ['Channel number', 'channelNumber', 'text'],
    ['Duration seconds', 'durationSeconds', 'seconds'],
    ['Queue wait seconds', 'waitSeconds', 'seconds'],
    ['Last hold segment seconds', 'holdSeconds', 'seconds'],
    ['Full duration recorded', 'durationComplete', 'boolean'],
    ['Recovered draft', 'recovered', 'boolean']
  ]
  const isNoteSeparator = (line) => /^\s*-{20,}\s*$/.test(line)
  function escapedNoteLine (line) {
    // Protect delimiter-like notes and leading backslashes without flattening multiline text.
    return line.startsWith('\\') || isNoteSeparator(line) || line === NOTE_DETAILS
      ? '\\' + line
      : line
  }
  function unescapedNoteLine (line) {
    const remainder = line.slice(1)
    const escaped = line.startsWith('\\') &&
      (remainder.startsWith('\\') || isNoteSeparator(remainder) || remainder === NOTE_DETAILS)
    return escaped
      ? remainder
      : line
  }
  function exportCallNotesText (entries = callHistory.records) {
    // Export every saved record, regardless of the search filter; unfinished calls remain drafts.
    const lines = [
      'Service Desk 8x8 Assistant — Call Notes (TXT v1)',
      'Exported: ' + new Date().toISOString(),
      NOTE_SEPARATOR
    ]
    const records = [...entries].sort(
      (a, b) => (a.detectedAt ?? -Infinity) - (b.detectedAt ?? -Infinity) || a.id - b.id
    )
    for (const record of records) {
      lines.push(escapedNoteLine(record.caller || 'Unknown'))
      if (record.notes) lines.push(...record.notes.split('\n').map(escapedNoteLine))
      lines.push(escapedNoteLine(record.jobNumber || 'NO JOB NUMBER'), NOTE_DETAILS)
      for (const [label, key, type] of NOTE_TEXT_FIELDS) {
        const value = record[key]
        let text = 'Not recorded'
        if (value !== null && value !== undefined) {
          if (type === 'date') text = new Date(value).toISOString()
          else if (type === 'boolean') text = value ? 'Yes' : 'No'
          else if (type === 'text') text = JSON.stringify(value)
          else text = String(value)
        }
        lines.push(label + ': ' + text)
      }
      lines.push('Caller type (prediction): ' + record.callerPrediction, NOTE_SEPARATOR)
    }
    // CRLF works in Notepad and preserves the same logical lines when imported on other systems.
    return lines.join('\r\n') + '\r\n'
  }
  function readNoteDetail (value, type) {
    if (!value || /^(?:not recorded|unknown|unavailable|null|—)$/i.test(value)) return null
    if (type === 'text') {
      // Quoted strings distinguish a literal "Unknown" queue from an absent value.
      if (!value.startsWith('"')) return value
      const text = JSON.parse(value)
      if (typeof text !== 'string') throw new Error('A call detail must contain text.')
      return text
    }
    if (type === 'source') {
      if (!['8x8', 'text', 'manual'].includes(value.toLowerCase())) {
        throw new Error('The record source is not recognised.')
      }
      return value.toLowerCase()
    }
    if (type === 'boolean') {
      if (/^(?:yes|true)$/i.test(value)) return true
      if (/^(?:no|false)$/i.test(value)) return false
      throw new Error('Full duration recorded must be Yes or No.')
    }
    if (type === 'date') {
      const time = Date.parse(value)
      if (!validCallTime(time)) throw new Error('A recorded date is not recognised.')
      return time
    }
    // Labelled timings accept whole seconds or the same clocks/units read from 8x8.
    const number = /^\d+$/.test(value)
      ? Number(value)
      : type === 'seconds' ? parseDuration(value) : null
    if (!Number.isSafeInteger(number) || number < (type === 'integer' ? 1 : 0)) {
      throw new Error('An entry number or duration is not recognised.')
    }
    return number
  }
  function readTextNote (block) {
    const lines = block.split('\n')
    while (lines.length && !lines.at(-1).trim()) lines.pop()
    if (!block.trim()) return null
    const detailsAt = lines.indexOf(NOTE_DETAILS)
    const body = (detailsAt < 0 ? lines : lines.slice(0, detailsAt)).map(unescapedNoteLine)
    const fields = { origin: 'text', detectedAt: null, completedAt: null, durationComplete: false }
    if (detailsAt >= 0) {
      const seen = new Set()
      for (const line of lines.slice(detailsAt + 1)) {
        const colon = line.indexOf(':')
        if (colon < 0) continue
        const label = normaliseStatus(line.slice(0, colon))
        const field = NOTE_TEXT_FIELDS.find(([name]) => normaliseStatus(name) === label)
        if (!field) continue
        const [, key, type] = field
        if (seen.has(key)) throw new Error('A call detail appears twice in one record.')
        seen.add(key)
        fields[key] = readNoteDetail(line.slice(colon + 1).trim(), type)
      }
    }
    while (body.length && !body.at(-1).trim()) body.pop()
    // Legacy files have a name first, multiline notes in the middle and an optional ticket last.
    const first = body.shift() || ''
    const nameLabel = /^(?:name\s*\/\s*(?:sid|id)|name|caller(?: name)?|student (?:id|number))\s*:\s*/i
    const caller = normaliseText(detailsAt >= 0 ? first : first.replace(nameLabel, '')) || 'Unknown'
    let jobNumber = ''
    const last = body.at(-1)?.trim() || ''
    const noJob = /^no\s+(?:job|ticket)(?:\s+number)?\.?$/i.test(last)
    const labelledJob = /^(?:job(?:\s+(?:number|no\.?))?|ticket(?:\s+(?:number|no\.?))?)\s*:\s*/i
    const ticketLine = detailsAt >= 0 || noJob || labelledJob.test(last) ||
      /^[a-z]{2,12}[- ]?\d{3,}$/i.test(last)
    if (body.length && ticketLine) {
      const lastLine = body.pop()
      const value = (detailsAt >= 0 ? lastLine : lastLine.replace(labelledJob, '')).trim()
      jobNumber = /^no\s+(?:job|ticket)(?:\s+number)?\.?$/i.test(value) ? '' : value
    }
    if (detailsAt < 0 && body[0]?.match(/^notes?\s*:/i)) {
      body[0] = body[0].replace(/^notes?\s*:\s*/i, '')
    }
    const notes = body.join('\n').trim()
    // Refuse oversized fields rather than silently losing caller information during a round trip.
    const limits = { recordKey: 180, number: 80, queue: 200, transactionId: 160, channel: 200, channelNumber: 80 }
    const oversizedDetail = Object.entries(limits).some(
      ([key, limit]) => typeof fields[key] === 'string' && fields[key].length > limit
    )
    if (caller.length > 160 || notes.length > MAX_NOTES_LENGTH || jobNumber.length > 80 || oversizedDetail) {
      throw new Error('A record contains more text than the assistant can keep.')
    }
    const record = savedCall({ ...fields, id: 1, caller, notes, jobNumber }, false)
    if (!record) throw new Error('A record contains an invalid date or call detail.')
    // Missing legacy identifiers/times are not invented. Row numbers are assigned only at import.
    record.recordKey = fields.recordKey || null
    record.originalId = fields.originalId || null
    return record
  }
  function parseCallNotesText (text, allowEmpty = false) {
    if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) {
      throw new Error('Choose a text file no larger than 5 MB.')
    }
    const normalised = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    // Reject binary control bytes while allowing Notepad's tabs and line breaks.
    for (const character of normalised) {
      const code = character.charCodeAt(0)
      if (code < 32 && ![9, 10].includes(code)) {
        throw new Error('The selected file is not readable plain text.')
      }
    }
    // Consume the delimiter's own newline once. A second blank first line is a missing
    // name, so retain it as Unknown rather than stealing the first line of notes.
    const blocks = normalised
      .split(/^[ \t]*-{20,}[ \t]*$/m)
      .map((block, index) => index ? block.replace(/^\n/, '') : block)
      .filter((block) => block.trim())
    if (/^Service Desk 8x8 Assistant.*Call Notes \(TXT v/i.test(blocks[0]?.trim() || '')) {
      if (!blocks[0].includes('(TXT v1)')) throw new Error('This Call Notes file uses a newer format.')
      blocks.shift()
    }
    if (blocks.length > MAX_IMPORT_RECORDS) throw new Error('Import up to 2,000 records at a time.')
    const records = blocks.map(readTextNote).filter(Boolean)
    if (!records.length && !allowEmpty) throw new Error('No call notes were found in the selected file.')
    return records
  }
  function legacyNoteSignature (record) {
    // Compare full legacy content without hashing away differences or guessing call identities.
    const details = NOTE_TEXT_FIELDS
      .filter(([, key]) => !['recordKey', 'originalId'].includes(key))
      .map(([, key]) => record[key])
    return JSON.stringify([record.caller, record.notes, record.jobNumber, ...details])
  }
  function importCallNotesText (text) {
    const records = parseCallNotesText(text)
    saveHistoryEdit(false)
    const knownKeys = new Set([...callHistory.records, ...callHistory.pending].map((call) => call.recordKey))
    const legacyCounts = new Map()
    for (const call of callHistory.records.filter((call) => call.origin === 'text')) {
      const signature = legacyNoteSignature(call)
      legacyCounts.set(signature, (legacyCounts.get(signature) || 0) + 1)
    }
    let added = 0
    let skipped = 0
    for (const record of records) {
      const signature = legacyNoteSignature(record)
      const duplicates = legacyCounts.get(signature) || 0
      // Stable keys make assistant exports idempotent. Multiset matching preserves identical
      // calls within one legacy file while avoiding extra copies when that file is reimported.
      if ((record.recordKey && knownKeys.has(record.recordKey)) || (!record.recordKey && duplicates)) {
        if (!record.recordKey) legacyCounts.set(signature, duplicates - 1)
        skipped++
        continue
      }
      record.id = callHistory.nextId++
      record.originalId ||= record.id
      record.recordKey ||= newNoteKey()
      knownKeys.add(record.recordKey)
      callHistory.records.push(record)
      added++
    }
    // Imported references never enter the native capture ledger or the observed-call statistics.
    historyRevision++
    saveCallHistory()
    renderHistory()
    return { added, skipped }
  }
  function transferMessage (message, error = false, expireAfter = NOTE_FEEDBACK_MS) {
    if (destroyed) return
    root.clearTimeout(transferMessageTimer)
    transferMessageTimer = null
    setText(historyTransferStatus, message)
    historyTransferStatus.setAttribute('data-error', String(error))
    historyTransferStatus.classList.remove('hidden')
    if (expireAfter) {
      // Replacing a confirmation cancels its old timer, so it cannot erase a newer message.
      transferMessageTimer = root.setTimeout(() => {
        transferMessageTimer = null
        if (!destroyed) historyTransferStatus.classList.add('hidden')
      }, expireAfter)
    }
  }
  function setTransferBusy (busy) {
    transferBusy = busy
    if (destroyed) return
    historyImport.disabled = busy
    historyAdd.disabled = busy
    historyExport.disabled = historyDownload.disabled = busy || !callHistory.records.length
  }
  function downloadCallNotes () {
    if (destroyed || transferBusy || !callHistory.records.length) return
    saveHistoryEdit()
    let url
    try {
      const file = new root.Blob([exportCallNotesText()], { type: 'text/plain;charset=utf-8' })
      url = root.URL.createObjectURL(file)
      const link = createElement('a', '', historyPanel, 'hidden')
      link.href = url
      link.download = `Call-Notes-${dayKey(Date.now())}.txt`
      link.click()
      link.remove()
      // Give Edge time to consume the blob before releasing it; no caller data leaves the browser.
      root.setTimeout(() => root.URL.revokeObjectURL(url), 30000)
      transferMessage('TXT download started. Edge’s download settings control the save location.')
    } catch {
      if (url) root.URL.revokeObjectURL(url)
      transferMessage('The TXT download could not start. Check Edge’s download permissions and try again.', true)
    }
  }
  historyDownload.onclick = downloadCallNotes
  historyExport.onclick = async () => {
    if (destroyed || transferBusy || !callHistory.records.length) return
    saveHistoryEdit()
    if (typeof root.showSaveFilePicker !== 'function') return downloadCallNotes()
    setTransferBusy(true)
    let writable
    try {
      // Open directly in the click handler, before any async work consumes user activation.
      const handle = await root.showSaveFilePicker({
        id: 'assistant-call-notes',
        suggestedName: `Call-Notes-${dayKey(Date.now())}.txt`,
        types: [{ description: 'Notepad text file', accept: { 'text/plain': ['.txt'] } }]
      })
      if (destroyed) return
      if (await automaticData?.usesFile(handle)) {
        transferMessage('That file is used for automatic saving. Choose a different file for your TXT export.', true)
        return
      }
      if (destroyed) return
      const text = exportCallNotesText()
      writable = await handle.createWritable()
      if (destroyed) {
        await writable.abort()
        return
      }
      await writable.write(text)
      // File System Access commits the selected file only when its stream is closed.
      await writable.close()
      writable = null
      transferMessage('Call Notes exported to your selected location.')
    } catch (error) {
      if (writable) await writable.abort().catch(() => {})
      if (error.name === 'AbortError') transferMessage('Export cancelled.')
      else {
        historyDownload.classList.remove('hidden')
        transferMessage('Edge could not save to a selected location. Try Download TXT, or check your browser permissions.', true)
      }
    } finally {
      setTransferBusy(false)
    }
  }
  historyImport.onclick = () => {
    if (destroyed || transferBusy) return
    saveHistoryEdit()
    // A file input works without installation and can reselect the same file after a failed import.
    historyFile.value = ''
    historyFile.click()
  }
  historyFile.onchange = async () => {
    const file = historyFile.files?.[0]
    if (!file || destroyed || transferBusy) return
    setTransferBusy(true)
    try {
      const text = await readNotesFile(file)
      // A closed/replaced assistant must not accept a late file-read result.
      if (destroyed) return
      const { added, skipped } = importCallNotesText(text)
      transferMessage(`${added} ${added === 1 ? 'call note' : 'call notes'} imported.${skipped ? ` ${skipped} already present.` : ''}`)
    } catch (error) {
      transferMessage(error instanceof TypeError ? 'The file could not be read as a Notepad text file.' : error.message || 'The file could not be imported. Try selecting it again.', true)
    } finally {
      setTransferBusy(false)
      historyFile.value = ''
    }
  }
  async function readNotesFile (file) {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('Choose a text file no larger than 5 MB.')
    if (root.TextDecoder && file.arrayBuffer) {
      // Share the manual import encoding rules, including Notepad UTF-16 and invalid-byte rejection.
      const bytes = new Uint8Array(await file.arrayBuffer())
      const encoding = bytes[0] === 255 && bytes[1] === 254
        ? 'utf-16le'
        : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8'
      return new root.TextDecoder(encoding, { fatal: true }).decode(bytes)
    }
    return file.text()
  }
  function dataSnapshot () {
    const entries = new Map(callHistory.records.map((record) => [record.recordKey, { ...record }]))
    // Preserve unfinished call fields without creating a completed call or changing its counter.
    for (const draft of callHistory.pending) {
      if (entries.has(draft.recordKey)) continue
      entries.set(draft.recordKey, {
        ...draft,
        caller: normaliseText(draft.callerInput) || 'Unknown',
        callerPrediction: predictCaller(draft.callerInput),
        notes: cleanNotes(draft.notesInput),
        jobNumber: '',
        completedAt: null,
        durationComplete: false,
        recovered: true
      })
    }
    const editing = historyEdit && (newManualRecord?.id === historyEdit.id
      ? newManualRecord
      : callHistory.records.find((record) => record.id === historyEdit.id))
    if (editing) {
      // A file checkpoint includes typing without committing the editor or taking away Escape.
      entries.set(editing.recordKey, {
        ...editing,
        caller: normaliseText(historyEdit.value) || 'Unknown',
        callerPrediction: predictCaller(historyEdit.value),
        notes: cleanNotes(historyEdit.notes),
        jobNumber: cleanJobNumber(historyEdit.jobNumber),
        recovered: true
      })
    }
    return [...entries.values()]
  }
  function dataSignature (records) {
    // Row numbers can change on restore; compare the actual text and recorded details instead.
    return JSON.stringify(records.map((record) => [record.recordKey, record.caller, record.notes, record.jobNumber,
      ...NOTE_TEXT_FIELDS.filter(([, key]) => key !== 'recordKey').map(([, key]) => record[key] ?? null)
    ]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  }
  function createAutomaticData () {
    const DATABASE = 'service-desk-8x8-data-location-v1'
    const CHECKPOINT = 'service-desk-8x8-data-checkpoint-v1'
    const ENABLED = 'service-desk-8x8-data-enabled-v1'
    const HEADER = 'Assistant autosave: '
    let handle = resumedDataFile?.handle || null
    let ready = false
    let stopping = false
    let loading = false
    let epoch = 0
    let pickerEpoch = 0
    let timer = null
    let feedbackTimer = null
    let lastAttention = ''
    let database = null
    let databasePromise = null
    let databaseTimeout = null
    let flight = Promise.resolve()
    let expectedText = ''
    let fileId = ''
    let generation = ''
    let lastSignature = ''
    let lastSavedAt = 0
    let remembered = true
    let needsAccess = false
    // Re-authorise a remembered file at most once automatically, within a genuine page gesture.
    let startupPermissionPending = false
    let startupPermissionAttempted = false
    let cleanRevision = historyRevision
    let inheritedChanges = resumedDataFile?.uncheckpointed === true
    let parentCheckpointRead = false
    let checkpoint = resumedDataFile?.checkpoint || null
    try {
      const stored = historyStorage?.getItem(CHECKPOINT)
      if (stored) checkpoint = JSON.parse(stored)
    } catch {}
    function inheritFinalCheckpoint () {
      if (parentCheckpointRead) return
      parentCheckpointRead = true
      const parent = previousDataSource?.()
      // Release the retired instance's closure after its final checkpoint has been copied.
      previousDataSource = null
      if (!parent) return
      handle = parent.handle || null
      checkpoint = parent.checkpoint || null
      inheritedChanges = parent.uncheckpointed === true
    }
    const active = (token) => token === epoch && !stopping && !destroyed
    function status (message, attention = false, feedback = true) {
      if (destroyed) return
      setText(dataLocationInfo, (handle ? handle.name + '\n' : '') + message)
      setText(dataFileStatus, (attention ? 'Data file: ' : 'Auto-save: ') + message)
      // File-health feedback also expires. The Settings indicator retains any unresolved problem.
      if (attention && feedback && message !== lastAttention) {
        root.clearTimeout(feedbackTimer)
        dataFileStatus.classList.remove('hidden')
        feedbackTimer = root.setTimeout(() => {
          feedbackTimer = null
          if (!destroyed) dataFileStatus.classList.add('hidden')
        }, NOTE_FEEDBACK_MS)
      } else if (!attention) {
        root.clearTimeout(feedbackTimer)
        feedbackTimer = null
        dataFileStatus.classList.add('hidden')
      }
      if (feedback || !attention) lastAttention = attention ? message : ''
      settingsButton.setAttribute('data-file-attention', String(attention))
      settingsButton.title = attention ? 'Settings — Data file needs attention' : 'Assistant settings'
      setText(historySummary.querySelector('.history-session-count'), ready ? 'Auto-save enabled' : handle ? 'Auto-save paused' : 'This session')
      historyList.setAttribute('aria-label', ready ? 'Saved Call Notes, newest first' : 'Call Notes in this tab, newest first')
      setText(historyPanel.querySelector('.history-note'), ready
        ? 'The tick, clicking away or Back saves. Your data file updates automatically; Export TXT makes a separate copy.'
        : 'Edit with the pen. The tick, clicking away or Back saves. Export TXT to keep a copy after this session.')
      dataFileStatus.setAttribute('data-attention', String(attention))
      dataFileStatus.title = (handle?.name || 'Data location') + ' — Open Data location settings'
      dataReconnect.classList.toggle('hidden', !handle)
      dataSave.classList.toggle('hidden', !handle || !ready)
      dataDisconnect.classList.toggle('hidden', !handle)
      dataChoose.textContent = handle ? 'Change data file' : 'Choose data file'
    }
    function rememberCheckpoint (dirty) {
      if (!fileId) return
      checkpoint = { fileId, generation, keys: checkpoint?.keys || [], digest: checkpoint?.digest || '', dirty }
      try { historyStorage?.setItem(CHECKPOINT, JSON.stringify(checkpoint)) } catch {}
    }
    function openDatabase () {
      if (databasePromise) return databasePromise
      databasePromise = new Promise((resolve, reject) => {
        if (!root.indexedDB) return reject(new Error('Edge could not remember the data location.'))
        let settled = false
        databaseTimeout = root.setTimeout(() => finish(new Error('The data location could not be opened.')), 8000)
        function finish (error, value) {
          if (settled) { value?.close?.(); return }
          settled = true
          root.clearTimeout(databaseTimeout)
          databaseTimeout = null
          error ? reject(error) : resolve(value)
        }
        try {
          const request = root.indexedDB.open(DATABASE, 1)
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('connection')) request.result.createObjectStore('connection')
          }
          request.onerror = request.onblocked = () => finish(new Error('Edge could not remember the data location.'))
          request.onsuccess = () => {
            const db = request.result
            if (settled) { db.close(); return }
            if (stopping || destroyed) { db.close(); finish(new Error('Assistant closed.')); return }
            database = db
            db.onversionchange = () => { db.close(); database = null; databasePromise = null }
            finish(null, db)
          }
        } catch (error) { finish(error) }
      }).catch((error) => { databasePromise = null; throw error })
      return databasePromise
    }
    async function connection (operation, value) {
      const db = await openDatabase()
      return new Promise((resolve, reject) => {
        // Only the browser file handle is stored here. Caller data goes to the chosen TXT file.
        const transaction = db.transaction('connection', operation === 'get' ? 'readonly' : 'readwrite')
        const store = transaction.objectStore('connection')
        const request = operation === 'get'
          ? store.get('file')
          : operation === 'put' ? store.put(value, 'file') : store.delete('file')
        transaction.oncomplete = () => resolve(request.result)
        transaction.onerror = transaction.onabort = () => reject(new Error('Edge could not remember the data location.'))
      })
    }
    function readData (text) {
      if (!text.trim()) return { records: [], meta: null }
      // An arbitrary text document must not be silently converted into an assistant data file.
      if (!/^\uFEFF?Service Desk 8x8 Assistant.*Call Notes \(TXT v/m.test(text) && !/^\s*-{20,}\s*$/m.test(text)) {
        throw new Error('Choose an assistant TXT export or an empty file. This file has not been changed.')
      }
      const preamble = text.replace(/\r\n?/g, '\n').split(/^\s*-{20,}\s*$/m)[0]
      const metadata = preamble.split('\n').filter((line) => line.startsWith(HEADER))
      if (metadata.length > 1) throw new Error('The data file has duplicate backup information.')
      const meta = metadata.length ? JSON.parse(metadata[0].slice(HEADER.length)) : null
      if (meta && (meta.format !== 1 || typeof meta.fileId !== 'string' || !meta.fileId || meta.fileId.length > 180 ||
          typeof meta.generation !== 'string' || !meta.generation || meta.generation.length > 180)) {
        throw new Error('This data file uses unrecognised backup information. It has not been changed.')
      }
      const records = parseCallNotesText(text, true)
      const keys = new Set()
      for (const record of records) {
        record.recordKey ||= newNoteKey()
        if (keys.has(record.recordKey)) throw new Error('The data file contains duplicate record keys. It has not been changed.')
        keys.add(record.recordKey)
      }
      return { records, meta }
    }
    async function fileDigest (text) {
      if (!root.crypto?.subtle) throw new Error('Edge could not verify this data file. Use Export TXT to keep a copy.')
      // A small session checkpoint detects edits even when an external editor leaves the header unchanged.
      const bytes = await new root.Blob([text]).arrayBuffer()
      const hash = await root.crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    }
    function restoreData (records, meta, digest) {
      const sameFile = !!meta && checkpoint?.fileId === meta.fileId
      const sameGeneration = sameFile && checkpoint.generation === meta.generation &&
        (!checkpoint.digest || checkpoint.digest === digest)
      const dirty = sameFile && (checkpoint.dirty === true || inheritedChanges || historyRevision !== cleanRevision)
      // A commit may have reached disk just before its session checkpoint was interrupted.
      if (dirty && !sameGeneration && dataSignature(dataSnapshot()) !== dataSignature(records)) {
        throw new Error('The data file changed while this tab had unsaved notes. Choose a new data file to keep both copies.')
      }
      const previousKeys = new Set(sameFile && Array.isArray(checkpoint.keys) ? checkpoint.keys : [])
      const fileKeys = new Set(records.map((record) => record.recordKey))
      const local = new Map(callHistory.records.map((record) => [record.recordKey, { ...record }]))
      // Apply an externally saved deletion only to a known, clean checkpoint, never to new local notes.
      if (sameFile && !sameGeneration && !dirty && !historyEdit) {
        for (const key of previousKeys) if (!fileKeys.has(key)) local.delete(key)
      }
      const recover = []
      for (const record of records) {
        const pending = record.recovered && record.transactionId
          ? callHistory.pending.find((call) => call.transactionId === record.transactionId)
          : null
        const completed = record.recovered && record.transactionId
          ? [...local.values()].find((call) => call.origin === '8x8' && call.transactionId === record.transactionId)
          : null
        if (pending || completed) { recover.push({ record, pending, completed }); continue }
        const existing = local.get(record.recordKey)
        if (sameGeneration && dirty) {
          // The disk is unchanged; preserve local edits/deletions made since its last successful save.
          if (existing || previousKeys.has(record.recordKey)) continue
        }
        if (existing && dataSignature([existing]) !== dataSignature([record])) {
          const cleanCheckpoint = sameFile && !dirty && previousKeys.has(record.recordKey) && !historyEdit
          if (!cleanCheckpoint) throw new Error('This file and this tab have different edits to the same note. Choose a new data file to keep both copies.')
        }
        local.set(record.recordKey, { ...record, id: existing?.id || 0 })
      }
      // Validation/conflict checks finish before any live record or call field is changed.
      for (const record of local.values()) {
        if (!record.id) record.id = callHistory.nextId++
        record.originalId ||= record.id
      }
      callHistory.records = [...local.values()]
      for (const { record, pending, completed } of recover) {
        if (pending) {
          pending.recordKey = record.recordKey
          pending.originalId = record.originalId || pending.originalId
          if (validCallTime(record.detectedAt)) pending.detectedAt = Math.min(pending.detectedAt, record.detectedAt)
          for (const key of ['number', 'queue', 'channel', 'channelNumber', 'waitSeconds', 'holdSeconds']) {
            if (pending[key] == null && record[key] != null) pending[key] = record[key]
          }
          if (record.durationSeconds !== null) pending.durationSeconds = Math.max(pending.durationSeconds || 0, record.durationSeconds)
          // An explicit empty edit is intentional too. A delayed restore must not fill it back in.
          const touched = touchedCallFields.get(pending.id)
          if (!(sameGeneration && dirty) && !pending.callerInput && !touched?.has('callerInput')) {
            pending.callerInput = record.caller === 'Unknown' ? '' : record.caller
          }
          if (!(sameGeneration && dirty) && !pending.notesInput && !touched?.has('notesInput')) pending.notesInput = record.notes
        } else {
          const touched = touchedCallFields.get(completed.id)
          if (!(sameGeneration && dirty) && completed.caller === 'Unknown' && !touched?.has('callerInput')) completed.caller = record.caller
          if (!(sameGeneration && dirty) && !completed.notes && !touched?.has('notesInput')) completed.notes = record.notes
          completed.callerPrediction = predictCaller(completed.caller)
        }
      }
      historyRevision++
      saveCallHistory()
      renderHistory()
    }
    function problem (error) {
      ready = false
      needsAccess = ['NotAllowedError', 'SecurityError'].includes(error?.name)
      const message = needsAccess
        ? 'File access needed. Click Reconnect.'
        : error?.name === 'NotFoundError'
          ? 'File moved or deleted. Choose its new location.'
          : error?.name === 'NoModificationAllowedError'
            ? 'Another window is saving this file. Reconnect to try again.'
            : error?.message || 'Auto-save stopped. Your notes are still available in this tab.'
      status(message, true)
    }
    async function connect (candidate, token, startup = false) {
      loading = true
      try {
        if (!candidate || candidate.kind !== 'file' || typeof candidate.queryPermission !== 'function' ||
            typeof candidate.getFile !== 'function' || typeof candidate.createWritable !== 'function') {
          throw new Error('Choose your data file again. Its saved connection is no longer valid.')
        }
        let permission = await candidate.queryPermission({ mode: 'readwrite' })
        if (!active(token)) return
        if (permission === 'prompt' && startup && !startupPermissionAttempted) {
          startupPermissionPending = true
          // A bookmark may retain transient activation. Check it now, after the asynchronous reads.
          if (root.navigator.userActivation?.isActive === true) {
            startupPermissionPending = false
            startupPermissionAttempted = true
            permission = await candidate.requestPermission({ mode: 'readwrite' })
            if (!active(token)) return
          }
        }
        if (permission !== 'granted') {
          handle = candidate
          ready = false
          needsAccess = true
          status(startupPermissionPending
            ? 'File access needed. Click in 8x8 to reconnect, or use Reconnect.'
            : 'File access needed. Click Reconnect.', true)
          return
        }
        startupPermissionPending = false
        const text = await readNotesFile(await candidate.getFile())
        const digest = await fileDigest(text)
        if (!active(token)) return
        const { records, meta } = readData(text)
        restoreData(records, meta, digest)
        if (!active(token)) return
        handle = candidate
        expectedText = text
        fileId = meta?.fileId || newNoteKey()
        generation = meta?.generation || ''
        lastSignature = dataSignature(records)
        const dirty = dataSignature(dataSnapshot()) !== lastSignature
        if (!dirty) { cleanRevision = historyRevision; inheritedChanges = false }
        checkpoint = { fileId, generation, keys: records.map((record) => record.recordKey), digest, dirty }
        rememberCheckpoint(dirty)
        ready = true
        needsAccess = false
        remembered = true
        try {
          await connection('put', candidate)
        } catch { remembered = false }
        try { settingsStorage.setItem(ENABLED, 'true') } catch {}
        if (!active(token)) return
        rememberCheckpoint(dataSignature(dataSnapshot()) !== lastSignature)
        status(remembered ? 'Connected. Changes save automatically.' : 'Connected for this session. Choose this file again after reopening Edge.', !remembered)
      } finally {
        if (active(token)) { loading = false; changed() }
      }
    }
    function changed () {
      if (stopping || destroyed || !handle || !ready || loading) return
      const dirty = dataSignature(dataSnapshot()) !== lastSignature
      if (!dirty) { cleanRevision = historyRevision; inheritedChanges = false }
      rememberCheckpoint(dirty)
      if (!dirty || timer) return
      // Coalesce typing and native timer updates without postponing the save indefinitely.
      const delay = Math.max(750, 5000 - (Date.now() - lastSavedAt))
      timer = root.setTimeout(() => { timer = null; flush() }, delay)
    }
    function flush (final = false) {
      if ((destroyed || stopping) && final !== true) return flight
      root.clearTimeout(timer)
      timer = null
      if (!handle || !ready || loading) return flight
      const records = dataSnapshot()
      const signature = dataSignature(records)
      if (signature === lastSignature) return flight
      const token = epoch
      const target = handle
      const targetId = fileId
      const nextGeneration = newNoteKey()
      const meta = { format: 1, fileId: targetId, generation: nextGeneration }
      const text = exportCallNotesText(records).replace(/(Exported: [^\r\n]+)(\r?\n)/,
        '$1$2' + HEADER + JSON.stringify(meta) + '\r\n')
      if (records.length > MAX_IMPORT_RECORDS || new root.Blob([text]).size > MAX_IMPORT_BYTES) {
        problem(new Error('Auto-save limit reached: 2,000 notes or 5 MB. Export a copy and remove older notes before reconnecting.'))
        return flight
      }
      const current = () => token === epoch && target === handle
      flight = flight.catch(() => {}).then(async () => {
        if (!current() || !ready || signature === lastSignature) return
        if (await target.queryPermission({ mode: 'readwrite' }) !== 'granted') {
          const error = new Error('File access needed.')
          error.name = 'NotAllowedError'
          throw error
        }
        const save = async () => {
          if (!current()) return
          const digest = await fileDigest(text)
          if (await readNotesFile(await target.getFile()) !== expectedText) {
            throw new Error('The data file changed elsewhere. Reconnect to restore it, or choose a new file to keep this tab’s notes.')
          }
          let writable
          try {
            // Exclusive streams plus a same-origin Web Lock prevent two assistant tabs racing.
            writable = await target.createWritable({ mode: 'exclusive' })
            if (!current()) { await writable.abort(); return }
            await writable.write(text)
            if (!current() || await readNotesFile(await target.getFile()) !== expectedText) {
              throw new Error('The data file changed during saving. Your notes remain in this tab.')
            }
            if (dataSignature(dataSnapshot()) !== signature) {
              // Typing or Escape superseded this queued snapshot. Never commit that stale draft.
              await writable.abort()
              writable = null
              return
            }
            // The prior file remains intact until close commits the complete replacement.
            await writable.close()
            writable = null
            if (!current()) return
            expectedText = text
            generation = nextGeneration
            lastSignature = signature
            lastSavedAt = Date.now()
            checkpoint = { fileId: targetId, generation, keys: records.map((record) => record.recordKey), digest, dirty: false }
            rememberCheckpoint(dataSignature(dataSnapshot()) !== signature)
            if (!checkpoint.dirty) { cleanRevision = historyRevision; inheritedChanges = false }
            status(remembered ? 'Saved ' + new Date(lastSavedAt).toLocaleTimeString('en-AU') : 'Saved. Reconnect this file next browser session.', !remembered)
          } catch (error) {
            if (writable) await writable.abort().catch(() => {})
            throw error
          }
        }
        status('Saving…', !remembered, false)
        const locks = root.navigator?.locks
        if (locks?.request) await locks.request('service-desk-8x8-assistant-data-write', { mode: 'exclusive' }, save)
        else await save()
      }).catch((error) => { if (current()) problem(error) }).finally(() => {
        if (!stopping && !destroyed) changed()
      })
      return flight
    }
    async function choose () {
      if (destroyed || stopping || dataChoose.disabled) return
      if (transferBusy) { status('Finish the TXT import or export before changing your data file.'); return }
      startupPermissionPending = false
      startupPermissionAttempted = true
      let token = epoch
      const selection = ++pickerEpoch
      const wasReady = ready
      try {
        // Open the picker directly in the click gesture, before any awaited I/O.
        const candidate = await root.showSaveFilePicker({
          id: 'assistant-automatic-data',
          suggestedName: '8x8-Assistant-Data.txt',
          types: [{ description: 'Assistant data text file', accept: { 'text/plain': ['.txt'] } }]
        })
        if (!active(token) || selection !== pickerEpoch) return
        await flight.catch(() => {})
        await Promise.resolve(previousShutdown).catch(() => {})
        if (!active(token) || selection !== pickerEpoch) return
        inheritFinalCheckpoint()
        // Until a file is actually chosen, the previous connection keeps saving normally.
        token = ++epoch
        ready = false
        root.clearTimeout(timer)
        timer = null
        await connect(candidate, token)
        if (active(token)) await flush()
      } catch (error) {
        if (!active(token)) return
        ready = wasReady
        if (error.name !== 'AbortError') status(error.message || 'The data file could not be selected.', true)
      } finally { if (active(token)) changed() }
    }
    function onInteraction (event) {
      if (!startupPermissionPending || startupPermissionAttempted || !event?.isTrusted ||
          root.navigator.userActivation?.isActive !== true || stopping || destroyed) return
      // Keep assistant file/device buttons dedicated to their own requested action.
      if (event.target === host || event.composedPath?.().includes(host)) return
      // Use the existing trusted page-input handlers; no synthetic click or unattended prompt.
      startupPermissionPending = false
      startupPermissionAttempted = true
      return resume()
    }
    async function resume () {
      if (!handle || stopping || destroyed) return
      startupPermissionPending = false
      startupPermissionAttempted = true
      const token = ++epoch
      ready = false
      try {
        // Start the request directly in the real Reconnect click or trusted page interaction.
        const permission = await handle.requestPermission({ mode: 'readwrite' })
        if (!active(token)) return
        if (permission !== 'granted') { needsAccess = true; status('File access was not allowed. Your notes stay in this tab.', true); return }
        await flight.catch(() => {})
        await Promise.resolve(previousShutdown).catch(() => {})
        if (active(token)) inheritFinalCheckpoint()
        if (active(token)) { await connect(handle, token); await flush() }
      } catch (error) { if (active(token)) problem(error) }
    }
    async function disconnect () {
      startupPermissionPending = false
      startupPermissionAttempted = true
      const token = ++epoch
      parentCheckpointRead = true
      ready = false
      root.clearTimeout(timer)
      timer = null
      handle = null
      checkpoint = null
      fileId = ''
      generation = ''
      needsAccess = false
      let forgotten = false
      try { historyStorage?.removeItem?.(CHECKPOINT) } catch {}
      try { settingsStorage.setItem(ENABLED, 'false'); forgotten = true } catch {}
      try { await connection('delete'); forgotten = true } catch {}
      if (active(token)) {
        status(forgotten
          ? 'Disconnected. Your data file has not been deleted.'
          : 'Disconnected for now. Edge could not forget this file; remove its file access in Edge before reopening.', !forgotten)
      }
    }
    async function start () {
      const token = epoch
      try {
        // A rerun waits for the previous instance’s final file commit before reading it back.
        await Promise.resolve(previousShutdown).catch(() => {})
        if (!active(token)) return
        inheritFinalCheckpoint()
        // A failed IndexedDB deletion must not reconnect a file explicitly disabled by the user.
        let disabled = false
        try { disabled = settingsStorage.getItem(ENABLED) === 'false' } catch {}
        if (!handle && disabled) return
        if (!handle && root.indexedDB) handle = await connection('get') || null
        if (!active(token)) return
        if (handle) await connect(handle, token, true)
        else if (settingsStorage.getItem(ENABLED) === 'true') status('Choose your data file again to restore Call Notes.', true)
      } catch (error) {
        if (active(token)) {
          let enabled = !!handle
          try { enabled ||= settingsStorage.getItem(ENABLED) === 'true' } catch {}
          if (enabled) problem(error)
        }
      }
    }
    function stop () {
      startupPermissionPending = false
      stopping = true
      root.clearTimeout(timer)
      root.clearTimeout(databaseTimeout)
      root.clearTimeout(feedbackTimer)
      databaseTimeout = null
      timer = null
      // Drain any in-progress commit first, then compare the final model with what actually saved.
      // This also repairs a snapshot whose close had already begun when the user pressed Escape.
      const prior = flight
      return Promise.all([prior.catch(() => {}), Promise.resolve(previousShutdown).catch(() => {})])
        .then(() => {
          if (!parentCheckpointRead && epoch === 0) inheritFinalCheckpoint()
          return flush(true)
        }).finally(() => { database?.close?.(); database = null })
    }
    dataChoose.onclick = choose
    dataReconnect.onclick = resume
    dataSave.onclick = () => flush()
    dataDisconnect.onclick = disconnect
    dataFileStatus.onclick = () => {
      if (needsAccess) return resume()
      openView('settings')
      dataLocation.scrollIntoView?.({ block: 'nearest' })
    }
    async function usesFile (candidate) {
      return !!handle && (candidate === handle || !!(await handle.isSameEntry?.(candidate)))
    }
    return {
      start,
      changed,
      flush,
      stop,
      onInteraction,
      usesFile,
      // Opaque checkpoint metadata also survives a rerun when session storage is blocked.
      session: () => ({
        handle,
        checkpoint: checkpoint && { ...checkpoint, keys: [...(checkpoint.keys || [])] },
        uncheckpointed: inheritedChanges || historyRevision !== cleanRevision || checkpoint?.dirty === true,
        touched: [...touchedCallFields].map(([id, fields]) => [id, [...fields]])
      })
    }
  }
  function createHistoryWidget (record) {
    const card = createElement('article', '', historyList, 'history-card')
    card.setAttribute('data-call-id', String(record.id))
    const heading = createElement('div', '', card, 'history-card-heading')
    const slot = createElement('div', '', heading, 'history-caller-slot')
    const caller = createElement('h4', record.caller, slot, 'history-caller')
    if (record.origin === 'manual') createElement('span', 'In person', slot, 'history-source')
    if (record.recovered) createElement('span', 'Recovered', slot, 'history-source')
    const input = createElement('input', '', slot, 'history-edit-input hidden')
    input.type = 'text'
    input.maxLength = 160
    input.autocomplete = 'off'
    input.placeholder = 'Name, username or student number'
    input.setAttribute('aria-label', `Caller name or ID for call #${record.id}`)
    const actions = createElement('div', '', heading, 'history-card-actions')
    const time = createElement(
      'span',
      `#${record.id} · ${historyTime(record.detectedAt)}`,
      actions,
      'history-time'
    )
    time.title = (record.origin === 'manual' ? 'Note added at ' : 'Call first detected at ') + historyTime(record.detectedAt)
    const button = createElement('button', '✎', actions, 'history-edit-toggle')
    const deleteButton = createElement('button', '🗑', actions, 'history-delete')
    deleteButton.title = 'Delete call note'
    deleteButton.setAttribute('aria-label', `Delete call note #${record.id}`)
    const notes = createElement('p', '', card, 'history-notes')
    const job = createElement('p', '', card, 'history-job')
    const fields = createElement('div', '', card, 'history-editor-fields hidden')
    const noteLabel = createElement('label', 'Notes', fields)
    const notesInput = createElement('textarea', '', noteLabel, 'history-edit-input history-notes-input')
    notesInput.rows = 3
    notesInput.maxLength = MAX_NOTES_LENGTH
    notesInput.setAttribute('aria-label', `Notes for call #${record.id}`)
    const jobLabel = createElement('label', 'Job Number', fields)
    const jobInput = createElement('input', '', jobLabel, 'history-edit-input history-job-input')
    jobInput.type = 'text'
    jobInput.maxLength = 80
    jobInput.autocomplete = 'off'
    jobInput.placeholder = 'e.g. INC1234567 or REQ123456'
    jobInput.setAttribute('aria-label', `Job number for call #${record.id}`)
    if (record.origin !== 'manual') {
      const information = createElement('div', '', card, 'history-information')
      setText(
        createCallDetail(information, 'Phone number', 'history-number'),
        record.number || 'Unavailable'
      )
      setText(createCallDetail(information, 'Queue', 'history-queue'), record.queue || 'Unavailable')
      const timings = createElement('div', '', card, 'history-timings')
      const duration =
      record.durationSeconds === null
        ? '—'
        : (record.durationComplete ? '' : '≥ ') + callClock(record.durationSeconds)
      createElement('span', 'Duration ' + duration, timings, 'history-duration')
      createElement('span', 'Queue wait ' + callClock(record.waitSeconds), timings, 'history-wait')
    }
    const details = createElement('details', '', card, 'history-extra')
    createElement('summary', 'More details', details)
    const prediction = createElement('p', '', details, 'history-prediction')
    prediction.title = 'Based on the entered name or ID; this prediction may be incorrect.'
    if (record.transactionId) createElement('p', 'Call reference: ' + record.transactionId, details)
    if (record.channel) createElement('p', 'Channel: ' + record.channel, details)
    if (record.channelNumber) createElement('p', 'Channel number: ' + record.channelNumber, details)
    if (record.holdSeconds !== null) {
      createElement('p', 'Hold time last read: ' + callClock(record.holdSeconds), details)
    }
    const savedAt = createElement('p', 'Saved at: ' + historyTime(record.completedAt), details)
    if (record.origin === 'text') createElement('p', 'Imported from a text file. Missing details remain unknown.', details)
    const widget = { card, caller, input, button, deleteButton, prediction, savedAt, notes, job, fields, notesInput, jobInput }
    button.onclick = () =>
      historyEdit?.id === record.id ? saveHistoryEdit() : beginHistoryEdit(record, widget)
    input.oninput = () => {
      if (!destroyed && historyEdit?.id === record.id) historyEdit.value = input.value.slice(0, 160)
      checkpointHistoryEdit()
    }
    notesInput.oninput = () => {
      if (!destroyed && historyEdit?.id === record.id) historyEdit.notes = notesInput.value.slice(0, MAX_NOTES_LENGTH)
      checkpointHistoryEdit()
    }
    jobInput.oninput = () => {
      if (!destroyed && historyEdit?.id === record.id) historyEdit.jobNumber = jobInput.value.slice(0, 80)
      checkpointHistoryEdit()
    }
    deleteButton.onclick = () => record === newManualRecord ? cancelHistoryEdit() : deleteHistoryRecord(record)
    // Keep editing keystrokes inside the assistant instead of invoking 8x8 shortcuts.
    for (const field of [input, notesInput, jobInput]) {
      for (const event of ['keydown', 'keypress', 'keyup']) field.addEventListener(event, (e) => e.stopPropagation())
      field.onkeydown = (event) => {
        // Notes keep normal multiline Enter; Ctrl+Enter confirms from any field.
        if (event.key === 'Escape' || (event.key === 'Enter' && (field !== notesInput || event.ctrlKey || event.metaKey))) {
          event.preventDefault()
          if (event.key === 'Escape') cancelHistoryEdit()
          else saveHistoryEdit()
        }
      }
    }
    syncHistoryEditor(record, widget)
    return widget
  }
  function renderHistory () {
    const query = normaliseStatus(historySearch.value)
    // A new search leaves the current record; save before evaluating its edited contents.
    if (historyEdit && historyRenderedQuery !== query) saveHistoryEdit(false)
    if (historyRenderedQuery !== query) historyPage = 0
    historyRenderedQuery = query
    const today = dayKey(Date.now())
    const key = `${historyRevision}|${query}|${today}|${historyPage}`
    // Polling updates statistics without rebuilding the scrollable cards or resetting expanded details.
    if (historyRenderKey === key) return
    historyRenderKey = key
    const records = [...callHistory.records].sort(
      (a, b) => (b.detectedAt ?? -Infinity) - (a.detectedAt ?? -Infinity) || b.id - a.id
    )
    const filtered = records.filter((call) => {
      const text = normaliseStatus(
        [call.caller, call.notes, call.jobNumber, call.number, call.queue, call.transactionId].join(' ')
      )
      // Telephone searches accept the user's spaces and punctuation as well as native formatting.
      const numberMatch =
        readablePhone(query) && phoneDigits(call.number).includes(phoneDigits(query))
      return !query || text.includes(query) || numberMatch
    })
    // These totals describe every saved note, regardless of search or rendered page.
    setText(historyTotal, String(records.length))
    setText(historyStudents, String(records.filter((record) => record.callerPrediction === 'Student').length))
    setText(historyStaff, String(records.filter((record) => record.callerPrediction === 'Staff').length))
    setText(historyMissingJobs, String(records.filter((record) => !cleanJobNumber(record.jobNumber)).length))
    setText(historyResults, query ? `${filtered.length} found` : 'Newest first')
    historyExport.disabled = transferBusy || !records.length
    historyDownload.disabled = transferBusy || !records.length
    historyAdd.disabled = transferBusy
    const pageSize = deployment?.historyPageSize || Infinity
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
    historyPage = Math.min(historyPage, pageCount - 1)
    const visibleRecords = historyPager ? filtered.slice(historyPage * pageSize, (historyPage + 1) * pageSize) : filtered
    if (historyPager) {
      historyPager.classList.toggle('hidden', pageCount <= 1)
      historyPrevious.disabled = historyPage === 0
      historyNext.disabled = historyPage >= pageCount - 1
      setText(historyPageLabel, `Page ${historyPage + 1} of ${pageCount}`)
    }
    const desired = []
    if (newManualRecord) {
      let widget = historyWidgets.get(newManualRecord.id)
      if (!widget) {
        widget = createHistoryWidget(newManualRecord)
        historyWidgets.set(newManualRecord.id, widget)
      }
      syncHistoryEditor(newManualRecord, widget)
      desired.push(widget.card)
    }
    if (!filtered.length && !newManualRecord) {
      if (!historyEmpty) historyEmpty = createElement('div', '', historyList, 'history-empty')
      setText(
        historyEmpty,
        query
          ? 'No matching call notes. Try another name, note or job number.'
          : 'No notes yet. Calls save after Wrap up. Use Add note for an in-person visit, or Import TXT.'
      )
      desired.push(historyEmpty)
    }
    let previousDay = ''
    for (const record of visibleRecords) {
      const recordDay = record.detectedAt === null ? 'unknown' : dayKey(record.detectedAt)
      if (recordDay !== previousDay) {
        const label =
          recordDay === 'unknown'
            ? 'Call date unknown'
            : recordDay === today
              ? 'Today'
              : new Date(record.detectedAt).toLocaleDateString('en-AU', {
                timeZone: STATISTICS_ZONE,
                day: 'numeric',
                month: 'short',
                year: 'numeric'
              })
        let heading = historyDays.get(recordDay)
        if (!heading) {
          heading = createElement('div', '', historyList, 'history-day')
          historyDays.set(recordDay, heading)
        }
        setText(heading, label)
        desired.push(heading)
        previousDay = recordDay
      }
      let widget = historyWidgets.get(record.id)
      if (!widget) {
        widget = createHistoryWidget(record)
        historyWidgets.set(record.id, widget)
      }
      syncHistoryEditor(record, widget)
      desired.push(widget.card)
    }
    // Insert new rows around existing cards instead of detaching an active input.
    // This preserves focus, caret, expanded details and normal scroll anchoring during polling.
    desired.forEach((node, index) => {
      if (historyList.children[index] !== node) {
        historyList.insertBefore(node, historyList.children[index] || null)
      }
    })
    const retained = new Set(desired)
    for (const node of [...historyList.children]) if (!retained.has(node)) node.remove()
    if (historyPager) {
      // Release cards from earlier pages instead of accumulating their detached DOM nodes.
      const visibleIds = new Set(visibleRecords.map((record) => record.id))
      if (newManualRecord) visibleIds.add(newManualRecord.id)
      for (const id of historyWidgets.keys()) if (!visibleIds.has(id)) historyWidgets.delete(id)
    }
  }
  function changeHistoryPage (direction) {
    saveHistoryEdit(false)
    historyPage = Math.max(0, historyPage + direction)
    renderHistory()
    historyList.scrollTop = 0
  }
  if (historyPrevious) historyPrevious.onclick = () => changeHistoryPage(-1)
  if (historyNext) historyNext.onclick = () => changeHistoryPage(1)
  function renderCall (page) {
    const draft = currentCallDraft()
    compactKind = 'call'
    setText(callBadge, page.onHold ? 'On hold' : 'Connected')
    callBadge.setAttribute('data-hold', String(!!page.onHold))
    setText(callElapsed, callClock(page.durationSeconds))
    setText(callNumber, page.number || draft?.number || 'Unavailable')
    setText(callQueue, page.queue || draft?.queue || 'Unavailable')
    callerInput.disabled = !draft || page.identityConflict
    notesInput.disabled = callerInput.disabled
    if (editingCallId !== draft?.id || callerInput.value !== (draft?.callerInput || '')) {
      // Ordinary accepted input already matches the draft: polling leaves its caret alone.
      // Caller changes or rejected late edits restore the correct saved value.
      callerInput.value = draft?.callerInput || ''
      editingCallId = draft?.id || null
    }
    if (notesInput.value !== (draft?.notesInput || '')) notesInput.value = draft?.notesInput || ''
    syncViews()
  }
  function saveOnCallInput (input, key, limit) {
    const draft = currentCallDraft()
    const page = readCallPage(getReadableDocuments())
    // Ignore a delayed input event after Wrap up or after the selected interaction changed.
    if (
      !draft ||
      page?.identityConflict ||
      page?.phase !== 'call' ||
      matchingCallDraft(page)?.id !== draft.id
    ) {
      return
    }
    draft[key] = input.value.slice(0, limit)
    if (!touchedCallFields.has(draft.id)) touchedCallFields.set(draft.id, new Set())
    touchedCallFields.get(draft.id).add(key)
    saveCallHistory()
  }
  callerInput.oninput = () => saveOnCallInput(callerInput, 'callerInput', 160)
  notesInput.oninput = () => saveOnCallInput(notesInput, 'notesInput', MAX_NOTES_LENGTH)
  for (const input of [callerInput, notesInput, historySearch]) {
    // Keep typing in assistant fields from bubbling into 8x8 keyboard shortcuts.
    for (const event of ['keydown', 'keypress', 'keyup']) {
      input.addEventListener(event, (e) => e.stopPropagation())
    }
  }
  historySearch.oninput = () => {
    renderHistory()
    historyList.scrollTop = 0
  }
  const SHORT_BREAK_KEY = 'service-desk-8x8-short-breaks-v1'
  const shortBreaks = { day: dayKey(Date.now()), seconds: 0, active: null }
  try {
    const saved = JSON.parse(settingsStorage.getItem(SHORT_BREAK_KEY) || '{}')
    if (saved && typeof saved === 'object') {
      // Store seconds so two partial minutes can contribute to the same completed minute.
      if (
        saved.day === shortBreaks.day &&
        Number.isSafeInteger(saved.seconds) &&
        saved.seconds >= 0
      ) {
        shortBreaks.seconds = saved.seconds
      }
      const active = saved.active
      // Retain the last native clock across restarts and midnight without counting it twice.
      if (
        active &&
        Number.isSafeInteger(active.elapsed) &&
        active.elapsed >= 0 &&
        Number.isFinite(active.seenAt) &&
        active.seenAt <= Date.now()
      ) {
        shortBreaks.active = { elapsed: active.elapsed, seenAt: active.seenAt }
      }
    }
  } catch {
    // Broken or blocked storage cannot interrupt the current break view.
  }
  function saveShortBreaks () {
    try {
      settingsStorage.setItem(SHORT_BREAK_KEY, JSON.stringify(shortBreaks))
    } catch {
      // In-memory totals still work when site storage is unavailable.
    }
  }
  function countShortBreaks (docs) {
    const now = Date.now()
    const today = dayKey(now)
    const before = JSON.stringify(shortBreaks)
    if (shortBreaks.day !== today) {
      shortBreaks.day = today
      shortBreaks.seconds = 0
    }
    const me = readMyPresence(docs)
    const kind = personalPageKind(me)
    if (kind === 'shortBreak' && Number.isSafeInteger(me.seconds)) {
      const active = shortBreaks.active
      // A lower native clock starts a new break; otherwise add only its measured increase.
      const continuing = active && me.seconds >= active.elapsed
      const added = continuing ? me.seconds - active.elapsed : me.seconds
      // Brisbane is UTC+10 year-round. An ongoing break may span midnight, so
      // only its measured portion belonging to the current day contributes today.
      const midnight = Date.parse(`${today}T00:00:00+10:00`)
      const secondsToday = Math.max(0, Math.floor((now - midnight) / MILLISECONDS_PER_SECOND))
      shortBreaks.seconds += Math.min(added, secondsToday)
      shortBreaks.active = { elapsed: me.seconds, seenAt: now }
    } else if (kind === 'otherBreak' && shortBreaks.active) {
      // A temporarily unknown reason cannot add time or cause a later double count.
      shortBreaks.active = { elapsed: me.seconds, seenAt: now }
    } else if (me && kind !== 'otherBreak') {
      // A readable different state ends this short break; missing data proves nothing.
      shortBreaks.active = null
    }
    if (JSON.stringify(shortBreaks) !== before) saveShortBreaks()
  }
  const agentWidgets = new Map()
  const freshness = new Map()
  const previous = new Map()
  const lunchLatched = new Set()
  let rosterRoot = null
  let rosterVisible = false
  let rosterComplete = false
  let rosterSettled = false
  let rosterUnreadable = false
  let lastReadableAgentsAt = null
  let rosterSnapshot = { signature: null, changedAt: Date.now() }
  const notices = new Map()
  const observers = new Map()
  const interactionDocs = new Set()
  let lastSample = null
  // Last-read counts are display-only; caller ages and cover decisions always use fresh DOM data.
  let lastReadableQueues = null
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
      .map((row) => row.closest('[data-item-index]')?.getAttribute('data-item-index'))
      .filter((value) => value !== null && value !== undefined)
      .map(Number)
      .sort((a, b) => a - b)
    // A nonzero first index or an index gap also identifies a partial window.
    return indexes.every((value, index) => Number.isInteger(value) && value === index)
  }
  function readAgents (docs) {
    const current = new Map()
    const me = readMyPresence(docs)
    if (me) current.set('Me', me)
    const rows = agentRows(docs)
    // Keep the list container so a genuinely empty, still-visible roster is readable.
    if (rows.length) {
      rosterRoot = rows[0].closest('[data-test-id="virtuoso-item-list"]') || rows[0].parentElement
    }
    if (!rosterRoot) {
      // A uniquely identifiable empty Groups list can still prove that only Me is signed in.
      const lists = docs.flatMap((d) => [...d.querySelectorAll('[data-test-id="virtuoso-item-list"]')])
        .filter((list) => isVisible(list) && !list.querySelector('[data-test-id="queue-item"]'))
      if (lists.length === 1) rosterRoot = lists[0]
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
    rosterUnreadable = false
    const names = new Set()
    for (const row of rows) {
      const name = agentName(row)
      // Duplicate/unnamed rows are a partial render, never permission to choose an identity.
      if (!name || name === 'Me' || names.has(name)) {
        rosterUnreadable = true
        continue
      }
      names.add(name)
      const status = normaliseText(
        row.querySelector('[data-status-value]')?.getAttribute('data-status-value')
      )
      const timer = normaliseText(
        row.querySelector('[data-test-id="user-presence-timer"]')?.textContent
      )
      // Build a fresh readable-presence map independently of saved G1 membership.
      current.set(name, { name, status, timer, seconds: parseDuration(timer) })
    }
    return current
  }
  function renderAgents (current, frozen) {
    // Read and validate the entire snapshot before touching any displayed status or timer.
    // Cached rows are display-only; alert rules always receive the independent fresh map.
    const personal = !!personalPageKind(current.get('Me'))
    if (!frozen && rosterSettled && !personal) {
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
    const names = frozen
      ? new Set(['Me', ...agentWidgets.keys()])
      : new Set(['Me', ...current.keys(), ...(!rosterSettled || personal ? agentWidgets.keys() : [])])
    // Me is always first; the remaining names use normal alphabetical ordering.
    for (const name of [...names].sort((a, b) =>
      a === 'Me' ? -1 : b === 'Me' ? 1 : a.localeCompare(b)
    )) {
      let widget = agentWidgets.get(name)
      if (!widget) {
        const row = createElement('tr', '', agentList)
        createElement('td', name, row, 'agent-name')
        const statusCell = createElement('td', '', row)
        const state = createElement('span', 'Not yet read', statusCell, 'agent-status')
        const timer = createElement('td', '—', row, 'agent-time')
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
      // Cached sign-in information cannot enable another agent's checkbox. Me can still
      // change their own role when the native personal/header presence is readable.
      widget.box.disabled = name === 'Me' ? !agent : frozen || !agent
      if (!frozen) {
        setText(widget.state, agent?.status || 'Not yet read')
        setText(widget.timer, agent?.timer || '—')
        widget.state.setAttribute('data-state', normaliseStatus(agent?.status))
      }
      // Leave existing rows attached while frozen; unrelated scans must not move the viewport.
      if (!frozen || widget.row.parentElement !== agentList) agentList.append(widget.row)
    }
    if (!frozen) lastReadableAgentsAt = Date.now()
    agentContainer.setAttribute('data-frozen', String(frozen))
  }
  function showFrozenAgents (value, alertsUnavailable = value) {
    agentsFrozen = value
    setText(agentDataBadge, value ? 'Last read' : 'Live')
    agentDataBadge.setAttribute('data-frozen', String(value))
    agentDataBadge.title = value ? 'Agent statuses and times are frozen until live information returns.' : 'Agent information can be read from 8x8.'
    const readTime = lastReadableAgentsAt === null
      ? 'No live agent information has been read yet.'
      : 'Last read at ' + new Date(lastReadableAgentsAt).toLocaleTimeString('en-AU', { hour12: false }) + '.'
    setText(dataLastRead, readTime + ' Call Notes is still available.')
    dataWarning.classList.toggle('hidden', !value)
    syncViews()
    // Only missing information required by an alert suspends it. Display caching must not
    // change alert eligibility when, for example, an unrelated G2 timer is unreadable.
    if (alertsUnavailable) reset()
  }
  function syncViews () {
    // Readable personal timers take priority over menus. Missing data never hides saved notes.
    // Calls normally open the identifier view. An explicit History shortcut can temporarily
    // replace it; break and disposition bars continue to take priority over menus.
    const callHistoryOpen = compactKind === 'call' && historyDuringCall && activeView === 'history'
    const compact = !!compactKind && !agentsFrozen && !callHistoryOpen
    const onCall = compactKind === 'call' && compact
    // Keep the shared warning beneath the current menu's heading, including when minimised.
    // Moving only on a menu switch leaves active note inputs, focus and scroll untouched.
    const warningParent = activeView === 'history'
      ? historyPanel
      : activeView === 'settings'
        ? settingsPanel
        : activeView === 'sounds' ? soundPanel : normalView
    if (dataWarning.parentElement !== warningParent) {
      warningParent.insertBefore(dataWarning, activeView === 'main' ? content : warningParent.children[1] || null)
    }
    if (historyEdit && (compact || activeView !== 'history')) saveHistoryEdit(false)
    panel.classList.toggle('compact', compact && !onCall)
    panel.classList.toggle('call-panel', onCall)
    panel.classList.toggle('history-panel', !compact && activeView === 'history')
    panel.classList.toggle('main-panel', !compact && activeView === 'main')
    compactView.classList.toggle('hidden', !compact || onCall)
    callView.classList.toggle('hidden', !onCall)
    normalView.classList.toggle('hidden', compact || activeView !== 'main')
    soundPanel.classList.toggle('hidden', compact || activeView !== 'sounds')
    settingsPanel.classList.toggle('hidden', compact || activeView !== 'settings')
    historyPanel.classList.toggle('hidden', compact || activeView !== 'history')
    bottom.classList.remove('hidden')
    footer.classList.toggle('hidden', compact || activeView !== 'main')
    windowResizer?.apply()
  }
  function minuteValue (seconds) {
    // Keep the lunch view in minutes, including small overruns and time left near zero.
    if (seconds > 0 && seconds < 6) return '<0.1'
    return String(Number((seconds / SECONDS_PER_MINUTE).toFixed(1)))
  }
  function renderCompact (me, kind) {
    compactKind = kind
    compactView.setAttribute('data-kind', kind)
    shortSummary.classList.toggle('hidden', kind !== 'shortBreak')
    compactCountdown.classList.toggle('hidden', kind === 'shortBreak' || kind === 'otherBreak')
    if (kind === 'shortBreak' || kind === 'otherBreak') {
      const short = kind === 'shortBreak'
      const elapsedMinutes = Math.floor(me.seconds / SECONDS_PER_MINUTE)
      const todayMinutes = Math.floor(shortBreaks.seconds / SECONDS_PER_MINUTE)
      compactView.setAttribute('data-overdue', 'false')
      setText(compactTitle, short ? 'Short break' : 'On break')
      setText(shortToday, `${todayMinutes} min`)
      setText(shortCurrent, `${elapsedMinutes} min`)
      setText(
        compactElapsed,
        short ? 'Total updates each completed minute' : `${minuteValue(me.seconds)} min elapsed`
      )
      setText(compactAllowance, short ? 'Next minute →' : 'Lunch timer is not used')
      // This small cycle shows progress toward another minute, never toward a lunch limit.
      const minuteProgress = (me.seconds % SECONDS_PER_MINUTE) / SECONDS_PER_MINUTE
      progressFill.style.width = `${minuteProgress * 100}%`
      progressTrack.setAttribute('aria-label', 'Progress toward the next break minute')
      progressTrack.setAttribute('aria-valuemax', '1')
      progressTrack.setAttribute('aria-valuenow', String(Number(minuteProgress.toFixed(2))))
      progressTrack.setAttribute(
        'aria-valuetext',
        short
          ? `${todayMinutes} minutes of short breaks today; ${elapsedMinutes} minutes this short break`
          : `${minuteValue(me.seconds)} minutes on break; lunch reminder disabled because the break reason is unknown`
      )
      syncViews()
      return
    }
    // Both personal states use seconds internally, regardless of the lunch UI's minutes.
    const allowance = kind === 'break' ? lunchMinutes * SECONDS_PER_MINUTE : dispositionSeconds
    const elapsed = me.seconds
    // Once overdue, show elapsed overrun instead of a negative countdown.
    const remaining = Math.max(0, allowance - elapsed)
    const overdue = elapsed > allowance
    compactView.setAttribute('data-overdue', String(overdue))
    const label = kind === 'break' ? 'Lunch break' : 'Complete disposition'
    setText(compactTitle, label)
    const lunch = kind === 'break'
    const display = (seconds) => (lunch ? `${minuteValue(seconds)} min` : `${seconds}s`)
    setText(
      compactCountdown,
      overdue ? `${display(elapsed - allowance)} overdue` : `${display(remaining)} left`
    )
    setText(compactElapsed, `${display(elapsed)} elapsed`)
    setText(compactAllowance, `${display(allowance)} allowance`)
    // Clamp the fill to the track while the overdue label can continue counting upward.
    progressFill.style.width = `${Math.min(100, (elapsed / allowance) * 100)}%`
    progressTrack.setAttribute('aria-label', label)
    // Accessible values use the same units as the visible timer.
    const unit = lunch ? SECONDS_PER_MINUTE : 1
    progressTrack.setAttribute('aria-valuemax', String(allowance / unit))
    progressTrack.setAttribute(
      'aria-valuenow',
      String(Number((Math.min(allowance, elapsed) / unit).toFixed(2)))
    )
    const words = (seconds) => (lunch ? `${minuteValue(seconds)} minutes` : `${seconds} seconds`)
    progressTrack.setAttribute(
      'aria-valuetext',
      `${words(elapsed)} elapsed, ${overdue ? words(elapsed - allowance) + ' overdue' : words(remaining) + ' left'}`
    )
    syncViews()
  }
  function openView (view) {
    if (activeView === 'history' && view !== 'history') saveHistoryEdit()
    // Leaving Sound Settings cancels the sample sound, while actual reminders continue.
    if (activeView === 'sounds' && view !== 'sounds') stopSound('preview')
    activeView = view
    syncViews()
    panel.scrollTop = 0
    if (view === 'sounds') refreshAudioDevices()
  }
  settingsButton.onclick = () => openView('settings')
  historyButton.onclick = () => {
    // A known call draft may outlive a temporarily unreadable phone card. An explicit
    // visit to Call Notes keeps that menu open when the same native call view returns.
    historyDuringCall = !!currentCallDraft()
    renderHistory()
    openView('history')
  }
  callHistoryButton.onclick = () => {
    historyDuringCall = true
    renderHistory()
    openView('history')
  }
  historyBack.onclick = () => {
    historyDuringCall = false
    openView('main')
    // Returning to an ongoing call restores the editor without discarding its draft.
    if (compactKind === 'call') callerInput.focus?.()
  }
  soundBack.onclick = () => openView('settings')
  settingsBack.onclick = () => openView('main')
  function prepareSound () {
    if (muted || destroyed) return
    try {
      // Neither context belongs to 8x8; changing either sink affects assistant tones only.
      if (AudioClass && !audio) {
        audio = new AudioClass()
        if (outputDeviceId) {
          audioOutputReady = false
          // Restore the saved sink asynchronously; playback waits for it to finish.
          setAssistantOutput(outputDeviceId)
        }
      }
      // A user gesture can unlock suspended browser audio; later gestures can retry failure.
      if (audio && audio.state !== 'running') audio.resume().catch(() => {})
      if (secondaryRingerEnabled && canRouteOutput) {
        // Restore the saved second output lazily, including after unmuting a saved session.
        if (!secondaryAudio) setSecondaryOutput(secondaryDeviceId)
        else resumeSecondaryAudio(secondaryAudio)
      }
    } catch (e) {
      console.warn('Service Desk 8x8 Assistant sound:', e.message)
    }
  }
  function enableAlerts (event) {
    // Only real keyboard or pointer actions can satisfy browser audio restrictions.
    if (!event?.isTrusted || destroyed) return
    automaticData?.onInteraction(event)
    if (event.type === 'pointerdown') saveHistoryOutside(event)
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
        `Plays when your break is labelled "Lunch" and lasts longer than your lunch length in Assistant Settings (currently ${timeWords(lunchMinutes, 'minute')}). Applies in G1 and G2. Never plays for "Short Break".`,
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
    const value = JSON.parse(settingsStorage.getItem(SOUND_KEY) || '{}')
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
      volume: Number.isFinite(configured.volume)
        ? Math.max(0, Math.min(100, configured.volume))
        : definition.volume,
      seconds: Number.isFinite(configured.seconds)
        ? Math.max(1, Math.min(120, configured.seconds))
        : definition.seconds,
      repeat: typeof configured.repeat === 'boolean' ? configured.repeat : definition.repeat,
      desktopNotification:
        typeof configured.desktopNotification === 'boolean' ? configured.desktopNotification : true
    }
  }
  const sounds = new Map()
  function startReminderLifetime (kind, soundKind = kind, preview = false) {
    // Each episode owns a fresh deadline. A newer break or preview cannot inherit an old expiry.
    const configuration = soundSettings[soundKind]
    reminderLifetimes.set(kind, {
      soundKind,
      repeating: configuration.repeat && !preview,
      expectedFinishAt: Date.now() + (preview ? Math.min(3, configuration.seconds) : configuration.seconds) * MILLISECONDS_PER_SECOND,
      finishedAt: null,
      expired: false
    })
  }
  function expireNotifications () {
    const now = Date.now()
    const displayMs = notificationDisplaySeconds * MILLISECONDS_PER_SECOND
    let changed = false
    for (const [kind, lifetime] of reminderLifetimes) {
      if (lifetime.expired || lifetime.repeating) continue
      if (lifetime.finishedAt === null && now >= lifetime.expectedFinishAt) {
        // Polling also enforces the wall-time deadline after browser timer throttling.
        stopSound(kind, true)
        lifetime.finishedAt = lifetime.expectedFinishAt
        changed = true
      }
      if (lifetime.finishedAt !== null && now >= lifetime.finishedAt + displayMs) {
        lifetime.expired = true
        reminders.delete(kind)
        notices.get(kind)?.close()
        notices.delete(kind)
        noticeTimes.delete(kind)
        changed = true
      }
    }
    for (const [kind, sentAt] of noticeTimes) {
      const notice = notices.get(kind)
      if (!notice) { noticeTimes.delete(kind); continue }
      const lifetime = reminderLifetimes.get(kind)
      // Desktop popups for ongoing repeating alerts close too; their actionable in-app
      // card remains visible until the real condition clears. Finite popups follow the sound.
      const finishedAt = lifetime && !lifetime.repeating
        ? lifetime.finishedAt ?? lifetime.expectedFinishAt
        : sentAt
      if (now >= finishedAt + displayMs) {
        notice.close()
        notices.delete(kind)
        noticeTimes.delete(kind)
      }
    }
    if (changed) syncReminderBox()
  }
  function soundPlaybackState (kind, soundKind) {
    // An active reminder can remain visible while its finite sound has ended.
    const configuration = soundSettings[soundKind]
    if (muted) return 'Sound muted'
    if (!configuration.volume) return 'Sound volume is 0%'
    if (sounds.has(kind)) return 'Sound playing'
    if (reminderLifetimes.get(kind)?.finishedAt !== null && reminderLifetimes.has(kind)) return 'Sound finished'
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
  function stopScheduledNotes (job, context = null) {
    // Routing one output must stop its queued notes without interrupting the other speaker.
    for (const [oscillator, note] of job.nodes) {
      if (context && note.context !== context) continue
      job.nodes.delete(oscillator)
      try {
        oscillator.stop()
      } catch {
        // A note that ended naturally cannot be stopped a second time.
      }
      oscillator.disconnect()
      note.gain.disconnect()
    }
    // A reconnected output may join the remaining sound once, without doubling its notes.
    if (context) job.lastStarted.delete(context)
    else job.lastStarted.clear()
  }
  function stopOutputSounds (context) {
    if (context) for (const job of sounds.values()) stopScheduledNotes(job, context)
  }
  function outputsMatch () {
    // Equal IDs, including two system-default selections, represent a single output.
    const primaryId = typeof audio?.sinkId === 'string' ? audio.sinkId : outputDeviceId
    const secondId =
      typeof secondaryAudio?.sinkId === 'string' ? secondaryAudio.sinkId : secondaryDeviceId
    if (primaryId === secondId) return true
    // The browser may expose Default/Communications aliases for the same hardware.
    // Match its nonempty group ID rather than guessing from potentially identical labels.
    const deviceFor = (id) =>
      audioOutputDevices.find((device) => device.deviceId === (id || 'default'))
    const primary = deviceFor(primaryId)
    const secondary = deviceFor(secondId)
    const alias = (id) => !id || id === 'communications'
    return Boolean(
      (alias(primaryId) || alias(secondId)) &&
      primary?.groupId &&
      primary.groupId === secondary?.groupId
    )
  }
  function playbackOutputs () {
    const contexts = audioOutputReady && audio?.state === 'running' ? [audio] : []
    if (
      secondaryRingerEnabled &&
      secondaryOutputReady &&
      secondaryAudio?.state === 'running' &&
      !outputsMatch()
    ) {
      contexts.push(secondaryAudio)
    }
    return contexts
  }
  function joinSecondarySounds () {
    if (destroyed || muted || !playbackOutputs().includes(secondaryAudio)) return
    // Joining a live job retains its original deadline and never replays the primary output.
    for (const job of sounds.values()) {
      if (!job.lastStarted.has(secondaryAudio)) job.cycle([secondaryAudio])
    }
  }
  function resumeSecondaryAudio (context) {
    if (destroyed || muted || !secondaryRingerEnabled || context !== secondaryAudio) return
    if (context.state === 'running') joinSecondarySounds()
    else {
      // A later trusted interaction can retry a browser-blocked resume without changing devices.
      context
        .resume()
        .then(() => {
          if (context === secondaryAudio) joinSecondarySounds()
        })
        .catch(() => {})
    }
  }
  function stopSound (kind, finished = false) {
    const job = sounds.get(kind)
    if (job) {
      root.clearInterval(job.interval)
      root.clearTimeout(job.timeout)
      // Stop already scheduled notes on both outputs as well as their shared timer.
      stopScheduledNotes(job)
      sounds.delete(kind)
    }
    const lifetime = reminderLifetimes.get(kind)
    if (lifetime && !lifetime.repeating && (job || finished)) {
      // An explicit stop finishes now; a natural stop retains the original finite deadline.
      lifetime.finishedAt = finished ? lifetime.expectedFinishAt : Date.now()
    }
    if (kind === 'preview' && !finished) {
      reminders.delete('preview')
      reminderLifetimes.delete('preview')
    }
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
    const job = {
      nodes: new Map(),
      lastStarted: new Map(),
      interval: null,
      timeout: null,
      cycle: null
    }
    sounds.set(key, job)
    if (preview) {
      reminders.set('preview', {
        soundKind: kind,
        title: `Preview: ${definitions[kind].label}`,
        body: `Testing your selected "${configuration.preset}" sound for this reminder.`
      })
    }
    startReminderLifetime(key, kind, preview)
    syncReminderBox()
    const start = Date.now()
    // Previews stay short and never repeat, even when the real alert repeats forever.
    const total = preview ? Math.min(3, configuration.seconds) : configuration.seconds
    const endless = configuration.repeat && !preview
    const cycle = (contexts = playbackOutputs()) => {
      // A replaced job must not schedule notes after a settings or output change.
      if (sounds.get(key) !== job) return
      // Use wall time for the finite deadline so delayed timer callbacks cannot extend it.
      const remaining = endless ? Infinity : total - (Date.now() - start) / MILLISECONDS_PER_SECOND
      if (remaining <= 0) {
        stopSound(key, true)
        return
      }
      for (const context of contexts) {
        job.lastStarted.set(context, Date.now())
        preset.notes.forEach((frequencyHz, noteIndex) => {
          // Zero-frequency entries are intentional rests between audible notes.
          const offset = noteIndex * preset.pace
          if (!frequencyHz || offset >= remaining) return
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          // Each speaker has its own audio clock; both use the same pattern and wall-time deadline.
          const noteStart = context.currentTime + offset
          const noteLength = Math.min(preset.pace * 0.8, remaining - offset)
          oscillator.type = preset.wave
          oscillator.frequency.value = frequencyHz
          // Brief attack and release ramps avoid abrupt waveform clicks.
          gain.gain.setValueAtTime(0, noteStart)
          // Leave gain headroom, apply the volume percentage, and cap attack at 15 ms.
          gain.gain.linearRampToValueAtTime(
            (0.3 * configuration.volume) / 100,
            noteStart + Math.min(0.015, noteLength / 3)
          )
          gain.gain.linearRampToValueAtTime(0, noteStart + noteLength)
          oscillator.connect(gain)
          // Only this assistant's audio destination is affected by its output selection.
          gain.connect(context.destination)
          job.nodes.set(oscillator, { context, gain })
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
    }
    job.cycle = cycle
    cycle()
    // Repeat whole note sequences, with a minimum interval to avoid overly tight loops.
    const cycleInterval = Math.max(250, preset.notes.length * preset.pace * MILLISECONDS_PER_SECOND)
    job.interval = root.setInterval(cycle, cycleInterval)
    // A finite sound also has a hard stop independent of its repeating cycle timer.
    if (!endless) {
      job.timeout = root.setTimeout(() => {
        // Ignore a delayed callback belonging to a preview/job that has since been replaced.
        if (sounds.get(key) === job) stopSound(key, true)
      }, total * MILLISECONDS_PER_SECOND)
    }
  }
  const saveSounds = () => {
    try {
      settingsStorage.setItem(SOUND_KEY, JSON.stringify(soundSettings))
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
    const choice = createElement(
      'select',
      '',
      createElement('label', 'Sound type', section, 'sound-field')
    )
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
    const durationLabel = createElement(
      'label',
      'Duration (seconds, 1–120)',
      section,
      'sound-field'
    )
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
    (number) => {
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
    (number) => {
      waitingAlertSeconds = number
    }
  )
  timingSetting(
    'Notification Display Time',
    'How long a finished sound message stays visible before it closes. Desktop notifications also close automatically. Active repeating alerts stay visible in the assistant until their condition clears.',
    'its-notification-display-seconds',
    notificationDisplaySeconds,
    1,
    300,
    'seconds',
    (number) => { notificationDisplaySeconds = number }
  )
  createElement('h4', 'Audio Devices', devicesCard)
  createElement(
    'p',
    'Output changes apply only to assistant sounds. Your 8x8 calls keep their own device settings.',
    devicesCard,
    'settings-description'
  )
  const outputChoice = createElement(
    'select',
    '',
    createElement('label', 'Output Device', devicesCard, 'sound-field')
  )
  outputChoice.setAttribute('aria-label', 'Assistant output device')
  const defaultOutput = createElement('option', 'System default (Default)', outputChoice)
  defaultOutput.value = ''
  if (outputDeviceId) {
    createElement('option', 'Saved output device', outputChoice).value = outputDeviceId
    outputChoice.value = outputDeviceId
  }
  outputChoice.disabled = !canRouteOutput
  const secondaryCard = createElement('div', '', devicesCard, 'secondary-ringer')
  const secondaryLabel = createElement('label', '', secondaryCard, 'repeat-control')
  const secondaryToggle = createElement('input', '', secondaryLabel)
  secondaryToggle.type = 'checkbox'
  secondaryToggle.id = 'its-secondary-ringer'
  secondaryToggle.setAttribute('aria-label', 'Secondary Ringer')
  secondaryLabel.append(doc.createTextNode('Secondary Ringer'))
  createElement(
    'p',
    'Play assistant sounds through a second output as well.',
    secondaryCard,
    'settings-description'
  )
  const secondaryOptions = createElement('div', '', secondaryCard, 'secondary-options')
  const secondaryChoice = createElement(
    'select',
    '',
    createElement('label', 'Secondary Ringer Device', secondaryOptions, 'sound-field')
  )
  secondaryChoice.setAttribute('aria-label', 'Assistant secondary ringer device')
  createElement('option', 'System default (Default)', secondaryChoice).value = ''
  if (secondaryDeviceId) {
    createElement('option', 'Saved secondary output device', secondaryChoice).value =
      secondaryDeviceId
    secondaryChoice.value = secondaryDeviceId
  }
  const deviceActions = createElement('div', '', devicesCard, 'device-actions')
  const refreshDevicesButton = createElement('button', 'Refresh devices', deviceActions)
  refreshDevicesButton.disabled =
    !canRouteOutput || typeof mediaDevices?.enumerateDevices !== 'function'
  // Only display the browser output picker when that API is actually available.
  const chooseOutputButton =
    canRouteOutput && typeof mediaDevices?.selectAudioOutput === 'function'
      ? createElement('button', 'Choose output device', deviceActions)
      : null
  const chooseSecondaryButton =
    canRouteOutput && typeof mediaDevices?.selectAudioOutput === 'function'
      ? createElement('button', 'Choose secondary ringer device', secondaryOptions)
      : null
  const secondaryFeedback = createElement('p', '', secondaryCard, 'small secondary-feedback')
  secondaryFeedback.setAttribute('role', 'status')
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
  let secondaryChanges = Promise.resolve()
  let secondaryChangeRevision = 0
  let deviceRefreshRevision = 0
  function syncSecondaryControls () {
    secondaryToggle.checked = secondaryRingerEnabled
    secondaryToggle.disabled = !canRouteOutput
    secondaryOptions.classList.toggle('hidden', !secondaryRingerEnabled)
    // Saved device choices remain editable while muted, even before audio is created.
    secondaryChoice.disabled = !secondaryRingerEnabled || secondaryOutputPending || !canRouteOutput
    if (chooseSecondaryButton) chooseSecondaryButton.disabled = secondaryChoice.disabled
  }
  function updateSecondaryFeedback () {
    const text = !canRouteOutput
      ? 'Secondary Ringer is unavailable in this browser. Assistant sounds use the system default.'
      : !secondaryRingerEnabled
          ? 'Secondary Ringer is off.'
          : outputsMatch()
            ? 'Both outputs use the same device. Sounds play once on that device.'
            : 'Assistant sounds and previews also play on your secondary device. Mute silences both outputs.'
    setText(secondaryFeedback, text)
  }
  syncSecondaryControls()
  updateSecondaryFeedback()
  function setSecondaryOutput (id, note = '') {
    if (destroyed || !secondaryRingerEnabled || !canRouteOutput) return Promise.resolve(false)
    const sinkId = id === 'default' ? '' : id
    // Invalidate earlier choices immediately, even if their browser permission promise is pending.
    const revision = ++secondaryChangeRevision
    secondaryOutputReady = false
    secondaryOutputPending = true
    stopOutputSounds(secondaryAudio)
    syncSecondaryControls()
    setText(secondaryFeedback, 'Connecting Secondary Ringer… Your main output is unchanged.')
    const change = secondaryChanges.then(async () => {
      const current = () =>
        !destroyed && secondaryRingerEnabled && revision === secondaryChangeRevision
      if (!current()) return false
      let context
      try {
        if (!secondaryAudio) secondaryAudio = new AudioClass()
        context = secondaryAudio
        // A second independent sink duplicates only the assistant's locally generated tones.
        await context.setSinkId(sinkId)
        if (!current() || context !== secondaryAudio) return false
        secondaryDeviceId = sinkId
        savePreferences()
        secondaryChoice.value = sinkId
        updateSecondaryFeedback()
        if (note) setText(secondaryFeedback, note)
        return true
      } catch {
        if (!current() || (context && context !== secondaryAudio)) return false
        // An unavailable or denied second device must never silence the primary output.
        secondaryDeviceId = typeof context?.sinkId === 'string' ? context.sinkId : ''
        savePreferences()
        secondaryChoice.value = secondaryDeviceId
        setText(
          secondaryFeedback,
          context
            ? 'Could not use that secondary device. The previous secondary output was kept; your main output is unchanged.'
            : 'Could not start Secondary Ringer. Your main output is unchanged. Choose the device again to retry.'
        )
        return false
      } finally {
        if (current() && (!context || context === secondaryAudio)) {
          secondaryOutputReady = true
          secondaryOutputPending = false
          syncSecondaryControls()
          if (context) resumeSecondaryAudio(context)
        }
      }
    })
    // Keep routing serial, but prevent a rejected change from blocking subsequent selections.
    secondaryChanges = change.catch(() => false)
    return change
  }
  secondaryToggle.onchange = () => {
    if (destroyed || !canRouteOutput) return Promise.resolve(false)
    secondaryRingerEnabled = secondaryToggle.checked
    secondaryChangeRevision++
    secondaryOutputReady = false
    secondaryOutputPending = false
    savePreferences()
    stopOutputSounds(secondaryAudio)
    syncSecondaryControls()
    updateSecondaryFeedback()
    if (secondaryRingerEnabled) return setSecondaryOutput(secondaryDeviceId)
    // Turning off the ringer closes its context immediately and retains its saved device choice.
    const previous = secondaryAudio
    secondaryAudio = null
    return previous?.close().catch(() => {}) || Promise.resolve(true)
  }
  secondaryChoice.onchange = () => setSecondaryOutput(secondaryChoice.value)
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
          updateSecondaryFeedback()
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
    const revision = ++deviceRefreshRevision
    try {
      // Enumerate permitted speakers without opening a microphone or altering phone devices.
      const devices = await mediaDevices.enumerateDevices()
      // Wait until pending routing settles before rebuilding the selected option.
      await Promise.all([outputChanges, secondaryChanges])
      if (destroyed || revision !== deviceRefreshRevision) return
      audioOutputDevices = devices.filter((device) => device.kind === 'audiooutput')
      updateSecondaryFeedback()
      // Exclude inputs and the duplicate default alias from the selectable output list.
      const available = devices.filter(
        (d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default'
      )
      const defaultLabel = (kind) => {
        const label = devices.find((d) => d.kind === kind && d.deviceId === 'default')?.label
        // Remove the browser's prefix while retaining the device name and clear default label.
        return (label ? label.replace(/^default\s*[-–—]\s*/i, '') : 'System default') + ' (Default)'
      }
      for (const choice of [outputChoice, secondaryChoice]) {
        choice.textContent = ''
        createElement('option', defaultLabel('audiooutput'), choice).value = ''
        for (const [index, device] of available.entries()) {
          createElement('option', device.label || `Output device ${index + 1}`, choice).value =
            device.deviceId
        }
      }
      // A removed or no-longer-permitted speaker falls back to the system default.
      if (outputDeviceId && !available.some((d) => d.deviceId === outputDeviceId)) {
        await setAssistantOutput(
          '',
          'Selected output is unavailable. Assistant sounds now use the system default.'
        )
      }
      outputChoice.value = outputDeviceId
      if (secondaryDeviceId && !available.some((device) => device.deviceId === secondaryDeviceId)) {
        if (secondaryRingerEnabled) {
          await setSecondaryOutput(
            '',
            'Secondary output is unavailable. Secondary Ringer now uses the system default.'
          )
        } else {
          // Do not create an audio context for a disabled ringer merely to forget a removed device.
          secondaryDeviceId = ''
          savePreferences()
        }
      }
      secondaryChoice.value = secondaryDeviceId
      // A changed system default can make two routes refer to the same physical speaker.
      if (outputsMatch()) stopOutputSounds(secondaryAudio)
      else joinSecondarySounds()
      syncSecondaryControls()
      if (!available.length && !outputDeviceId) {
        setText(
          deviceFeedback,
          'Using the system default. Other outputs may need browser permission.'
        )
      }
    } catch {
      if (!destroyed && revision === deviceRefreshRevision) {
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
  if (chooseSecondaryButton) {
    chooseSecondaryButton.onclick = async () => {
      // Capture the toggle revision so a picker result cannot re-enable a ringer switched off meanwhile.
      const revision = secondaryChangeRevision
      if (destroyed || !secondaryRingerEnabled) return
      try {
        const device = await mediaDevices.selectAudioOutput(
          secondaryDeviceId ? { deviceId: secondaryDeviceId } : {}
        )
        if (destroyed || !secondaryRingerEnabled || revision !== secondaryChangeRevision) return
        if (device?.kind !== 'audiooutput' || typeof device.deviceId !== 'string') {
          throw Error('No output selected')
        }
        await setSecondaryOutput(device.deviceId)
        await refreshAudioDevices()
      } catch {
        if (!destroyed && secondaryRingerEnabled && revision === secondaryChangeRevision) {
          setText(
            secondaryFeedback,
            'No new secondary device was selected. Your outputs are unchanged.'
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
  const notificationInstructions = createElement(
    'div',
    '',
    desktopCard,
    'small notification-instructions'
  )
  createElement('p', 'Allow notifications manually in Microsoft Edge:', notificationInstructions)
  const notificationSteps = createElement('ol', '', notificationInstructions)
  createElement(
    'li',
    'Settings → Privacy, search and services → Site permissions → All permissions → Notifications.',
    notificationSteps
  )
  createElement('li', 'Under Allowed to send notifications, select Add site.', notificationSteps)
  createElement('li', 'Enter https://vcc-au2.8x8.com and select Add.', notificationSteps)
  if (deployment) {
    notificationInstructions.textContent = 'Notifications are sent by this extension. If no popup appears, check Microsoft Edge notifications in Windows Settings.'
  }
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
    const NotificationClass = notificationClass()
    if (!NotificationClass) {
      setText(notificationFeedback, 'Desktop notifications are not supported in this browser.')
      return
    }
    notificationTesting = true
    syncNotificationTest()
    try {
      const permission = NotificationClass.permission
      if (destroyed || !desktopNotifications) return
      if (permission !== 'granted') {
        setText(
          notificationFeedback,
          deployment
            ? 'Notifications are not allowed yet. Check Microsoft Edge notifications in Windows Settings, then try again.'
            : 'Notifications are not allowed yet. Follow the Edge settings steps above, then try again.'
        )
        return
      }
      notices.get('test')?.close()
      const notice = new NotificationClass('8x8 Assistant: Test Notification', {
        body: 'This is a test of your desktop notifications.',
        tag: 'its-call-assist-test',
        silent: muted
      })
      notices.set('test', notice)
      noticeTimes.set('test', Date.now())
      notice.onclick = () => {
        root.focus()
        notice.close()
      }
      // The extension API is asynchronous; report success only after Edge accepts the popup.
      if (deployment) await notice.ready
      if (destroyed || !desktopNotifications) return notice.close()
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
  desktopToggle.onchange = (event) => {
    desktopNotifications = desktopToggle.checked
    savePreferences()
    if (!desktopNotifications) {
      for (const notice of notices.values()) notice.close()
      notices.clear()
      noticeTimes.clear()
    } else enableAlerts(event)
    syncNotificationTest()
  }
  function sendDesktopNotification (kind, title, body) {
    const NotificationClass = notificationClass()
    // Browser permission, the global switch and this sound's checkbox must all allow a popup.
    if (
      !destroyed &&
      desktopNotifications &&
      soundSettings[kind].desktopNotification &&
      NotificationClass &&
      NotificationClass.permission === 'granted'
    ) {
      try {
        notices.get(kind)?.close()
        // Tags replace this reminder's previous popup; mute requests silent OS delivery.
        const notice = new NotificationClass(title, {
          body,
          tag: `its-call-assist-${kind}`,
          requireInteraction: true,
          silent: muted
        })
        notices.set(kind, notice)
        noticeTimes.set(kind, Date.now())
        notice.ready?.catch(() => {})
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
    startReminderLifetime(kind)
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
    noticeTimes.delete(kind)
    reminders.delete(kind)
    reminderLifetimes.delete(kind)
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
      // A finished finite message must not reappear on every scan of the same condition.
      if (!reminderLifetimes.get(reminder.kind)?.expired) reminders.set(reminder.kind, reminder)
      syncReminderBox()
      // Finite sounds stay finished; repeating sounds recover after audio/output interruptions.
      if (!sounds.has(reminder.kind) && soundSettings[reminder.kind].repeat) {
        playSound(reminder.kind)
      }
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

  function monitoringMessage (offline, queues) {
    if (offline) return 'Waiting for connection'
    // Counts may remain readable while 8x8 has not yet exposed a caller's age.
    if (queues.some((queue) => queue.waiting > 0 && queue.waitSeconds === null)) {
      return 'Waiting for caller time'
    }
    // Readable queue rows are live monitoring even when their numbers stay unchanged.
    // Agent timers and G1 edits only affect separate alert checks, never this status.
    return 'Live'
  }
  function renderMonitoring (sample) {
    // Queue display remains independent of agent availability. Cached counts are labelled
    // explicitly and never provide caller ages or eligibility to the alert rules.
    const queuesReadable = sample.queueErrors.length === 0
    const heading = queuesReadable
      ? monitoringMessage(root.navigator.onLine === false, sample.queues)
      : 'Queue data unavailable. Scroll back to your queues.'
    setText(monitorState, heading)
    monitorState.setAttribute(
      'data-state',
      !queuesReadable ? 'unavailable' : heading === 'Live' ? 'live' : 'waiting'
    )
    if (queuesReadable) {
      lastReadableQueues = {
        total: sample.queues.reduce((total, queue) => total + queue.waiting, 0)
      }
      setText(lastUpdated, new Date().toLocaleTimeString('en-AU', { hour12: false }))
    }
    setText(queueTotal, lastReadableQueues ? String(lastReadableQueues.total) : '—')
    setText(queueCountLabel, queuesReadable ? 'Callers waiting' : 'Last read callers waiting')
  }

  function scan (docs) {
    if (destroyed) return
    const now = Date.now()
    const gap = now - lastScan
    lastScan = now
    syncPageObservers(docs)
    const current = readAgents(docs)
    const selfInG1 = selected.has('Me')
    const me = current.get('Me')
    const personalKind = personalPageKind(me)
    // Missing HTML or a lone Busy header cannot prove that an ongoing call ended.
    // Preserve an explicitly opened notes menu until a different readable state returns.
    if ((personalKind && personalKind !== 'call') ||
      (me && !personalKind && normaliseStatusLabel(me.status) !== 'busy')) {
      historyDuringCall = false
    }
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
        agentsFrozen: false,
        view: personalKind
      }
      // Personal pages expose their own clocks. Keep the hidden table unchanged rather than
      // turning absent Groups rows into blank agents while calls and reminders continue.
      renderAgents(current, true)
      showFrozenAgents(false)
      if (personalKind === 'call') renderCall(me)
      else renderCompact(me, personalKind)
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
    const presentG1 = [...selected].filter((name) => current.has(name))
    const sample = readAgentAndQueues(
      docs,
      presentG1[0] || [...current.keys()].find((name) => name !== 'Me') || 'Me'
    )
    // Validate each live selected agent; a missing saved name remains a preference only.
    const samples = presentG1.map((name) => readAgentAndQueues(docs, name))
    const agents = samples.map((s) => s.agent).filter(Boolean)
    // An incomplete or virtualised list cannot prove an absent selected member signed out.
    const missingG1 = [...selected].some((name) => name !== 'Me' && !current.has(name))
    const missing =
      !current.has('Me') ||
      (!rosterVisible && agentWidgets.size > 1) ||
      (missingG1 && (!rosterComplete || rosterUnreadable)) ||
      sample.agentErrors.length > 0 ||
      samples.some((s) => s.agentErrors.length)
    // Freeze the whole displayed table for a partial snapshot, even when the fresh subset
    // still contains everything needed by a particular alert or by queue monitoring.
    const tableFrozen = !!missing || !rosterComplete || rosterUnreadable ||
      [...current.values()].some((agent) => !agent.status || agent.seconds === null) ||
      (!rosterSettled && [...agentWidgets.keys()].some((name) => name !== 'Me' && !current.has(name)))
    const queuesReadable = sample.queueErrors.length === 0
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
      agentsFrozen: tableFrozen,
      queuesReadable,
      view: 'main'
    }
    renderAgents(current, tableFrozen)
    renderMonitoring(sample)
    showFrozenAgents(tableFrozen, !!missing)
    if (missing) {
      return
    }
    if (gap > FRESHNESS_WINDOW_MS) freshness.clear()
    let alertsFresh = true
    // Individual status checks protect alerts; Monitoring reads only the three queue rows.
    for (const agent of selfInG1 ? [me] : agents) {
      const signature = `${agent.status}|${agent.timer}`
      if (!observeFreshSample(agent.name, signature, now)) alertsFresh = false
    }
    const offline = root.navigator.onLine === false
    if (!queuesReadable) {
      // Unmounted queue rows invalidate their freshness; recovery needs a new live update.
      for (const queue of sample.queues) freshness.delete('queue:' + queue.name)
      syncReminder(null)
    }
    // Valid agent reads still update the footer when queue rows alone are unavailable.
    setText(lastUpdated, new Date().toLocaleTimeString('en-AU', { hour12: false }))
    if (!alertsFresh || offline) {
      clearAlert('lunch')
      syncReminder(null)
      return
    }
    for (const agent of agents) {
      const old = previous.get(agent.name)
      // A state change or reset elapsed timer marks a new status episode.
      if (
        old &&
        (normaliseStatus(old.status) !== normaliseStatus(agent.status) ||
          agent.seconds < old.seconds)
      ) {
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
    const covering = selfInG1 ? agents.filter((agent) => agent.name !== 'Me') : agents
    // Missing saved members may have signed out, but not during a list remount.
    let coverageFresh = (selfInG1 || covering.length > 0) && (!missingG1 || rosterSettled)
    // Keep cover checks separate from personal/header freshness observations.
    for (const agent of [me, ...covering]) {
      const key = 'coverage:' + agent.name
      const signature = agent.status + '|' + agent.timer
      if (!observeFreshSample(key, signature, now)) coverageFresh = false
    }
    let waitingFresh = false
    for (const queue of queuesReadable ? sample.queues : []) {
      const key = 'queue:' + queue.name
      // Caller count and age together detect both queue updates and replacement calls.
      const signature = queue.waiting + '|' + queue.waitSeconds
      const liveQueue = observeFreshSample(key, signature, now)
      if (callerWaitReached(queue, waitingAlertSeconds, selfInG1) && liveQueue) waitingFresh = true
    }
    const decision = groupRules(agents, sample.queues, me, waitingAlertSeconds, selfInG1)
    // An otherwise eligible condition stays silent unless both roster and queue are live.
    decision.critical = decision.critical && queuesReadable && coverageFresh && waitingFresh
    if (decision.critical) {
      clearAlert('lunch')
      syncReminder(coverReminder(me, covering, selfInG1))
    } else syncReminder(null)
    if (selfInG1) return
    // Informational break sounds occur once per observed break episode, only in G2.
    const newBreaks = decision.lunch.filter((name) => !lunchLatched.has(name))
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
      newBreaks.forEach((name) => lunchLatched.add(name))
    }
  }
  function safeScan () {
    if (destroyed) return
    // Message expiry continues even when 8x8's agent or queue information is unavailable.
    expireNotifications()
    try {
      const docs = getReadableDocuments()
      // Call capture and finalisation do not require the queue or roster panels.
      trackCallHistory(docs)
      // Statistics are independent of the queue view and continue even while muted.
      countCalls(docs)
      // Short-break totals use only the user's own native clock, independently of queue visibility.
      countShortBreaks(docs)
      scan(docs)
    } catch (e) {
      // A reader failure cannot conceal Call Notes or leave an old personal view interactive.
      compactKind = ''
      lastSample = {
        ...lastSample,
        me: null,
        agents: [],
        queues: [],
        unavailable: true,
        agentsFrozen: true,
        queuesReadable: false,
        view: 'main'
      }
      callerInput.disabled = notesInput.disabled = true
      renderAgents(new Map(), true)
      showFrozenAgents(true)
      setText(monitorState, 'Queue data unavailable. Open 8x8 queue information.')
      monitorState.setAttribute('data-state', 'unavailable')
      setText(queueCountLabel, 'Last read callers waiting')
      console.warn('Service Desk 8x8 Assistant:', e.message)
    }
  }
  function syncMute () {
    for (const button of [muteButton, compactMute, callMute]) {
      buttonIcon(button, [
        'M11 5 6 9H3v6h3l5 4V5Z',
        ...(muted ? ['m16 9 5 6m0-6-5 6'] : ['M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'])
      ])
      button.setAttribute('aria-label', muted ? 'Unmute' : 'Mute')
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
  muteButton.onclick = compactMute.onclick = callMute.onclick = toggleMute
  syncMute()
  minimize.onclick = () => {
    content.classList.toggle('hidden')
    const collapsed = content.classList.contains('hidden')
    minimize.textContent = collapsed ? '+' : '-'
    minimize.title = collapsed ? 'Restore assistant' : 'Minimise assistant'
    minimize.setAttribute('aria-label', minimize.title)
    windowResizer?.apply()
  }
  function createWindowResizer () {
    const key = 'service-desk-8x8-window-size-v1'
    let preferred = null
    let drag = null
    try {
      const value = JSON.parse(settingsStorage.getItem(key) || 'null')
      if (Number.isFinite(value?.width) && Number.isFinite(value?.height)) preferred = value
    } catch {}
    const grip = createElement('button', '', shadow, 'resize-handle')
    grip.type = 'button'
    grip.setAttribute('aria-label', 'Resize assistant')
    grip.title = 'Drag this corner to resize. Arrow keys resize; double-click or Home resets the size.'
    buttonIcon(grip, ['M5 15V5h10M5 5l14 14'])
    // The corner hit area has its own sizing; it is not one of the footer icon buttons.
    grip.classList.remove('icon-button')
    const bounds = () => ({ width: Math.max(180, (root.innerWidth || 1024) - 36), height: Math.max(160, (root.innerHeight || 768) - 36) })
    function fitted (size) {
      const max = bounds()
      return {
        width: Math.max(Math.min(340, max.width), Math.min(max.width, size.width)),
        height: Math.max(Math.min(480, max.height), Math.min(max.height, size.height))
      }
    }
    function apply () {
      const compact = panel.classList.contains('compact') || content.classList.contains('hidden')
      const size = preferred ? fitted(preferred) : null
      panel.style.width = size ? size.width + 'px' : ''
      panel.style.height = size && !compact ? size.height + 'px' : ''
      panel.classList.toggle('resized', !!size && !compact)
    }
    function persist () {
      try { settingsStorage.setItem(key, JSON.stringify(preferred)) } catch {}
    }
    function removeDragListeners () {
      root.removeEventListener?.('pointermove', move, true)
      root.removeEventListener?.('pointerup', finish, true)
      root.removeEventListener?.('pointercancel', cancel, true)
      root.removeEventListener?.('keydown', cancelKey, true)
    }
    function finish (event) {
      if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return
      try { grip.releasePointerCapture?.(drag.id) } catch {}
      drag = null
      grip.classList.remove('resizing')
      removeDragListeners()
      persist()
    }
    function cancel (event) {
      if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return
      preferred = drag.original
      finish(event)
      apply()
    }
    function cancelKey (event) {
      if (event.key === 'Escape') { event.preventDefault(); cancel() }
    }
    function move (event) {
      if (!drag || event.pointerId !== drag.id || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
      event.preventDefault()
      // The bottom-right anchor stays fixed while the top-left corner follows the pointer.
      preferred = fitted({ width: drag.width + drag.x - event.clientX, height: drag.height + drag.y - event.clientY })
      apply()
    }
    grip.onpointerdown = (event) => {
      if (destroyed || (event.button !== undefined && event.button !== 0) || event.isPrimary === false) return
      event.preventDefault()
      event.stopPropagation()
      const rect = panel.getBoundingClientRect?.()
      const size = preferred ? fitted(preferred) : { width: rect?.width || 470, height: rect?.height || 600 }
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ...size, original: preferred && { ...preferred } }
      try { grip.setPointerCapture?.(event.pointerId) } catch {}
      grip.classList.add('resizing')
      root.addEventListener?.('pointermove', move, true)
      root.addEventListener?.('pointerup', finish, true)
      root.addEventListener?.('pointercancel', cancel, true)
      root.addEventListener?.('keydown', cancelKey, true)
    }
    function reset () { preferred = null; persist(); apply() }
    grip.ondblclick = reset
    grip.onkeydown = (event) => {
      if (event.key === 'Home') { event.preventDefault(); reset(); return }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const rect = panel.getBoundingClientRect?.()
      const size = preferred || { width: rect?.width || 470, height: rect?.height || 600 }
      const step = event.shiftKey ? 50 : 10
      preferred = fitted({
        width: size.width + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
        height: size.height + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)
      })
      persist()
      apply()
    }
    root.addEventListener?.('resize', apply)
    apply()
    return { apply, destroy: () => { removeDragListeners(); root.removeEventListener?.('resize', apply); grip.remove() } }
  }
  function destroy () {
    if (destroyed) return
    // Set the shutdown flag before async output changes can resume sounds or save devices.
    saveStatistics()
    saveShortBreaks()
    saveHistoryEdit(false)
    saveCallHistory()
    const finalFileSave = automaticData?.stop()
    if (finalFileSave) {
      // A close followed immediately by a manual rerun still waits for this instance's final save.
      const handoff = { promise: finalFileSave, session: automaticData.session }
      root.__itsCallAssistDataShutdown = handoff
      Promise.resolve(finalFileSave).catch(() => {}).finally(() => {
        if (root.__itsCallAssistDataShutdown === handoff) delete root.__itsCallAssistDataShutdown
      })
    }
    windowResizer?.destroy()
    root.removeEventListener?.('pagehide', saveStatistics)
    root.removeEventListener?.('pagehide', saveShortBreaks)
    root.removeEventListener?.('pagehide', finaliseCallNotes)
    root.removeEventListener?.('beforeunload', finaliseCallNotes)
    doc.removeEventListener?.('visibilitychange', saveHiddenData)
    destroyed = true
    root.clearTimeout(transferMessageTimer)
    root.clearInterval(interval)
    mediaDevices?.removeEventListener?.('devicechange', audioDeviceChanged)
    for (const key of [...sounds.keys()]) stopSound(key)
    for (const observer of observers.values()) observer.disconnect()
    for (const notice of notices.values()) notice.close()
    noticeTimes.clear()
    reminderLifetimes.clear()
    for (const pageDocument of interactionDocs) {
      pageDocument.removeEventListener('pointerdown', enableAlerts, true)
      pageDocument.removeEventListener('keydown', enableAlerts, true)
    }
    audio?.close().catch(() => {})
    secondaryAudio?.close().catch(() => {})
    host.remove()
    delete root.__itsCallAssist
    stopStorageStatus?.()
    deployment?.onDestroy?.()
    return finalFileSave
  }
  remove.onclick = destroy
  // Polling advances time displays even when no mutation event fires.
  const interval = root.setInterval(safeScan, SCAN_INTERVAL_MS)
  root.__itsCallAssist = { destroy, inspect: () => lastSample }
  root.__itsCallAssist.version = VERSION
  function finaliseCallNotes () {
    saveHistoryEdit(false)
    saveCallHistory()
    automaticData?.flush()
  }
  function saveHiddenData () {
    // Hidden/pagehide events are only extra opportunities; ongoing saves cover unannounced crashes.
    if (doc.visibilityState === 'hidden') automaticData?.flush()
  }
  root.__itsCallAssist.finaliseCallNotes = finaliseCallNotes
  // Packaged builds can show the saved notes directly from the extension toolbar.
  root.__itsCallAssist.openCallNotes = () => historyButton.onclick()
  // Return copies so restart support and inspection cannot mutate internal state.
  root.__itsCallAssist.wrapUpSession = () => (wrapUpSession ? { ...wrapUpSession } : null)
  root.__itsCallAssist.statistics = () => ({
    day: statistics.day,
    total: statistics.calls.length,
    calls: [...statistics.calls],
    hadGaps: statistics.hadGaps
  })
  root.__itsCallAssist.shortBreakStatistics = () => ({
    day: shortBreaks.day,
    seconds: shortBreaks.seconds,
    minutes: Math.floor(shortBreaks.seconds / SECONDS_PER_MINUTE)
  })
  // Data-only copies support restarts without exposing mutable draft/record objects.
  root.__itsCallAssist.callHistorySession = () => JSON.parse(JSON.stringify(callHistory))
  root.__itsCallAssist.dataFileSession = () => automaticData?.session() || null
  // Preserve the latest observed call count when the page closes or navigates away.
  root.addEventListener?.('pagehide', saveStatistics)
  root.addEventListener?.('pagehide', saveShortBreaks)
  root.addEventListener?.('pagehide', finaliseCallNotes)
  root.addEventListener?.('beforeunload', finaliseCallNotes)
  doc.addEventListener?.('visibilitychange', saveHiddenData)
  windowResizer = createWindowResizer()
  prepareSound()
  safeScan()
  refreshAudioDevices()
  if (!deployment && typeof root.showSaveFilePicker === 'function') {
    automaticData = createAutomaticData()
    automaticData.start()
  }
})()
