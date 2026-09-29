# State schema

One file, `briefing-state.json`, lives beside the briefings. It holds two things
only: the **coverage baseline** and a **seven-day index of recent stories**. It
computes nothing about newness - whether a story is `#new` or `#followup` is the
agent's own judgement against that index, made while writing the briefing.

## Shape

    {
      "version": 2,
      "updatedAt": "2026-09-28T09:30:00Z",
      "lastBriefingAt": "2026-09-28T09:30:00Z",
      "lastBriefingDate": "2026-09-28",
      "window": {
        "since": "...", "until": "...", "hours": 23.8, "capped": false,
        "gapHours": 23.8, "uncoveredHours": 0, "previousBriefingAt": "...",
        "maxWindowHours": 72, "firstRunHours": 24, "label": "..."
      },
      "plannedWindow": null,
      "items": [
        {
          "title": "Headline as written in the briefing",
          "section": "global",
          "aspect": "Economy",
          "outlet": "BBC",
          "primaryUrl": "https://...",
          "flags": ["new"],
          "watch": false,
          "date": "2026-09-28",
          "lastSeen": "2026-09-28T09:30:00Z"
        }
      ],
      "watchlist": [
        { "title": "...", "date": "2026-09-28", "lastSeen": "2026-09-28T09:30:00Z" }
      ]
    }

`section` is `global`, `china` or `watch`. `aspect` is `top` for a Top story,
otherwise the aspect heading exactly as the contract spells it (`Economy` ...
`Social`, `经济` ... `社会`). A story line that sits directly under a section
heading with no `### ` heading above it records an empty aspect.

## Items

`items` is an **array**, one entry per story line per run, so a Top story repeated
in its aspect section is indexed twice: no story key and no derived state.
`update` appends this run's curated items and stamps `date` and `lastSeen` itself
- both are ignored if the input carries them.

The append is **idempotent for a re-run**. An entry already held under the same
`date` and `title` is already covered, not a new story, so it is kept once and
not appended again. Those are the only two fields matched, and only entries
already in the state are compared - the incoming batch is never compared with
itself, so a line the Markdown repeats inside one run is still indexed as many
times as it is written. Re-running Step 6 therefore cannot duplicate the index;
it can still move the coverage baseline, which is why the re-run guard below
refuses it.

Two briefings on the same calendar day share the `(date, title)` key, so a title
the second briefing reports can already be held when it runs with nothing having
gone wrong: the dedup is not by itself evidence of a re-run. The common case is
a **watchlist title that recurs** - retention is not a report, and a later
briefing lists the title again when it moves inside the window - so the same
entry is matched on both runs. What separates a second briefing from a repeated
Step 6 is the window the re-run guard measures, not the dedup - and only inside
the guard's band: a second Step 6 pass more than ten minutes after the first
closes a fresh window, exits 0 and moves the baseline, the neutral dedup notice
the only trace.

- `title`, `primaryUrl` - the cited headline and its primary link.
- `section`, `aspect`, `outlet` - recorded as given, and read back as the index
  for later runs.
- `flags` - the `#tags` present on the story line.
- `watch` - whether the story belongs on the watchlist.
- `date`, `lastSeen` - chosen by `update`: the Asia/Shanghai briefing date and
  the write timestamp.

There is no `key`, `status`, `timesSeen`, `outlets` or `firstSeen`; nothing
recomputes a count or a status, and no script reads one.

## Retention

Entries whose `lastSeen` is older than `RETENTION_DAYS` (7) are dropped on the
next update. Nothing else ages out.

## Watchlist

The watchlist is a **retention list**, not a to-report list: it keeps every
retained item flagged `watch`, whether or not a later briefing reports it. It is
rebuilt on every update from the retained items with `watch: true`,
deduplicated by title keeping the earliest `date`:

    { "title": "...", "date": "YYYY-MM-DD", "lastSeen": "<ISO>" }

