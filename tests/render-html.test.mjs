// render-html.mjs - the deliverable is one self-contained document; the numbers
// it reports about itself must be true. Each test names the regression it
// guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { jsonOf, readText, runScript, tempDir, writeText } from './helpers.mjs';
import { scenario } from './fixtures.mjs';

const SCRIPT = 'render-html.mjs';

function render(dir, mdPath) {
  const out = join(dir, 'briefing.html');
  const res = runScript(SCRIPT, [mdPath, '--out', out]);
  return { res, out, payload: res.status === 0 ? jsonOf(res.stdout) : null };
}

test('reported bytes equals the real UTF-8 size of the written file (CJK fixture)', (t) => {
  const dir = tempDir(t);
  const { mdPath } = scenario(dir);
  const { res, out, payload } = render(dir, mdPath);
  assert.equal(res.status, 0, res.stderr);
  const text = readText(out);

  // Guard the premise: without multibyte text, String#length and the byte size
  // would agree and this test could not distinguish the two.
  assert.ok(/[\u4e00-\u9fff]/.test(text), 'fixture must contain CJK for this test to be meaningful');
  // Regression: bytes used to be doc.length (UTF-16 code units), which
  // under-reported a bilingual briefing by thousands of bytes.
  assert.equal(payload.bytes, statSync(out).size);
  assert.notEqual(payload.bytes, text.length);
  assert.ok(payload.bytes > text.length, 'UTF-8 must be larger than UTF-16 units for this document');
});

test('HTML in a headline or summary is escaped, never emitted raw', (t) => {
  const dir = tempDir(t);
  const md = [
    '# Daily Briefing / 每日简报 - 2026-09-30',
    '_Asia/Shanghai - generated 2026-09-30 08:30_',
    '',
    '## Global',
    '### Economy',
    '- **A & B "quoted" <script>alert(1)</script>** - Summary with & and "quotes" and <b>tags</b>. [src:BBC 2026-09-29 12:10](https://example.com/a) #new [prov:full]',
    '',
  ].join('\n');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const { res, out } = render(dir, mdPath);
  assert.equal(res.status, 0, res.stderr);
  const text = readText(out);

  // Regression: a headline or summary containing markup or a quote could break
  // out of its attribute/element - an injected <script> would execute.
  assert.ok(!text.includes('<script>alert(1)</script>'), 'raw injected script reached the document');
  assert.ok(!text.includes('<b>tags</b>'), 'raw injected tag reached the document');
  assert.ok(!text.includes('A & B "quoted"'), 'raw unescaped headline reached the document');
  assert.ok(
    text.includes('A &amp; B &quot;quoted&quot; &lt;script&gt;alert(1)&lt;/script&gt;'),
    'the headline must appear fully escaped',
  );
  assert.ok(
    text.includes('Summary with &amp; and &quot;quotes&quot; and &lt;b&gt;tags&lt;/b&gt;.'),
    'the summary must appear fully escaped',
  );
});

test('the output is a single self-contained document', (t) => {
  const dir = tempDir(t);
  const { mdPath } = scenario(dir);
  const { res, out } = render(dir, mdPath);
  assert.equal(res.status, 0, res.stderr);
  const text = readText(out);

  assert.match(text, /^<!doctype html>/i);
  assert.ok(text.includes('<style>'), 'the CSS must be inline');
  // Regression: an external stylesheet or script would break the file://
  // offline promise of the deliverable.
  assert.doesNotMatch(text, /<link\b/i);
  assert.doesNotMatch(text, /rel=["']?stylesheet/i);
  assert.doesNotMatch(text, /<script[^>]*\bsrc=/i);
  assert.doesNotMatch(text, /<img[^>]*\bsrc=/i);
  assert.doesNotMatch(text, /@import/i);
});

test('storyLines equals the number of story lines in the fixture markdown', (t) => {
  const dir = tempDir(t);
  const { mdPath } = scenario(dir);
  const { res, payload } = render(dir, mdPath);
  assert.equal(res.status, 0, res.stderr);
  const md = readText(mdPath);
  const expectedStoryLines = md
    .split('\n')
    .filter((line) => line.startsWith('- ') && line.includes('[src:'))
    .length;

  assert.equal(expectedStoryLines, 10, 'the default fixture has 10 story lines');
  // Regression: the counter used to tick on any bullet, so non-story bullets
  // (coverage note, sources) inflated it past the real story count.
  assert.equal(payload.storyLines, expectedStoryLines);
  assert.equal(payload.sections, 7);
  assert.equal(payload.aspects, 4);
});
