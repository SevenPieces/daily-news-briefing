// md-to-items.mjs - the state index must be a complete, ordered, faithful reading
// of the briefing's story lines. Each test names the regression it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonOf, readText, runScript, tempDir, writeText } from './helpers.mjs';
import { briefing, scenario } from './fixtures.mjs';

const SCRIPT = 'md-to-items.mjs';
const OUT = '.items.json';

function readItems(path) {
  return JSON.parse(readText(path));
}

test('indexes exactly the fixture story lines, in document order, with section/aspect/watch', (t) => {
  const dir = tempDir(t);
  const { mdPath } = scenario(dir);
  const out = join(dir, OUT);
  const res = runScript(SCRIPT, [mdPath, '--out', out]);
  assert.equal(res.status, 0, res.stderr);
  const items = readItems(out);

  // Exact count: catches a story line silently dropped (or double-indexed).
  assert.equal(items.length, 10);
  // Exact order: catches a section being read out of document order, or two
  // sections being merged or split.
  assert.deepEqual(items.map((i) => i.title), [
    'Synthetic top story number 1',
    'Synthetic top story number 2',
    'Synthetic global economy story 1',
    'Synthetic global economy story 2',
    'Synthetic global economy story 3',
    'Synthetic global politics story 1',
    '合成中国经济新闻 1',
    '合成中国经济新闻 2',
    '合成中国时政新闻 1',
    'Synthetic watched story 1',
  ]);
  // Section + aspect mapping and the watch flag: Top stories -> global/top,
  // '### X' -> the current aspect, Watchlist -> watch/watch flagged watch.
  assert.deepEqual(items.map((i) => [i.section, i.aspect, i.watch]), [
    ['global', 'top', false],
    ['global', 'top', false],
    ['global', 'Economy', false],
    ['global', 'Economy', false],
    ['global', 'Economy', false],
    ['global', 'Politics', false],
    ['china', '经济', false],
    ['china', '经济', false],
    ['china', '时政', false],
    ['watch', 'watch', true],
  ]);
});

test('a Chinese-only "## 中国" heading still yields the China items (9 lines, not 7)', (t) => {
  const dir = tempDir(t);
  const md = briefing({ chinaStories: 1 }).replace('## China / 中国', '## 中国');
  assert.ok(md.includes('## 中国'), 'fixture injection did not apply');
  assert.ok(!md.includes('## China / 中国'), 'the Chinese-only heading variant was not built');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const out = join(dir, OUT);
  const res = runScript(SCRIPT, [mdPath, '--out', out]);
  assert.equal(res.status, 0, res.stderr);
  const items = readItems(out);

  // Regression: this fixture is 9 story lines; before the shared section
  // grammar an unmapped '## 中国' dropped its 2 China stories, giving 7.
  assert.equal(items.length, 9);
  assert.deepEqual(
    items.filter((i) => i.section === 'china').map((i) => i.title),
    ['合成中国经济新闻 1', '合成中国时政新闻 1'],
  );
});

test('non-story bullets are not indexed: coverage note, sources, indented sub-bullets', (t) => {
  const dir = tempDir(t);
  const md = briefing({
    coverageSubheading: true,
    extraStoryLines: [
      '- **Coverage note bullet shaped like a story** - must be ignored. [src:BBC 2026-09-29 12:10](https://example.com/coverage) [prov:full]',
    ],
  })
    .replace(
      '### Politics',
      '  - **Indented sub-note in a story section** - must be ignored. [src:BBC 2026-09-29 12:10](https://example.com/indent) [prov:full]\n### Politics',
    )
    .replace(
      '## Sources / 来源',
      '## Sources / 来源\n- **Sources bullet shaped like a story** - must be ignored. [src:Fake 2026-09-29 10:00](https://example.com/fake) [prov:full]',
    );
  for (const needle of [
    'Coverage note bullet shaped',
    'Indented sub-note in a story section',
    'Sources bullet shaped',
  ]) {
    assert.ok(md.includes(needle), 'fixture injection for "' + needle + '" did not apply');
  }
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const res = runScript(SCRIPT, [mdPath, '--out', join(dir, OUT)]);
  assert.equal(res.status, 0, res.stderr);
  const items = readItems(join(dir, OUT));

  // Regression: a bullet that merely looks like a story inside a non-story
  // section, or any indented bullet, must not inflate the index.
  assert.equal(items.length, 10);
  for (const needle of ['Coverage note bullet shaped', 'Indented sub-note', 'Sources bullet shaped']) {
    assert.ok(!items.some((i) => i.title.includes(needle)), needle + ' must not be indexed');
  }
});

