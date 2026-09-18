# State schema

One file, `briefing-state.json`, lives beside the briefings and is the only
memory the skill keeps. It powers new-versus-follow-up flags, the watchlist and
the coverage window.

## Shape

    {
      "version": 1,
      "updatedAt": "2026-09-10T09:30:00Z",
      "lastBriefingAt": "2026-09-10T09:30:00Z",
      "lastBriefingDate": "2026-09-10",
      "window": { "since": "...", "until": "...", "hours": 72, "capped": true },
      "items": {
        "<key>": {
          "key": "a1b2c3d4e5f6",
          "title": "normalized headline",
          "section": "global",
          "aspect": "economy",
          "firstSeen": "2026-09-08T01:00:00Z",
          "lastSeen": "2026-09-10T09:30:00Z",
          "timesSeen": 3,
          "status": "followup",
          "outlet": "BBC",
          "primaryUrl": "https://...",
          "outlets": ["BBC", "SCMP"],
          "flags": ["developing"],
          "watch": true
        }
      },
      "watchlist": [
        { "key": "a1b2c3d4e5f6", "title": "...", "firstSeen": "...", "lastSeen": "...", "timesSeen": 3 }
      ]
    }

## Story key

Derived from the normalized headline plus the primary host, hashed to 12 hex
characters. Normalization lowercases, strips punctuation and stop words, and
collapses whitespace. Two runs that report the same event with a slightly
different headline still match when the host and the distinctive tokens agree;
when in doubt, prefer merging over duplicating.

## Status rules

| Condition | status |
|---|---|
| key absent from the previous state | new |
| key present with an earlier firstSeen | followup |
| key present but no item this run | aged out; keep for 7 days then drop |

## Window rule (the plan command)

    node scripts/update-state.mjs plan --state <path>

Prints JSON with since, until, hours, capped, previousBriefingAt and a
label string, applying exactly this rule:

- previous briefing exists: since = max(lastBriefingAt, now - 72h)
- no previous briefing: since = now - 24h
- capped is true when now - lastBriefingAt exceeds 72h
- it never prompts and never waits for input

## Watchlist

An item enters the watchlist when it is flagged watch (an unresolved developing
story). It stays while it has activity inside the window or until 7 days after
firstSeen, whichever comes first. Watchlist entries only appear in a briefing
when the item also has a new development in the current window.

## Commands

| Command | Purpose |
|---|---|
| plan | compute the window, do not mutate state |
| update | merge this run's items, recompute statuses, write state |

Both accept --state and print JSON to stdout; update also accepts --items (the
run's curated items array), --out (write target) and --date (YYYY-MM-DD).
