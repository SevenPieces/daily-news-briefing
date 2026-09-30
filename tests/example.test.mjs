// The shipped example is the strongest format signal a documentation-first
// skill has, and it had drifted from the contract it illustrates: two Top
// stories where 3-5 are required, no market closing note, and eight aspects
// dropped without being named quiet. These tests pin it, and pin the committed
// HTML to what the renderer actually produces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_ROOT, runScript, tempDir, jsonOf } from './helpers.mjs';

const EXAMPLE_MD = join(SKILL_ROOT, 'examples', 'sample-briefing.md');
const EXAMPLE_HTML = join(SKILL_ROOT, 'examples', 'sample-briefing.html');
const read = (p) => readFileSync(p, 'utf8');

/** The bullets of one '## ' section, up to the next '## '. */
function sectionLines(md, heading) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('## ') && l.slice(3).trim().startsWith(heading));
  assert.ok(start >= 0, 'the example has no ' + heading + ' section');
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break;
    out.push(lines[i]);
  }
  return out;
}

test('the example passes both gates', () => {
  const p = runScript('check-provenance.mjs', [EXAMPLE_MD]);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.match(p.stdout, /PROVENANCE: OK/);
  const d = runScript('check-diversity.mjs', [EXAMPLE_MD]);
  assert.equal(d.status, 0, d.stdout + d.stderr);
  assert.match(d.stdout, /DIVERSITY: OK/);
});

test('the example shows 3-5 Top stories, as the contract requires', () => {
  const tops = sectionLines(read(EXAMPLE_MD), 'Top stories').filter((l) => l.startsWith('- '));
  assert.ok(tops.length >= 3 && tops.length <= 5, 'Top stories: ' + tops.length);
});

test('the example closes its market table with the contract wording, verbatim', () => {
  const md = read(EXAMPLE_MD);
  const note = '(Values from the collector APIs, each row with its own as-of time in Asia/Shanghai.'
    + ' Yields are quoted in basis points: changeBp is the move in percentage points x 100.)';
  assert.ok(md.includes(note), 'the market closing note is missing or reworded');
});

test('every aspect heading in the example is one of the contract aspects', () => {
  const allowed = new Set(['Economy', 'Politics', 'Business', 'Tech', 'Foreign affairs', 'Military', 'Social',
    '经济', '时政', '商业', '科技', '外交', '军事', '社会']);
  const md = read(EXAMPLE_MD);
  const headings = [...md.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
  assert.ok(headings.length > 0);
  for (const h of headings) {
    assert.ok(allowed.has(h) || h === 'Additional notes / 补充说明', 'unexpected aspect heading: ' + h);
  }
});

test('every aspect the example omits is named quiet in its section language', () => {
  const md = read(EXAMPLE_MD);
  const global = sectionLines(md, 'Global');
  const china = sectionLines(md, 'China');
  const quiet = (lines, marker) => lines.filter((l) => l.trim() === marker).length;
  // The example carries stories in Global Economy and Tech, and in China 经济
  // and 时政; every other aspect must carry the marker rather than be dropped.
  assert.equal(quiet(global, '(quiet - no significant news today)'), 5, 'Global quiet markers');
  assert.equal(quiet(china, '(无重大新闻)'), 5, 'China quiet markers');
  assert.ok(!md.includes('(quiet - 今日无重要新闻)'), 'the mixed-language marker is not the form');
});

test('the committed example HTML is exactly what the renderer produces today', (t) => {
  const dir = tempDir(t, 'dnb-example-');
  const out = join(dir, 'sample.html');
  const r = runScript('render-html.mjs', [EXAMPLE_MD, '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(out), read(EXAMPLE_HTML),
    'examples/sample-briefing.html is stale - re-render it after editing the Markdown');
  assert.equal(jsonOf(r.stdout).bytes, statSync(EXAMPLE_HTML).size, 'reported bytes must be the file size');
});

test('the example indexes as 10 story lines, matching both gates', (t) => {
  const dir = tempDir(t, 'dnb-example-');
  const out = join(dir, 'items.json');
  const r = runScript('md-to-items.mjs', [EXAMPLE_MD, '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const payload = jsonOf(r.stdout);
  assert.equal(payload.items, 10);
  const gate = runScript('check-provenance.mjs', [EXAMPLE_MD]);
  assert.match(gate.stdout, /story lines: 10 /);
  const rendered = runScript('render-html.mjs', [EXAMPLE_MD, '--out', join(dir, 'x.html')]);
  assert.equal(jsonOf(rendered.stdout).storyLines, 10, 'the renderer counts the same 10 story lines');
});

test('the example is placeholder text, never real news', () => {
  const md = read(EXAMPLE_MD);
  assert.ok(md.includes('ILLUSTRATIVE EXAMPLE'), 'the disclaimer is missing');
  const storyLines = md.split(/\r?\n/).filter((l) => l.startsWith('- **'));
  assert.ok(storyLines.length > 0);
  for (const line of storyLines) {
    assert.ok(/\[EXAMPLE\]|\[示例\]/.test(line), 'a story line lacks the placeholder marker: ' + line.slice(0, 60));
    assert.ok(line.includes('example.com'), 'a story line cites a real host: ' + line.slice(0, 60));
  }
});