test('parses title, outlet, primaryUrl and flags from a full story line', (t) => {
  const dir = tempDir(t);
  const md = [
    '# Daily Briefing / 每日简报 - 2026-09-30',
    '_Asia/Shanghai - generated 2026-09-30 08:30_',
    '',
    '## Global',
    '### Economy',
    '- **Headline** - Summary. [src:OUTLET 2026-09-29 12:10](https://example.com/a) [alt:Other](https://example.com/b) #new #developing [prov:full]',
    '',
  ].join('\n');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const res = runScript(SCRIPT, [mdPath, '--out', join(dir, OUT)]);
  assert.equal(res.status, 0, res.stderr);
  const items = readItems(join(dir, OUT));

  // Regression: the outlet used to keep the ' YYYY-MM-DD HH:MM' stamp, an
  // [alt:] link could win over [src:] as the primary, and a run of tags could
  // swallow the next token.
  assert.deepEqual(items, [{
    title: 'Headline',
    section: 'global',
    aspect: 'Economy',
    outlet: 'OUTLET',
    primaryUrl: 'https://example.com/a',
    flags: ['new', 'developing'],
    watch: false,
  }]);
});

test('an unknown "## " heading exits 2 and writes no output file', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing.md'), briefing().replace('## Global', '## Worldwide'));
  const out = join(dir, OUT);
  const res = runScript(SCRIPT, [mdPath, '--out', out]);

  // Regression: an unmapped heading used to silently drop its whole section
  // from the index while the tool still exited 0.
  assert.equal(res.status, 2);
  assert.ok(!existsSync(out), 'a refused run must leave no index behind');
  assert.match(res.stderr, /unrecognised section heading/i);
  assert.match(res.stderr, /## Worldwide/);
});

test('a briefing with no story lines exits non-zero and writes nothing', (t) => {
  const dir = tempDir(t);
  const md = [
    '# Daily Briefing / 每日简报 - 2026-09-30',
    '_Asia/Shanghai - generated 2026-09-30 08:30_',
    '',
    '## Coverage note / 覆盖说明',
    'Quiet day: no story lines at all.',
    '',
  ].join('\n');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const out = join(dir, OUT);
  const res = runScript(SCRIPT, [mdPath, '--out', out]);
  assert.equal(res.status, 1);
  assert.ok(!existsSync(out));
  assert.match(res.stderr, /no stories parsed/i);
});

test('--out defaults to .items.json beside the input', (t) => {
  const dir = tempDir(t);
  const mdPath = writeText(join(dir, 'briefing-2026-09-30.md'), briefing());
  const res = runScript(SCRIPT, [mdPath]); // deliberately no --out
  assert.equal(res.status, 0, res.stderr);
  const out = join(dir, OUT);
  assert.ok(existsSync(out), 'default output beside the input is missing');
  const payload = jsonOf(res.stdout);
  assert.equal(payload.out, out);
  assert.equal(payload.items, 10);
});

test('a previous output file is removed before parsing', (t) => {
  const dir = tempDir(t);
  const md = ['# Daily Briefing', '_meta_', '', '## Coverage note / 覆盖说明', 'Quiet.', ''].join('\n');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const out = join(dir, OUT);
  writeFileSync(out, 'STALE INDEX FROM A PREVIOUS RUN\n');
  assert.ok(existsSync(out));

  const res = runScript(SCRIPT, [mdPath]); // fails: the file has no story lines
  assert.equal(res.status, 1);
  // Regression: a failed run used to leave the previous run's index in place,
  // so update-state.mjs would ingest stories from the wrong briefing.
  assert.ok(!existsSync(out), 'the previous run output must be removed before parsing');
});

test('a non-bold bullet with a real [src:] reference is not indexed, while a bold-headed one is', (t) => {
  const dir = tempDir(t);
  const note = '- Note: two rows are stale, see [src:BBC 2026-09-29 12:10](https://example.com/note) [prov:link]';
  const control = '- **Indexed bold control** - Synthetic summary. [src:BBC 2026-09-29 12:10](https://example.com/control) #new [prov:full]';
  const md = briefing().replace('### Politics', note + '\n' + control + '\n### Politics');
  assert.ok(md.includes('two rows are stale'), 'fixture injection did not apply');
  assert.ok(md.includes('Indexed bold control'), 'fixture injection did not apply');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const out = join(dir, OUT);
  const res = runScript(SCRIPT, [mdPath, '--out', out]);
  assert.equal(res.status, 0, res.stderr);
  const items = readItems(out);

  // Regression: indexing only required a [src:] link, so this note became an
  // index entry whose title was the note text - a garbage "story" for
  // update-state.mjs to carry forward.
  assert.equal(items.length, 11, 'ten fixture stories plus exactly one control');
  assert.deepEqual(
    items.filter((i) => i.title === 'Indexed bold control').map((i) => i.title),
    ['Indexed bold control'],
  );
  assert.ok(!items.some((i) => i.title.includes('two rows are stale')), 'the note must not be an item');
  assert.ok(!readText(out).includes('two rows are stale'), 'the note text must not appear anywhere in the index');

  // Positive control: the bold-headed line in the same position was indexed, so
  // the absence above is about the missing headline and nothing else.
  assert.ok(items.some((i) => i.title === 'Indexed bold control'));
});