An item enters the watchlist when it is flagged `watch` - an unresolved
developing story that also has a new development inside the current window (see
`reference/output-contract.md`). It stays while it is retained. A watchlist entry
only appears in a briefing when that new development exists.

## Planned window

`plan` records the window it computes - or keeps the one already recorded - so `update` can use the same coverage end.

- `plan --state FILE` prints the window as JSON on stdout. When FILE holds a
  **usable** `plannedWindow` (below) it prints that recorded window, computes
  nothing and writes nothing; otherwise it computes a fresh window and records
  it in FILE as `plannedWindow` (read-modify-write; every other value is
  preserved). A reused window is announced: `plan` writes one line to stderr
  naming the record's age and its end, so a record an aborted run left behind is
  visible; stdout and the state are unchanged either way. If FILE does not exist
  or cannot be read, `plan` still prints and does **not** create the file.
- A plannedWindow is **usable** when its `until` parses as a date, is not behind
  `state.lastBriefingAt`, is no more than 12h old (it is not a leftover from an
  aborted run), and is not more than 5 minutes ahead of the command's own clock
  (a window no live run could have announced). `plan` and `update` share this one
  predicate - the code is `usablePlannedWindow(state, baseline, now)` in
  `scripts/update-state.mjs` - so the end the header announces is the end the
  state stores. A stale, behind-baseline or future-dated record is ignored and
  the command falls back to its own clock.
- `update` takes the coverage end from a usable `state.plannedWindow.until`,
  otherwise from its own clock, and then:
  - `window = planWindow(state.lastBriefingAt, coverageEnd)`
  - `lastBriefingAt = coverageEnd` exactly, so the stored baseline is the
    announced end **whenever update consumes a usable record**. The window
    travels through the state file: `plan` records it as `plannedWindow` and
    `update` reads that record back from the same `--state` file, so which shell
    runs `update` does not matter. When no usable record exists - `update` ran
    against a different state file, `plan` had no state file to record the
    window in (a missing or unreadable one: it still prints, and does not
    create the file), or the usability predicate above rejects the record -
    `coverageEnd` is update's own `now` and the announced end is whatever `plan`
    last printed, so the two need not match;
  - `plannedWindow = null`.
- **Guard**: when the window measured in whole seconds from its own ends is below
  `MIN_WINDOW_SECONDS` (120, two minutes) and `--force` was not passed, `update`
  prints an explanatory error to stderr and exits 3 **without writing**. The
  threshold is the "seconds old" case the guard exists to catch - a second update
  moments after the last one - so a mid-day re-run, a catch-up and a normal day
  all clear it. The measurement floors, so 119.9s is under two minutes and is
  refused while 120.0s is accepted. `--force` excuses only a short but
  **positive** window (under two minutes). A window whose end is behind
  `lastBriefingAt` - the window measured from its own ends is negative - is
  refused regardless of `--force` (exit 3), and the message says how to reset:
  correct `lastBriefingAt` in the state file, or delete the state file and start
  fresh (which drops the recorded coverage). The baseline can only be corrupt
  that way by hand or by a backwards host clock, so refusing is the point;
  `--force` does not discard coverage. An accepted window under about 0.1h keeps
  the existing tenth-of-an-hour rounding, so it is labelled `covering latest 0h`:
  the label's shape is unchanged and no smaller unit is invented.
  A recorded `plannedWindow` that the usability predicate above rejects - it sits
  behind `lastBriefingAt`, is older than 12h, is in the future, or carries an
  `until` that does not parse - is no longer discarded in silence: `update`
  writes one stderr line naming the reason and saying coverage would end at this
  run's own clock instead, then continues.
