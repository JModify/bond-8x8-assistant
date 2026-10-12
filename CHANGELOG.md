# Changelog

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
