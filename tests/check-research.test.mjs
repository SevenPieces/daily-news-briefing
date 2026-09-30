// check-research.mjs - the offline gate over the research stage's records.
// Every line names the record and the field, warnings never change the exit
// code, and a headline may differ from sourceTitle only by a trailing outlet
// name. Each test names the regression it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runScript, tempDir, writeJson, writeText } from './helpers.mjs';

const SCRIPT = 'check-research.mjs';
const WINDOW = ['--window', '2026-09-29 00:00', '2026-09-30 00:00'];

/** One publishable record: only the field a test overrides can fail. */
function record(over = {}) {
  return {
    section: 'global',
    aspect: 'Economy',
    headline: 'Synthetic headline one',
    sourceTitle: 'Synthetic headline one',
    outlet: 'BBC',
    primaryUrl: 'https://example.com/one',
    publishedAt: '2026-09-29 12:10',
    dateSource: 'datePublished',
    provenance: 'full',
    textLength: 1234,
    flags: ['new'],
    keyFacts: ['Synthetic fact one'],
    ...over,
  };
}

/** Run the gate over one JSON value written into the test's temp dir. */
function run(dir, value, args = []) {
  return runScript(SCRIPT, [writeJson(join(dir, 'report.json'), value), ...args]);
}

/** Assert the gate refused, and printed this exact problem line. */
function assertProblem(res, expected) {
  assert.equal(res.status, 1, 'expected exit 1, got ' + res.status + '\n' + res.stdout + res.stderr);
  assert.match(res.stdout, /RESEARCH: FAIL/);
  const lines = res.stdout.split('\n');
  assert.ok(lines.includes('  ' + expected),
    'missing problem line "  ' + expected + '" in:\n' + res.stdout);
}

/** Assert one warning line was printed. */
function assertWarning(res, expected) {
  const lines = res.stdout.split('\n');
  assert.ok(lines.includes('  WARN ' + expected),
    'missing warning line "  WARN ' + expected + '" in:\n' + res.stdout);
}

test('a valid record passes with exit 0 and RESEARCH: OK', (t) => {
  const dir = tempDir(t);
  const res = run(dir, [record()]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /RESEARCH: OK/);
  assert.match(res.stdout,
    /^research records: 1 \| problems: 0 \| warnings: 0 \| no window$/m);
  // Absence control: the fixture carries no problem and no warning at all.
  assert.doesNotMatch(res.stdout, /record 1/);
  assert.doesNotMatch(res.stdout, /WARN/);
});

test('a flag outside the contract tag set fails and names the tag', (t) => {
  const dir = tempDir(t);
  const res = run(dir, [record({ flags: ['new', 'scoop'] })]);
  // Regression: a tag the renderer does not know reached the briefing because
  // the flag list was never checked against the contract set.
  assertProblem(res, 'record 1  flags: tag "scoop" is outside the allowed set');

  // Positive control: the other documented tags are accepted.
  const ok = run(dir, [record({ flags: ['new', 'followup', 'developing', 'paywalled', 'unverified'] })]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /RESEARCH: OK/);
});

test('a corroborating outlet that names the primary outlet fails', (t) => {
  const dir = tempDir(t);
  const alt = { altUrl: 'https://example.com/alt', altTitle: 'Alternate title' };
  // Regression: an "alternate" that was the same outlet corroborated nothing,
  // and the comparison is case-insensitive.
  const res = run(dir, [record({ corroboratingOutlet: 'bbc', ...alt })]);
  assertProblem(res, 'record 1  corroboratingOutlet: names the primary outlet "BBC" - an alternate is a different outlet');

  // Positive control: a genuinely different outlet is accepted.
  const ok = run(dir, [record({ corroboratingOutlet: 'The Guardian', ...alt })]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /RESEARCH: OK/);
});

test('a headline rewritten away from sourceTitle fails', (t) => {
  const dir = tempDir(t);
  const res = run(dir, [record({ headline: 'A rewritten headline' })]);
  // Regression: the run rewrote a publisher's headline, which is
  // indistinguishable from a copied one unless sourceTitle is checked.
  assertProblem(res, 'record 1  headline: differs from sourceTitle "Synthetic headline one"');
});

test('a missing required field fails and names the field', (t) => {
  const dir = tempDir(t);
  const noSourceTitle = record();
  delete noSourceTitle.sourceTitle;
  const noOutlet = record();
  delete noOutlet.outlet;
  const res = run(dir, [noSourceTitle, noOutlet]);
  assertProblem(res, 'record 1  sourceTitle: missing');
  assertProblem(res, 'record 2  outlet: missing');
  // The record number is the report position, so both lines are distinguishable.
  assert.match(res.stdout, /^research records: 2 \| problems: 2 \|/m);
});

