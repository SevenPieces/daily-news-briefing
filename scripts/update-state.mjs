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
// "Seconds old" in the agreement, operationalised at two minutes: what the guard
// catches is a second update moments after the last one, not a mid-day re-run or
// a catch-up, which must proceed without --force.
const MIN_WINDOW_SECONDS = 120;
// The seconds-old guard is narrow on purpose, so a re-run that spends a couple of
// minutes fixing a typo and re-parsing the Markdown slips above it. A second
// Step 6 pass has no planned window left - the first pass nulled it - and would
// close a window measured only from the baseline to its own clock, which is a
// re-run of a completed run, not a new briefing. This is the upper band of that
// same case: still minutes, never hours.
const RERUN_WINDOW_SECONDS = 600;
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
// never a window a live run announced. The verdict names the refusal rather than
// just returning null, because update must say which predicate failed before it
// falls back to its own clock: an ignored record moves the stored baseline away
// from the end the header announced, and that must not happen in silence.
function classifyPlannedWindow(state, baseline, now) {
  const planned = state && state.plannedWindow ? state.plannedWindow : null;
  const plannedEnd = planned ? validDate(planned.until) : null;
  // A recorded end that does not parse is a rejection like any other, and it
  // must name itself too: the same warning covers every rejected record.
  if (!plannedEnd) return { plannedEnd: null, reason: planned ? 'not a parseable date' : null };
  if (baseline && plannedEnd.getTime() < baseline.getTime()) return { plannedEnd: null, reason: 'behind the baseline' };
  if (now.getTime() - plannedEnd.getTime() > PLANNED_WINDOW_MAX_AGE_HOURS * HOUR) {
    return { plannedEnd: null, reason: 'older than ' + PLANNED_WINDOW_MAX_AGE_HOURS + 'h' };
  }
  if (plannedEnd.getTime() > now.getTime() + CLOCK_SKEW_TOLERANCE_MS) return { plannedEnd: null, reason: 'in the future' };
  return { plannedEnd, reason: null };
}

