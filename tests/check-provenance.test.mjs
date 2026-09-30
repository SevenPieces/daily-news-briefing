// check-provenance.mjs - every story line must carry exactly one [prov:*]
// marker, as the last token, and must carry the [src:] reference the state
// index needs. Each test names the regression it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runScript, tempDir, writeText } from './helpers.mjs';
import { briefing, scenario } from './fixtures.mjs';

const SCRIPT = 'check-provenance.mjs';

/** One-line story in a valid story section, so only the tested rule can fail. */
function doc(storyLines) {
  return [
    '# Daily Briefing / 每日简报 - 2026-09-30',
    '_Asia/Shanghai - generated 2026-09-30 08:30_',
    '',
    '## Global',
    '### Economy',
    ...storyLines,
    '',
  ].join('\n');
}

/** The printed counts line, parsed into numbers. */
function summary(stdout) {
  const m = /^story lines: (\d+) \| full: (\d+) \| feed: (\d+) \| link: (\d+)/m.exec(stdout);
  assert.ok(m, 'expected the provenance summary line, got:\n' + stdout);
  return { storyLines: Number(m[1]), full: Number(m[2]), feed: Number(m[3]), link: Number(m[4]) };
}

function story(headline, tail) {
  return '- **' + headline + '** - Synthetic summary. [src:BBC 2026-09-29 12:10](https://example.com/a) ' + tail;
}

test('the valid fixture passes with exit 0', (t) => {
  const dir = tempDir(t);
  const { mdPath } = scenario(dir);
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /PROVENANCE: OK/);
});

test('the printed counts partition the fixture exactly', (t) => {
  const dir = tempDir(t);
  const { mdPath } = scenario(dir);
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 0, res.stderr);
  const c = summary(res.stdout);

  // The fixture's own marker mix: 7 English-language [prov:full] stories, 1
  // China [prov:feed], and 2 China [prov:full]. Regression: a marker counted
  // twice, or a story silently left out of every bucket.
  assert.deepEqual(c, { storyLines: 10, full: 9, feed: 1, link: 0 });
  // Every story line lands in exactly one marker bucket when there are no
  // failures; if a bucket ever lost a line this would no longer hold.
  assert.equal(c.full + c.feed + c.link, c.storyLines);
});

test('a story with no [prov:*] marker fails', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), doc([story('Unmarked', '#new')]));
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /PROVENANCE: FAIL/);
  assert.match(res.stdout, /unmarked: 1/);
  const c = summary(res.stdout);
  assert.equal(c.storyLines, 1);
  assert.equal(c.full + c.feed + c.link, 0);
});

test('a story with two markers fails as duplicated', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), doc([story('Two markers', '[prov:full] [prov:feed]')]));
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /PROVENANCE: FAIL/);
  assert.match(res.stdout, /duplicated: 1/);
  assert.match(res.stdout, /full, feed/);
});

test('a marker that is not the last token fails as misplaced', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), doc([story('Trailing prose', '[prov:full] and then more words')]));
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /PROVENANCE: FAIL/);
  assert.match(res.stdout, /misplaced: 1/);
  assert.match(res.stdout, /not the last token/);
});

test('a bold headline with no [src:] reference fails as unsourced', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), doc([
    '- **No source at all** - Synthetic summary with no reference. [prov:full]',
  ]));
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /PROVENANCE: FAIL/);
  assert.match(res.stdout, /unsourced: 1/);
  assert.match(res.stdout, /no \[src:\.\.\.\] source reference/);
});

test('tags after the marker and a trailing semicolon after the marker are accepted', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), doc([
    story('Tagged after', '[prov:feed] #new #developing'),
    story('Semicolon after', '[prov:link];'),
  ]));
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /PROVENANCE: OK/);
  assert.doesNotMatch(res.stdout, /FAIL/);
  assert.deepEqual(summary(res.stdout), { storyLines: 2, full: 0, feed: 1, link: 1 });
});

test('an unknown "## " heading exits 2 before counting', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), briefing().replace('## Global', '## Worldwide'));
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /does not match the output contract/i);
  assert.match(res.stderr, /unrecognised .*section heading/i);
  assert.match(res.stderr, /Worldwide/);
  assert.equal(res.stdout, '');
});

test('a story-shaped bullet in a section that holds no stories exits 2', (t) => {
  const dir = tempDir(t);
  // Beyond the required list: commit 8d60e19 made the gates police structure,
  // because on 2026-09-30 a '###' plus a bullet under the Coverage note passed
  // both gates. This is the same shape md-to-items is lenient about; here it
  // must be refused rather than silently excluded from the count.
  const md = briefing({
    extraStoryLines: [
      '- **Coverage-note bullet with a real reference** - structurally illegal. [src:BBC 2026-09-29 12:10](https://example.com/coverage) [prov:full]',
    ],
  });
  assert.ok(md.includes('Coverage-note bullet with a real reference'), 'fixture injection did not apply');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /story-shaped bullet in a section that holds no stories/i);
  assert.equal(res.stdout, '');
});

test('indented bullets are never counted as stories', (t) => {
  const dir = tempDir(t);
  const md = briefing().replace(
    '### Politics',
    '  - **Indented sub-note with no marker** - if counted this would be unsourced and unmarked.\n'
      + '  - **Indented story look-alike** - [src:BBC 2026-09-29 12:10](https://example.com/sub) [prov:full]\n'
      + '### Politics',
  );
  assert.ok(md.includes('  - **Indented story look-alike**'), 'fixture injection did not apply');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const res = runScript(SCRIPT, [mdPath]);

  // Regression: counting an indented sub-bullet would both inflate the story
  // count and (for a marker-less sub-note) fail a valid briefing.
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.deepEqual(summary(res.stdout), { storyLines: 10, full: 9, feed: 1, link: 0 });
  assert.match(res.stdout, /PROVENANCE: OK/);
});
