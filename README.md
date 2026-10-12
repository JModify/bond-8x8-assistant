# Bond-8x8-Assistant

Assistant for the Bond IT Service Desk 8x8 customer call center interface.

Author: **Joshua Lavagna-Slater** | Current version: **1.0.3**.

The current snippet is [Service-Desk-8x8-Assistant.js](Service-Desk-8x8-Assistant.js).

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

Agents who disappear from a visible Groups list are removed from the assistant's table and their G1 selections are cleared. Logging in adds a fresh row, initially in G2. Temporarily hiding the entire list, including the break and disposition pages, does not erase G1 selections. Me always appears first with the same row styling as other agents.

There is one phone-cover alert, with a repeating two-tone alarm by default. It plays when you are in G2, are not Available, a caller has waited at least the configured delay, and every signed-in G1 member is unavailable: Busy, On Break, Working Offline or completing disposition. At least one signed-in agent must be ticked in G1. Becoming Available, an available G1 member, or no caller waiting long enough clears the alert. The earlier informational Caller Waiting sound is removed.

The delay uses each inbound queue's **Longest waiting time**, not an agent's time on Busy. Missing or stale waiting times do not produce guessed call ages. G1 break information and the existing personal G1 reminders remain separate from the phone-cover alert.

Waiting-call monitoring uses the three inbound queues configured locally. Outbound queues are excluded.

Monitoring shows one combined **Callers waiting** total. Statistics appear as three cards in a horizontal row. **Last updated** at the bottom records the latest assistant update. Working Offline appears in orange.

The script only reads page information and alerts you. It does not change your status, select disposition fields, or answer calls.

## Timing settings and compact reminders

Lunch Break Length is recorded in whole minutes. Reminder delays and sound durations use seconds.

| Setting | Default | Allowed range |
| --- | ---: | ---: |
| Lunch Break Length | 30 minutes | 1–120 minutes |
| Disposition Reminder Delay | 20 seconds | 1–120 seconds |
| Caller Waiting Alert Delay | 180 seconds | 1–3600 seconds |

Lunch length has a slider and an exact minutes field. Existing second-based lunch settings convert to the nearest whole minute, within the supported range. The former Extra Phone Cover Delay becomes Caller Waiting Alert Delay with its saved duration retained. The old 10-second disposition default upgrades once to 20 seconds; other saved delays are preserved, and newly chosen values remain unchanged on later runs.

While you are on break or completing disposition, the assistant shows a compact progress bar with elapsed time, time left, the allowance and a small Mute/Unmute button. Its colours match the main panel; a gentle shimmer becomes an orange pulse when overdue. Reduced-motion preferences are respected. The main menu returns when you leave that state. Personal reminder sounds still require **Me** to be ticked in G1.

The break reader uses 8x8's `on-break-timer`, including `MM:SS` and `H:MM:SS` values, so reminders work while all queue and agent rows are hidden.

The disposition reader requires the actual **Wrap up** state and its `progress-timer`. Merely opening the Disposition tab during a call does not start a reminder. [8x8's post-processing clock counts down](https://docs.8x8.com/8x8WebHelp/contact-center/agent-workspace/Content/aw/answer-incoming-calls.htm), and its other interaction timer describes the completed call. The assistant therefore measures its own disposition interval from the first observed Wrap up page, using decreases in the native countdown to catch up. Re-running the snippet retains an observed ongoing interval; starting it after disposition has already begun cannot recover the unseen start time. An expired native countdown does not silence a reminder while the Wrap up page is still open.

## Testing desktop notifications

Allow the site manually in Microsoft Edge:

1. Open **Settings → Privacy, search and services → Site permissions → All permissions → Notifications**.
2. Under **Allowed to send notifications**, select **Add site**.
3. Enter **https://vcc-au2.8x8.com**, then select **Add**.

In **Settings → Desktop Notifications** in the assistant, turn on notifications and click **Test desktop notification**. This temporary diagnostic button sends one popup without an alert tone. It does not request permission automatically. It reports missing permission, unsupported browsers and failed requests. A successful send cannot guarantee that the operating system displayed the popup; check browser and computer notification settings if it did not appear.

Notification tests remain usable while muted, and are disabled when desktop notifications are switched off.

## Audio devices

**Settings → Audio Devices → Output Device** routes only the assistant's generated sounds. It does not change 8x8's call audio or system-wide devices. The default entry is labelled **(Default)**; browser-exposed device names appear after Refresh devices. Choose output device can request an output selection where that browser API is available.

Output selection uses the assistant's own [AudioContext.setSinkId](https://developer.chrome.com/blog/audiocontext-setsinkid/). Availability and visible devices depend on browser support and permission. The assistant never opens a microphone to discover speakers. Unsupported browsers keep system-default output. A removed selected device falls back to the system default, and a failed switch keeps the previous output. Desktop notification audio remains controlled by the browser and operating system.

**Input Device** displays a disabled default entry because this assistant does not use a microphone. It does not configure or replace the microphone used by 8x8 calls.

## Statistics

- **Calls taken today:** the number of Busy starts detected by the assistant today. A Busy period already in progress when counting starts is counted once.
- **Calls in the last hour:** detected Busy starts within the previous 60 minutes.
- **Last call detected:** the time the most recent Busy start was detected.

Statistics use the Australia/Brisbane day boundary. They are saved in this browser's 8x8 site storage when storage is available. Re-running the snippet preserves the daily total and does not count a continuing Busy period again. The daily total resets at midnight; a Busy period crossing midnight is not counted again solely because the date changed.

This is an observed Busy-start counter, not an 8x8 historical reporting API. Other interaction types that use Busy cannot be distinguished from calls using status alone. Calls that start and finish entirely while your own status is unreadable, or while the assistant is closed, cannot be reconstructed. Missing information is never treated as proof of a call ending. A timer reset alone is not counted as another call. Statistics indicate when status information was unreadable.

The counter works independently of queue visibility. It can count a Busy transition when queue information is hidden or the status timer cannot be read, as long as the user's own status label remains readable.

## Mute, minimise and close

**Mute** stops all assistant tones and previews. Monitoring, agent updates, timers, progress animations, statistics and desktop notifications continue. Notifications created while muted request silent delivery. **Unmute** resumes any current alert; it does not repeat its desktop popup. The mute preference is saved for subsequent runs.

The **-** button minimises the main content; **+** restores it. Monitoring and counting continue while minimised. The **x** button closes the assistant and stops all monitoring and counting, retaining statistics already saved.

Settings remain usable while muted. Preview buttons are disabled until sounds are unmuted. The compact break and disposition bars also include Mute/Unmute.

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

Tests use a simulated 8x8 DOM, notifications and audio devices to verify roster updates, timing boundaries, queue waiting times, mute behavior, device routing, persistence and statistics. They do not verify live Edge notifications, physical audio delivery or the real 8x8 page layout.
