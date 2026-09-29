#!/usr/bin/env node
// Continuity and coverage-window logic for the daily-news-briefing skill.
// Zero dependencies. Usage:
//   node update-state.mjs plan   --state FILE
//   node update-state.mjs update --state FILE --items FILE [--out FILE] [--date YYYY-MM-DD] [--force]
//
// Window rule (never prompts):
//   previous briefing exists -> from its timestamp to now, capped at 72h
//   no previous briefing     -> the latest 24h
//
// plan records the window it computes in the state as plannedWindow, and update
// closes coverage at that recorded end rather than at its own clock. The state
// holds the coverage baseline and a seven-day index of recent stories only: it
// derives nothing about newness.

import { readFileSync, statSync, writeFileSync } from 'node:fs';

const MAX_WINDOW_HOURS = 72;
const FIRST_RUN_HOURS = 24;
const MIN_WINDOW_HOURS = 6;
// A recorded plan older than this - or one that predates the last briefing - is
// a leftover from an aborted run: ignore it and fall back to now.
const PLANNED_WINDOW_MAX_AGE_HOURS = 12;
// A recorded end slightly ahead of this shell's clock is tolerated, because two
// processes can straddle a second or a small skew; anything further ahead is a
// corrupt record, not a window a live run could have announced.
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60000;
// An --items file is written after the planned window ended, so a file older
// than that end by more than this grace belongs to an earlier run. The grace
// absorbs filesystem timestamp granularity, not a stale index.
const PLANNED_INDEX_GRACE_MS = 60000;
const RETENTION_DAYS = 7;
const STATE_VERSION = 2;
const HOUR = 3600000;
const DAY = 86400000;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function validDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The window label is human-facing and the briefing header declares
// Asia/Shanghai, so stamp in that zone. Using an explicit formatter keeps the
// label consistent with the coverage note that cites the same window (the old
// toISOString() form printed UTC and disagreed with it). Hour '24' is
// normalised to '00' for engines that emit it at midnight. The same formatter
// supplies the default briefing date, so --date defaults to the Shanghai day
// rather than the UTC day and a late-evening run cannot date itself a day early.
const LABEL_TZ = 'Asia/Shanghai';
const labelFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: LABEL_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function partsOf(date) {
  const parts = {};
  for (const p of labelFormat.formatToParts(date)) parts[p.type] = p.value;
  return parts;
}

function stamp(date) {
  const parts = partsOf(date);
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return parts.year + '-' + parts.month + '-' + parts.day + ' ' + hour + ':' + parts.minute;
}

