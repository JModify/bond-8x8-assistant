# Call Notes capacity and performance

Prototype **v1.2.2**, measured 19 October 2026. [Back to the technical guide](../TECHNICAL.md).

## Practical limits

A text file has no useful record-count limit of its own: note length, browser memory, rendering, storage quotas and complete-file reads/writes determine the practical limit.

- **Supported per-file ceiling:** 10,000 records or **20 MiB** (20,971,520 bytes, shown as 20 MB), whichever is reached first. v1.2.1 allowed 2,000 records/5 MiB. Invalid or oversized files are rejected before data is applied; recorded notes are never automatically truncated.
- **Comfortable active history:** keep a few thousand short notes in the working file, or fewer when notes are lengthy. Use dated quarterly/yearly archives before the file approaches its limit. This is a conservative recommendation, not a hardware guarantee.
- **Browser tab backup:** normally up to 5 MiB per origin, shared with 8x8's other session data and the assistant's checkpoints. It can run out well before the selected TXT file reaches its limit. In this fixture, 2,000 short notes used roughly 2.4 MiB of serialised UTF-16 backup text; 5,000 used roughly 6.1 MiB. Maximum-length notes reached roughly 3.9 MiB with only 100 records. These are footprint estimates, not measured free space or a guaranteed record allowance.
- **Keep Data location connected for larger histories.** The selected TXT file is the persistent copy. If the tab backup is full/blocked, the assistant warns, retains notes in memory, and preserves the newest in-memory state on a prototype rerun. Recovery after a full page/session loss needs the file.

## Measurements

Fictional records with 240-character notes, measured in Node with a simulated 8x8 DOM on an Intel Xeon Platinum 8573C. These figures measure JavaScript and fixture operations, **not Edge layout, actual file access, antivirus or an agent's laptop**. Parsing was warmed; import/menu/search timings are single samples and vary. [Raw results and exact source hashes](performance/call-notes-1.2.2.json).

| Records | TXT size | v1.2.1 import | v1.2.2 import | Open notes | Search | Cards rendered |
| --- | --- | --- | --- | --- | --- | --- |
| 500 | 0.38 MiB | 264 ms | 41 ms | 25 ms | 4 ms | 50 |
| 1,000 | 0.76 MiB | 656 ms | 74 ms | 41 ms | 8 ms | 50 |
| 2,000 | 1.52 MiB | 1110 ms | 94 ms | 18 ms | 7 ms | 50 |
| 5,000 | 3.80 MiB | Above old limit | 227 ms | 16 ms | 10 ms | 50 |
| 10,000 | 7.60 MiB | Above old limit | 457 ms | 24 ms | 15 ms | 50 |

At 2,000 records the earlier prototype built about 62,000 fixture nodes; v1.2.2 kept about 1,800, including the rest of the assistant. A separate maximum-length test used 1,000 notes of 20,000 characters each: 19.60 MiB of TXT, about 649 ms for the synchronous import benchmark, and 15 ms for indexed search. Real file operations also yield between validation batches, so the full import time includes scheduling and I/O. A near-limit file remains substantially heavier to load/save than a short history.

## What changed

- Render **50 notes per page** and release off-page cards/headings. A hidden Call Notes menu builds no cards. Search, totals and export still cover every record.
- Validate file reads in **100-record batches**, yielding between them. Validate the entire file before applying anything; closing or disconnecting cancels stale batches.
- Cache normalised search text and rebuild it when a record changes. Weak record keys release deleted/replaced search data.
- Rewrite the completed-note tab backup only when saved records change; keep live caller fields/capture guards in a small matching-generation backup.
- Coalesce full data-file comparisons and writes instead of rescanning the archive for each keypress or native clock update. Preserve conflict checks, Escape and committing-write repair.

## Archive safely

Archiving remains an explicit user action; paging keeps all current notes available.

1. Finish the current call and save any note edits. Use **Save now** for the connected file.
2. Use **Call Notes → Export TXT** to save a dated archive in a separate location. Verify the exported file before proceeding.
3. In **Settings → Data location**, select **Disconnect**. Keep the old data file and archive.
4. Close that 8x8 tab. Open a **new** 8x8 tab normally, launch the prototype and choose a new empty TXT file for the next period. Starting another file in the old notes session merges that session's notes into it; a fresh tab starts a fresh working history.
5. Read older archives in Notepad, or import records when needed, subject to the active file limits. Import skips known stable keys; it does not overwrite existing edits or replace their dates.

## Remaining cost and future direction

The prototype still reads a complete TXT file and commits a complete replacement. Batched validation and paging do **not** provide selective disk loading or append-only storage. Whole-file work and memory scale with total bytes; 10,000 very short records can be cheaper than 1,000 long ones. Browser freezing, unavailable permissions, locks or a crash can delay/prevent the latest save. Automatic reconnection retries with bounded backoff until explicit Disconnect; conflicting copies are preserved and can still require user action.

For substantially larger long-term histories, the intended approved Edge extension should use an indexed, transactional record store with paged queries and TXT exports for interchange. That would remove whole-file rewriting from normal editing. This prototype update leaves the existing development extension unchanged.

References: [browser storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria), [File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [permission renewal](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api), [browser task yielding](https://developer.chrome.com/blog/use-scheduler-yield), [DOM size and interactivity](https://web.dev/articles/dom-size-and-interactivity).
