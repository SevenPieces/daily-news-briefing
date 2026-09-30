// Unit tests for scripts/lib/sections.mjs - the one place that defines what a
// section is and what a story line is. Three CLI tools import it, and the
// defects it was written to close (a whole section silently dropped, a garbage
// title indexed as a story) were both predicate defects, so the predicates are
// tested directly as well as through the tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORY_SECTIONS, describeProblems, headingText, headings, hasSourceRef,
  isStoryLine, looksLikeStory, sectionOf, sourceRef, structureProblems,
} from '../scripts/lib/sections.mjs';

const STORY = '- **Headline** - Summary. [src:BBC 2026-09-29 12:10](https://x/a) #new [prov:full]';

test('sectionOf maps both halves of a bilingual heading, in either order', () => {
  assert.equal(sectionOf('Top stories / 今日要闻'), 'top');
  assert.equal(sectionOf('Global'), 'global');
  assert.equal(sectionOf('China / 中国'), 'china');
  assert.equal(sectionOf('中国 / China'), 'china', 'the reversed bilingual form must still map');
  assert.equal(sectionOf('中国'), 'china', 'a Chinese-only heading must still map - this is the silent-loss case');
  assert.equal(sectionOf('Watchlist / 持续关注'), 'watch');
  assert.equal(sectionOf('观察'), 'watch');
  assert.equal(sectionOf('Market snapshot / 市场快照'), 'market');
  assert.equal(sectionOf('市场快照'), 'market');
  assert.equal(sectionOf('Coverage note / 覆盖说明'), 'coverage');
  assert.equal(sectionOf('覆盖说明'), 'coverage');
  assert.equal(sectionOf('Sources / 来源'), 'sources');
  assert.equal(sectionOf('来源'), 'sources');
});

test('sectionOf is case-insensitive and trims, and returns null for anything else', () => {
  assert.equal(sectionOf('  GLOBAL  '), 'global');
  assert.equal(sectionOf('top STORIES / 今日要闻'), 'top');
  assert.equal(sectionOf('Nonsense'), null);
  assert.equal(sectionOf('Globals'), null);
  assert.equal(sectionOf(''), null);
});

test('STORY_SECTIONS holds exactly the four sections that carry stories', () => {
  assert.deepEqual([...STORY_SECTIONS].sort(), ['china', 'global', 'top', 'watch']);
});

test('headingText accepts only level-2 and level-3 headings', () => {
  assert.equal(headingText('## Global'), 'Global');
  assert.equal(headingText('### Economy'), 'Economy');
  assert.equal(headingText('  ## Indented heading'), null, 'a heading must start at column zero');
  assert.equal(headingText('# Title'), null);
  assert.equal(headingText('#### Too deep'), null);
  assert.equal(headingText('##NoSpace'), null, 'the space after the hashes is required');
  assert.equal(headingText('plain text'), null);
});

test('headings() reports only level-2 headings, with 1-based line numbers', () => {
  const md = ['# Title', '', '## Global', '### Economy', STORY, '', '## China / 中国', '## 中国'].join('\n');
  assert.deepEqual(headings(md), [
    { line: 3, text: 'Global', section: 'global' },
    { line: 7, text: 'China / 中国', section: 'china' },
    { line: 8, text: '中国', section: 'china' },
  ]);
});

test('isStoryLine demands the contract shape: a non-indented bullet with a bold headline', () => {
  assert.equal(isStoryLine(STORY), true);
  assert.equal(isStoryLine('- **Headline** - no reference at all'), true, 'the source rule is checked separately');
  assert.equal(isStoryLine('- **Headline**'), true);
  assert.equal(isStoryLine('- Note: see [src:BBC 2026-09-29 12:10](https://x/a)'), false,
    'a bullet that merely contains a reference is not a story - indexing it put a garbage title in the state');
  assert.equal(isStoryLine('  - **Indented** - sub-note'), false);
  assert.equal(isStoryLine('* **Bullet star**'), false);
  assert.equal(isStoryLine('Prose about - **Headline**'), false);
});

test('looksLikeStory is the wider net that catches a malformed story so it can be reported', () => {
  assert.equal(looksLikeStory(STORY), true);
  assert.equal(looksLikeStory('- Note: see [src:BBC 2026-09-29 12:10](https://x/a)'), true,
    'this is the line check-provenance must report as malformed rather than skip');
  assert.equal(looksLikeStory('  - **Indented** - sub-note'), false);
  assert.equal(looksLikeStory('- a plain note bullet'), false);
});

