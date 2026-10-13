# Technical guide

Detailed alert rules, browser behaviour, storage, audio routing and development notes. For setup and everyday use, start with the [README](README.md).

Author: **Joshua Lavagna-Slater** | Current version: **1.1.3**.

The current snippet is [Service-Desk-8x8-Assistant.js](Service-Desk-8x8-Assistant.js).

## Running the assistant

1. Open your existing logged-in `vcc-au2.8x8.com` page in Edge.
2. Open Developer Tools → Sources → Snippets.
3. Paste the complete script into a saved snippet and press Ctrl + Enter.
4. Open 8x8's queue information using the button immediately to the right of your status at the top of the page, next to the bell icon.
5. Queue monitoring automatically uses **ITS Academic Hotline**, **ITS Internal TRNFR** and **ITS Service Desk**. Keep these queues rendered for live waiting counts.
6. In 8x8, open **Groups → Filter icon**, select your service desk group, then tick **every status under User status**. This allows the assistant to see agents in all states, rather than treating a filtered list as the whole phone group.
7. Select the agents covering phones in the assistant's **G1** column. Tick **Me** when you are covering phones.
8. Click **Settings** to adjust reminder timing, lunch length and desktop notifications. Open **Sound Settings** from that menu to customise audio, choose the assistant's output device and optionally enable **Secondary Ringer**.
9. During a call, optionally enter the caller's staff name or student number in the assistant's **On call** view. Open **Call History** between Mute and Settings to review completed calls; **History** in the on-call view lets you review earlier calls and return to your draft.

If the assistant says **Unable to Assist: Open 8x8 agent queue information**, complete steps 4–6 so your own status and required agent information are readable. Keep the full agent list rendered when monitoring the phone group. If Monitoring says **Queue data unavailable**, scroll back to the three configured inbound queues for live counts and phone-cover alerts.

The snippet starts monitoring immediately. The page can remain in the background, but it must stay open. A page refresh or browser restart requires running the saved snippet again. Browser audio may need a click in the page before it can play. Background tab throttling or freezing can delay detection.

## Groups and reminders

**G1** is the group covering phones. Everyone not ticked in G1 is automatically **G2**.

When you are in G2, the assistant monitors G1 break status and waiting callers, and tells you when extra cover is needed. When you are in G1, it requests phone cover from Working Offline only when a caller has waited long enough and no other G1 member is Available. Other Work is permitted without this availability alarm. **Lunch and disposition reminders apply in both groups**, including when no agents are selected in G1.

G1 selections are saved user choices. They change only when you tick or untick a checkbox. Navigating, filtering, scrolling, refreshing the page or rerunning the snippet does not clear them. The earlier bug deleted a selection whenever its row disappeared from the rendered list; 8x8 can temporarily remove those rows without the agent signing out.

An absent agent's row is removed after the complete visible roster settles, while their saved G1 choice is retained. When the agent returns, their checkbox restores its previous value. Previously unseen agents start in G2. Hidden or virtualised list fragments cannot prove someone signed out or is unavailable; missing coverage information suppresses queue alerts. Me always appears first with the same row styling as other agents.

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

Waiting-call monitoring uses the built-in **ITS Academic Hotline**, **ITS Internal TRNFR** and **ITS Service Desk** queues. Outbound queues are excluded. Queue names cannot be edited in Settings; older saved queue preferences and configuration snippets cannot change the monitored queues.

Monitoring shows one combined **Callers waiting** total. Statistics appear as three cards in a horizontal row. **Last updated** at the bottom records the latest assistant update, alongside **Version**. The author stays under the title. Working Offline appears in orange.

The Monitoring status uses only the three inbound queue rows. **Live** means their numbers can be read from the page; unchanged counts, empty queues, agent timers in seconds/minutes/hours, G1 choices and assistant menu changes do not make it wait for an update. Missing or inconsistent counts show **Queue data unavailable**, an unreadable waiting caller's age shows **Waiting for caller time**, and an offline browser shows **Waiting for connection**. Alerts retain their separate status and caller-time checks: a readable count alone cannot trigger a phone-cover sound. This status describes the queue reader, rather than confirming 8x8's connection to its server.

