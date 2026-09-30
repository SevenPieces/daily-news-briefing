// update-state.mjs - the coverage-window ledger and the item index.
//
// Two commands share one state file: plan computes and records the window the
// briefing will cover, update closes that window and rebuilds the index and the
// watchlist from it. The tests below pin the contract the script was hardened
// for: a missing state is a first run, an unreadable one is never overwritten,
// the window is announced in Asia/Shanghai and consumed at exactly the end that
// was announced, and the watchlist and index are derived rather than appended
// blindly. Each test names the regression it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { jsonOf, readJson, readText, runScript, tempDir, writeJson, writeText } from './helpers.mjs';
import { state } from './fixtures.mjs';

const SCRIPT = 'update-state.mjs';
const HOUR = 3600000;
const MINUTE = 60000;
const DAY = 86400000;

/** Run the script with the temp dir as cwd, so nothing can be written here. */
function run(dir, args) {
  return runScript(SCRIPT, args, { cwd: dir });
}

const agoHours = (h) => new Date(Date.now() - h * HOUR).toISOString();
const aheadMinutes = (m) => new Date(Date.now() + m * MINUTE).toISOString();
const instant = (value) => new Date(value).getTime();

// Asia/Shanghai is UTC+8 with no DST, so shifting the epoch and reading the UTC
// fields is an expectation derived independently of the script's Intl formatter.
const shanghaiDate = (ms) => new Date(ms + 8 * HOUR).toISOString().slice(0, 10);
const shanghaiStamp = (ms) => new Date(ms + 8 * HOUR).toISOString().slice(0, 16).replace('T', ' ');

/** One item as scripts/md-to-items.mjs writes it. */
const item = (title) => ({
  title,
  section: 'global',
  aspect: 'economy',
  outlet: 'EXAMPLE',
  primaryUrl: 'https://example.com/' + encodeURIComponent(title),
  flags: [],
  watch: false,
});

/** A watched item, for the watchlist cases. */
const watched = (title, date, lastSeen, extra = {}) => Object.assign({
  title,
  section: 'watch',
  aspect: 'watch',
  outlet: '',
  primaryUrl: '',
  flags: [],
  watch: true,
  date,
  lastSeen,
}, extra);

const ALL_WINDOW_KEYS = [
  'capped', 'firstRunHours', 'gapHours', 'hours', 'label', 'maxWindowHours',
  'previousBriefingAt', 'since', 'uncoveredHours', 'until',
];

/**
 * The largest lag (at most 11h, inside the 12h record-age limit) whose instant
 * falls on a different Shanghai calendar day than its own UTC day - one instant,
 * two dates, so a UTC-based date is distinguishable. Returns null in the one
 * window where no such instant is reachable (a run between Shanghai 19:00 and
 * midnight): the whole last 12h then shares a single UTC date.
 */
function differentialLag() {
  for (let lag = 11 * HOUR; lag >= 2 * MINUTE; lag -= MINUTE) {
    const ms = Date.now() - lag;
    if (shanghaiDate(ms) !== new Date(ms).toISOString().slice(0, 10)) return lag;
  }
  return null;
}

// --- the first run -------------------------------------------------------