test('provenance "full" with textLength 0 fails; "feed" with 0 passes', (t) => {
  const dir = tempDir(t);
  const res = run(dir, [record({ provenance: 'full', textLength: 0 })]);
  assertProblem(res, 'record 1  provenance: [prov:full] recorded with textLength 0 - no body evidence');

  // Positive control: only "full" rests on the page body, so a zero length is
  // legal for a feed-sourced record.
  const ok = run(dir, [record({ provenance: 'feed', textLength: 0 })]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /RESEARCH: OK/);
});

test('a non-http(s) primaryUrl fails', (t) => {
  const dir = tempDir(t);
  const res = run(dir, [record({ primaryUrl: 'ftp://example.com/one' })]);
  assertProblem(res, 'record 1  primaryUrl: not an http(s) URL: "ftp://example.com/one"');

  // Positive control: plain http is fine; only a non-URL scheme is not.
  const ok = run(dir, [record({ primaryUrl: 'http://example.com/one' })]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('publishedAt outside --window fails at both ends', (t) => {
  const dir = tempDir(t);
  const early = run(dir, [record({ publishedAt: '2026-09-28 23:59' })], WINDOW);
  assertProblem(early, 'record 1  publishedAt: 2026-09-28 23:59 is before the window start 2026-09-29 00:00');

  const late = run(dir, [record({ publishedAt: '2026-09-30 00:01' })], WINDOW);
  assertProblem(late, 'record 1  publishedAt: 2026-09-30 00:01 is after the window end 2026-09-30 00:00');

  // Positive control: a stamp inside the window passes the same run.
  const inside = run(dir, [record({ publishedAt: '2026-09-29 12:10' })], WINDOW);
  assert.equal(inside.status, 0, inside.stdout + inside.stderr);
  assert.match(inside.stdout, /RESEARCH: OK/);
});

test('a malformed publishedAt fails', (t) => {
  const dir = tempDir(t);
  const iso = run(dir, [record({ publishedAt: '2026-09-29T12:10' })]);
  assertProblem(iso, 'record 1  publishedAt: not YYYY-MM-DD HH:MM (Asia/Shanghai): "2026-09-29T12:10"');

  const impossible = run(dir, [record({ publishedAt: '2026-13-40 12:10' })]);
  assertProblem(impossible, 'record 1  publishedAt: not YYYY-MM-DD HH:MM (Asia/Shanghai): "2026-13-40 12:10"');
});

test('a dateSource outside the closed label set fails', (t) => {
  const dir = tempDir(t);
  // "meta:pubdate" is the near neighbour of the label fetch-page.mjs really
  // prints for name="pubdate", which is meta:date-published. Regression: the
  // set was open, so an invented label was copied into the record.
  const res = run(dir, [record({ dateSource: 'meta:pubdate' })]);
  // The message names the three families that are accepted, so a reader knows
  // what to write instead of only what is wrong.
  assertProblem(res, 'record 1  dateSource: "meta:pubdate" is not a label fetch-page.mjs prints,'
    + ' a field the feed collector reads (pubDate, published, updated, dc:date, date),'
    + ' or the name of another tool (web_fetch)');

  // The accepted non-fetch sources: a publisher-feed record names the field the
  // collector read, and a page read with another tool names that tool. Checking
  // only fetch-page's labels refused every feed-derived record - the feeds are
  // primaries, so that is most of a normal run.
  for (const source of ['pubDate', 'published', 'updated', 'dc:date', 'date', 'web_fetch', null]) {
    const accepted = run(dir, [record({ dateSource: source })]);
    assert.equal(accepted.status, 0, 'dateSource ' + JSON.stringify(source) + ' must be accepted: ' + accepted.stdout);
  }

  // Positive control: the label the script lists for the same markup passes
  // (with its documented warning, which must not change the exit code).
  const ok = run(dir, [record({ dateSource: 'meta:date-published' })]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.doesNotMatch(ok.stdout, /^  record 1/m);
});

test('an aspect that does not belong to its section fails', (t) => {
  const dir = tempDir(t);
  const res = run(dir, [
    record({ section: 'global', aspect: '\u7ecf\u6d4e' }),
    record({ section: 'china', aspect: 'Economy' }),
  ]);
  assertProblem(res, 'record 1  aspect: "\u7ecf\u6d4e" is not an aspect of global');
  assertProblem(res, 'record 2  aspect: "Economy" is not an aspect of china');

  // Positive control: the same aspect under its own section passes.
  const ok = run(dir, [record({ section: 'china', aspect: '\u7ecf\u6d4e' })]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('--window is applied to an array report and reported in the summary', (t) => {
  const dir = tempDir(t);
  const res = run(dir, [record()], WINDOW);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout,
    /^research records: 1 \| problems: 0 \| warnings: 0 \| window 2026-09-29 00:00 -> 2026-09-30 00:00$/m);

  // The window really applied: the same record before it fails.
  const out = run(dir, [record({ publishedAt: '2026-09-20 09:00' })], WINDOW);
  assertProblem(out, 'record 1  publishedAt: 2026-09-20 09:00 is before the window start 2026-09-29 00:00');
});

test('the {records, window} object form carries the window itself', (t) => {
  const dir = tempDir(t);
  const window = { since: '2026-09-29 00:00', until: '2026-09-30 00:00' };
  const ok = run(dir, { records: [record()], window });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /\| window 2026-09-29 00:00 -> 2026-09-30 00:00$/m);

  const bad = run(dir, { records: [record({ publishedAt: '2026-09-20 09:00' })], window });
  assertProblem(bad, 'record 1  publishedAt: 2026-09-20 09:00 is before the window start 2026-09-29 00:00');
});

test('a report with no window skips the window check', (t) => {
  const dir = tempDir(t);
  // The same ancient stamp fails under --window (previous test) and passes here.
  const res = run(dir, { records: [record({ publishedAt: '2020-01-01 09:00' })] });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /\| no window$/m);
  assert.match(res.stdout, /RESEARCH: OK/);
});

test('a non-real-time dateSource warns without changing the exit code', (t) => {
  const dir = tempDir(t);
  const res = run(dir, [record({ dateSource: 'article:published_time' })]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /RESEARCH: OK/);
  assert.match(res.stdout, /^research records: 1 \| problems: 0 \| warnings: 1 \|/m);
  assertWarning(res, 'record 1  dateSource: "article:published_time" is neither datePublished nor dateModified'
    + ' - the reused-URL check needs its own look at the page');
});

test('an aspect whose records all come from one outlet warns without failing', (t) => {
  const dir = tempDir(t);
  const first = record({ headline: 'First synthetic headline', sourceTitle: 'First synthetic headline' });
  const second = record({ headline: 'Second synthetic headline', sourceTitle: 'Second synthetic headline' });
  const res = run(dir, [first, second]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /RESEARCH: OK/);
  assertWarning(res, 'record 1  aspect Economy (global) has 2 records, all from BBC - prefer a second outlet');

  // Positive control: one different outlet in the aspect clears the warning.
  const mixed = [first, { ...second, outlet: 'The Guardian' }];
  const clear = run(dir, mixed);
  assert.equal(clear.status, 0, clear.stdout + clear.stderr);
  assert.doesNotMatch(clear.stdout, /prefer a second outlet/);
});

test('no argument is a usage error with exit 2', () => {
  const res = runScript(SCRIPT, []);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage: check-research\.mjs <report\.json>/);
  assert.equal(res.stdout, '');
});

test('an unreadable report file exits 2', (t) => {
  const dir = tempDir(t);
  const res = runScript(SCRIPT, [join(dir, 'nope.json')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /check-research: cannot read .*nope\.json/);
  assert.equal(res.stdout, '');
});

test('a non-JSON report exits 2', (t) => {
  const dir = tempDir(t);
  const res = runScript(SCRIPT, [writeText(join(dir, 'report.json'), '{ not json')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /is not JSON/);
  assert.equal(res.stdout, '');
});

test('a bad --window exits 2', (t) => {
  const dir = tempDir(t);
  const file = writeJson(join(dir, 'report.json'), [record()]);
  const one = runScript(SCRIPT, [file, '--window', '2026-09-29 00:00']);
  assert.equal(one.status, 2);
  assert.match(one.stderr, /--window needs two values/);

  const unparseable = runScript(SCRIPT, [file, '--window', 'yesterday', 'tomorrow']);
  assert.equal(unparseable.status, 2);
  assert.match(unparseable.stderr, /window ends must be YYYY-MM-DD HH:MM/);
  assert.equal(unparseable.stdout, '');
});

test('a headline differing only by a trailing outlet name is accepted', (t) => {
  const dir = tempDir(t);
  // Documented tolerance: a fetch may fall back to <title>, which appends the
  // outlet after a separator. Two separator shapes, in two aspects so the
  // single-outlet warning cannot fire either way.
  const res = run(dir, [
    record({ headline: 'Example headline text', sourceTitle: 'Example headline text - News Site' }),
    record({ aspect: 'Politics', headline: 'Second example headline', sourceTitle: 'Second example headline | \u5149\u660e\u7f51' }),
  ]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /RESEARCH: OK/);
});

test('a truncated headline is still refused', (t) => {
  const dir = tempDir(t);
  // The tolerant rule only allows a trailing separator plus the outlet: a
  // headline cut short of the page title is still a rewrite.
  const res = run(dir, [record({ headline: 'Example headline', sourceTitle: 'Example headline text' })]);
  assertProblem(res, 'record 1  headline: differs from sourceTitle "Example headline text"');
});
