# Changelog

## 1.1.6 (Script) — 2026-10-14

- Added **+ Add note** to Call Notes for in-person visits. Manual entries use the existing name/ID, multiline notes and job-number editor, show an In person badge and omit unavailable phone details. The tick, clicking away, Back and navigation save; Escape/Cancel discards a new draft. Manual notes survive session restoration and TXT round trips without affecting call counters or capture guards.
- Replaced call statistics in Call Notes with Total notes, Students (predicted), Staff (predicted) and Missing job numbers. Totals follow additions, edits, imports, deletion and Undo, independently of search and the main-menu call counter.
- Added **Notification Display Time** in Assistant Settings, defaulting to five seconds. Finished finite sound/preview cards close after this delay; desktop popups also close automatically. Active repeating in-app alerts stay visible until their condition clears. Wall-time deadlines, episode suppression and stale callback checks prevent permanent or unexpectedly reappearing messages.
- Made deleted/restored confirmations disappear after five seconds while retaining Undo. Removed the per-record duration-unavailable and prediction-explanation paragraphs; the duration lower-bound marker and labelled prediction remain.
- Replaced mute/unmute and Settings text buttons with accessible SVG speaker/gear icons. Call Notes sits to their left; speaker appearance changes with mute state, including personal views.
- Kept the extension 1.0.0 bundle, images and every earlier release snapshot unchanged. Extension checks now validate its separately versioned, recorded core instead of silently replacing it during a script release.
- Validation: JavaScript syntax and Standard Style, 250 baseline script scenarios, 21 v1.1.6 scenarios and 29 unchanged-extension scenarios (300 total).

## 1.1.5 — 2026-10-14

- Replaced the blocking Unable to Assist view with a frozen last-read agent table. Missing, partial or unreadable information preserves names, statuses, timers and colours instead of clearing rows or advancing cached times.
- Added a compact Live/Last read badge and an amber Agent information frozen warning beneath the current menu heading. The warning includes the last successful read time, explains how to restore live data, stays visible when minimised and clears automatically on recovery.
- Kept Call Notes, active record editing, search, deletion/Undo, TXT transfers, Settings, mute and manual previews available throughout data gaps. Startup without data clearly shows Not yet read/unknown values.
- Separated agent reading/validation from display updates. A complete readable roster catches up to native values and retains safe sign-out settling and persistent G1 choices. Cached other-agent G1 controls are disabled until live information returns.
- Kept readable queue totals and observed call counters independent of the frozen table. Alert rules never use cached values and stop when their required native data is missing; unrelated G2 timer failures do not change valid G1 cover rules. Native personal views keep their existing priority.
- Preserved an explicitly opened Call Notes menu and its editor through temporary call-card gaps and recovery. Reader exceptions also leave menus accessible and mark unavailable data clearly.
- Validation: syntax and JavaScript Standard Style checks plus 250 behavioural scenarios, including 18 new frozen-data, recovery, accessibility, call-notes and transfer scenarios. Preserve all earlier release snapshots and redacted documentation images.

## 1.1.4 — 2026-10-13

- Renamed Call History to **Call Notes**, including its main-menu and on-call shortcuts.
- Added optional multiline on-call notes, saved with the caller identifier at Wrap up and displayed directly on each record.
- Added editable **Job Number** fields. The pen now edits the caller name/ID, notes and job together; caller predictions update on save.
- Clicking outside a record, Back or another record's pen saves changes. Search, view changes, navigation and snippet restarts also save; Escape explicitly cancels. Polling preserves typing and caret.
- Added per-record deletion with Undo. Native duplicate-call guards remain separate from deletable records, and deleting notes leaves observed call statistics unchanged.
- Added readable Notepad TXT import/export with all saved call details, multiline escaping, unknown values, original entry numbers and stable record keys. Export uses a Save As picker where permitted, with a download fallback. Import selects a local file and supports the simple legacy name/notes/job format, longer dash separators, empty templates and UTF-8/UTF-16 files.
- Imports add records, skip duplicates and preserve existing edits, active drafts and call counters. Invalid or oversized imports fail without partially adding records; late file results after closure are ignored.
- Updated the concise user guide, technical reference and development constraints. Existing redacted screenshots are labelled as v1.1.3 examples; no private attachment data is published.
- Validation: syntax and JavaScript Standard Style checks, 232 behavioural scenarios, and a private round-trip check of all four populated records in the supplied Notepad example.

## 1.1.3 — 2026-10-13

