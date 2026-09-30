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