// The boolean plan asks for; the end is null exactly when the record is unusable
// and the caller must fall back to its own clock.
function usablePlannedWindow(state, baseline, now) {
  return classifyPlannedWindow(state, baseline, now).plannedEnd;
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
        // A reuse is announced rather than silent: a plannedWindow orphaned by
        // an aborted run would otherwise become this run's window, and the next
        // briefing would cover a window no live run chose. The record's age -
        // measured from the end it announced, which is when plan wrote it - is
        // what separates a record this run means from yesterday's leftover.
        // A usable record may sit up to CLOCK_SKEW_TOLERANCE_MS ahead of this
        // clock, and the raw difference would print as '-0.1h old' - or, once
        // rounded, as '0h old' - claiming a past this clock never saw. Only a
        // record behind this clock is announced by its age; one ahead of it is
        // announced as ending in the future, in minutes because the tolerated
        // skew band is minutes wide.
        // stderr only: stdout prints the same JSON and this path writes nothing.
        const recordedAt = validDate(effective.until);
        const ageMs = now.getTime() - recordedAt.getTime();
        const announced = ageMs >= 0
          ? ' and is ' + round1(ageMs / HOUR) + 'h old'
          : ' and lies ' + round1(-ageMs / 60000) + 'm ahead of this shell\'s clock';
        process.stderr.write('update-state: reusing the planned window already recorded in ' + statePath
          + ' and not computing a new one: it ends ' + effective.until + announced
          + ', so it was announced by an earlier plan run. '
          + 'Delete plannedWindow in the state file, or plan against a different --state file, for a fresh window.\n');
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
  // only when it is a record plan would have announced too. When it is refused,
  // say so: coverage would end at this run's clock instead, and a silent fallback is
  // exactly the announced-end/stored-baseline drift this change set removes.
  const verdict = classifyPlannedWindow(state, baseline, now);
  if (verdict.reason) {
    process.stderr.write('update-state: the recorded planned window ends ' + state.plannedWindow.until + ', which is '
      + verdict.reason + ', so it is ignored and coverage would end at this run\'s clock (' + nowIso + ') instead.\n');
  }
  const plannedEnd = verdict.plannedEnd;
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

  // The window is measured from its own ends, not from window.hours: that field
  // is rounded to a tenth of an hour for the label and cannot resolve the seconds
  // these guards turn on (a two-minute window would read as 0.0h, and a window up
  // to three minutes behind the baseline rounds to -0, which is not < 0). Whole
  // seconds, floored: the threshold is a floor, so 119.9s is under two minutes
  // while 120.0s is not.
  const windowMs = validDate(window.until).getTime() - validDate(window.since).getTime();
  const windowSeconds = Math.floor(windowMs / 1000);

  // --force excuses a short window, never an impossible one: a negative window
  // means the end used above sits behind the baseline, so the write is refused.
  // Both guards read this one measurement, so they cannot disagree about the sign.
  if (windowSeconds < 0) {
    process.stderr.write('update-state: coverage window would be ' + window.hours
      + 'h (its end is behind the last briefing), so the baseline cannot move backwards. Nothing was written. '
      + 'The recorded baseline can now only be corrupt by hand or by a backwards host clock: correct '
      + 'lastBriefingAt in the state file, or delete the state file to start fresh (deleting it drops the '
      + 'recorded coverage, and the next run falls back to its own first-run window).\n');
    process.exit(3);
  }

  if (windowSeconds < MIN_WINDOW_SECONDS && !force) {
    process.stderr.write('update-state: coverage window is only ' + windowSeconds + 's (under ' + MIN_WINDOW_SECONDS
      + 's), so this looks like a second update moments after the last one. Nothing was written. '
      + 'Pass --force only after checking the run is genuinely new.\n');
    process.exit(3);
  }

  // The same case, minutes wide instead of seconds. A second Step 6 pass finds no
  // record left - the first pass consumed it - so it would close a window measured
  // only from the baseline to its own clock and move lastBriefingAt to a moment no
  // plan announced, silently skipping the coverage in between. Refuse, and name
  // both remedies rather than rewrite the baseline in silence.
  if (!plannedEnd && windowSeconds < RERUN_WINDOW_SECONDS && !force) {
    process.stderr.write('update-state: no usable planned window was recorded, and the window this update would close is only '
      + windowSeconds + 's (under ' + RERUN_WINDOW_SECONDS + 's), so the state was already closed minutes ago (last briefing '
      + state.lastBriefingAt + ') and this is a re-run of a completed run, not a new briefing. Nothing was written. '
      + 'A re-run rewrites the coverage baseline to this shell\'s clock. Re-run plan (Step 2) so update has a window of its own '
      + 'to consume, or pass --force only after checking the run is genuinely new.\n');
    process.exit(3);
  }

  const lastBriefingDate = arg('--date', dateKey(coverageEnd));
  const items = retained(state.items, now);
  // A re-run of Step 6 appends the same curated lines a second time: the first
  // pass consumed the planned window, so this pass rebuilds the index from the
  // same Markdown and every story would land twice. An entry already held under
  // the same date and title is this run's own earlier write, not a new story, so
  // it is kept once. The key is the two stored fields the index is read by, and
  // only entries already in the state are matched - the incoming batch is never
  // compared with itself, so a line the Markdown repeats inside one run is still
  // appended as many times as it is written.
  const held = new Set(items.map((it) => String(it.date || '') + '\u0000' + String(it.title || '')));
  let alreadyHeld = 0;
  for (const item of incoming) {
    const entry = {
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
    };
    if (held.has(entry.date + '\u0000' + entry.title)) {
      alreadyHeld++;
      continue;
    }
    items.push(entry);
  }
  if (alreadyHeld) {
    process.stderr.write('update-state: ' + alreadyHeld + ' of ' + incoming.length + ' curated entries are already in the '
      + 'index for ' + lastBriefingDate + ' with the same title, so they were kept once rather than appended again; this is a '
      + 're-run of a completed Step 6, and the coverage baseline moved to ' + coverageEnd.toISOString() + ' all the same.\n');
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