- Fix disposition creating a second Unknown history entry and another counted call when the completed card reappears without its Info/reference. Give completed-call and Wrap up markers priority over lingering active clocks, and keep a session-persistent finished-interaction guard until a distinct connected identity or confirmed idle state permits the next call. A lingering Busy header cannot count disposition again.
- Add a pen in the top right of each saved call. Edit one caller name/ID at a time; the tick or Enter confirms, while Back, another menu, Escape, filtering the record away or a personal-state view cancels the unsaved draft. Preserve typing and caret through polling and retain call timings, metadata and counts on save. Blank confirmed identifiers become Unknown; unsaved edits remain only in memory.
- Add Caller type (prediction) under More details: Student for exactly 6–9 digits, Staff for identifiers containing letters, and Unknown otherwise or for the Unknown placeholder. Preserve leading zeros, clearly explain that the prediction can be incorrect, and recompute it on saved edits and restored older records. Keep caller data in tab session storage and add no sorting in this release.
- Preserve existing records and daily totals rather than guessing which historical Unknown entries were duplicates. Retain every earlier release snapshot unchanged.
- Expand behavioural checks to 201 scenarios, including missing-reference disposition duplicates, partial markers, persistent guards, consecutive calls, editing, cancellation, prediction boundaries, safe text and privacy. Verify the supplied on-call and disposition structures with fictional caller details in Chromium at three viewport sizes, including active typing/caret, day rollover, predictions, single-editor cancellation and an 82-record scrolling history.

## 1.1.2 — 2026-10-13

- Fix Monitoring flickering between Live and Waiting for live updates. The former badge required every selected G1 agent's timer to change within 30 seconds; quiet rows and minute/hour displays could invalidate it even while all three queue counts remained readable.
- Make Monitoring depend only on ITS Academic Hotline, ITS Internal TRNFR and ITS Service Desk. Start Live as soon as their numbers are readable and retain it for unchanged or empty queues, without requiring G1 selection or agent-clock movement. Preserve connection, unavailable-queue and unreadable caller-time messages, combined counts and last-read labels.
- Keep alert conditions and their independent native status/caller-time observations unchanged. A Live badge never bypasses unreadable or stale information needed for a phone-cover alert. Preserve sound settings, secondary-ringer routing, statistics, Call History and prior release snapshots.
- Expand behavioural checks to 183 scenarios covering the original flicker, seconds/minutes/hours, unchanged counts, menu/timing/G1 edits, mute, count changes in the three inbound queues, outbound exclusion, recovery and stale-data alert guards. Verify the supplied queue markup in Chromium at three viewport sizes, including a simulated hour with unchanged counts, menu navigation, G1 edits, changing counts and inconsistent-data recovery.

## 1.1.1 — 2026-10-13

- Add Secondary Ringer under Settings → Sound Settings → Audio Devices. Default it off, reveal a separate output selector when enabled and save both its toggle and device choice. Duplicate assistant reminders and previews with matching sound, volume, duration and repeat settings, using a second assistant-owned audio context without changing 8x8 or system audio.
- Mute and close stop both outputs; turning the secondary ringer off leaves the main output uninterrupted. Retain finite sound deadlines when the second output joins, avoid duplicate playback for matching devices or browser-proven Default aliases, preserve working outputs on routing failure and fall back to Default when a selected device disappears. Reject stale changes and browser-picker results after a later choice, disabling or shutdown. Do not open a microphone to list devices.
- Embed ITS Academic Hotline, ITS Internal TRNFR and ITS Service Desk as the fixed inbound queues, as explicitly requested for public source. Remove the queue editor and configuration bootstrap requirement; ignore old stored queue names. Keep historical release snapshots unchanged and update setup instructions.
- Expand behavioural checks to 171 scenarios covering dual-output scheduling, isolation, mute and muted startup, finite previews, Default/Communications aliases, persistence, permission failures, removed devices, rapid changes and cleanup, alongside all prior monitoring and Call History checks. Verify the controls and native Chromium audio graphs at five viewport sizes using simulated output devices; physical dual-device playback is not tested by the headless fixture.

## 1.1.0 — 2026-10-13

- Add Call History between Mute and Settings. Provide a separate Back menu with newest-first records grouped by day, search for names/student numbers/telephone numbers/queues/references, expandable extra details and scrolling that keeps navigation and statistics accessible.
- Add a connected/held-call view with the native duration, telephone number, queue and optional Caller name or student number field. Keep typing, caret and unfinished drafts intact through timer updates, Info-tab changes, DOM replacement, mute, group edits and snippet restarts. Add an on-call History shortcut whose Back button restores the field.
- Save each observed call at actual Wrap up, using Unknown for blank identifiers. Read labelled call fields and native call timers; retain queue wait, reference, channel details and the last-read hold segment. Stable transaction references prevent duplicates and keep switched interactions' drafts separate. A Disposition tab, Busy icon or ringing offer alone cannot create a detailed record.
- Store records and drafts only in the browser tab's session, with an in-memory rerun fallback when storage is unavailable. Keep caller information out of durable settings, statistics, public files and external services. Preserve saved settings and every historical release snapshot.
- Retain known details when Info is hidden or fields are unreadable. Never finalise from missing HTML alone; recover an observed return to idle after a missed Wrap up with the last measured duration labelled as a lower bound. Ignore a reopened already-saved reference as evidence of another counted call.
- Show the main menu's three statistics in a compact shared strip in Call History, alongside its separate saved-session total. Add no new alert sound or desktop notification for recording.
- Expand behavioural checks to 153 scenarios. Verify the supplied on-call structure with fictional caller details in Chromium, including held calls, caret preservation, Wrap up finalisation, an 81-record history, filtering, shared statistics, active alerts and four viewport sizes; retain the existing main/break layout checks.

