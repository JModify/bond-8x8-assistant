# Bond-8x8-Assistant

Assistant for the Bond IT Service Desk 8x8 customer call center interface.

Current version: **1.0.2**. The current snippet is [Service-Desk-8x8-Assistant.js](Service-Desk-8x8-Assistant.js).

## Running the assistant

1. Open your existing logged-in `vcc-au2.8x8.com` page in Edge.
2. Open Developer Tools → Sources → Snippets.
3. Paste the complete script into a saved snippet and press Ctrl + Enter.
4. Configure your three inbound queue names in Settings if they have not already been supplied by your configured local snippet. Queue names stay in this browser and are not part of the public source.
5. Select the agents covering phones in G1. Tick **Me** when you are covering phones.
6. Click Settings to adjust reminder timing, lunch length and desktop notifications. Open Sound Settings from that menu to customise audio.

The snippet starts monitoring immediately. The page can remain in the background, but it must stay open. A page refresh or browser restart requires running the saved snippet again. Browser audio may need a click in the page before it can play. Background tab throttling or freezing can delay detection.

## Groups and reminders

**G1** is the group covering phones. Everyone not ticked in G1 is automatically **G2**.

When you are in G2, the assistant monitors G1 break status and waiting callers, and tells you when extra cover is needed. When you are in G1, it reminds you to remain Available or Busy, to finish disposition within the configured delay, and to return from lunch before the selected allowance expires.

Waiting-call monitoring uses the three inbound queues configured locally. Outbound queues are excluded.

Monitoring shows one combined **Callers waiting** total. Statistics appear as three cards in a horizontal row. **Last updated** at the bottom records the latest assistant update. Working Offline appears in orange.

The script only reads page information and alerts you. It does not change your status, select disposition fields, or answer calls.

## Seconds and compact reminders

All timing settings use seconds. Existing minute-based preferences are converted once without changing the saved durations, G1 selections or sounds.

| Setting | Default seconds | Allowed seconds |
| --- | ---: | ---: |
| Lunch Break Length | 1800 | 1–7200 |
| Disposition Reminder Delay | 10 | 1–120 |
| Caller Waiting Delay | 120 | 1–1800 |
| Extra Phone Cover Delay | 180 | 1–3600 |

Lunch length has a slider and an exact seconds field. Sound durations already use seconds.

While you are on break or completing disposition, the assistant shows only a compact progress bar with elapsed time, time left and the allowance. Its colours match the main panel; a gentle shimmer becomes an orange pulse when overdue. Reduced-motion preferences are respected. The main menu returns when you leave that state. Personal reminder sounds still require **Me** to be ticked in G1.

The break reader uses 8x8's `on-break-timer`, including `MM:SS` and `H:MM:SS` values, so reminders work while all queue and agent rows are hidden.

The disposition reader requires the actual **Wrap up** state and its `progress-timer`. Merely opening the Disposition tab during a call does not start a reminder. [8x8's post-processing clock counts down](https://docs.8x8.com/8x8WebHelp/contact-center/agent-workspace/Content/aw/answer-incoming-calls.htm), and its other interaction timer describes the completed call. The assistant therefore measures its own disposition interval from the first observed Wrap up page, using decreases in the native countdown to catch up. Re-running the snippet retains an observed ongoing interval; starting it after disposition has already begun cannot recover the unseen start time. An expired native countdown does not silence a reminder while the Wrap up page is still open.

## Testing desktop notifications

In **Settings → Desktop Notifications**, turn on desktop notifications and click **Test desktop notification**. This temporary diagnostic button requests browser permission if needed and sends one popup without playing a sound or starting an alert. It reports blocked permissions, unsupported browsers and failed requests. A successful send cannot guarantee that the operating system displayed the popup; check browser and computer notification settings if it did not appear.

Notification tests are disabled while paused or when desktop notifications are switched off.

## Statistics

- **Calls taken today:** the number of Busy starts detected by the assistant today. A Busy period already in progress when counting starts is counted once.
- **Calls in the last hour:** detected Busy starts within the previous 60 minutes.
- **Last call detected:** the time the most recent Busy start was detected.

Statistics use the Australia/Brisbane day boundary. They are saved in this browser's 8x8 site storage when storage is available. Re-running the snippet preserves the daily total and does not count a continuing Busy period again. The daily total resets at midnight; a Busy period crossing midnight is not counted again solely because the date changed.

This is an observed Busy-start counter, not an 8x8 historical reporting API. Other interaction types that use Busy cannot be distinguished from calls using status alone. Calls that start and finish entirely while your own status is unreadable, or while the assistant is closed, cannot be reconstructed. Missing information is never treated as proof of a call ending. A timer reset alone is not counted as another call. Statistics indicate when status information was unreadable.

The counter works independently of queue visibility. It can count a Busy transition when queue information is hidden or the status timer cannot be read, as long as the user's own status label remains readable.

## Pause, minimise and close

**Pause** freezes the displayed agent information, queue counts, Last updated time, compact timers and animations, alert checks and other statistics. It stops alert sounds and previews. The daily call counter remains active and its total can still increase while paused. Resume refreshes the page values and other statistics immediately.

The **-** button minimises the main content; **+** restores it. Monitoring and counting continue while minimised. The **x** button closes the assistant and stops all monitoring and counting, retaining statistics already saved.

Settings can be edited while paused. Preview buttons remain disabled until monitoring resumes.

## Releases

The previous assistant's behavior is recorded as **1.0.0**, with organisation-specific defaults extracted into local configuration. Release snapshots are kept in [releases](releases), and changes are described in [CHANGELOG.md](CHANGELOG.md). Future releases increment the patch version unless the user requests another versioning change.

Public release files contain no organisation queue names or staff defaults. A configured local snippet can seed the queue settings before the public core runs; that private configuration is not published to this repository. Archived 1.0.0 reads the same local queue configuration.

The script's version, VERSION file, package.json and release snapshot must agree. GitHub is the source for subsequent releases.

## Development checks

Node.js 18 or newer is sufficient; no dependencies need installing.

```sh
npm run check
npm test
```

Tests use a simulated 8x8 DOM to verify status readers, timing boundaries, menu navigation, persistence, pause behavior and statistics. They do not verify live Edge notifications, audio delivery or the real 8x8 page layout.
