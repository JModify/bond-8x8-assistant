# Technical guide

Detailed alert rules, browser behaviour, storage, audio routing and development notes. For setup and everyday use, start with the [README](README.md).

Author: **Joshua Lavagna-Slater** | Current prototype version: **1.1.7**.

The current JavaScript prototype is [Service-Desk-8x8-Assistant.js](Service-Desk-8x8-Assistant.js). It is run through Edge's DevTools **Snippets** feature; that browser label does not make it an installed extension.

The intended deployment is an organisation-approved Microsoft Edge extension. `releases/edge-extension/1.0.0/extension/` contains the single, separately versioned development/test package, not a published or approved deployment. Approval and distribution must be arranged before team installation as an extension. Historical source filenames and snapshots stay unchanged; earlier references to a "script" describe this prototype.

## Running the prototype

1. Open your existing logged-in `vcc-au2.8x8.com` page in Edge.
2. Open Developer Tools → Sources → Snippets.
3. Paste the complete prototype code into a saved snippet and press Ctrl + Enter.
4. Open 8x8's queue information using the button immediately to the right of your status at the top of the page, next to the bell icon.
5. Queue monitoring automatically uses **ITS Academic Hotline**, **ITS Internal TRNFR** and **ITS Service Desk**. Keep these queues rendered for live waiting counts.
6. In 8x8, open **Groups → Filter icon**, select your service desk group, then tick **every status under User status**. This allows the assistant to see agents in all states, rather than treating a filtered list as the whole phone group.
7. Select the agents covering phones in the assistant's **G1** column. Tick **Me** when you are covering phones.
8. Click **Settings** to adjust reminder timing, lunch length and desktop notifications. Open **Sound Settings** from that menu to customise audio, choose the assistant's output device and optionally enable **Secondary Ringer**.
9. During a call, optionally enter the caller's staff name or student number and notes in the assistant's **On call** view. Open **Call Notes** to the left of the speaker and Settings icons, or from the on-call shortcut, to review records and return to your draft.

If the assistant says **Agent information frozen**, complete steps 4–6 so your own status and the complete agent list are readable. The assistant keeps its last-read table and menus open while you restore the view. If Monitoring says **Queue data unavailable**, scroll back to the three configured inbound queues for live counts and phone-cover alerts.

The prototype starts monitoring immediately. The page can remain in the background, but it must stay open. A page refresh or browser restart requires running the saved snippet again. Browser audio may need a click in the page before it can play. Background tab throttling or freezing can delay detection.

## Groups and reminders

**G1** is the group covering phones. Everyone not ticked in G1 is automatically **G2**.

When you are in G2, the assistant monitors G1 break status and waiting callers, and tells you when extra cover is needed. When you are in G1, it requests phone cover from Working Offline only when a caller has waited long enough and no other G1 member is Available. Other Work is permitted without this availability alarm. **Lunch and disposition reminders apply in both groups**, including when no agents are selected in G1.

G1 selections are saved user choices. They change only when you tick or untick a checkbox. Navigating, filtering, scrolling, refreshing the page or rerunning the snippet does not clear them. The earlier bug deleted a selection whenever its row disappeared from the rendered list; 8x8 can temporarily remove those rows without the agent signing out.

An absent agent's row is removed after the complete visible roster settles, while their saved G1 choice is retained. When the agent returns, their checkbox restores its previous value. Previously unseen agents start in G2. Hidden or virtualised list fragments cannot prove someone signed out or is unavailable; missing coverage information suppresses queue alerts. Me always appears first with the same row styling as other agents.

### Frozen agent information

Missing own presence, hidden/partial Groups lists, unreadable timers or ambiguous rows freeze the displayed table at its last complete readable snapshot. Names, statuses, timer text and status colours are retained; cached times are never increased or replaced with blank values. An amber **Last read** badge and **Agent information frozen** card show the last successful read and tell you to open 8x8 queue information. The card sits beneath the current menu heading, remains visible when minimised and disappears automatically on recovery. Starting without data shows **Not yet read** and an unknown timer rather than an invented status.