## 1.0.6 — 2026-10-13

- Fit the main panel without an outer scrollbar. Tighten spacing, let the agent table adjust to the available height, and keep the footer and active reminders visible. Use a compact arrangement in shorter windows; Settings and Sound Settings keep their own scrolling.
- Read the explicit Lunch or Short Break reason beside the dedicated break timer. Short Break never uses Lunch Break Length or its alarm. Missing or conflicting reasons show a generic break view without a guessed lunch reminder.
- Add a separate animated Short Break view showing today's total and the current break in completed minutes. Preserve measured seconds across breaks and snippet restarts so partial minutes accumulate. Save totals locally and reset at Brisbane midnight, assigning only today's portion of an ongoing break to the new day. Do not advance totals from unreadable or unchanged clocks.
- Display lunch elapsed, remaining, allowance and overdue time in minutes, including accessible progress values. Keep disposition in seconds. Clarify the lunch sound and setting descriptions.
- Keep the assistant open when scrolling unmounts configured queue rows. Continue roster updates, call statistics and available controls. Clearly label cached counts as last-read, stop queue-dependent cover alerts and require fresh native data on recovery. Retained offscreen DOM rows remain readable; never advance cached caller waiting times or alter 8x8's scrolling/rendering.
- Preserve saved G1 roles, sound choices, notification options, mute behaviour and all prior release snapshots. Expand behavioural checks to 118 scenarios and verify layouts in Chromium with long fictional rosters, active alerts, queue-scroll recovery and the supplied minimal Lunch/Short Break markup.

## 1.0.5 — 2026-10-13

- Make Lunch Break Finished and Complete Disposition work in G1 and G2, including when no G1 agents or queue names are configured. Update their sound explanations and timing-setting help. Keep the configured strict greater-than boundaries and notification options.
- Fix G1 selections being erased when 8x8 filters, virtualises or rebuilds agent rows. Separate saved membership from currently readable agents; only manual checkbox edits may remove a saved choice. Restore the previous role when a row returns or the snippet restarts.
- Recognise partial Virtuoso lists through padding and row indexes. Suppress queue-cover decisions when a selected agent is unreadable; allow a complete roster one polling interval to settle before removing absent rows. Keep absent members out of live coverage without deleting their saved preferences.
- Preserve active personal reminders and their timers when G1 checkboxes change, without sending duplicate desktop popups.
- Expand setup instructions to include the status-adjacent queue button, the three configured inbound names, and Groups → Filter with the service desk group and every User status selected.
- Apply JavaScript Standard Style to current source and tests. Add a pinned development linter, lockfile and npm run lint; include style validation in npm run check. Keep all older release snapshots unchanged.
- Improve descriptive names, small rule/freshness/rendering helpers, readable CSS and explanatory comments for complex parsing, timing, migration, audio and lifecycle operations.
- Expand simulated behavioural checks to 97 scenarios, including group-independent reminders and persistent membership through navigation, filtering, scrolling, row replacement and reruns.

## 1.0.4 — 2026-10-12

- Allow G1 users to use Other Work and Working Offline without an immediate availability alarm. The G1 phone-cover alert now requires Me to be Working Offline, no other signed-in G1 member Available, and a caller waiting strictly longer than Caller Waiting Alert Delay. It also works when Me is the only signed-in G1 member. Retain the G2 queue rule and separate lunch/disposition reminders.
- Move Audio Devices into Sound Settings and remove Input Device. Preserve saved assistant-only output routing.
- Add a saved Send desktop notification checkbox to each of the four sounds. Preserve previous audio choices and notification behaviour by default; respect the master notification setting and browser permission. Turning a sound's notifications off closes its existing popup while its sound and reminder continue.
- Add distinct Info, Alert and preview cards above the footer, with a plain-English reason and sound state. Keep active reminders visible in submenus, while minimised and beside the compact break/disposition bar. Previews do not send notifications; finite sounds show when they have finished.
- Remove the introductory Sound Settings paragraph. Keep author attribution under the main title and move Version beside Last updated in the footer.
- Simplify Inbound Queue Names help, use the requested Caller Waiting Alert Delay description, and remove printed lunch slider bounds and its duplicate current-value label.
- Keep lunch in whole minutes and reminder delays in seconds. Retain prior release snapshots unchanged and expand simulated behavioural tests to 86 scenarios.

