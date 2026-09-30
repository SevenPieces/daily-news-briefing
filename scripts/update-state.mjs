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

import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';

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

// Reading the state is not a lookup with a fallback. A file that exists but
// cannot be parsed is evidence this run must not overwrite: treating it as "no
// state" made plan announce a first-run window over a truncated
// briefing-state.json ("No previous briefing - covering latest 24h") and update
// then overwrite the file, destroying lastBriefingAt and the whole item index,
// with exit 0 and nothing on stderr. Only a missing file is a genuine first run;
// every other failure - a parse error, or a read error such as EACCES - names
// the path and exits 2 from both commands, before anything is written.
function readState(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { exists: false, text: null, state: null };
    process.stderr.write('update-state: cannot read state file ' + path + ': '
      + String((err && err.message) || err) + '\n');
    process.exit(2);
  }
  try {
    return { exists: true, text, state: JSON.parse(text) };
  } catch (err) {
    process.stderr.write('update-state: state file ' + path + ' exists but is not valid JSON ('
      + String((err && err.message) || err) + '); reading it as "no state" would overwrite a coverage baseline and an item index '
      + 'that cannot be recovered, so nothing was written. Fix the file by hand, or delete it to start fresh.\n');
    process.exit(2);
  }
}

// A state write must never leave a truncated file behind: an interrupted
// writeFileSync produces exactly the half-written state readState refuses. The
// payload goes to a temp file in the target's own directory - so the rename
// stays on one filesystem and is atomic - and is renamed over the target. On
// failure the temp is removed and the previous state is left intact.
function writeStateAtomic(path, data) {
  const tmp = path + '.' + process.pid + '.tmp';
  try {
    // The state is local state, not a deliverable: explicit 0600 rather than the
    // process umask, which made it group-writable under a 0002 umask.
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch (cleanupErr) {
      // The temp may never have been created; the original error is the story.
    }
    throw err;
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
// cannot drift apart. A record fails it when its until is unparseable, has no
// parseable since, starts after it ends, sits behind the last briefing, is older
// than PLANNED_WINDOW_MAX_AGE_HOURS, lies in the future, or is shorter than
// MIN_WINDOW_SECONDS - each is a leftover from an aborted run or a skewed clock,
// never a window a live run announced and update could consume. The verdict
// names the refusal rather than just returning null, because update must say
// which predicate failed before it falls back to its own clock: an ignored
// record moves the stored baseline away from the end the header announced, and
// that must not happen in silence.
function classifyPlannedWindow(state, baseline, now) {
  const planned = state && state.plannedWindow ? state.plannedWindow : null;
  const plannedEnd = planned ? validDate(planned.until) : null;
  // A recorded end that does not parse is a rejection like any other, and it
  // must name itself too: the same warning covers every rejected record.
  if (!plannedEnd) return { plannedEnd: null, reason: planned ? 'not a parseable date' : null };
  // A record without a usable start is not a window this run can announce:
  // Step 3 takes --since from plan's stdout, so a record carrying only until
  // would make it undefined, and a start after the end is no window at all.
  const plannedSince = validDate(planned.since);
  if (!plannedSince) return { plannedEnd: null, reason: 'missing a parseable start' };
  if (plannedSince.getTime() > plannedEnd.getTime()) return { plannedEnd: null, reason: 'a start after its end' };
  if (baseline && plannedEnd.getTime() < baseline.getTime()) return { plannedEnd: null, reason: 'behind the baseline' };
  if (now.getTime() - plannedEnd.getTime() > PLANNED_WINDOW_MAX_AGE_HOURS * HOUR) {
    return { plannedEnd: null, reason: 'older than ' + PLANNED_WINDOW_MAX_AGE_HOURS + 'h' };
  }
  if (plannedEnd.getTime() > now.getTime() + CLOCK_SKEW_TOLERANCE_MS) return { plannedEnd: null, reason: 'in the future' };
  // A record whose own window is shorter than update's MIN_WINDOW_SECONDS can
  // never be consumed: update would close coverage at that end and refuse the
  // short window, and plan's next pass reuses the same frozen end, so every
  // retry fails until the record ages out. Refusing the record here makes plan
  // recompute from the baseline instead, and the retry widens with real time.
  if (Math.floor((plannedEnd.getTime() - plannedSince.getTime()) / 1000) < MIN_WINDOW_SECONDS) {
    return { plannedEnd: null, reason: 'shorter than ' + MIN_WINDOW_SECONDS + 's' };
  }
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
// maintained list: deduplicated by title, keeping the earliest date - when the
// title entered the list - and the newest lastSeen, when it was last reported.
// Keeping the earliest sighting's lastSeen too made a story reported again today
// still report a lastSeen from up to seven days ago, the oldest sighting
// retention still holds, so a live story read as an aged-out one. Membership is
// unchanged: a title stays while any watch-flagged sighting is retained, and
// leaves when none is within RETENTION_DAYS.
function buildWatchlist(items) {
  const byTitle = new Map();
  for (const it of items) {
    if (!it || !it.watch) continue;
    const title = it.title || '';
    const seen = validDate(it.lastSeen);
    const entry = byTitle.get(title);
    if (!entry) {
      byTitle.set(title, { title, date: it.date, lastSeen: it.lastSeen });
      continue;
    }
    if (String(it.date || '') < String(entry.date || '')) entry.date = it.date;
    const latest = validDate(entry.lastSeen);
    if (seen && (!latest || seen.getTime() > latest.getTime())) entry.lastSeen = it.lastSeen;
  }
  return Array.from(byTitle.values()).map((it) => ({ title: it.title, date: it.date, lastSeen: it.lastSeen }));
}

function main() {
  const command = process.argv[2];
  // The command is checked before the state is read: an unknown command is a
  // usage error (exit 1) whatever the file happens to contain, while the
  // unreadable-or-unparseable state check below is the more specific failure.
  if (command !== 'plan' && command !== 'update') {
    process.stderr.write('usage: update-state.mjs plan|update --state FILE [--items FILE] [--out FILE] [--date YYYY-MM-DD] [--force]\n');
    process.exit(1);
  }
  const statePath = arg('--state', 'briefing-state.json');
  const now = new Date();
  const loaded = readState(statePath);
  const raw = loaded.state;

  if (command === 'plan') {
    const state = raw && typeof raw === 'object' ? raw : null;
    const window = planWindow(state && state.lastBriefingAt, now);
    // Record the window so update closes coverage at the same end time. An
    // absent state is a genuine first run and is left alone: plan never creates
    // the file (an unreadable or unparseable one is fatal in readState).
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
        // Under an hour the age is reported in minutes, because the hour
        // reading is rounded to a tenth of an hour - six minutes wide - so a
        // record written three minutes ago and one written eight minutes ago
        // both read '0.1h old', anything under three minutes reads '0h old',
        // and the reading cannot show how long ago a fresh record was written.
        // Minutes are also what the ahead-of-clock branch below prints, so the
        // two agree in unit.
        // The branch turns on that rounded reading rather than on the raw span:
        // a span of 59m57s rounds to sixty minutes, and comparing the raw span
        // against HOUR would let the minutes branch print the '60m old' the
        // hour branch exists to avoid. Choosing by the rounded value keeps the
        // seam honest - the last minutes reading is 59.9m, and the first hour
        // reading is the 1h that same rounding of the span produces.
        const ageMinutes = round1(ageMs / 60000);
        const announced = ageMs < 0
          ? ' and lies ' + round1(-ageMs / 60000) + 'm ahead of this shell\'s clock'
          : ageMinutes < 60
            ? ' and is ' + ageMinutes + 'm old'
            : ' and is ' + round1(ageMs / HOUR) + 'h old';
        process.stderr.write('update-state: reusing the planned window already recorded in ' + statePath
          + ' and not computing a new one: it ends ' + effective.until + announced
          + ', so it was announced by an earlier plan run. '
          + 'Delete plannedWindow in the state file, or plan against a different --state file, for a fresh window.\n');
      } else {
        // A record exists but the shared predicate refused it. update names that
        // same refusal when it meets one; plan replaced the record in silence, so
        // a leftover from an aborted run simply disappeared. Name it here too,
        // before the fresh window is recorded, so the two commands agree.
        const verdict = classifyPlannedWindow(state, baseline, now);
        if (verdict.reason) {
          process.stderr.write('update-state: the planned window already recorded in ' + statePath
            + ' was ignored (' + verdict.reason + '), so a fresh window was computed from the baseline '
            + 'and the recorded one is replaced.\n');
        }
        // A baseline ahead of this shell's clock - a host clock that stepped
        // backwards, or a hand-edited state - makes the computed window
        // negative, and the label would announce "covering latest -2h". Recording
        // that in silence hides a corrupt baseline behind a plausible-looking
        // run; clamping since to until would hide the same corruption behind a
        // "0h" label instead. Say it out loud and leave update's negative-window
        // guard to refuse the write.
        const spanMs = validDate(window.until).getTime() - validDate(window.since).getTime();
        if (spanMs <= 0) {
          process.stderr.write('update-state: lastBriefingAt ' + state.lastBriefingAt
            + ' is ahead of this shell\'s clock, so the window computed from it covers ' + window.hours
            + 'h (' + window.since + ' -> ' + window.until + ') and would read as a negative window; recording it as computed. '
            + 'A baseline in the future can never be covered: correct lastBriefingAt in ' + statePath
            + ' to a past instant, or delete the state file to start fresh.\n');
        }
        const payload = Object.assign({}, state, { plannedWindow: window });
        // plan and update are read-modify-write passes over the same file and
        // must not run concurrently. plan holds a single field to add, so it
        // re-reads the file immediately before the write and refuses when
        // another process committed something in between - the alternative is
        // silently dropping a baseline or an item index plan never saw.
        try {
          if (readFileSync(statePath, 'utf8') !== loaded.text) {
            process.stderr.write('update-state: ' + statePath + ' changed while plan was running (another plan or update '
              + 'committed to it), so this plan refuses to overwrite it with the content it read. Nothing was written; re-run plan.\n');
            process.exit(2);
          }
        } catch (err) {
          process.stderr.write('update-state: cannot re-read ' + statePath + ' before writing it: '
            + String((err && err.message) || err) + '\n');
          process.exit(2);
        }
        try {
          writeStateAtomic(statePath, JSON.stringify(payload, null, 2) + '\n');
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

  const itemsPath = arg('--items', '');
  if (!itemsPath) {
    process.stderr.write('update-state: update requires --items FILE\n');
    process.exit(1);
  }
  // --date keys every appended item and the (date,title) dedupe, so a malformed
  // value would poison the whole index for this run; accept only the shape the
  // default (dateKey of the coverage end) produces.
  const dateArg = arg('--date', null);
  if (dateArg !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(dateArg))) {
    process.stderr.write('update-state: --date ' + dateArg + ' is not YYYY-MM-DD, so it cannot key the item index; '
      + 'pass the Asia/Shanghai briefing date or omit --date.\n');
    process.exit(2);
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
  //
  // The comparison is deliberate and needs no timezone conversion: mtimeMs is
  // epoch milliseconds, and plannedEnd.getTime() is the same instant parsed from
  // the record's ISO-8601 stamp, so a "+08:00" until and a UTC mtime already sit
  // in one clock domain and the offset cancels. In Step 6 order (md-to-items
  // after plan) the file is newer than the end the record carries, so the guard
  // stays quiet; it fires only for a file written before the plan this update
  // consumed. A stat failure here means the file was removed between the read
  // above and this point, which is unreadable input rather than a stale index.
  if (plannedEnd) {
    let itemsMtime;
    try {
      itemsMtime = statSync(itemsPath).mtimeMs;
    } catch (err) {
      process.stderr.write('update-state: cannot stat --items file ' + itemsPath
        + ' to compare it against the planned window: ' + String((err && err.message) || err) + '\n');
      process.exit(2);
    }
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
      + 'Delete plannedWindow in the state file - plan reuses it, which freezes the window at this length - '
      + 'or re-run plan against a state file without it, or pass --force only after checking the run is genuinely new.\n');
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

  const lastBriefingDate = dateArg !== null ? dateArg : dateKey(coverageEnd);
  const items = retained(state.items, now);
  // Step 6 can write the same curated line twice: a re-run of the step rebuilds
  // the index from the same Markdown, and two briefings on one calendar day that
  // both carry a recurring title - a retained watchlist entry, say - collide on
  // the (date, title) key by design. Either way an entry already held for this
  // date with this title is already covered, so it is kept once rather than
  // appended again. That key is the two stored fields the index is read by, and
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
      + 'index for ' + lastBriefingDate + ' with the same title, so they were kept once rather than appended again; the coverage '
      + 'baseline moved to ' + coverageEnd.toISOString() + ' all the same.\n');
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
  // plan and update are read-modify-write passes over the same file and must not
  // run concurrently. When update writes back to the file it read, refuse if
  // anything committed in between: the payload is a full replacement, so
  // overwriting would drop a baseline or an item index this run never saw. A
  // different --out is a fresh target with no previous content to lose.
  if (outPath === statePath && loaded.exists) {
    let current;
    try {
      current = readFileSync(statePath, 'utf8');
    } catch (err) {
      process.stderr.write('update-state: cannot re-read ' + statePath + ' before writing it: '
        + String((err && err.message) || err) + '\n');
      process.exit(2);
    }
    if (current !== loaded.text) {
      process.stderr.write('update-state: ' + statePath + ' changed while update was running (another plan or update '
        + 'committed to it), so this update refuses to overwrite it with the state it read. Nothing was written; re-run plan and update.\n');
      process.exit(2);
    }
  }
  try {
    writeStateAtomic(outPath, JSON.stringify(payload, null, 2) + '\n');
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
