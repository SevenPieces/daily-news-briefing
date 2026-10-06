// render-html.mjs - the deliverable is one self-contained document; the numbers
// it reports about itself must be true. Each test names the regression it
// guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { jsonOf, readText, runScript, tempDir, writeText } from './helpers.mjs';
import { briefing, scenario } from './fixtures.mjs';

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

// ---------------------------------------------------------------------------
// Behaviour added after the first suite: scheme sanitising, the plain-list
// fallback for bullets that are not story lines, and the unreadable-file exit.
// ---------------------------------------------------------------------------

function schemeDoc(srcLines) {
  return [
    '# Daily Briefing / 每日简报 - 2026-09-30',
    '_Asia/Shanghai - generated 2026-09-30 08:30_',
    '',
    '## Global',
    '### Economy',
    ...srcLines,
    '',
  ].join('\n');
}

test('a javascript: [src:] URL is never an href, while an https one is (positive control)', (t) => {
  const dir = tempDir(t);
  const md = schemeDoc([
    '- **Javascript scheme headline** - Summary text. [src:BBC 2026-09-29 12:10](javascript:alert(1)) #new [prov:link]',
    '- **Https scheme headline** - Summary text. [src:Al Jazeera 2026-09-29 14:20](https://example.com/safe) #new [prov:full]',
  ]);
  assert.ok(md.includes('javascript:alert(1)'), 'the fixture must actually carry the scheme');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const { res, out } = render(dir, mdPath);
  assert.equal(res.status, 0, res.stderr);
  const text = readText(out);

  // Regression: esc() escaped the URL text but said nothing about its scheme,
  // so a javascript: URL from a publisher feed became an executable link
  // inside the delivered file:// page.
  assert.doesNotMatch(text, /href="javascript:/i);
  assert.ok(!text.includes('href="javascript'), 'no href may start with javascript:');
  // Non-vacuous: the same story with https IS an href, and the javascript one
  // still reaches safeUrl and is rejected as a link (span, not anchor).
  assert.match(text, /<a class="hl" href="https:\/\/example\.com\/safe"[^>]*>Https scheme headline<\/a>/);
  assert.match(text, /<span class="hl">Javascript scheme headline<\/span>/);
  assert.match(text, /<span class="badge src">BBC 2026-09-29 12:10<\/span>/);
});

test('a data: [src:] URL is never an href, while an https one is (positive control)', (t) => {
  const dir = tempDir(t);
  const md = schemeDoc([
    '- **Data scheme headline** - Summary text. [src:BBC 2026-09-29 12:10](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==) #new [prov:link]',
    '- **Https scheme headline** - Summary text. [src:Al Jazeera 2026-09-29 14:20](https://example.com/safe) #new [prov:full]',
  ]);
  assert.ok(md.includes('data:text/html'), 'the fixture must actually carry the scheme');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const { res, out } = render(dir, mdPath);
  assert.equal(res.status, 0, res.stderr);
  const text = readText(out);

  assert.doesNotMatch(text, /href="data:/i);
  assert.ok(!text.includes('href="data'), 'no href may start with data:');
  assert.match(text, /<a class="hl" href="https:\/\/example\.com\/safe"[^>]*>Https scheme headline<\/a>/);
  assert.match(text, /<span class="hl">Data scheme headline<\/span>/);
  assert.match(text, /<span class="badge src">BBC 2026-09-29 12:10<\/span>/);
});

test('a non-bold bullet in a story section is a plain list item, not a story card', (t) => {
  const dir = tempDir(t);
  const note = '- Note: two rows are stale, see [src:BBC 2026-09-29 12:10](https://example.com/note) [prov:link]';
  const md = briefing().replace('## China / 中国', note + '\n## China / 中国');
  assert.ok(md.includes('two rows are stale'), 'fixture injection did not apply');
  const mdPath = writeText(join(dir, 'briefing.md'), md);
  const { res, out, payload } = render(dir, mdPath);
  assert.equal(res.status, 0, res.stderr);
  const text = readText(out);

  // Regression: the renderer used to treat any bullet as a story, so this note
  // became a story card and inflated storyLines past the real count.
  assert.match(text, /<ul class="plain">\s*<li>Note: two rows are stale/, 'the note must be a plain list item');
  assert.equal((text.match(/<li class="story"/g) || []).length, 10, 'only the fixture stories may be story cards');
  assert.equal(payload.storyLines, 10, 'the reported story count must exclude the note');
  // Positive controls: the note is still published, and the fixture's real
  // story lines still are counted - so the count above is not simply broken.
  assert.ok(text.includes('two rows are stale'), 'the note must still be rendered');
  assert.ok(text.includes('Synthetic global politics story 1'), 'a real story must still be rendered');
});

test('a missing input file exits 2 with "cannot read", not a stack trace and not exit 1', (t) => {
  const dir = tempDir(t);
  const missing = join(dir, 'no-such-briefing.md');
  const out = join(dir, 'briefing.html');
  const res = runScript(SCRIPT, [missing, '--out', out]);

  // Regression: unguarded, readFileSync threw and the process died with a raw
  // stack trace on stderr and exit 1 - the same code the gates use for a real
  // content failure, and indistinguishable from a crash.
  assert.equal(res.status, 2);
  assert.match(res.stderr, /cannot read/);
  assert.ok(res.stderr.includes(missing), 'the message must name the file');
  assert.doesNotMatch(res.stderr, /\n\s+at /, 'no stack frames may be printed');
  assert.doesNotMatch(res.stderr, /\b(TypeError|ReferenceError|ENOENT is not)\b/);
  assert.equal(res.stdout, '');
  assert.ok(!existsSync(out), 'a refused run must write no output');
});

test('the renderer and check-provenance agree on the story count of the standard fixture', (t) => {
  const dir = tempDir(t);
  const { mdPath } = scenario(dir);
  const { res, payload } = render(dir, mdPath);
  assert.equal(res.status, 0, res.stderr);

  const gate = runScript('check-provenance.mjs', [mdPath]);
  assert.equal(gate.status, 0, gate.stderr);
  const m = /^story lines: (\d+) \|/m.exec(gate.stdout);
  assert.ok(m, 'expected the provenance summary line, got:\n' + gate.stdout);
  // Guard the premise: the fixture really has ten story lines.
  assert.equal(Number(m[1]), 10);
  // Regression: the two tools used to count different things, so the HTML could
  // claim a different number of stories than the gate had just verified.
  assert.equal(payload.storyLines, Number(m[1]));
});

test('the aspects figure counts contract aspects, not Coverage-note sub-headings (L9)', (t) => {
  // Runtime finding 2026-10-01, 10-02, 10-04: every h3 renders as a collapsible
  // block, and the reported figure counted them all, so the Coverage note's own
  // allowed '### Additional notes / 补充说明' made a 14-aspect briefing report 15.
  const dir = tempDir(t);
  const withNote = join(dir, 'with-note.md');
  writeText(withNote, briefing({ coverageSubheading: true }));
  const withoutNote = join(dir, 'without-note.md');
  writeText(withoutNote, briefing({ coverageSubheading: false }));

  // Each variant needs its own output path: render() always writes
  // dir/briefing.html, so the second call would overwrite the first.
  const outA = join(dir, 'with-note.html');
  const outB = join(dir, 'without-note.html');
  const resA = runScript(SCRIPT, [withNote, '--out', outA]);
  const resB = runScript(SCRIPT, [withoutNote, '--out', outB]);
  assert.equal(resA.status, 0, resA.stderr);
  assert.equal(resB.status, 0, resB.stderr);
  const aspectsA = jsonOf(resA.stdout).aspects;
  const aspectsB = jsonOf(resB.stdout).aspects;

  // Guard the premise: the note really is present in one and absent in the other.
  assert.match(readText(withNote), /### Additional notes/);
  assert.doesNotMatch(readText(withoutNote), /### Additional notes/);

  // The contract aspect count is the same either way...
  assert.equal(aspectsA, aspectsB);
  assert.equal(aspectsA, 4, 'the fixture has Economy, Politics, 经济 and 时政');
  // ...and the note still renders as a collapsible block, with its own unique id.
  const html = readText(outA);
  assert.match(html, /Additional notes/);
  const ids = [...html.matchAll(/<details class="aspect" id="(a\d+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 5, 'four aspects plus the note block');
  assert.equal(new Set(ids).size, ids.length, 'every block id is unique');
});
