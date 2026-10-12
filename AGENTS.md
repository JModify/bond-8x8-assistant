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
- Pause freezes displayed data and stops alert checks, sounds and previews. Only the daily Busy-start counter continues; other statistics refresh on resume.
- Busy-start counts are observations, not complete historical call totals. Preserve state through unreadable periods, do not fabricate calls, and explain the limitation.
- On break and disposition pages, show only a compact personal progress bar. Read the dedicated break timer and Wrap up markers; do not require queue or agent rows for G1 personal reminders. Do not mistake a Disposition tab or the completed call's timer for elapsed wrap-up time.
- For other missing information, show only `Unable to Assist: Open 8x8 agent queue information.`
- Use seconds for all timing settings; preserve durations when migrating legacy minute preferences.
- Do not publish page captures, caller information, credentials or live staff schedules. Use fictional fixtures in tests.
- Keep organisation queue names and staff defaults out of public source, docs, tests and archived releases. Preserve configured private download copies separately. Do not commit private configuration; it stays in browser settings or a private local bootstrap.