The main panel fits the available height without an outer scrollbar. Its agent table can scroll when there are many agents, and long lists of names can scroll inside their reminder card; the footer and controls stay visible. Settings and Sound Settings retain their separate scrollable menus.

8x8 uses a virtualised queue list: scrolling can remove offscreen rows from the rendered HTML. Rows outside the viewport are still readable if they remain in the DOM, but unmounted rows provide no live data. The assistant stays open when queue rows disappear, continues roster updates and call counting, and marks the displayed count **Last read callers waiting**. Queue-dependent cover alerts stop until all three queue counts and fresh waiting times return. A cached count never supplies a caller's current waiting time. The assistant does not change 8x8's scrolling, inspect private application state or make additional requests to recover missing rows.

Current reminders appear in prominent Info or Alert cards directly above the footer. Each card names the sound, explains the actual trigger and shows whether its sound is playing, finished or muted. Cards remain visible when the assistant is minimised or Settings is open. Sound previews have a separate temporary card and never send a desktop notification.

The script reads page information, records the optional identifier you enter in its own field, and alerts you. It does not change your status, select disposition fields, or answer calls.

## Call History

While a connected call is visible, the assistant shows its telephone number, queue, native call duration and Connected/On hold state. The **Caller name or student number (optional)** field accepts free text and preserves leading zeros. Enter a staff member's name or a student's number after you obtain it. The assistant never substitutes 8x8's display name for your entry.

The call is saved when the actual **Wrap up** state appears. Simply opening 8x8's Disposition tab while talking does not finalise it. A blank or whitespace-only identifier becomes **Unknown**. The field keeps its draft and caret through normal timer updates, changes to Info/Notes tabs, DOM replacement, muting, G1 changes and snippet reruns. The on-call **History** shortcut opens earlier records and statistics; **Back** restores the current caller field. The disposition timer takes priority when the call finishes.

| Saved detail | Source |
| --- | --- |
| Caller name or student number | Your optional entry; Unknown when blank |
| Caller type (prediction) | Student for exactly 6–9 digits; Staff when the entry contains letters; Unknown otherwise |
| Phone number | The active call's Phone number field or readable number heading |
| Queue | The active call's labelled Queue field |
| Duration | The native interaction clock, confirmed by the final call timer at Wrap up |
| Queue wait | The active call's Queue wait duration field |
| Call reference | The Transaction ID, used to keep each interaction separate |
| Channel and channel number | The active call's labelled channel fields, under More details |
| Hold segment | The last readable On hold timer, under More details; not total hold time |
| Detected and saved times | When the assistant first detected the call and finalised its record |

Call History lists completed records newest first, grouped by Brisbane date. Search by name, student number, phone number, queue or call reference. Telephone searches accept spaces and punctuation. Long histories scroll while the heading, search and statistics remain accessible. **More details** expands a record's reference, channel information and saved time. Opening the menu does not create another counter: its Today, Last hour and Last detected values come from the same statistics as the main menu. The separate **calls saved this session** count includes completed history records, so it can differ from the day's observed Busy-start count.

Click the **pen** in the top right of a saved call to edit its caller name or ID. It changes to a **tick**; click the tick or press Enter to save. **Back** or changing menus cancels an unsaved edit, as does Escape. Only one call can be edited at a time: opening another editor cancels the first draft. A saved edit changes only the name/ID and its prediction, leaving call times, other details and counts untouched. A confirmed blank entry becomes Unknown. Polling preserves your text and caret, and unsaved edits are never stored.

**Caller type (prediction)** appears under **More details**. An exact 6–9-digit entry suggests Student, including leading zeros. A name or username containing letters suggests Staff. Blank, Unknown and other unmatched entries predict Unknown. This is only a guess from what you enter: entering a student's full name can produce a Staff prediction. It updates when an edit is saved and is also derived for older records when they are restored. This release does not add sorting by prediction.

