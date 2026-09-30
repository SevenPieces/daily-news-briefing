// check-diversity.mjs - a section whose primaries all come from one outlet
// fails, and no story section may be skipped. Each test names the regression it
// guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runScript, tempDir, writeText } from './helpers.mjs';
import { briefing, scenario } from './fixtures.mjs';

const SCRIPT = 'check-diversity.mjs';

function globalStory(headline, outlet, url) {
  return '- **' + headline + '** - Synthetic summary. [src:' + outlet + ' 2026-09-29 12:10](' + url + ') #new [prov:full]';
}

function chinaStory(headline, outlet, url) {
  return '- **' + headline + '** - 合成摘要。 [src:' + outlet + ' 2026-09-29 18:00](' + url + ') #new [prov:feed]';
}

/** Global (2 outlets) + China, so only the intended section can fail. */
function doc(chinaLines, chinaHeading = '## China / 中国') {
  return [
    '# Daily Briefing / 每日简报 - 2026-09-30',
    '_Asia/Shanghai - generated 2026-09-30 08:30_',
    '',
    '## Global',
    '### Economy',
    globalStory('Global one', 'BBC', 'https://example.com/g1'),
    globalStory('Global two', 'Al Jazeera', 'https://example.com/g2'),
    '',
    chinaHeading,
    '### 经济',
    ...chinaLines,
    '',
  ].join('\n');
}

test('the valid fixture passes with exact per-section item and outlet counts', (t) => {
  const dir = tempDir(t);
  const { mdPath } = scenario(dir);
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 0, res.stderr);

  // Exact numbers and exact outlet order (first-appearance). A dropped story,
  // a merged section or a reordered outlet list shows up here.
  assert.deepEqual(res.stdout.trimEnd().split('\n'), [
    'Global: 4 items, 3 distinct outlet(s): BBC, Al Jazeera, The Guardian',
    'China: 3 items, 2 distinct outlet(s): 新华网, 央广网',
    'DIVERSITY: OK',
  ]);
});

test('a section whose primaries are all one outlet fails with exit 1', (t) => {
  const dir = tempDir(t);
  const md = [
    '# Daily Briefing / 每日简报 - 2026-09-30',
    '_Asia/Shanghai - generated 2026-09-30 08:30_',
    '',
    '## Global',
    '### Economy',
    globalStory('Global one', 'BBC', 'https://example.com/g1'),
    globalStory('Global two', 'BBC', 'https://example.com/g2'),
    '',
    '## China / 中国',
    '### 经济',
    chinaStory('中国一', '新华网', 'https://example.com/c1'),
    chinaStory('中国二', '央广网', 'https://example.com/c2'),
    '',
  ].join('\n');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 1);
  assert.deepEqual(res.stdout.trimEnd().split('\n'), [
    'Global: 2 items, 1 distinct outlet(s): BBC',
    '  FAIL: Global rests on a single outlet',
    '  note: Global/Economy has 2 items all from BBC',
    'China: 2 items, 2 distinct outlet(s): 新华网, 央广网',
    'DIVERSITY: FAIL',
  ]);
});

test('a Chinese-only "## 中国" heading is counted, so a single-outlet China section fails', (t) => {
  const dir = tempDir(t);
  const md = doc([
    chinaStory('中国一', '新华网', 'https://example.com/c1'),
    chinaStory('中国二', '新华网', 'https://example.com/c2'),
  ], '## 中国');
  assert.ok(md.includes('## 中国'), 'fixture injection did not apply');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const res = runScript(SCRIPT, [mdPath]);

  // The regression that matters most: this used to print 'China: 0 items',
  // call itself DIVERSITY: OK and exit 0, because the heading was unmapped.
  assert.equal(res.status, 1);
  assert.deepEqual(res.stdout.trimEnd().split('\n'), [
    'Global: 2 items, 2 distinct outlet(s): BBC, Al Jazeera',
    'China: 2 items, 1 distinct outlet(s): 新华网',
    '  FAIL: China rests on a single outlet',
    '  note: China/经济 has 2 items all from 新华网',
    'DIVERSITY: FAIL',
  ]);
  assert.doesNotMatch(res.stdout, /China: 0 items/);
});

test('Top stories are not double-counted into the Global section', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), briefing({ topStories: 4 }));
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 0, res.stdout + res.stderr);

  // The fixture's 4 Top stories already appear in an aspect; counting them a
  // second time as Global would report 8 items here, double-weighting them.
  assert.deepEqual(res.stdout.trimEnd().split('\n'), [
    'Global: 4 items, 3 distinct outlet(s): BBC, Al Jazeera, The Guardian',
    'China: 3 items, 2 distinct outlet(s): 新华网, 央广网',
    'DIVERSITY: OK',
  ]);
});

test('a sub-heading outside Global, China or the Coverage note exits 2', (t) => {
  const dir = tempDir(t);
  // Beyond the required list: commit 8d60e19 made both gates refuse a stray
  // '###' instead of counting (or ignoring) whatever sat under it.
  const md = briefing().replace(
    '## Coverage note / 覆盖说明',
    '## Watchlist / 持续关注\n### Stray aspect\n## Coverage note / 覆盖说明',
  );
  assert.ok(md.includes('### Stray aspect'), 'fixture injection did not apply');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /sub-heading outside Global, China or the Coverage note/i);
  assert.equal(res.stdout, '');
});