**Call Notes** remains accessible, including search, record editing, deletion/Undo and TXT import/export. A data gap does not cancel or save an active record editor, replace its input nodes or move its scroll position. Settings, mute and manual sound previews also remain usable. Cached other-agent G1 checkboxes are disabled until a readable complete table returns; Me can change their own role when their native presence is still readable. Recovery refreshes statuses and timers immediately, while sign-out pruning retains its existing settling check and never erases saved G1 choices. The display snapshot is in memory; rerunning or refreshing without readable data can show Not yet read, but saved Call Notes remains in the tab session.

Freezing the table is separate from queue monitoring and alert eligibility. Readable queues can continue updating their total and Live badge even while the table is frozen; unreadable queues keep their labelled last-read total. Cached agent/queue data never supplies an alert condition. Missing data required by a particular alert stops its sound, notification and reason card, and recovery needs fresh native observations. An unrelated G2 row's bad timer does not stop an otherwise valid G1 cover alert. Valid native lunch, short-break, disposition and on-call views keep working without Groups. Observed Busy-start counters also continue when the own status remains readable. When both agent and queue data are missing, the footer's Last updated stops advancing until a readable source returns.

An explicitly opened Call Notes menu survives a temporary connected-call card gap and stays open when that same call returns. A real break or disposition state retains its compact-view priority. A reader exception also leaves menus open, disables the stale on-call fields, marks monitoring unavailable and preserves the last-read table until a later scan succeeds.

There is one phone-cover alert, with a repeating two-tone alarm by default:

- **Me in G2:** you are not Available, a caller has waited at least the configured delay, and every signed-in G1 member is unavailable: Busy, On Break, Working Offline, Other Work or completing disposition. At least one signed-in agent must be ticked in G1.
- **Me in G1:** you are Working Offline, no other signed-in G1 member is Available, and a caller has waited strictly longer than the delay. This also applies when Me is the only signed-in G1 member. Working Offline alone does not trigger an alarm. Available, Busy and Other Work do not trigger this alert in G1.

Becoming Available, an available G1 member, or no caller waiting long enough clears the alert. In G1, leaving Working Offline also clears it. Work Offline is recognised as the same status label. The earlier informational Caller Waiting sound remains removed.

The delay uses each inbound queue's **Longest waiting time**, not an agent's time on Busy. Missing or stale waiting times do not produce guessed call ages. G1 break information and personal lunch/disposition reminders remain separate from the phone-cover alert.

| Sound | When it plays |
| --- | --- |
| Info: G1 On Break | You are in G2 and a selected, signed-in G1 member is On Break. Includes someone already on break when monitoring starts; suppressed during a phone-cover alert. |
| Alert: Change Status To Available | The appropriate G1 or G2 phone-cover condition above is met. |
| Alert: Complete Disposition | Your disposition time exceeds Disposition Reminder Delay, in G1 or G2. Stops when you leave disposition. |
| Alert: Lunch Break Finished | Your break is labelled Lunch and exceeds Lunch Break Length, in G1 or G2. Stops when you leave Lunch. Never plays for Short Break. |

Waiting-call monitoring uses the built-in **ITS Academic Hotline**, **ITS Internal TRNFR** and **ITS Service Desk** queues. Outbound queues are excluded. Queue names cannot be edited in Settings; older saved queue preferences and configured copies of the prototype cannot change the monitored queues.

Monitoring shows one combined **Callers waiting** total. Statistics appear as three cards in a horizontal row. **Last updated** at the bottom records the latest assistant update, alongside **Version**. The author stays under the title. Working Offline appears in orange.

