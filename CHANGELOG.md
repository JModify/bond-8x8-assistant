# Changelog

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
