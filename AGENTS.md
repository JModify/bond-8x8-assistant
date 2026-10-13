# Release workflow

The user requires each released update to be versioned and pushed to `JModify/bond-8x8-assistant` on GitHub. The repository's current source is authoritative; do not start future updates from an older Library copy.

For each authorised application update:

1. Read the current VERSION, CHANGELOG.md, script and repository HEAD.
2. Increment the patch version by default unless the user specifies another version. The previous baseline is 1.0.0 and the first versioned update is 1.0.1.
3. Keep the script header, VERSION constant, VERSION file, package.json and visible version in agreement.
4. Add a dated changelog entry and an exact release snapshot at `releases/<version>/Service-Desk-8x8-Assistant.js`. Never modify an existing release snapshot.
5. Run `npm run check` and `npm test`. Update behavioral tests for the changes.
6. Push the tested change to GitHub's main branch, preserving unrelated changes and using an expected-HEAD check. Do not force-push over another update. The user's standing request authorises these release pushes.
7. Deliver the versioned script and link the verified GitHub commit or repository. Do not also save repository-backed source to Library.

# Application constraints

- Use the existing 8x8 browser session; no additional logins, downloaded dependencies or external requests in the snippet.
- The assistant reads the page and alerts. It never changes availability or answers calls.
- Only the three locally configured inbound queues are monitored for waiting callers; exclude outbound queues.
- G1 denotes agents covering phones; every agent not selected in G1 is G2.
- Mute silences assistant tones and previews while monitoring, timers, statistics and notifications continue. Request silent notifications while muted; never pause the monitoring loop.
- Saved G1 membership is a user preference, independent of the rendered roster. Only explicit checkbox edits may remove a saved choice. Preserve it through filters, virtual scrolling, navigation, row replacement, refreshes and snippet reruns. Remove absent rows only after a complete visible roster settles; restore their chosen G1 state when they reappear. Never infer sign-out or availability from a partial or hidden roster. Me stays first without separate row shading.
- Phone-cover alerts use native inbound Longest waiting time and only signed-in G1 members. For G2, require Me not Available, every signed-in G1 member unavailable and a caller waiting at least the delay. For G1, require Me Working Offline, no other signed-in G1 member Available and a caller waiting strictly longer than the delay; Me alone in G1 can still need cover. Other Work never triggers this alert for Me in G1. Do not guess missing wait durations or use Busy time as caller wait time.
- Busy-start counts are observations, not complete historical call totals. Preserve state through unreadable periods, do not fabricate calls, and explain the limitation.
- Lunch Break Finished and Complete Disposition apply in any group, including when nobody is selected in G1. Distinguish the explicit Lunch and Short Break reason beside the dedicated break timer; never assume an unspecified break is lunch. Short Break has its own compact daily total in completed minutes, persists measured seconds across breaks/restarts, and resets on the Brisbane day boundary. It never uses the lunch allowance or alarm. Lunch compact labels and accessibility text use minutes; disposition uses seconds. Read the dedicated break timer and Wrap up markers; do not require queue or agent rows for personal reminders. Do not mistake a Disposition tab or the completed call's timer for elapsed wrap-up time. Editing G1 membership must not interrupt an active personal reminder.
- Missing queue rows keep the assistant and its menus open when own status and the required roster remain readable. Label any cached count as last-read and suspend queue-dependent alerts until fresh native data returns; never advance cached caller ages. Ordinary offscreen rows that remain rendered can still be read. Do not change the phone application's scrolling or rendering to recover virtualised rows.
- For missing own status or required roster information, show only `Unable to Assist: Open 8x8 agent queue information.` Keep the main panel fitted without an outer scrollbar or clipping controls; the agent table and submenus can scroll.
- Record lunch in whole minutes; reminder delays and sound durations use seconds. Preserve configured durations when migrating where the new range permits them.
- Route output only on the assistant's own AudioContext. Put Audio Devices in Sound Settings with output selection only. Never alter 8x8's devices, open a microphone for device enumeration, or modify system-wide audio settings.
- Each sound has a saved Send desktop notification checkbox, subject to the global notification setting and browser permission. A notification opt-out must not silence the sound or remove its visible reason. Keep current reasons visible above the footer, including when minimised or in submenus; previews have their own temporary explanation and never send a popup.
- Keep the author under the title and the release version in the footer beside Last updated. Lunch length is shown only in the editable number field, without a duplicated value or printed slider bounds.
- Author: Joshua Lavagna-Slater is explicitly approved for the public script and title metadata.
- Do not publish page captures, caller information, credentials or live staff schedules. Use fictional fixtures in tests.
- Keep organisation queue names and staff defaults out of public source, docs, tests and archived releases. Preserve configured private download copies separately. Do not commit private configuration; it stays in browser settings or a private local bootstrap.
- Setup instructions must include opening queue information using the top button to the right of status, next to the bell; configuring the three inbound names; and selecting the service desk group with every User status ticked under Groups → Filter.
- Follow JavaScript Standard Style in current source and tests. Explain every nontrivial parsing, timing, state, migration, audio scheduling and asynchronous operation with a useful comment; use descriptive names and small focused helpers. Run npm run check (syntax and StandardJS) plus behavioural tests before publishing. Keep historical release snapshots immutable and outside style reformatting; each new snapshot must exactly match current source.