The Monitoring status uses only the three inbound queue rows. **Live** means their numbers can be read from the page; unchanged counts, empty queues, agent timers in seconds/minutes/hours, G1 choices and assistant menu changes do not make it wait for an update. Missing or inconsistent counts show **Queue data unavailable**, an unreadable waiting caller's age shows **Waiting for caller time**, and an offline browser shows **Waiting for connection**. Alerts retain their separate status and caller-time checks: a readable count alone cannot trigger a phone-cover sound. This status describes the queue reader, rather than confirming 8x8's connection to its server.

The main panel fits the available height without an outer scrollbar. Its agent table can scroll when there are many agents, and long lists of names can scroll inside their reminder card; the footer and controls stay visible. Settings and Sound Settings retain their separate scrollable menus.

8x8 uses a virtualised queue list: scrolling can remove offscreen rows from the rendered HTML. Rows outside the viewport are still readable if they remain in the DOM, but unmounted rows provide no live data. The assistant stays open when queue rows disappear, continues roster updates and call counting, and marks the displayed count **Last read callers waiting**. Queue-dependent cover alerts stop until all three queue counts and fresh waiting times return. A cached count never supplies a caller's current waiting time. The assistant does not change 8x8's scrolling, inspect private application state or make additional requests to recover missing rows.

Current reminders appear in prominent Info or Alert cards directly above the footer. Each card names the sound, explains the actual trigger and shows whether its sound is playing, finished or muted. Cards remain visible when the assistant is minimised or Settings is open. Finite sound and preview cards show Sound finished, then close after Notification Display Time. Muted or unavailable finite playback still has a bounded lifetime. Expired finite messages do not reappear during polling of the same condition. Repeating alert cards stay visible while their condition remains active, but their desktop popup closes after the configured time. Changing the display time applies to existing messages; expiry continues through data gaps or reader errors and uses wall-time deadlines after timer throttling. Manual Stop preview or leaving Sound Settings clears its card immediately. Previews never send a desktop notification.

The prototype reads page information, records the optional identifier you enter in its own field, and alerts you. It does not change your status, select disposition fields, or answer calls.

## Call Notes

While a connected call is visible, the assistant shows its telephone number, queue, native call duration and Connected/On hold state. The **Caller name or student number (optional)** field accepts free text and preserves leading zeros. A separate **Notes (optional)** field accepts multiline notes. The assistant never substitutes 8x8's display name for your entry.

The call is saved when the actual **Wrap up** state appears. Simply opening 8x8's Disposition tab while talking does not finalise it. A blank or whitespace-only identifier becomes **Unknown**. Both fields keep their drafts and caret through normal timer updates, changes to Info/Notes tabs, DOM replacement, muting, G1 changes and prototype reruns. The on-call **Call Notes** shortcut opens earlier records and note totals; **Back** restores the current caller fields. The disposition timer takes priority when the call finishes.

| Saved detail | Source |
| --- | --- |
| Caller name or student number | Your optional entry; Unknown when blank |
| Notes | Your optional multiline entry; shown directly on each saved record |
| Job Number | Your optional entry in a saved record's editor, such as INC1234567 or REQ123456 |
| Caller type (prediction) | Student for exactly 6–9 digits; Staff when the entry contains letters; Unknown otherwise |
| Phone number | The active call's Phone number field or readable number heading |
| Queue | The active call's labelled Queue field |
| Duration | The native interaction clock, confirmed by the final call timer at Wrap up |
| Queue wait | The active call's Queue wait duration field |
| Call reference | The Transaction ID, used to keep each interaction separate |
| Channel and channel number | The active call's labelled channel fields, under More details |
| Hold segment | The last readable On hold timer, under More details; not total hold time |
| Detected and saved times | When the assistant first detected the call and finalised its record |

Call Notes lists completed records newest first, grouped by Brisbane date. Undated imports appear under **Call date unknown** after dated calls. Search by name, student number, notes, job number, phone number, queue or call reference. Telephone searches accept spaces and punctuation. Long lists scroll while the heading, search, transfer buttons and statistics remain accessible. Notes and job numbers are visible without expanding **More details**, which contains reference, channel information and saved time. The four note statistics count all saved records: Total notes, Students (predicted), Staff (predicted), and Missing job numbers. Search filters do not change these totals. Saving an edit, adding/importing/deleting a note or using Undo updates them. Observed call statistics stay on the main menu and remain independent.

