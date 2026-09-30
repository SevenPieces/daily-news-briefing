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

// ---------------------------------------------------------------------------
// Behaviour these tests pin was added after the first suite: the "malformed"
// bucket, and the structural refusals of scripts/lib/sections.mjs.
// ---------------------------------------------------------------------------

const MALFORMED_LINE = '- Note: two rows are stale, see [src:BBC 2026-09-29 12:10](https://example.com/stale) [prov:link]';

test('a bullet meant as a story with no bold headline is reported as malformed, not skipped', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), doc([MALFORMED_LINE]));
  const res = runScript(SCRIPT, [mdPath]);

  // Regression: looksLikeStory() was widened exactly so that this line is
  // REPORTED. Before, it was neither a story nor a complaint - the line was
  // skipped everywhere, so nothing that read the briefing ever saw it.
  assert.equal(res.status, 1);
  assert.match(res.stdout, /PROVENANCE: FAIL/);
  assert.match(res.stdout, /malformed: 1/);
  assert.match(res.stdout, /meant as stories but do not open with a bold headline/);
  assert.match(res.stdout, /^    line \d+ {2}\(Global\) {2}- Note: two rows are stale/m);
  // It fails; it is not quietly promoted to a story either.
  const c = summary(res.stdout);
  assert.equal(c.storyLines, 0);
  assert.equal(c.full + c.feed + c.link, 0);
});

test('the same bullet with a bold headline is counted normally (control for malformed)', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), doc([
    '- **Note: two rows are stale** - see [src:BBC 2026-09-29 12:10](https://example.com/stale) [prov:link]',
  ]));
  const res = runScript(SCRIPT, [mdPath]);

  // Control: only the missing bold headline explains the failure above, so the
  // malformed bucket is not merely "any bullet that carries a [src:] link".
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /PROVENANCE: OK/);
  assert.doesNotMatch(res.stdout, /malformed/);
  assert.deepEqual(summary(res.stdout), { storyLines: 1, full: 0, feed: 0, link: 1 });
});