History and unfinished drafts use [browser tab session storage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage), separate from durable assistant settings. They survive refreshes and snippet reruns within the tab's page session; browser session restoration may restore them too. Normal tab/session closure ends this history. If session storage is blocked or full, recording still works in memory and can survive a snippet rerun, but a refresh cannot recover that in-memory copy. Caller details are never placed in the assistant's localStorage preferences/statistics or sent to GitHub, Library or an external service.

Capture requires a readable connected phone card. A Busy header or incoming-call offer alone is not enough to create a detailed record. Previously unseen completed calls cannot be reconstructed. Hidden or ambiguous card data cannot attach a name to an arbitrary interaction; previously readable details are retained rather than erased. Repeated references do not create duplicate records. Completed-call and Wrap up markers take priority during partial page updates, and a finished interaction stays guarded even when its Info fields disappear. A lingering Busy header or active clock cannot turn disposition into a new Unknown call or increment the counter again. A distinct new connected reference or number, or a confirmed return to idle, permits the next interaction. If no such evidence is readable, the assistant cannot reliably distinguish a new call from the old card. If Wrap up is missed but a readable idle state proves the call ended, the record retains its last known duration as **≥** that time; unknown values stay unavailable. Busy, hold and disposition timers never substitute for call duration. These limitations also mean calls outside the assistant's observed period may be missing.

Version 1.1.3 prevents new disposition duplicates. Existing saved records and daily counts are retained; the assistant cannot safely determine which earlier Unknown records were erroneous or reconstruct the correct historical total.

## Timing settings and compact reminders

Lunch Break Length is recorded in whole minutes. Reminder delays and sound durations use seconds.

| Setting | Default | Allowed range |
| --- | ---: | ---: |
| Lunch Break Length | 30 minutes | 1–120 minutes |
| Disposition Reminder Delay | 20 seconds | 1–120 seconds |
| Caller Waiting Alert Delay | 180 seconds | 1–3600 seconds |

Lunch length has a slider and an exact minutes field; its current value appears only in the editable field, without printed slider bounds. Existing second-based lunch settings convert to the nearest whole minute, within the supported range. The former Extra Phone Cover Delay becomes Caller Waiting Alert Delay with its saved duration retained. The old 10-second disposition default upgrades once to 20 seconds; other saved delays are preserved, and newly chosen values remain unchanged on later runs.

While you are on **Lunch** or completing disposition, the assistant shows a compact progress bar with elapsed time, time left, the allowance and a small Mute/Unmute button. Lunch labels use minutes, including overdue and accessible progress text; disposition uses seconds. Any active reminder's explanation appears below the bar. Its colours match the main panel; a gentle shimmer becomes an orange pulse when overdue. Reduced-motion preferences are respected. The main menu returns when you leave that state. These reminders work in **G1 and G2**, without needing queue information. Changing group membership does not cancel a reminder for an ongoing personal state.

The break reader uses 8x8's `on-break-timer`, including `MM:SS` and `H:MM:SS` values, and checks the reason label beside it. **Lunch** uses the lunch allowance; **Short Break** never does. An unknown or conflicting reason shows a generic break timer without a lunch alarm.

**Short Break** opens a separate teal view showing **Short breaks today** and **This short break**, both in completed minutes. A gently animated bar shows progress toward the next minute. Measured seconds carry across breaks, so two partial minutes can make one full minute; totals survive snippet reruns and are saved in this browser when storage is permitted. The daily total resets at Brisbane midnight and splits an ongoing break at that boundary. An already-running short break contributes its readable native elapsed time for today. Earlier breaks that were never observed cannot be reconstructed, and an unreadable or unchanged clock never adds guessed wall time. Mute does not stop counting. No short-break alarm is added.