test('an unknown "## " heading exits 2', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), briefing().replace('## Global', '## Worldwide'));
  const res = runScript(SCRIPT, [mdPath]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /does not match the output contract/i);
  assert.match(res.stderr, /unrecognised .*section heading/i);
  assert.match(res.stderr, /Worldwide/);
  assert.equal(res.stdout, '');
});

// ---------------------------------------------------------------------------
// Behaviour added after the first suite: the "unparsed" bucket, so a section
// whose stories carry no usable [src:] stamp can no longer look empty.
// ---------------------------------------------------------------------------

test('stories whose [src:] has a date but no clock time fail instead of reading as an empty section', (t) => {
  const dir = tempDir(t);
  const md = doc([
    chinaStory('中国一', '新华网', 'https://example.com/c1'),
    chinaStory('中国二', '央广网', 'https://example.com/c2'),
  ])
    .replace('[src:BBC 2026-09-29 12:10]', '[src:BBC 2026-09-29]')
    .replace('[src:Al Jazeera 2026-09-29 12:10]', '[src:Al Jazeera 2026-09-29]');
  assert.ok(md.includes('[src:BBC 2026-09-29]('), 'the Global stamp was not stripped');
  assert.ok(md.includes('[src:Al Jazeera 2026-09-29]('), 'the second Global stamp was not stripped');
  assert.ok(!md.includes('[src:BBC 2026-09-29 12:10]'), 'a Global story still has a clock time');
  const res = runScript(SCRIPT, [writeText(join(dir, 'briefing.md'), md)]);

  // Regression: sourceRef() could not attribute these two lines, so they were
  // skipped, the section printed 'Global: 0 items' and the gate said
  // DIVERSITY: OK - exactly the silent pass this bucket exists to prevent.
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL: 2 story line\(s\) in Global or China carry no usable \[src:OUTLET YYYY-MM-DD HH:MM\] reference, so no outlet could be counted/);
  assert.match(res.stdout, /^    line \d+ {2}- \*\*Global one\*\*/m);
  assert.match(res.stdout, /^    line \d+ {2}- \*\*Global two\*\*/m);
  assert.match(res.stdout, /DIVERSITY: FAIL/);
  assert.doesNotMatch(res.stdout, /DIVERSITY: OK/);

  // The per-section summary line still says 0 items, but it is no longer "as if
  // the section were simply empty": the gate has already said, above it, that
  // it could not attribute those lines. Pinning the order makes the difference
  // between the old silent pass and this refusal.
  const failAt = res.stdout.indexOf('no outlet could be counted');
  const zeroAt = res.stdout.indexOf('Global: 0 items');
  assert.ok(failAt >= 0, 'the no-outlet FAIL line must be printed');
  assert.ok(zeroAt >= 0, 'the per-section summary line is still printed');
  assert.ok(failAt < zeroAt, 'the no-outlet FAIL must precede the section summary');

  // Positive control: the section that DID carry a clock time is still counted,
  // so the zero above is about the Global stamps alone.
  assert.match(res.stdout, /^China: 2 items, 2 distinct outlet\(s\): 新华网, 央广网$/m);
});

test('the same two stories with a full timestamp pass (control for the unparsed bucket)', (t) => {
  const dir = tempDir(t);
  const md = doc([
    chinaStory('中国一', '新华网', 'https://example.com/c1'),
    chinaStory('中国二', '央广网', 'https://example.com/c2'),
  ]);
  assert.ok(md.includes('[src:BBC 2026-09-29 12:10]'), 'the control needs a full Global stamp');
  const res = runScript(SCRIPT, [writeText(join(dir, 'briefing.md'), md)]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.deepEqual(res.stdout.trimEnd().split('\n'), [
    'Global: 2 items, 2 distinct outlet(s): BBC, Al Jazeera',
    'China: 2 items, 2 distinct outlet(s): 新华网, 央广网',
    'DIVERSITY: OK',
  ]);
});

test('a non-bold bullet carrying a real [src:] reference in Global is counted and fails', (t) => {
  const dir = tempDir(t);
  const note = '- Note: two rows are stale, see [src:BBC 2026-09-29 12:10](https://example.com/note) [prov:link]';
  const md = doc([
    chinaStory('中国一', '新华网', 'https://example.com/c1'),
    chinaStory('中国二', '央广网', 'https://example.com/c2'),
  ]).replace('## China / 中国', note + '\n## China / 中国');
  assert.ok(md.includes('two rows are stale'), 'fixture injection did not apply');
  const res = runScript(SCRIPT, [writeText(join(dir, 'briefing.md'), md)]);

  // Regression: looksLikeStory() widened, so a bullet that merely carries a
  // [src:] link is no longer invisible to this gate - it lands in the unparsed
  // bucket instead of being neither counted nor reported.
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL: 1 story line\(s\) in Global or China carry no usable \[src:OUTLET YYYY-MM-DD HH:MM\] reference, so no outlet could be counted/);
  assert.match(res.stdout, /^    line \d+ {2}- Note: two rows are stale/m);
  assert.match(res.stdout, /DIVERSITY: FAIL/);
  // Positive control: the two real stories are still attributed, so the failure
  // is caused by the note alone.
  assert.match(res.stdout, /^Global: 2 items, 2 distinct outlet\(s\): BBC, Al Jazeera$/m);
});