test('an unmapped "## " heading exits 2 with the contract message and prints no counts at all', (t) => {
  const dir = tempDir(t);
  // Positive control first: the untouched fixture DOES print a count line, so
  // the absence asserted below is a property of the refused run, not of the tool.
  const good = runScript(SCRIPT, [writeText(join(dir, 'good.md'), briefing())]);
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /^story lines: 10 \|/m);

  const fixture = briefing();
  assert.equal((fixture.match(/^## Global$/gm) || []).length, 1, 'fixture must have exactly one "## Global"');
  const mdPath = writeText(join(dir, 'briefing.md'), fixture.replace('## Global', '## Worldwide'));
  const res = runScript(SCRIPT, [mdPath]);

  // Regression: the gate refused the structure but could still print counts for
  // the sections it happened to recognise, so "refused to evaluate" and
  // "evaluated and passed" were indistinguishable.
  assert.equal(res.status, 2);
  assert.match(res.stderr, /does not match the output contract/i);
  assert.match(res.stderr, /unrecognised "## " section heading/);
  assert.match(res.stderr, /Worldwide/);
  assert.equal(res.stdout, '');
  assert.doesNotMatch(res.stdout, /story lines:/);
});

test('a "### " sub-heading outside Global/China, under ## Sources, exits 2', (t) => {
  const dir = tempDir(t);
  const md = briefing().replace('## Sources / 来源', '## Sources / 来源\n### Stray under sources');
  assert.ok(md.includes('### Stray under sources'), 'fixture injection did not apply');
  const res = runScript(SCRIPT, [writeText(join(dir, 'briefing.md'), md)]);

  // Regression: only Global, China and the Coverage note may carry a '### '.
  // Anywhere else it was read as an aspect, or ignored.
  assert.equal(res.status, 2);
  assert.match(res.stderr, /sub-heading outside Global, China or the Coverage note/);
  assert.match(res.stderr, /Stray under sources/);
  assert.equal(res.stdout, '');
});

test('the blessed Coverage-note sub-heading passes; any other one exits 2', (t) => {
  const dir = tempDir(t);
  const blessed = briefing({ coverageSubheading: true });
  assert.ok(blessed.includes('### Additional notes / 补充说明'), 'fixture injection did not apply');

  const ok = runScript(SCRIPT, [writeText(join(dir, 'blessed.md'), blessed)]);
  // Regression, positive direction: the one sub-heading the real briefing used
  // under the Coverage note must not itself be treated as a deviation.
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /PROVENANCE: OK/);
  assert.deepEqual(summary(ok.stdout), { storyLines: 10, full: 9, feed: 1, link: 0 });

  const other = runScript(SCRIPT, [writeText(join(dir, 'other.md'), blessed.replace('### Additional notes / 补充说明', '### Anything else'))]);
  assert.match(other.stderr, /does not match the output contract/i);
  assert.equal(other.status, 2);
  assert.match(other.stderr, /sub-heading the Coverage note does not define/);
  assert.match(other.stderr, /Anything else/);
  assert.equal(other.stdout, '');
});

test('a second "### Additional notes / 补充说明" inside the Coverage note exits 2', (t) => {
  const dir = tempDir(t);
  const md = briefing({ coverageSubheading: true })
    .replace('### Additional notes / 补充说明', '### Additional notes / 补充说明\n### Additional notes / 补充说明');
  assert.equal((md.match(/### Additional notes \/ 补充说明/g) || []).length, 2, 'the duplicate was not injected');
  const res = runScript(SCRIPT, [writeText(join(dir, 'briefing.md'), md)]);

  // Regression: the blessed sub-heading was a set-membership test with no
  // "seen already" state, so a second copy was accepted as normal.
  assert.equal(res.status, 2);
  assert.match(res.stderr, /second Coverage-note sub-heading/);
  assert.equal(res.stdout, '');
});

test('a story-shaped bullet in Market snapshot, the Coverage note or the Sources exits 2', (t) => {
  const dir = tempDir(t);
  const bullet = (label) => '- **' + label + '** - structurally illegal. [src:BBC 2026-09-29 12:10](https://example.com/' + label + ') [prov:full]';
  const variants = [
    ['## Market snapshot', briefing().replace('## Global', bullet('Market-shaped') + '\n\n## Global'), 'Market-shaped'],
    ['## Coverage note', briefing().replace('Quiet aspects: none.', 'Quiet aspects: none.\n' + bullet('Coverage-shaped')), 'Coverage-shaped'],
    ['## Sources', briefing().replace('## Sources / 来源', '## Sources / 来源\n' + bullet('Sources-shaped')), 'Sources-shaped'],
  ];
  // Positive control: the untouched fixture is accepted, so "exit 2" below is
  // caused by the injected bullet and nothing else.
  const base = runScript(SCRIPT, [writeText(join(dir, 'base.md'), briefing())]);
  assert.equal(base.status, 0, base.stdout + base.stderr);

  for (const [where, md, label] of variants) {
    assert.ok(md.includes(label), 'injection into ' + where + ' did not apply');
    const res = runScript(SCRIPT, [writeText(join(dir, 'briefing.md'), md)]);
    // Regression: these bullets sat in sections the exclusion list did not
    // match, so they were silently skipped instead of refused.
    assert.equal(res.status, 2, where + ' must be refused');
    assert.match(res.stderr, /story-shaped bullet in a section that holds no stories/);
    assert.match(res.stderr, new RegExp(label));
    assert.equal(res.stdout, '', where + ' must not print story counts');
  }
});

test('an indented bullet is never a story, in any bucket', (t) => {
  const dir = tempDir(t);
  const indented = (label, url) => '  - **' + label + '** - [src:BBC 2026-09-29 12:10](' + url + ') [prov:full]';
  const md = briefing()
    .replace('| S&P 500 |', indented('Indented market', 'https://example.com/i1') + '\n| S&P 500 |')
    .replace('Quiet aspects: none.', 'Quiet aspects: none.\n' + indented('Indented coverage', 'https://example.com/i2'))
    .replace('- BBC - https://www.bbc.co.uk/news/articles/example-one', indented('Indented sources', 'https://example.com/i3') + '\n- BBC - https://www.bbc.co.uk/news/articles/example-one')
    .replace('### Politics', indented('Indented global', 'https://example.com/i4') + '\n### Politics');
  for (const label of ['Indented market', 'Indented coverage', 'Indented sources', 'Indented global']) {
    assert.ok(md.includes(label), 'injection of "' + label + '" did not apply');
  }
  const res = runScript(SCRIPT, [writeText(join(dir, 'briefing.md'), md)]);

  // Regression: an indented sub-note was a story in the Market-snapshot and
  // Coverage-note buckets (inflating the count, and with no marker failing a
  // valid briefing) and a "malformed" story in the story sections.
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /PROVENANCE: OK/);
  assert.doesNotMatch(res.stdout, /malformed|unsourced|unmarked|misplaced|duplicated|FAIL/);
  assert.deepEqual(summary(res.stdout), { storyLines: 10, full: 9, feed: 1, link: 0 });
});