The disposition reader requires the actual **Wrap up** state and its `progress-timer`. Merely opening the Disposition tab during a call does not start a reminder. [8x8's post-processing clock counts down](https://docs.8x8.com/8x8WebHelp/contact-center/agent-workspace/Content/aw/answer-incoming-calls.htm), and its other interaction timer describes the completed call. The assistant therefore measures its own disposition interval from the first observed Wrap up page, using decreases in the native countdown to catch up. Re-running the snippet retains an observed ongoing interval; starting it after disposition has already begun cannot recover the unseen start time. An expired native countdown does not silence a reminder while the Wrap up page is still open.

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

Statistics use the Australia/Brisbane day boundary. They are saved in this browser's 8x8 site storage when storage is available. Re-running the snippet preserves the daily total and does not count a continuing Busy period again. The daily total resets at midnight; a Busy period crossing midnight is not counted again solely because the date changed.

This is an observed Busy-start counter, not an 8x8 historical reporting API. Other interaction types that use Busy cannot be distinguished from calls using status alone. Calls that start and finish entirely while your own status is unreadable, or while the assistant is closed, cannot be reconstructed. Missing information is never treated as proof of a call ending. A timer reset alone is not counted as another call. Statistics indicate when status information was unreadable.

The counter works independently of queue visibility. It can count a Busy transition when queue information is hidden or the status timer cannot be read, as long as the user's own status label remains readable.

## Mute, minimise and close

**Mute** stops all assistant tones and previews. Monitoring, agent updates, timers, progress animations, statistics and desktop notifications continue. Notifications created while muted request silent delivery. **Unmute** resumes any current alert; it does not repeat its desktop popup. The mute preference is saved for subsequent runs.

The **-** button minimises the main content; **+** restores it. Monitoring and counting continue while minimised. The **x** button closes the assistant and stops all monitoring and counting, retaining statistics and call history already saved. Closing the assistant does not end the browser tab's history session.

Settings remain usable while muted. Preview buttons are disabled until sounds are unmuted. The compact break and disposition bars also include Mute/Unmute.

## Releases

The previous assistant's behavior is recorded as **1.0.0**, with organisation-specific defaults extracted into local configuration. Release snapshots are kept in [releases](releases), and changes are described in [CHANGELOG.md](CHANGELOG.md). Future releases increment the patch version unless the user requests another versioning change.

Starting with **1.1.1**, public release files include the three ITS queue names expressly approved by the author. Queue configuration and its editor are removed. Older release snapshots keep their original local-configuration behaviour and are not changed. Caller details, live staff information and staff defaults are never published.

The script's version, VERSION file, package.json and release snapshot must agree. GitHub is the source for subsequent releases.

## Development checks

The browser snippet needs no installed dependencies. Development checks use Node.js 18 or newer and the pinned JavaScript Standard Style tool:

```sh
npm ci
npm run check
npm test
```

`npm run check` validates syntax and runs `npm run lint`. Current source and tests follow [JavaScript Standard Style](https://standardjs.com/). Historical release snapshots retain their original formatting; a new snapshot always matches the current source exactly.

The code separates page parsing, pure alert conditions, persistent settings, roster reconciliation, freshness checks, UI rendering and audio/notification delivery into focused helpers. Comments explain complex selectors, elapsed/countdown conversion, migration rules, asynchronous routing and lifecycle cleanup. Styles are expanded into readable CSS and remain isolated inside the panel's shadow root.

Tests use a simulated 8x8 DOM, notifications and audio devices to verify roster updates, timing boundaries, queue waiting times, mute behavior, device routing, persistence and statistics. Call-history checks cover real Wrap up versus tabs/offers, repeated and switched references, disposition duplicates with missing Info and lingering clocks/Busy headers, student numbers, safe text rendering, missing/ambiguous fields, session-only persistence, reruns/refreshes, search and shared statistics. Saved-record checks cover one editor at a time, confirmation/cancellation, prediction changes, polling, day rollover, blocked storage, safe text and unchanged call metadata/counts. Layout is also checked separately in Chromium with fictional agents, both supplied minimal break pages, and the supplied on-call and disposition structures with fictionalised caller details. Checks include caret preservation, scrolling histories, narrow and short viewports and active alerts. These checks do not verify live Edge notifications or physical audio delivery.

Secondary-ringer checks compare note patterns, volume envelopes, clock offsets and destinations across both contexts. They cover Default/Communications aliases, device loss, routing errors, muted startup, pending choices and shutdown. The 1.1.1 menu is checked at five viewport sizes using native Chromium audio graphs with simulated device choices; physical playback through two speakers must be checked on a computer with those devices.