Click the **pen** in the top right of a saved call to edit its name/ID, notes and Job Number. It changes to a **tick**. The tick, clicking outside the record, **Back**, another record's pen or leaving the view saves all fields. Search, personal-state transitions, page navigation, closing the assistant and prototype reruns also finalise the editor. Only one record is editable at a time. Enter saves from the name/job field; notes retain multiline Enter and use Ctrl+Enter (or Command+Enter) to save. **Escape** cancels explicitly. A blank name becomes Unknown. Polling preserves the input nodes, text and caret. Saving changes only user-entered fields and the derived prediction; native timings and statistics remain unchanged.

Use **+ Add note** to open an in-person draft in the same card editor. Enter a name/student number, notes and job number; the tick, clicking away or Back saves it. Escape or Cancel discards an unsaved new note. A second Add click focuses the existing draft. Manual records have an **In person** badge and source `manual`; they record actual added/saved timestamps but never fabricate a phone number, queue, call reference or duration. They work without live 8x8 information, retain their source through session restoration and TXT transfers, and never enter the native call-capture guard ledger or observed call counter. A reserved local sequence number prevents collision with an active call.

The **bin** deletes a saved note immediately. **Undo delete** restores the latest deletion while this assistant remains open. Deleted/restored confirmations disappear after five seconds; Undo remains available. New messages cancel older confirmation timers. Deletion does not reduce the observed call counter. The native transaction ledger and current completed-interaction guard survive deletion and session restoration, preventing an old Wrap up or lingering Busy card from recreating the deleted record or counting it again.

**Caller type (prediction)** appears under **More details**. An exact 6–9-digit entry suggests Student, including leading zeros. A name or username containing letters suggests Staff. Blank, Unknown and other unmatched entries predict Unknown. This is only a guess from what you enter: entering a student's full name can produce a Staff prediction. It updates when an edit is saved and is also derived for older records when they are restored. This release does not add sorting by prediction.

Call Notes and unfinished drafts use [browser tab session storage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage), separate from durable assistant settings. They survive refreshes and prototype reruns within the tab's page session; browser session restoration may restore them too. Normal tab/session closure ends these notes unless you export a copy. If session storage is blocked or full, recording still works in memory and can survive a prototype rerun, but a refresh cannot recover that copy. Caller details are never placed in localStorage preferences/statistics or sent to GitHub, Library or an external service. Local TXT files are written or read only when you choose Export/Import.

Capture requires a readable connected phone card. A Busy header or incoming-call offer alone is not enough to create a detailed record. Previously unseen completed calls cannot be reconstructed. Hidden or ambiguous card data cannot attach a name to an arbitrary interaction; previously readable details are retained rather than erased. Repeated references do not create duplicate records. Completed-call and Wrap up markers take priority during partial page updates, and a finished interaction stays guarded even when its Info fields disappear. A lingering Busy header or active clock cannot turn disposition into a new Unknown call or increment the counter again. A distinct new connected reference or number, or a confirmed return to idle, permits the next interaction. If no such evidence is readable, the assistant cannot reliably distinguish a new call from the old card. If Wrap up is missed but a readable idle state proves the call ended, the record retains its last known duration as **≥** that time; unknown values stay unavailable. Busy, hold and disposition timers never substitute for call duration. These limitations also mean calls outside the assistant's observed period may be missing.

Since 1.1.3, disposition duplicates are prevented. Existing saved records and daily counts are retained; the assistant cannot reconstruct the correct earlier total. Unwanted records can now be deleted manually.

### TXT import and export

