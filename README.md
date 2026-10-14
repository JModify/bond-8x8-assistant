# Service Desk 8x8 Assistant

See phone coverage, keep call notes and get reminders to finish wrap-up or return from lunch.

**Author:** Joshua Lavagna-Slater · **Script version:** 1.1.6

[Assistant code](Service-Desk-8x8-Assistant.js) · [Technical guide](TECHNICAL.md) · [Release notes](CHANGELOG.md)

## Setup

1. Open your logged-in 8x8 page in **Microsoft Edge**.
2. Open the [assistant code](Service-Desk-8x8-Assistant.js), select **Raw**, then copy the whole file.
3. Press **Ctrl+Shift+i** → **Sources → Click "»" icon → Snippets → New snippet**. Name it **8x8 Assistant**, paste the code and press **Ctrl+S**, then **Ctrl+Enter**.
4. Open 8x8's **queue information** using the button to the right of your status, next to the bell icon.

<a href="docs/images/queue-info.png"><img src="docs/images/queue-info.png" width="215" alt="Queue information button location"></a>

5. Under **Groups → Filter**, select **ITS**, tick **every User status**, and leave **Show only favorite agents** off. Match the images below.
6. Keep **ITS Academic Hotline**, **ITS Internal TRNFR** and **ITS Service Desk** visible in the queue list. These are monitored automatically.
7. In the assistant, tick **G1** for agents covering phones, including **Me** when you are covering phones. Unticked agents are **G2**.

| Group: select ITS | User status: tick every status |
| --- | --- |
| <a href="docs/images/filter-group.png"><img src="docs/images/filter-group.png" width="215" alt="8x8 group filter with ITS selected and favorite-only filtering off"></a> | <a href="docs/images/filter-user-status.png"><img src="docs/images/filter-user-status.png" width="215" alt="8x8 user status filter with every status selected"></a> |

After refreshing or reopening 8x8, run your saved snippet again with **Ctrl+Enter**.

## Assistant views

The view changes automatically as you take calls, wrap up or go on break. Click an image to enlarge it. Example images show v1.1.3 with personal details blacked out.

| View | What you can do |
| --- | --- |
| **Main assistant**<br><a href="docs/images/main-view.png"><img src="docs/images/main-view.png" width="320" alt="Main assistant with agent names blacked out"></a> | View agents, statuses, timers, G1 roles and a combined waiting total. See today's call count, calls in the last hour and the last call. Clear alerts explain when phone cover is needed. Missing information freezes the agent table with a **Last read** badge; the assistant stays open. |
| **On a call**<br><a href="docs/images/on-call-view.png"><img src="docs/images/on-call-view.png" width="320" alt="On-call example with the phone number and caller identifier blacked out"></a> | See caller number, queue, duration and hold status. Enter a name, username or student number and optional notes; they save at **Wrap up**. Blank names become **Unknown**. |
| **Call Notes**<br><a href="docs/images/call-history-view.png"><img src="docs/images/call-history-view.png" width="320" alt="Earlier Call History view, now called Call Notes, with personal details blacked out"></a> | Use **+ Add note** for in-person visits. Search names, notes and job numbers; see totals for saved notes, predicted students/staff and missing jobs. The **pen** edits a record; the **tick**, clicking away or **Back** saves. Delete with the **bin**, with **Undo** available. |
| **Lunch break**<br><a href="docs/images/lunch-view.png"><img src="docs/images/lunch-view.png" width="320" alt="Lunch view showing elapsed and remaining minutes"></a> | See elapsed and remaining minutes, with a reminder when your configured lunch length is exceeded. |
| **Short break**<br><a href="docs/images/short-break-view.png"><img src="docs/images/short-break-view.png" width="320" alt="Short-break view showing this break and today's total in minutes"></a> | Track this break and today's total in completed minutes. Short breaks are counted separately from lunch. |
| **Disposition**<br><a href="docs/images/disposition-view.png"><img src="docs/images/disposition-view.png" width="320" alt="Disposition view with a countdown to the wrap-up reminder"></a> | See your countdown and get a reminder to complete the fields and click **Wrap up**. Lunch and disposition reminders work in both groups. |

## Controls and customisation

- **Speaker icon:** mute or unmute sounds while monitoring and counting continue. **Call Notes** sits to the left of the icons.
- **Call Notes → Export TXT / Import TXT:** save a readable Notepad file or bring saved notes back. Export lets you choose a location where Edge allows it; otherwise it downloads the file. Import adds notes and skips records already present.
- **Gear icon → Settings:** change lunch length, reminder delays, notification display time and desktop notifications.
- **Sound Settings:** choose sounds, volume, duration, repeat and per-sound notifications. Select an output device or enable **Secondary Ringer** for a second device.
- **– / ×:** minimise or close the assistant. It never changes your status or answers calls for you.

## Quick help

- **Agent information frozen:** open 8x8 queue information and check the setup filters. Last-read statuses and times stay visible until live data returns. **Call Notes** and settings remain available.
- **Queue data unavailable:** scroll back to the three monitored queues for live waiting counts.
- Keep 8x8 open. The counter can miss calls when the assistant is unavailable. Export Call Notes before ending your tab session. Importing or deleting notes does not change the call counter.
- For notification setup and detailed behaviour, see the [technical guide](TECHNICAL.md).