test('hasSourceRef wants a real reference, not the words in prose', () => {
  assert.equal(hasSourceRef(STORY), true);
  assert.equal(hasSourceRef('- text mentioning [src:] by name'), false,
    'a Coverage-note bullet explaining the grammar must not read as a story');
  assert.equal(hasSourceRef('- [src:OUTLET](https://x)', ), true);
});

test('sourceRef extracts the outlet, and only from a stamped reference', () => {
  assert.equal(sourceRef(STORY), 'BBC');
  assert.equal(sourceRef('- **H** - s. [src:央广网 2026-09-29 18:00](https://x) #new [prov:feed]'), '央广网');
  assert.equal(sourceRef('- **H** - s. [src:BBC 2026-09-29](https://x)'), null,
    'no clock time is not a usable reference - the gate must say so, not skip the line');
  assert.equal(sourceRef('- **H** - s. [src:BBC](https://x)'), null);
});

test('structureProblems refuses an unmapped section heading instead of skipping its bullets', () => {
  const md = ['## Global', '### Economy', STORY, '## Nonsense', STORY].join('\n');
  const problems = structureProblems(md);
  assert.equal(problems.length, 1);
  assert.deepEqual(problems[0], { line: 4, kind: 'unmapped-section', text: 'Nonsense' });
});

test('structureProblems refuses a sub-heading outside Global, China and the Coverage note', () => {
  const md = ['## Sources / 来源', '### Extra', '- a line'].join('\n');
  assert.deepEqual(structureProblems(md), [{ line: 2, kind: 'stray-subheading', text: 'Extra' }]);
});

test('the Coverage note allows exactly one blessed sub-heading', () => {
  const ok = ['## Coverage note / 覆盖说明', 'text', '### Additional notes / 补充说明', '- a note'].join('\n');
  assert.deepEqual(structureProblems(ok), []);
  const wrongName = ['## Coverage note / 覆盖说明', '### Anything else'].join('\n');
  assert.deepEqual(structureProblems(wrongName), [{ line: 2, kind: 'coverage-subheading', text: 'Anything else' }]);
  const twice = ['## Coverage note / 覆盖说明', '### Additional notes', '### 补充说明'].join('\n');
  assert.deepEqual(structureProblems(twice), [{ line: 3, kind: 'duplicate-coverage-subheading', text: '补充说明' }]);
});

test('structureProblems refuses a story-shaped bullet in a section that holds no stories', () => {
  const md = ['## Coverage note / 覆盖说明', STORY].join('\n');
  const problems = structureProblems(md);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'story-outside-story-section');
  assert.equal(problems[0].line, 2);
  assert.ok(problems[0].text.includes('Headline'));
});

test('structureProblems leaves a valid briefing alone, prose mentions included', () => {
  const md = [
    '## Top stories / 今日要闻', STORY, '',
    '## Global', '### Economy', STORY, '',
    '## China / 中国', '### 经济', '- **标题** - 摘要。 [src:新华网 2026-09-29 18:00](https://x/b) #new [prov:feed]', '',
    '## Watchlist / 持续关注', STORY, '',
    '## Coverage note / 覆盖说明',
    '- the rule mentions [prov:feed] and [src:] in prose, which is not a story line',
    '### Additional notes / 补充说明', '- a note bullet', '',
    '## Sources / 来源', '- BBC - https://x/a',
  ].join('\n');
  assert.deepEqual(structureProblems(md), []);
});

test('describeProblems names every problem kind in words a reader can act on', () => {
  const kinds = ['unmapped-section', 'coverage-subheading', 'duplicate-coverage-subheading',
    'stray-subheading', 'story-outside-story-section'];
  const lines = describeProblems(kinds.map((kind, i) => ({ line: i + 1, kind, text: 'TEXT' })));
  assert.equal(lines.length, 5);
  for (const [i, line] of lines.entries()) {
    assert.ok(line.startsWith('line ' + (i + 1) + '  '), 'each line names its line number: ' + line);
    assert.ok(line.includes('TEXT'), 'each line quotes the offending text: ' + line);
  }
  assert.ok(lines[0].includes('section heading'));
  assert.ok(lines[4].includes('holds no stories'));
});