- **Re-run guard**: a second Step 6 pass has no planned window left to consume -
  the first pass sets `plannedWindow = null` - so it would close a window measured
  only from `lastBriefingAt` to its own clock. When that window is under
  `RERUN_WINDOW_SECONDS` (600, ten minutes) and `--force` was not passed, `update`
  says the state was already closed minutes ago, prints an explanatory error to
  stderr and exits 3 **without writing**: accepting it would move the baseline to a
  moment no `plan` announced, and the next window would silently skip the coverage
  in between. **Editing the Markdown after Step 6 therefore means re-running
  `plan` (Step 2) as well**, because `update`'s record is consumed by the first
  pass and a second `update` has no window of its own to consume; `--force`
  accepts a re-run deliberately, and the index dedup (see Items) keeps even that
  pass from appending the same entries twice.
- **Stale `--items` guard**: when `update` consumes a usable `plannedWindow`, an
  `--items` file whose mtime is older than that record's `until` minus 60
  seconds belongs to an earlier run, and `update` exits 3 with a message telling
  the caller to re-run `scripts/md-to-items.mjs`. Without a usable record there
  is nothing to compare against, so the guard is skipped.

## Window rule (the plan command)

    node scripts/update-state.mjs plan --state <path>

Prints JSON with since, until, hours, capped, gapHours, uncoveredHours,
previousBriefingAt, maxWindowHours, firstRunHours and a label string, applying
exactly this rule:

- previous briefing exists: since = max(lastBriefingAt, now - 72h)
- no previous briefing: since = now - 24h
- capped is true when now - lastBriefingAt exceeds 72h
- it never prompts and never waits for input

`update` accepts `--date` to set `lastBriefingDate`; it defaults to the
Asia/Shanghai date of the coverage end, not the UTC date.

## Items input (update --items)

`update` takes the run's curated items array: a JSON array with one object per
story in the briefing. `scripts/md-to-items.mjs` produces it from the briefing
Markdown.

    [
      {
        "title": "Headline as written in the briefing",
        "section": "global",
        "aspect": "Economy",
        "outlet": "BBC",
        "primaryUrl": "https://...",
        "flags": ["new"],
        "watch": false
      }
    ]

- `title` and `primaryUrl` are required; `update` records an empty string for a
  missing one rather than rejecting the item.
- `section`, `aspect` and `outlet` are recorded on the entry.
- `flags` is read from the item on every run and does not carry over: omitting
  `flags` clears them.
- `watch` is carried by the retained index: any retained entry with `watch: true`
  keeps its title on the watchlist until it ages out after 7 days.
- If `--items` is given but the file cannot be read or parsed, `update` exits
  non-zero with a clear message instead of continuing with an empty array.
- The file is a run artifact: written by the agent each run, overwritten each
  run, and never read by the renderer. It is not part of the deliverable.

## Migrating a v1 state

Version 1 stored `items` as an object keyed by a hash of the normalized headline
and host, with `key`, `status`, `timesSeen`, `outlets` and `firstSeen` per
item. Version 2 has none of that. Reading a v1 state converts it silently and
losslessly for the fields that survive:

- keep `title`, `section`, `aspect`, `outlet`, `primaryUrl`, `flags` and
  `watch`;
- carry `lastSeen` over, falling back to `firstSeen` when it is absent;
- set `date` from that `lastSeen` in Asia/Shanghai (an entry whose date is
  missing or invalid is dropped by retention);
- drop `key`, `status`, `timesSeen`, `outlets`, `firstSeen` and the hash key;
- write `version: 2`.

Nothing has to be done by hand. `plan` reads a v1 state as it stands and only
adds `plannedWindow`; the conversion happens the next time `update` runs.

## Commands

| Command | Purpose |
|---|---|
| plan | reuse a usable plannedWindow (print it, compute nothing, write nothing), else compute the window and record it as plannedWindow; do not otherwise mutate state |
| update | consume plannedWindow, append this run's items, rebuild the watchlist, write state |

Both accept --state and print JSON to stdout; update also accepts --items (the
run's curated items array), --out (write target), --date (YYYY-MM-DD) and
--force (proceed when the window is under two minutes but still positive, or
when a second Step 6 pass has no recorded window and the state was closed minutes
ago; never when the window is negative).