**Export TXT** includes every saved record, including those hidden by search. It does not finalise a live on-call draft. Where permitted, the [File System Access Save As picker](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#write_the_file_to_the_local_file_system) lets you choose the filename and location. The picker opens directly from the click, and the write succeeds only after the stream closes. Cancellation writes nothing. If the picker is unsupported, Export starts a normal TXT download; if permission or writing fails, an explicit **Download TXT** fallback appears. Its location is controlled by Edge's download settings. No browser policy or download setting is changed.

The UTF-8 export uses Windows CRLF endings and 20-dash separators. Each record starts with its name/ID, optional multiline notes and its job number (or **NO JOB NUMBER**), followed by **[Call details]** and labelled metadata. For example, the basic portion is:

```text
--------------------
Alex Example
Helped restore account access.
Caller confirmed the issue is resolved.
INC1234567
--------------------
Unknown
NO JOB NUMBER
--------------------
```

Assistant exports also include a stable record key, original entry number, source, detected/saved timestamps, phone/queue/reference/channel details, native durations, the full-duration flag and caller prediction. Text metadata is quoted to distinguish literal text from unknown values. Separator-like note lines, the details marker and leading backslashes are escaped with a leading backslash and restored on import. Times retain milliseconds; unknown values and duration lower bounds keep their meaning. Original entry numbers survive import even when fresh local row numbers are needed to avoid collisions. Predictions are recalculated from the name/ID.

**Import TXT** opens a local file selector. It adds records after validating the entire file and never overwrites an existing record with the same exported key. Reimporting an assistant export skips known keys. Simple legacy files accept separators of 20 or more dashes, multiline notes, optional labels and ticket prefixes beyond INC/REQ, including IMS. Empty templates are ignored. A missing name line or empty labelled name becomes Unknown; missing notes/job fields stay empty. Legacy records have no guessed call dates, queue details or durations. UTF-8 (with or without BOM) and BOM-marked UTF-16 little/big endian Notepad files are accepted.

Repeated legacy imports compare full record contents as a multiset: two identical entries in one file remain two calls, while importing that same unchanged file again skips existing copies. An edited legacy entry may differ enough to import as another record; legacy text has no stable identity. Imports and deletions do not change observed call statistics, and imported transaction references never populate the native capture guard ledger or interfere with an active call draft.

Imports are limited to 5 MB and 2,000 nonempty records at a time. Caller identifiers allow 160 characters, notes 20,000 characters and job numbers 80 characters. Oversized, binary or invalid structured data fails before records are added. Imported content is rendered as text, never executed. Closing/replacing the assistant rejects late file reads or picker results. Cancelled/failed transfers leave existing records intact and do not play sounds or send notifications.

## Timing settings and compact reminders

Lunch Break Length is recorded in whole minutes. Reminder delays and sound durations use seconds.

| Setting | Default | Allowed range |
| --- | ---: | ---: |
| Lunch Break Length | 30 minutes | 1–120 minutes |
| Disposition Reminder Delay | 20 seconds | 1–120 seconds |
| Caller Waiting Alert Delay | 180 seconds | 1–3600 seconds |
| Notification Display Time | 5 seconds | 1–300 seconds |

Lunch length has a slider and an exact minutes field; its current value appears only in the editable field, without printed slider bounds. Existing second-based lunch settings convert to the nearest whole minute, within the supported range. The former Extra Phone Cover Delay becomes Caller Waiting Alert Delay with its saved duration retained. The old 10-second disposition default upgrades once to 20 seconds; other saved delays are preserved, and newly chosen values remain unchanged on later runs.

While you are on **Lunch** or completing disposition, the assistant shows a compact progress bar with elapsed time, time left, the allowance and a small speaker button for Mute/Unmute. Lunch labels use minutes, including overdue and accessible progress text; disposition uses seconds. Any active reminder's explanation appears below the bar. Its colours match the main panel; a gentle shimmer becomes an orange pulse when overdue. Reduced-motion preferences are respected. The main menu returns when you leave that state. These reminders work in **G1 and G2**, without needing queue information. Changing group membership does not cancel a reminder for an ongoing personal state.

The break reader uses 8x8's `on-break-timer`, including `MM:SS` and `H:MM:SS` values, and checks the reason label beside it. **Lunch** uses the lunch allowance; **Short Break** never does. An unknown or conflicting reason shows a generic break timer without a lunch alarm.

**Short Break** opens a separate teal view showing **Short breaks today** and **This short break**, both in completed minutes. A gently animated bar shows progress toward the next minute. Measured seconds carry across breaks, so two partial minutes can make one full minute; totals survive prototype reruns and are saved in this browser when storage is permitted. The daily total resets at Brisbane midnight and splits an ongoing break at that boundary. An already-running short break contributes its readable native elapsed time for today. Earlier breaks that were never observed cannot be reconstructed, and an unreadable or unchanged clock never adds guessed wall time. Mute does not stop counting. No short-break alarm is added.

The disposition reader requires the actual **Wrap up** state and its `progress-timer`. Merely opening the Disposition tab during a call does not start a reminder. [8x8's post-processing clock counts down](https://docs.8x8.com/8x8WebHelp/contact-center/agent-workspace/Content/aw/answer-incoming-calls.htm), and its other interaction timer describes the completed call. The assistant therefore measures its own disposition interval from the first observed Wrap up page, using decreases in the native countdown to catch up. Re-running the prototype retains an observed ongoing interval; starting it after disposition has already begun cannot recover the unseen start time. An expired native countdown does not silence a reminder while the Wrap up page is still open.

## Testing desktop notifications

Allow the site manually in Microsoft Edge:

1. Open **Settings → Privacy, search and services → Site permissions → All permissions → Notifications**.
2. Under **Allowed to send notifications**, select **Add site**.
3. Enter **https://vcc-au2.8x8.com**, then select **Add**.

In **Settings → Desktop Notifications** in the assistant, turn on notifications and click **Test desktop notification**. This temporary diagnostic button sends one popup without an alert tone. It does not request permission automatically. It reports missing permission, unsupported browsers and failed requests. A successful send cannot guarantee that the operating system displayed the popup; check browser and computer notification settings if it did not appear.

Notification tests remain usable while muted, and are disabled when desktop notifications are switched off.

Each sound in **Sound Settings** has its own **Send desktop notification** checkbox. Notifications require both this choice and the global setting to be on, with browser permission already granted. Existing sound choices are preserved, and each new notification checkbox defaults on to retain previous behaviour. Switching a sound's notifications off closes its existing popup without stopping the tone or hiding its reason. Previews never send popups.

## Audio devices

**Settings → Sound Settings → Audio Devices → Output Device** routes only the assistant's generated sounds. It does not change 8x8's call audio or system-wide devices. The default entry is labelled **(Default)**; browser-exposed device names appear after Refresh devices. Choose output device can request an output selection where that browser API is available.

**Secondary Ringer** defaults off. Turn it on in the same Audio Devices section to reveal **Secondary Ringer Device**, then select the second speaker or headset. All assistant reminders and previews play through both outputs, using the same sound, volume, duration and repeat setting. **Mute** silences both. Turning Secondary Ringer off leaves the main output playing and remembers the second device for next time. Both device choices and the toggle are saved with the other assistant settings.

Selecting the same device for both outputs plays each tone once. The assistant also recognises Default and Communications aliases when the browser supplies their matching device group. If the browser does not expose this relationship, choose two visibly different devices. Enabling or changing the secondary output during a sound keeps the original sound deadline and does not restart the main output or resend a desktop notification. Both selectors remain usable while muted.

Output selection uses [AudioContext.setSinkId](https://developer.chrome.com/blog/audiocontext-setsinkid/) on separate assistant-owned contexts. Availability and visible devices depend on browser support and permission. The assistant never opens a microphone to discover speakers. Unsupported browsers keep system-default output and disable Secondary Ringer. A removed selected device falls back to the system default, and a failed switch keeps the previous output. A secondary routing failure leaves the main output usable. Where supported, **Choose secondary ringer device** requests permission for that output only. Desktop notification audio remains controlled by the browser and operating system.

## Statistics

- **Calls taken today:** the number of Busy starts detected by the assistant today. A Busy period already in progress when counting starts is counted once.
- **Calls in the last hour:** detected Busy starts within the previous 60 minutes.
- **Last call detected:** the time the most recent Busy start was detected.

Statistics use the Australia/Brisbane day boundary. They are saved in this browser's 8x8 site storage when storage is available. Re-running the prototype preserves the daily total and does not count a continuing Busy period again. The daily total resets at midnight; a Busy period crossing midnight is not counted again solely because the date changed.

This is an observed Busy-start counter, not an 8x8 historical reporting API. Other interaction types that use Busy cannot be distinguished from calls using status alone. Calls that start and finish entirely while your own status is unreadable, or while the assistant is closed, cannot be reconstructed. Missing information is never treated as proof of a call ending. A timer reset alone is not counted as another call. Statistics indicate when status information was unreadable.

The counter works independently of queue visibility. It can count a Busy transition when queue information is hidden or the status timer cannot be read, as long as the user's own status label remains readable.

## Mute, minimise and close

**Mute** stops all assistant tones and previews. Monitoring, agent updates, timers, progress animations, statistics and desktop notifications continue. Notifications created while muted request silent delivery. **Unmute** resumes any current alert; it does not repeat its desktop popup. The mute preference is saved for subsequent runs.

The **-** button minimises the main content; **+** restores it. Monitoring and counting continue while minimised. The **x** button closes the assistant and stops monitoring and counting, retaining statistics and Call Notes already saved. Closing the assistant does not end the browser tab's notes session.

Settings remain usable while muted. Preview buttons are disabled until sounds are unmuted. The compact break and disposition bars also include a speaker icon. All icon buttons have action-specific accessible names and tooltips; muted speakers change their paths and colour. The footer places Call Notes first, with space before the speaker and Settings gear. These buttons share a 32-pixel height in the main footer and on-call controls. Muted speaker icons use red.

## Releases

The previous assistant's behavior is recorded as **1.0.0**, with organisation-specific defaults extracted into local configuration. Prototype snapshots are kept in [releases/edge-prototype](releases/edge-prototype); extension packages are kept in [releases/edge-extension](releases/edge-extension), and changes are described in [CHANGELOG.md](CHANGELOG.md). Future releases increment the patch version unless the user requests another versioning change.

Starting with **1.1.1**, public release files include the three ITS queue names expressly approved by the author. Queue configuration and its editor are removed. Older release snapshots keep their original local-configuration behaviour and are not changed. Caller details, live staff information and staff defaults are never published.

The prototype's version, VERSION file, package.json, lockfile and release snapshot must agree. Prototype and extension releases are versioned separately: a prototype release leaves the development extension bundle and metadata unchanged. Extension checks validate its own recorded core hash; an explicit `--refresh-core` rebuild requires a new extension release version before changing a previously released core. GitHub is the source for subsequent releases. Version 1.1.7 was published as [Service Desk 8x8 Assistant - Prototype](https://github.com/JModify/bond-8x8-assistant/releases/tag/v1.1.7), tagged `v1.1.7`, with the exact JavaScript snapshot as a download. Its completed one-off publishing workflow has been retired. The existing tag and downloadable asset retain their original contents and commit; reorganising main does not republish or replace that release. The offline publisher checks remain in `tools/`.

## Repository layout

| Location | Purpose |
| --- | --- |
| `Service-Desk-8x8-Assistant.js` | Current prototype code used by the setup instructions. |
| `releases/edge-prototype/<version>/` | Versioned prototype snapshots. Their contents are unchanged by the folder move. |
| `releases/edge-extension/<version>/extension/` | The single extension source package for that release. There is no separate root extension copy. |
| `releases/edge-extension/<version>/*.zip` | Packaged extension download. |
| `tools/` | Repository build tools, extension update configuration and the completed prototype publisher. These are not installed in 8x8. |
| `tests/` | Simulated browser and release checks. |

The extension builder reads the newest versioned extension source and its recorded core. `npm run build:extension` stages a copy in `../output/edge-extension/<version>/extension/`; `npm run package:extension` also creates its ZIP in `../output/`. Neither command writes to a release folder. `npm run check` validates the existing canonical release directly, without building a duplicate in the repository.

For a future extension update, use an explicit new version: `npm run build:extension -- --version 1.0.1 --refresh-core`. This stages the current prototype core under the new extension version for review; it does not publish a release or change 1.0.0. The remote-update placeholder is `tools/extension-updates.json`, outside the installed package. Completed extension releases belong under `releases/edge-extension/<version>/`.

## Development checks

The browser prototype needs no installed dependencies. Development checks use Node.js 18 or newer and the pinned JavaScript Standard Style tool:

```sh
npm ci
npm run check
npm test
```

`npm run check` validates syntax and runs `npm run lint`. Current source and tests follow [JavaScript Standard Style](https://standardjs.com/). Historical release snapshots retain their original formatting; a new snapshot always matches the current source exactly.

The code separates page parsing, pure alert conditions, persistent settings, roster reconciliation, freshness checks, UI rendering and audio/notification delivery into focused helpers. Comments explain complex selectors, elapsed/countdown conversion, migration rules, asynchronous routing and lifecycle cleanup. Styles are expanded into readable CSS and remain isolated inside the panel's shadow root.

The 250 baseline prototype behavioural scenarios use a simulated 8x8 DOM, notifications, audio devices and file APIs. They cover roster/timing/queue rules, mute, routing, statistics, real Wrap up versus tabs/offers, repeated/switched references, disposition duplicates, draft/session persistence and safe text rendering. Call Notes checks include all editable fields, autosave, Escape, predictions, polling, navigation, deletion/Undo, independent capture guards, TXT round trips, legacy/UTF-16 imports, duplicates, limits, failed writes and late file results. Frozen-data checks cover complete snapshot retention, status colours/timers, partial and ambiguous lists, sign-in/out recovery, missing-data startup, independent monitoring/statistics, safe alerts, menu warnings, active editors, call-card recovery, previews, reader exceptions and TXT transfers while all native panels are hidden. The 21 v1.1.6 checks add manual draft/save/cancel/autosave/concurrent-call behaviour, source and TXT preservation, note totals, icon accessibility, finite/ongoing/muted message lifetimes, replaced deadlines and confirmation cleanup. Eleven offline release checks cover metadata and snapshots, draft/upload/publication order, retries, immutable tags and assets, annotated tags, upload integrity and local-execution/network-host guards. The 31 extension scenarios run against the unchanged extension 1.0.0 bundle in its canonical release folder, including staging a new core outside releases and rejecting refreshes of a released version or invalid output paths. The supplied Notepad example was checked privately for 1.1.4; its data is never included in fixtures or public files.

Earlier Chromium layout checks through 1.1.3 used fictional agents and fictionalised copies of the supplied break/call/disposition structures to verify caret preservation, scrolling lists, narrow/short viewports and active alerts. The new 1.1.4–1.1.7 layouts and file dialogs have not been tested in live Edge here; menu/transfer behaviour is covered by fixtures. These checks do not verify live notifications or physical audio delivery.

Secondary-ringer checks compare note patterns, volume envelopes, clock offsets and destinations across both contexts. They cover Default/Communications aliases, device loss, routing errors, muted startup, pending choices and shutdown. The 1.1.1 menu is checked at five viewport sizes using native Chromium audio graphs with simulated device choices; physical playback through two speakers must be checked on a computer with those devices.