function dateKey(date) {
  const parts = partsOf(date);
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function planWindow(previousAt, now) {
  const previous = validDate(previousAt);
  let since;
  let capped = false;
  let gapHours = null;
  if (previous) {
    const floor = new Date(now.getTime() - MAX_WINDOW_HOURS * HOUR);
    since = previous > floor ? previous : floor;
    capped = previous < floor;
    gapHours = round1((now.getTime() - previous.getTime()) / HOUR);
  } else {
    since = new Date(now.getTime() - FIRST_RUN_HOURS * HOUR);
  }
  const hours = round1((now.getTime() - since.getTime()) / HOUR);
  const tail = ' (' + stamp(since) + ' -> ' + stamp(now) + ' ' + LABEL_TZ + ')';
  let label;
  if (previous) {
    label = 'Last briefing ' + stamp(previous).slice(0, 10) + ' - covering latest ' + hours + 'h' + tail;
    if (capped) label += ' - ' + Math.round(gapHours - hours) + 'h not covered';
  } else {
    label = 'No previous briefing - covering latest ' + hours + 'h' + tail;
  }
  return {
    since: since.toISOString(),
    until: now.toISOString(),
    hours,
    capped,
    gapHours,
    uncoveredHours: capped ? round1(gapHours - hours) : 0,
    previousBriefingAt: previous ? previous.toISOString() : null,
    maxWindowHours: MAX_WINDOW_HOURS,
    firstRunHours: FIRST_RUN_HOURS,
    label,
  };
}

// The single test both branches use to decide whether a stored plannedWindow is
// still this run's. Sharing it is the point: plan may announce only a record
// update will consume, and update may consume only a record plan would have
// announced, so the end in the briefing header and the baseline in the state
// cannot drift apart. A record fails it when its until is unparseable, sits
// behind the last briefing, is older than PLANNED_WINDOW_MAX_AGE_HOURS, or lies
// in the future - each is a leftover from an aborted run or a skewed clock,
// never a window a live run announced. Returns the parsed end, or null when the
// record is unusable and the caller must fall back to its own clock.
function usablePlannedWindow(state, baseline, now) {
  const plannedEnd = state && state.plannedWindow ? validDate(state.plannedWindow.until) : null;
  if (!plannedEnd) return null;
  if (baseline && plannedEnd.getTime() < baseline.getTime()) return null;
  if (now.getTime() - plannedEnd.getTime() > PLANNED_WINDOW_MAX_AGE_HOURS * HOUR) return null;
  if (plannedEnd.getTime() > now.getTime() + CLOCK_SKEW_TOLERANCE_MS) return null;
  return plannedEnd;
}

// Version 1 keyed items by a hash of the normalized headline and host and kept
// key/status/timesSeen/outlets/firstSeen beside them; version 2 is a plain
// array that derives nothing. Convert on read - silently, and losslessly for
// the fields that survive - so the next write lands as version 2.
function toV2(state) {
  const next = Object.assign({}, state);
  if (Array.isArray(next.items)) return next;
  const keyed = next.items && typeof next.items === 'object' ? next.items : {};
  const items = [];
  for (const key of Object.keys(keyed)) {
    const it = keyed[key] || {};
    const lastSeen = it.lastSeen || it.firstSeen || null;
    const seen = validDate(lastSeen);
    items.push({
      title: it.title || '',
      section: it.section || '',
      aspect: it.aspect || '',
      outlet: it.outlet || '',
      primaryUrl: it.primaryUrl || '',
      flags: Array.isArray(it.flags) ? it.flags : [],
      watch: Boolean(it.watch),
      date: seen ? dateKey(seen) : '',
      lastSeen: lastSeen,
    });
  }
  next.items = items;
  return next;
}

function retained(items, now) {
  const keep = [];
  for (const it of items) {
    const seen = validDate(it && it.lastSeen);
    if (!seen) continue;
    if ((now.getTime() - seen.getTime()) / DAY <= RETENTION_DAYS) keep.push(it);
  }
  return keep;
}

// The watchlist is an index derived from the retained items, never a separately
// maintained list: deduplicated by title, keeping the earliest date.
function buildWatchlist(items) {
  const byTitle = new Map();
  for (const it of items) {
    if (!it || !it.watch) continue;
    const title = it.title || '';
    const before = byTitle.get(title);
    if (!before || String(it.date || '') < String(before.date || '')) byTitle.set(title, it);
  }
  return Array.from(byTitle.values()).map((it) => ({ title: it.title, date: it.date, lastSeen: it.lastSeen }));
}

function main() {
  const command = process.argv[2];
  const statePath = arg('--state', 'briefing-state.json');
  const now = new Date();
  const raw = readJson(statePath, null);

  if (command === 'plan') {
    const state = raw && typeof raw === 'object' ? raw : null;
    const window = planWindow(state && state.lastBriefingAt, now);
    // Record the window so update closes coverage at the same end time. An
    // absent or unreadable state is left alone: plan never creates the file.
    // Re-running plan for a baseline that already has a plan keeps the recorded
    // one, so the end the header announces is the end update consumes.
    let effective = window;
    if (state) {
      const baseline = validDate(state.lastBriefingAt);
      // Same predicate as update: a record announced here but refused there
      // would leave the header declaring a window the state never stores.
      if (usablePlannedWindow(state, baseline, now)) {
        effective = state.plannedWindow;
      } else {
        const payload = Object.assign({}, state, { plannedWindow: window });
        try {
          writeFileSync(statePath, JSON.stringify(payload, null, 2) + '\n');
        } catch (err) {
          process.stderr.write('update-state: cannot record the planned window in ' + statePath + ': '
            + String((err && err.message) || err) + '\n');
          process.exit(2);
        }
      }
    }
    process.stdout.write(JSON.stringify({ command: 'plan', statePath, window: effective }, null, 2) + '\n');
    return;
  }

  if (command !== 'update') {
    process.stderr.write('usage: update-state.mjs plan|update --state FILE [--items FILE] [--out FILE] [--date YYYY-MM-DD] [--force]\n');
    process.exit(1);
  }

  const itemsPath = arg('--items', '');
  if (!itemsPath) {
    process.stderr.write('update-state: update requires --items FILE\n');
    process.exit(1);
  }
  let incoming;
  try {
    incoming = JSON.parse(readFileSync(itemsPath, 'utf8'));
  } catch (err) {
    process.stderr.write('update-state: cannot read --items file ' + itemsPath + ': ' + String((err && err.message) || err) + '\n');
    process.exit(2);
  }
  if (!Array.isArray(incoming)) {
    process.stderr.write('update-state: --items file ' + itemsPath + ' must hold a JSON array of items\n');
    process.exit(2);
  }
  for (let i = 0; i < incoming.length; i++) {
    const element = incoming[i];
    if (element && typeof element === 'object' && !Array.isArray(element)) continue;
    const what = element === null ? 'null' : Array.isArray(element) ? 'an array' : 'a ' + typeof element;
    process.stderr.write('update-state: --items file ' + itemsPath + ' element ' + i + ' is ' + what
      + ', but every element must be a JSON object\n');
    process.exit(2);
  }

  const state = toV2(raw && typeof raw === 'object' ? raw : {});
  const nowIso = now.toISOString();
  // Coverage ends where plan said the briefing would end, not where this write
  // happens: otherwise the announced end and the stored baseline drift apart by
  // however long the run took, and the next window silently skips that gap.
  // Only a plausible record is used: a plan left behind by an aborted run must
  // not move the baseline backwards or reopen a window that was never announced.
  const baseline = validDate(state.lastBriefingAt);
  // Same predicate plan applied before it announced: consume the recorded end
  // only when it is a record plan would have announced too.
  const plannedEnd = usablePlannedWindow(state, baseline, now);
  const coverageEnd = plannedEnd || now;
  const window = planWindow(state.lastBriefingAt, coverageEnd);
  const force = process.argv.includes('--force');

  // A usable record means this run started with plan, so the index must have
  // been rebuilt for it: an --items file older than the window it closes is a
  // previous day's index and would be ingested as this run's. No record means
  // update is being run on its own, where there is nothing to compare against.
  if (plannedEnd) {
    const itemsMtime = statSync(itemsPath).mtimeMs;
    if (itemsMtime < plannedEnd.getTime() - PLANNED_INDEX_GRACE_MS) {
      process.stderr.write('update-state: --items file ' + itemsPath + ' is older than the planned window it would close (last written '
        + new Date(itemsMtime).toISOString() + ', window ends ' + plannedEnd.toISOString()
        + '), so it is a leftover index from an earlier run. Nothing was written. Re-run scripts/md-to-items.mjs for this briefing and pass the file it writes.\n');
      process.exit(3);
    }
  }

  // --force excuses a short window, never an impossible one: a negative window
  // means the end used above sits behind the baseline, so the write is refused.
  if (window.hours < 0) {
    process.stderr.write('update-state: coverage window would be ' + window.hours
      + 'h (its end is behind the last briefing), so the baseline cannot move backwards. Nothing was written. '
      + 'The recorded baseline can now only be corrupt by hand or by a backwards host clock: correct '
      + 'lastBriefingAt in the state file, or delete the state file to start fresh (deleting it drops the '
      + 'recorded coverage, and the next run falls back to its own first-run window).\n');
    process.exit(3);
  }

  if (window.hours < MIN_WINDOW_HOURS && !force) {
    process.stderr.write('update-state: coverage window is only ' + window.hours + 'h (under ' + MIN_WINDOW_HOURS
      + 'h), so this looks like a second run on the same day. Nothing was written. '
      + 'Pass --force only after checking the run is genuinely new.\n');
    process.exit(3);
  }

  const lastBriefingDate = arg('--date', dateKey(coverageEnd));
  const items = retained(state.items, now);
  for (const item of incoming) {
    items.push({
      title: item.title || '',
      section: item.section || '',
      aspect: item.aspect || '',
      outlet: item.outlet || '',
      primaryUrl: item.primaryUrl || '',
      flags: Array.isArray(item.flags) ? item.flags : [],
      watch: Boolean(item.watch),
      // Stamped here, not read from the input: the index records when this run
      // saw the story, not what the feed or the agent claimed.
      date: lastBriefingDate,
      lastSeen: nowIso,
    });
  }
  const watchlist = buildWatchlist(items);

  const outPath = arg('--out', statePath);
  const payload = {
    version: STATE_VERSION,
    updatedAt: nowIso,
    lastBriefingAt: coverageEnd.toISOString(),
    lastBriefingDate,
    window,
    plannedWindow: null,
    items,
    watchlist,
  };
  try {
    writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  } catch (err) {
    process.stderr.write('update-state: cannot write ' + outPath + ': ' + String((err && err.message) || err) + '\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify({
    command: 'update',
    statePath: outPath,
    lastBriefingAt: payload.lastBriefingAt,
    lastBriefingDate,
    window: payload.window,
    itemCount: items.length,
    watchlistCount: watchlist.length,
  }, null, 2) + '\n');
}

main();