## 1.0.3 — 2026-10-12

- Remove signed-out agents from the table and clear their G1 selections. Add returning and newly signed-in agents as fresh rows. Preserve selections while the whole roster is hidden by break/disposition pages.
- Keep Me first without different row shading. Add Author: Joshua Lavagna-Slater beside the version under the title.
- Restore Lunch Break Length to whole minutes, with a 1–120 minute slider and exact field. Migrate existing seconds values.
- Default disposition reminders to 20 seconds. Upgrade the old 10-second default once while preserving other custom values.
- Remove the informational Caller Waiting sound and its separate Busy-time delay setting.
- Rename Extra Phone Cover Delay to Caller Waiting Alert Delay. Use native Longest waiting time: the G2 phone-cover alert requires an aged waiting caller and every signed-in G1 member to be unavailable. Keep the existing G1 personal reminders.
- Replace Pause with Mute/Unmute in the main controls and compact bar. Keep monitoring, timers, statistics and notifications active while muted; silence tones, previews and new desktop notification sounds. Resume current repeating sounds without another popup when unmuted.
- Add the requested manual Edge notification allow-list instructions. Keep the test button and remove automatic permission prompts.
- Add assistant-only output device selection using supported browser APIs, labelled system defaults, device refresh and output picker where available. Restore saved outputs, retain the previous output on permission failures, and fall back to Default when a selected device is removed.
- Display Input Device as a disabled default because the assistant does not use a microphone. Do not touch 8x8 call devices or request microphone capture.
- Retain prior release snapshots unchanged and expand simulated behavioural checks for the new rules and audio routing.

## 1.0.2 — 2026-10-12

- Use seconds for all timing settings and sound explanations. Convert saved minute values once, preserving their durations.
- Add an exact seconds field beside the lunch slider; allow lunch lengths from 1 to 7200 seconds.
- Add a temporary desktop notification test button with permission and send-result feedback, without playing an alert sound.
- Read the dedicated On Break page timer and retain lunch reminders when queue and agent rows are hidden.
- Recognise the actual Wrap up page and measure a separate disposition interval, without using the completed call's duration or assuming an administrator's timeout.
- Show only an animated compact status bar on break and disposition pages, with elapsed, remaining and overdue time. Return to the main menu when the state ends.
- Keep personal sounds limited to users selected in G1. Freeze compact timers and animations while paused; catch up on resume.
- Keep disposition reminders active if the native countdown expires but the Wrap up page remains open.
- Show statistics in a horizontal row and simplify the visible counter explanation.
- Combine the three inbound waiting counts into one Callers waiting total. Remove the duplicate monitoring label and put Last updated in the footer.
- Show Working Offline and Work Offline in orange.
- Poll once each second for responsive countdowns. Retain the previous release snapshots unchanged.

## 1.0.1 — 2026-10-12

- Display the release version and retain immutable copies of each released script.
- Refer to agents who are not selected in G1 as Group 2 (G2).
- Remove the misleading stop-condition sentences from the two informational sound descriptions.
- Add Statistics beside Monitoring: calls taken today, calls detected in the last hour, and the last call detection time.
- Save observed Busy starts in this browser and reset the daily total at Brisbane midnight.
- Keep the call counter running while paused and while queue information is hidden, when the user's own status is still readable.
- Avoid double-counting an ongoing Busy period after unreadable status data or a snippet restart.
- Freeze the displayed agent statuses, timers, queue counts, Checked timestamp, alert checks and other statistics while paused. Resume catches up to the page immediately.
- Stop all sounds while paused, including previews.
- Keep only Pause/Resume and Settings in the bottom controls. Move minimise/restore and close to the top right.
- Move Sound Settings access inside Assistant Settings.
- Separate organisation-specific queue names and staff defaults from the public source. Queue names are configurable locally; a configured private snippet retains the existing setup.

Call counts are based on Busy starts observed by the assistant. Calls entirely missed while the status is unreadable or the assistant is closed cannot be reconstructed from the page.

## 1.0.0 — previous baseline

The previously delivered assistant's behavior is the 1.0.0 baseline. Organisation-specific defaults are extracted into local configuration in the public snapshot. It includes G1 selection, personal disposition and lunch reminders, three inbound queues, separate Sound Settings and Assistant Settings, and configurable alert timing.