test('a missing state file is a genuine first run: plan announces 24h and creates nothing', (t) => {
  const dir = tempDir(t);
  const statePath = join(dir, 'briefing-state.json');
  const res = run(dir, ['plan', '--state', statePath]);
  assert.equal(res.status, 0, res.stderr);
  const payload = jsonOf(res.stdout);
  assert.equal(payload.command, 'plan');
  assert.equal(payload.statePath, statePath);
  const w = payload.window;

  // Every key of the window contract, not just the ones asserted below.
  assert.deepEqual(Object.keys(w).sort(), ALL_WINDOW_KEYS);
  assert.equal(w.hours, 24);
  assert.equal(w.firstRunHours, 24);
  assert.equal(w.maxWindowHours, 72);
  assert.equal(w.previousBriefingAt, null);
  assert.equal(w.capped, false);
  assert.equal(w.gapHours, null);
  assert.equal(w.uncoveredHours, 0);
  assert.equal(instant(w.until) - instant(w.since), 24 * HOUR);
  assert.match(w.label, /^No previous briefing - covering latest 24h \(/);
  assert.ok(w.label.includes(shanghaiStamp(instant(w.since)) + ' -> ' + shanghaiStamp(instant(w.until)) + ' Asia/Shanghai'), w.label);

  // Regression: the window used to be recorded even when there was no file to
  // record it into, so a first run left a state holding only a plan.
  assert.equal(existsSync(statePath), false, 'a first-run plan must not create the state file');
});

test('update alone on a missing state file creates it', (t) => {
  const dir = tempDir(t);
  const statePath = join(dir, 'briefing-state.json');
  const itemsPath = writeJson(join(dir, '.items.json'), [item('First story')]);
  const res = run(dir, ['update', '--state', statePath, '--items', itemsPath]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(existsSync(statePath), 'update must create the state file it did not find');
  const st = readJson(statePath);
  assert.equal(st.version, 2);
  assert.equal(st.plannedWindow, null);
  assert.equal(st.window.hours, 24, 'an absent state falls back to the first-run window');
  assert.equal(st.items.length, 1);
  assert.equal(st.items[0].title, 'First story');
  assert.equal(st.items[0].date, shanghaiDate(instant(st.lastBriefingAt)));
  const payload = jsonOf(res.stdout);
  assert.equal(payload.command, 'update');
  assert.equal(payload.itemCount, 1);
});

// --- the data-loss regression -------------------------------------------

test('an unparseable state file makes both commands exit 2 and leaves it byte-identical', (t) => {
  const dir = tempDir(t);
  const statePath = join(dir, 'briefing-state.json');
  const valid = JSON.stringify(state(), null, 2) + '\n';
  const truncated = valid.slice(0, Math.floor(valid.length * 0.6));
  assert.throws(() => JSON.parse(truncated), 'the fixture must be genuinely unparseable mid-object');
  writeText(statePath, truncated);
  const before = readFileSync(statePath);
  const itemsPath = writeJson(join(dir, '.items.json'), [item('Story')]);

  for (const args of [['plan', '--state', statePath], ['update', '--state', statePath, '--items', itemsPath]]) {
    const res = run(dir, args);
    assert.equal(res.status, 2, args[0] + ' must refuse, not recover: ' + res.stdout + res.stderr);
    assert.equal(res.stdout, '', args[0] + ' must print no window for a state it cannot read');
    assert.match(res.stderr, /not valid JSON/);
    assert.ok(res.stderr.includes(statePath), args[0] + ' must name the file: ' + res.stderr);
    // Regression: treating a truncated state as "no state" announced a first-run
    // window and then overwrote lastBriefingAt and the whole item index with
    // exit 0. Bytes, not just the exit code, are what must survive.
    assert.deepEqual(readFileSync(statePath), before, args[0] + ' must leave the state bytes untouched');
  }
});

test('only a missing state file is a first run; an existing one is never treated as absent', (t) => {
  const dir = tempDir(t);
  const missingPath = join(dir, 'missing.json');
  const missing = run(dir, ['plan', '--state', missingPath]);
  assert.equal(missing.status, 0, missing.stderr);
  assert.equal(jsonOf(missing.stdout).window.previousBriefingAt, null);
  assert.match(jsonOf(missing.stdout).window.label, /^No previous briefing/);
  assert.equal(existsSync(missingPath), false);

  const baseline = agoHours(3);
  const existingPath = writeJson(join(dir, 'existing.json'), state({ lastBriefingAt: baseline }));
  const existing = run(dir, ['plan', '--state', existingPath]);
  assert.equal(existing.status, 0, existing.stderr);
  const w = jsonOf(existing.stdout).window;
  assert.match(w.label, /^Last briefing /);
  assert.equal(instant(w.previousBriefingAt), instant(baseline));
  assert.equal(instant(readJson(existingPath).plannedWindow.until), instant(w.until),
    'an existing state is a file plan records its window into');

  // A parseable file whose baseline is unusable still announces no previous
  // briefing - but it is a file, so plan records into it rather than skipping it.
  const unusablePath = writeJson(join(dir, 'unusable.json'), Object.assign(state(), { lastBriefingAt: 'not-a-date' }));
  const unusable = run(dir, ['plan', '--state', unusablePath]);
  assert.equal(unusable.status, 0, unusable.stderr);
  assert.match(jsonOf(unusable.stdout).window.label, /^No previous briefing/);
  assert.ok(readJson(unusablePath).plannedWindow, 'an existing file must be recorded into even with a useless baseline');
});

// --- the briefing date ---------------------------------------------------

test('--date must be YYYY-MM-DD: a malformed value exits 2 and rewrites nothing', (t) => {
  const dir = tempDir(t);
  const statePath = writeJson(join(dir, 'st.json'), state({ lastBriefingAt: agoHours(5) }));
  const itemsPath = writeJson(join(dir, '.items.json'), [item('Dated')]);
  const before = readFileSync(statePath);
  for (const bad of ['2026/09/30', '2026-9-30', '30-09-2026', 'yesterday']) {
    const res = run(dir, ['update', '--state', statePath, '--items', itemsPath, '--date', bad]);
    assert.equal(res.status, 2, bad + ': ' + res.stdout + res.stderr);
    assert.match(res.stderr, /is not YYYY-MM-DD/);
    assert.ok(res.stderr.includes(bad), 'the message must quote the rejected value: ' + res.stderr);
    // Regression: a malformed --date used to key every appended item, poisoning
    // the index; now it is refused before anything is written.
    assert.deepEqual(readFileSync(statePath), before, 'a rejected --date must not rewrite the state');
  }
});

test('a valid --date overrides the Shanghai-date default for the state and every item', (t) => {
  const dir = tempDir(t);
  const statePath = writeJson(join(dir, 'st.json'), state({ lastBriefingAt: agoHours(5) }));
  const itemsPath = writeJson(join(dir, '.items.json'), [item('Dated')]);
  const res = run(dir, ['update', '--state', statePath, '--items', itemsPath, '--date', '2026-01-02']);
  assert.equal(res.status, 0, res.stderr);
  const st = readJson(statePath);
  assert.equal(st.lastBriefingDate, '2026-01-02');
  assert.equal(st.items[0].date, '2026-01-02');
  assert.equal(jsonOf(res.stdout).lastBriefingDate, '2026-01-02');
  assert.notEqual(st.lastBriefingDate, shanghaiDate(instant(st.lastBriefingAt)),
    'the explicit date must not be the default this run would have computed');
});

test('the stored window label dates the last briefing in Asia/Shanghai, not UTC', (t) => {
  const dir = tempDir(t);
  // 2026-09-29T16:30Z is 2026-09-30 00:30 in Asia/Shanghai: one instant, two
  // calendar dates, so a UTC-derived date cannot pass by coincidence.
  const baseline = '2026-09-29T16:30:00.000Z';
  assert.equal(new Date(baseline).toISOString().slice(0, 10), '2026-09-29');
  assert.equal(shanghaiDate(instant(baseline)), '2026-09-30');
  const statePath = writeJson(join(dir, 'st.json'), state({ lastBriefingAt: baseline }));
  const res = run(dir, ['plan', '--state', statePath]);
  assert.equal(res.status, 0, res.stderr);
  const w = jsonOf(res.stdout).window;
  assert.equal(w.previousBriefingAt, baseline);
  assert.match(w.label, /^Last briefing 2026-09-30 - /, 'the baseline is named by its Shanghai day: ' + w.label);
  // The stamps are Shanghai wall clock too: the old label printed UTC via
  // toISOString() and disagreed with the coverage note citing the same window.
  assert.ok(w.label.includes(shanghaiStamp(instant(w.since)) + ' -> ' + shanghaiStamp(instant(w.until)) + ' Asia/Shanghai'), w.label);
  assert.equal(readJson(statePath).plannedWindow.label, w.label, 'the recorded plan must carry the announced label');
});

test('the default lastBriefingDate is the Shanghai date of the coverage end, not its UTC date', (t) => {
  const dir = tempDir(t);
  const lag = differentialLag();
  const endMs = lag === null ? Date.now() - 4 * HOUR : Date.now() - lag;
  const until = new Date(endMs).toISOString();
  const baseline = agoHours(20);
  const statePath = writeJson(join(dir, 'st.json'), state({
    lastBriefingAt: baseline,
    plannedWindow: {
      since: new Date(endMs - 5 * HOUR).toISOString(),
      until,
      hours: 5,
      capped: false,
      gapHours: 5,
      uncoveredHours: 0,
      previousBriefingAt: baseline,
      maxWindowHours: 72,
      firstRunHours: 24,
      label: 'planned by the previous run',
    },
  }));
  const itemsPath = writeJson(join(dir, '.items.json'), [item('Dated')]);
  const res = run(dir, ['update', '--state', statePath, '--items', itemsPath]);
  assert.equal(res.status, 0, res.stderr);
  const st = readJson(statePath);
  assert.equal(instant(st.lastBriefingAt), endMs, 'coverage closes at the recorded end');
  if (lag !== null) {
    // The discriminating case: the end instant has two candidate dates.
    assert.notEqual(shanghaiDate(endMs), until.slice(0, 10), 'this construction must straddle two calendar dates');
  }
  assert.equal(st.lastBriefingDate, shanghaiDate(endMs), 'the default date is the Shanghai day of the coverage end');
  assert.equal(st.items[0].date, shanghaiDate(endMs), 'and it keys the appended item');
  // Unconditional half: the stored label stamps the end in Shanghai wall clock.
  assert.ok(st.window.label.includes('-> ' + shanghaiStamp(endMs) + ' Asia/Shanghai'), st.window.label);
});

// --- the window rule -----------------------------------------------------

test('the window rule: a 25h baseline is covered in full, 100h is capped at 72h with a gap clause, none is 24h', (t) => {
  const dir = tempDir(t);

  const baseline25 = agoHours(25);
  const a = run(dir, ['plan', '--state', writeJson(join(dir, 'a.json'), state({ lastBriefingAt: baseline25 }))]);
  assert.equal(a.status, 0, a.stderr);
  const w25 = jsonOf(a.stdout).window;
  assert.ok(Math.abs(w25.hours - 25) < 0.05, 'a 25h-old baseline gives a ~25h window, got ' + w25.hours);
  assert.equal(instant(w25.since), instant(baseline25), 'the window starts at the baseline, not at a floor');
  assert.equal(w25.capped, false);
  assert.equal(w25.uncoveredHours, 0);
  assert.equal(w25.gapHours, w25.hours);
  assert.match(w25.label, /covering latest 25h/);
  assert.ok(!/not covered/.test(w25.label), 'nothing is dropped from a 25h window: ' + w25.label);

  const b = run(dir, ['plan', '--state', writeJson(join(dir, 'b.json'), state({ lastBriefingAt: agoHours(100) }))]);
  assert.equal(b.status, 0, b.stderr);
  const w100 = jsonOf(b.stdout).window;
  assert.equal(w100.hours, 72, 'the window is capped at 72h');
  assert.equal(w100.capped, true);
  assert.equal(w100.maxWindowHours, 72);
  assert.ok(Math.abs(w100.gapHours - 100) < 0.05, 'the baseline itself is still ~100h old, got ' + w100.gapHours);
  assert.equal(w100.uncoveredHours, 28);
  assert.equal(instant(w100.until) - instant(w100.since), 72 * HOUR, 'the capped window is exactly the ceiling wide');
  // Regression: a capped window used to be announced as if it covered the whole
  // gap, so the briefing silently declared 100h of coverage.
  assert.match(w100.label, /covering latest 72h/);
  assert.match(w100.label, /- 28h not covered/);

  const c = run(dir, ['plan', '--state', join(dir, 'c.json')]);
  assert.equal(c.status, 0, c.stderr);
  const w24 = jsonOf(c.stdout).window;
  assert.equal(w24.hours, 24);
  assert.equal(w24.firstRunHours, 24);
  assert.match(w24.label, /^No previous briefing - covering latest 24h/);
});

// --- plan and update agree on one end ------------------------------------

test('plan records plannedWindow and update closes coverage at exactly that end, then clears it', (t) => {
  const dir = tempDir(t);
  const statePath = writeJson(join(dir, 'st.json'), state({ lastBriefingAt: agoHours(5) }));
  const planned = run(dir, ['plan', '--state', statePath]);
  assert.equal(planned.status, 0, planned.stderr);
  const announced = jsonOf(planned.stdout).window;
  const recorded = readJson(statePath).plannedWindow;
  assert.ok(recorded, 'plan must record the window it announced');
  assert.equal(instant(recorded.until), instant(announced.until));
  assert.equal(instant(recorded.since), instant(announced.since));

  const itemsPath = writeJson(join(dir, '.items.json'), [item('Story')]);
  const updated = run(dir, ['update', '--state', statePath, '--items', itemsPath]);
  assert.equal(updated.status, 0, updated.stderr);
  const st = readJson(statePath);
  // Regression: coverage used to close at update's own clock, so the end in the
  // header and the stored baseline drifted by however long the run took.
  assert.equal(instant(st.lastBriefingAt), instant(announced.until), 'coverage must close at the announced end');
  assert.equal(instant(jsonOf(updated.stdout).lastBriefingAt), instant(announced.until));
  assert.equal(st.plannedWindow, null, 'the consumed plan must be cleared');
  assert.equal(st.window.label, announced.label, 'the stored window is the announced one, recomputed from the same ends');
});

test('plan does not reuse a plannedWindow shorter than 120s: it recomputes from the baseline', (t) => {
  const dir = tempDir(t);
  const baseline = agoHours(3);
  const recordedUntil = new Date(Date.now() - MINUTE).toISOString();
  const statePath = writeJson(join(dir, 'st.json'), state({
    lastBriefingAt: baseline,
    plannedWindow: {
      since: new Date(Date.now() - 90000).toISOString(),
      until: recordedUntil,
      hours: 0,
      capped: false,
      gapHours: 0,
      uncoveredHours: 0,
      previousBriefingAt: baseline,
      maxWindowHours: 72,
      firstRunHours: 24,
      label: 'stale 30s record',
    },
  }));
  const res = run(dir, ['plan', '--state', statePath]);
  assert.equal(res.status, 0, res.stderr);
  const w = jsonOf(res.stdout).window;
  // Regression: a 30s record is a window update must refuse, so reusing it made
  // every retry fail forever; plan recomputes instead and the retry widens.
  assert.ok(!/reusing the planned window/.test(res.stderr), 'a refused record must not be announced as reused: ' + res.stderr);
  assert.ok(!/not computing a new one/.test(res.stderr));
  assert.notEqual(w.label, 'stale 30s record');
  assert.ok(Math.abs(w.hours - 3) < 0.05, 'the fresh window runs from the 3h baseline, got ' + w.hours);
  assert.equal(instant(w.since), instant(baseline));
  assert.ok(instant(w.until) > instant(recordedUntil) + MINUTE, 'the frozen end must not be reused');
  assert.equal(instant(readJson(statePath).plannedWindow.until), instant(w.until), 'the short record must be replaced');
});

test('plan recomputes instead of reusing a record behind the baseline, older than 12h, or minutes ahead', (t) => {
  const dir = tempDir(t);
  const cases = [
    { name: 'behind the baseline', baseline: agoHours(5), record: { since: agoHours(7), until: agoHours(6) } },
    { name: 'older than 12h', baseline: agoHours(20), record: { since: agoHours(15), until: agoHours(13) } },
    { name: 'minutes ahead', baseline: agoHours(5), record: { since: agoHours(5), until: aheadMinutes(10) } },
  ];
  for (const c of cases) {
    const statePath = writeJson(join(dir, c.name.replace(/\W+/g, '-') + '.json'), state({
      lastBriefingAt: c.baseline,
      plannedWindow: Object.assign({
        hours: 1,
        capped: false,
        gapHours: 1,
        uncoveredHours: 0,
        previousBriefingAt: c.baseline,
        maxWindowHours: 72,
        firstRunHours: 24,
        label: 'stale: ' + c.name,
      }, c.record),
    }));
    const res = run(dir, ['plan', '--state', statePath]);
    assert.equal(res.status, 0, c.name + ': ' + res.stderr);
    const w = jsonOf(res.stdout).window;
    // Regression: an orphaned record from an aborted run used to become this
    // run's window, so the next briefing covered a window no live run chose.
    assert.ok(!/reusing the planned window/.test(res.stderr), c.name + ' must recompute: ' + res.stderr);
    assert.notEqual(w.label, 'stale: ' + c.name, c.name + ' must not reuse the recorded label');
    assert.equal(instant(w.since), instant(c.baseline), c.name + ': a fresh window starts at the baseline');
    assert.ok(Math.abs(instant(w.until) - Date.now()) < 5000, c.name + ": a fresh window ends at this run's clock");
    assert.equal(instant(readJson(statePath).plannedWindow.until), instant(w.until), c.name + ': the stale record is replaced');
  }
});

test('update names why a recorded plannedWindow was ignored before falling back to its clock', (t) => {
  const dir = tempDir(t);
  const cases = [
    { name: 'behind the baseline', baseline: agoHours(5), record: { since: agoHours(7), until: agoHours(6) }, why: /behind the baseline/ },
    { name: 'older than 12h', baseline: agoHours(20), record: { since: agoHours(15), until: agoHours(13) }, why: /older than 12h/ },
    { name: 'in the future', baseline: agoHours(5), record: { since: agoHours(5), until: aheadMinutes(10) }, why: /in the future/ },
  ];
  const itemsPath = writeJson(join(dir, '.items.json'), []);
  for (const c of cases) {
    const statePath = writeJson(join(dir, c.name.replace(/\W+/g, '-') + '.json'), state({
      lastBriefingAt: c.baseline,
      plannedWindow: { since: c.record.since, until: c.record.until, label: 'stale' },
    }));
    const res = run(dir, ['update', '--state', statePath, '--items', itemsPath]);
    assert.equal(res.status, 0, c.name + ': ' + res.stdout + res.stderr);
    // Regression: an ignored record used to be dropped in silence, moving the
    // stored baseline away from the end the header announced.
    assert.match(res.stderr, /the recorded planned window ends/);
    assert.ok(res.stderr.includes(c.record.until), c.name + ' must name the ignored end: ' + res.stderr);
    assert.match(res.stderr, c.why);
    assert.ok(Math.abs(instant(readJson(statePath).lastBriefingAt) - Date.now()) < 5000,
      c.name + ": the fallback closes at this run's clock");
  }
});

// --- the guards ----------------------------------------------------------

test('update refuses a window under 120s unless --force, and names the plannedWindow remedy', (t) => {
  const dir = tempDir(t);
  const statePath = writeJson(join(dir, 'st.json'), state({ lastBriefingAt: new Date(Date.now() - MINUTE).toISOString() }));
  const itemsPath = writeJson(join(dir, '.items.json'), [item('Moments later')]);
  const before = readFileSync(statePath);

  const refused = run(dir, ['update', '--state', statePath, '--items', itemsPath]);
  assert.equal(refused.status, 3, refused.stdout + refused.stderr);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /coverage window is only \d+s \(under 120s\)/);
  assert.match(refused.stderr, /Delete plannedWindow in the state file/, 'the remedy must name plannedWindow');
  assert.deepEqual(readFileSync(statePath), before, 'a refusal must write nothing');

  const forced = run(dir, ['update', '--state', statePath, '--items', itemsPath, '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  const st = readJson(statePath);
  assert.equal(st.items.length, 1, '--force is an explicit override, not a different code path');
  assert.ok(instant(st.window.until) - instant(st.window.since) < 120000, 'the forced window really is the short one');
  assert.ok(Math.abs(instant(st.lastBriefingAt) - Date.now()) < 5000);
});

test('a baseline ahead of the shell clock is warned about rather than recorded in silence', (t) => {
  const dir = tempDir(t);
  const future = new Date(Date.now() + 2 * HOUR).toISOString();
  const statePath = writeJson(join(dir, 'st.json'), state({ lastBriefingAt: future }));
  const res = run(dir, ['plan', '--state', statePath]);
  assert.equal(res.status, 0, res.stderr);
  // Regression: the negative window used to be recorded with exit 0 and no
  // output, announcing "covering latest -2h" as if it were a normal run.
  assert.match(res.stderr, /ahead of this shell's clock/);
  assert.match(res.stderr, /negative window/);
  assert.ok(res.stderr.includes(statePath), 'the warning must name the file to fix: ' + res.stderr);
  const w = jsonOf(res.stdout).window;
  assert.equal(w.hours, -2);
  assert.match(w.label, /covering latest -2h/);
  assert.equal(instant(readJson(statePath).plannedWindow.until), instant(w.until), 'it is recorded as computed, only loudly');

  // And the write is still refused downstream: a log entry is not coverage.
  const itemsPath = writeJson(join(dir, '.items.json'), []);
  const updated = run(dir, ['update', '--state', statePath, '--items', itemsPath]);
  assert.equal(updated.status, 3, updated.stdout + updated.stderr);
  assert.match(updated.stderr, /cannot move backwards/);
});

// --- derived index and watchlist -----------------------------------------

test('the watchlist keeps the earliest date and the newest lastSeen and drops an aged-out title', (t) => {
  const dir = tempDir(t);
  const olderSeen = new Date(Date.now() - 3 * DAY).toISOString();
  const newerSeen = new Date(Date.now() - DAY).toISOString();
  const agedSeen = new Date(Date.now() - 10 * DAY).toISOString();
  const freshSeen = new Date(Date.now() - 2 * HOUR).toISOString();
  const statePath = writeJson(join(dir, 'st.json'), Object.assign(state({ lastBriefingAt: agoHours(5) }), {
    items: [
      watched('Repeated watched', '2026-09-27', olderSeen),
      watched('Repeated watched', '2026-09-29', newerSeen),
      watched('Aged out', '2026-09-01', agedSeen),
      watched('Fresh watched', '2026-09-30', freshSeen),
      item('Not watched'),
    ],
  }));
  const itemsPath = writeJson(join(dir, '.items.json'), []);
  const res = run(dir, ['update', '--state', statePath, '--items', itemsPath]);
  assert.equal(res.status, 0, res.stderr);
  const st = readJson(statePath);

  const repeated = st.watchlist.filter((w) => w.title === 'Repeated watched');
  assert.equal(repeated.length, 1, 'the watchlist is deduplicated by title');
  assert.equal(repeated[0].date, '2026-09-27', 'the earliest date is when the title entered the list');
  // Regression: the entry kept the earliest sighting's lastSeen, so a story
  // reported again today still read as last seen up to seven days ago.
  assert.equal(instant(repeated[0].lastSeen), instant(newerSeen), 'the newest lastSeen, not the first sighting');
  assert.ok(!st.watchlist.some((w) => w.title === 'Aged out'), 'a title with no sighting inside 7 days leaves the list');
  assert.ok(!st.items.some((i) => i.title === 'Aged out'), 'and its item is no longer retained');
  assert.deepEqual(st.watchlist.map((w) => w.title).sort(), ['Fresh watched', 'Repeated watched']);
  assert.ok(!st.watchlist.some((w) => w.title === 'Not watched'), 'only watch-flagged items are indexed');
});

test('the item index dedupes a repeated (date,title) and prints the neutral notice', (t) => {
  const dir = tempDir(t);
  const date = '2026-09-30';
  const statePath = writeJson(join(dir, 'st.json'), Object.assign(state({ lastBriefingAt: agoHours(5) }), {
    items: [{ title: 'Recurring', section: 'global', aspect: 'economy', outlet: '', primaryUrl: '', flags: [], watch: false, date, lastSeen: agoHours(2) }],
  }));
  const itemsPath = writeJson(join(dir, '.items.json'), [item('Recurring'), item('Brand New')]);

  const first = run(dir, ['update', '--state', statePath, '--items', itemsPath, '--date', date]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /1 of 2 curated entries are already in the index for 2026-09-30 with the same title, so they were kept once rather than appended again/);
  let st = readJson(statePath);
  assert.deepEqual(st.items.map((i) => i.title).sort(), ['Brand New', 'Recurring']);
  assert.equal(st.items.length, 2, 'the held entry must not be appended a second time');

  // The second Step 6 pass is what the short-window guard is for; once forced
  // through, the (date,title) key is what must keep the index stable.
  const refused = run(dir, ['update', '--state', statePath, '--items', itemsPath, '--date', date]);
  assert.equal(refused.status, 3, refused.stdout + refused.stderr);
  const second = run(dir, ['update', '--state', statePath, '--items', itemsPath, '--date', date, '--force']);
  assert.equal(second.status, 0, second.stderr);
  // Regression: a re-run used to append the same curated lines again, growing
  // the index every time the step was repeated.
  assert.match(second.stderr, /2 of 2 curated entries are already in the index for 2026-09-30 with the same title/);
  st = readJson(statePath);
  assert.deepEqual(st.items.map((i) => i.title).sort(), ['Brand New', 'Recurring'], 'a re-run must not duplicate the index');
  assert.equal(st.items.length, 2);
});

test('the dedupe key is (date,title): the same title on another date is still appended', (t) => {
  const dir = tempDir(t);
  const statePath = writeJson(join(dir, 'st.json'), Object.assign(state({ lastBriefingAt: agoHours(5) }), {
    items: [{ title: 'Recurring', section: 'global', aspect: 'economy', outlet: '', primaryUrl: '', flags: [], watch: false, date: '2026-09-29', lastSeen: agoHours(2) }],
  }));
  const itemsPath = writeJson(join(dir, '.items.json'), [item('Recurring')]);
  const res = run(dir, ['update', '--state', statePath, '--items', itemsPath, '--date', '2026-09-30']);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!/already in the index/.test(res.stderr), 'a different date is not the same entry: ' + res.stderr);
  const st = readJson(statePath);
  assert.deepEqual(st.items.map((i) => i.date).sort(), ['2026-09-29', '2026-09-30'],
    'the key is the (date,title) pair, not the title alone');
});

// --- argument and input handling -----------------------------------------

test('an unknown command is a usage error even when the state file is unparseable', (t) => {
  const dir = tempDir(t);
  const statePath = writeText(join(dir, 'st.json'), '{ "version": 2, "lastBriefingAt": "2026-09-29T00:39:48.304Z", "items": [');
  const before = readFileSync(statePath);
  const res = run(dir, ['bogus', '--state', statePath]);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  // Regression: reading the state first made an unknown command exit 2 on a
  // corrupt file, reporting a state problem for a usage mistake.
  assert.match(res.stderr, /^usage: update-state\.mjs plan\|update --state FILE/);
  assert.ok(!/not valid JSON/.test(res.stderr), 'the command is checked before the state is read');
  assert.deepEqual(readFileSync(statePath), before);
  assert.equal(run(dir, ['--state', statePath]).status, 1, 'no command at all is the same usage error');
});

test('--items must exist and be an array, and a stale index is refused with exit 3', (t) => {
  const dir = tempDir(t);
  const baseline = agoHours(5);
  const statePath = writeJson(join(dir, 'st.json'), state({ lastBriefingAt: baseline }));
  const before = readFileSync(statePath);

  const absentPath = join(dir, 'absent.json');
  const absent = run(dir, ['update', '--state', statePath, '--items', absentPath]);
  assert.equal(absent.status, 2, absent.stdout + absent.stderr);
  assert.match(absent.stderr, /cannot read --items file/);
  assert.ok(absent.stderr.includes(absentPath), 'the message must name the file: ' + absent.stderr);
  assert.deepEqual(readFileSync(statePath), before, 'unreadable input must leave the state alone');

  const objectPath = writeJson(join(dir, 'object.json'), { title: 'not an array' });
  const notArray = run(dir, ['update', '--state', statePath, '--items', objectPath]);
  assert.equal(notArray.status, 2, notArray.stdout + notArray.stderr);
  assert.match(notArray.stderr, /must hold a JSON array of items/);
  assert.ok(notArray.stderr.includes(objectPath));
  assert.deepEqual(readFileSync(statePath), before);

  // A usable record is what makes update compare the index's mtime with the end
  // it would close: a file written before that plan belongs to an earlier run.
  const end = new Date(Date.now() - 30000);
  const plannedPath = writeJson(join(dir, 'planned.json'), state({
    lastBriefingAt: agoHours(6),
    plannedWindow: {
      since: new Date(Date.now() - 5 * HOUR).toISOString(),
      until: end.toISOString(),
      hours: 5,
      capped: false,
      gapHours: 5,
      uncoveredHours: 0,
      previousBriefingAt: agoHours(6),
      maxWindowHours: 72,
      firstRunHours: 24,
      label: 'planned',
    },
  }));
  const plannedBefore = readFileSync(plannedPath);
  const stalePath = writeJson(join(dir, 'stale.json'), [item('Yesterday')]);
  const staleSeconds = end.getTime() / 1000 - 300;
  utimesSync(stalePath, staleSeconds, staleSeconds);
  const stale = run(dir, ['update', '--state', plannedPath, '--items', stalePath]);
  assert.equal(stale.status, 3, stale.stdout + stale.stderr);
  assert.match(stale.stderr, /older than the planned window it would close/);
  assert.ok(stale.stderr.includes(stalePath), 'the message must name the index: ' + stale.stderr);
  assert.ok(stale.stderr.includes(end.toISOString()), 'and the end it would close: ' + stale.stderr);
  assert.deepEqual(readFileSync(plannedPath), plannedBefore, 'a refused index must not move the baseline');
});
