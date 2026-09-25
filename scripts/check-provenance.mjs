#!/usr/bin/env node
// Provenance-marker gate for the daily-news-briefing skill.
//
// Every story line must END with exactly one [prov:full|feed|link] marker: the
// marker is the reader-facing statement of how deep the evidence is, and
// render-html.mjs turns it into a coloured dot. This gate mirrors the
// renderer's idea of what a story is, so it cannot pass a line the renderer
// publishes as a story.
//
// Usage: node check-provenance.mjs <briefing.md>
// Exit: 0 OK, 1 a story violates the marker rule, 2 usage or unreadable file.

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: check-provenance.mjs <briefing.md>'); process.exit(2); }

let md;
try {
  md = readFileSync(file, 'utf8');
} catch (err) {
  console.error('check-provenance: cannot read ' + file + ': ' + String((err && err.message) || err));
  process.exit(2);
}

const ANY_MARKER = /\[prov:(full|feed|link)\]/g;      // count every marker, to catch duplicates
// The marker must be the last *token*: output-contract.md also puts #tags at
// the end of the line, so trailing tags after the marker are accepted.
const ENDS_WITH = /\[prov:(full|feed|link)\];?(?:\s+#[A-Za-z0-9_-]+)*\s*$/;

// Sections whose bullets are not stories. Listed as exclusions rather than an
// allowlist so a future section is policed by default, not silently skipped.
const NON_STORY_SECTION = /^(Sources|Coverage note|Market snapshot)/i;

const counts = { full: 0, feed: 0, link: 0 };
const missing = [];
const misplaced = [];
const duplicated = [];
let items = 0;
let section = 'preamble';

md.split('\n').forEach((line, i) => {
  const h2 = /^##\s+(.*)$/.exec(line);
  if (h2) { section = h2[1].trim(); return; }
  if (NON_STORY_SECTION.test(section)) return;

  // Mirror render-html.mjs: a story is a non-indented "- " bullet that carries
  // a [src: ...] reference or opens with a bold headline.
  if (!line.startsWith('- ')) return;
  if (!line.includes('[src:') && !/^-\s+\*\*/.test(line)) return;

  items++;
  const found = [...line.matchAll(ANY_MARKER)].map((m) => m[1]);
  const where = { line: i + 1, section, preview: line.slice(0, 72) };
  if (found.length === 0) missing.push(where);
  else if (found.length > 1) duplicated.push(Object.assign({ markers: found.join(', ') }, where));
  else if (!ENDS_WITH.test(line)) misplaced.push(Object.assign({ marker: found[0] }, where));
  else counts[found[0]]++;
});

const problems = missing.length + misplaced.length + duplicated.length;
console.log('stories: ' + items + ' | full: ' + counts.full + ' | feed: ' + counts.feed + ' | link: ' + counts.link);
if (missing.length) {
  console.log('  FAIL: ' + missing.length + ' story item(s) carry no [prov:*] marker');
  for (const m of missing.slice(0, 10)) console.log('    line ' + m.line + '  (' + m.section + ')  ' + m.preview);
  if (missing.length > 10) console.log('    ... and ' + (missing.length - 10) + ' more');
}
if (misplaced.length) {
  console.log('  FAIL: ' + misplaced.length + ' story item(s) carry a marker that is not the last token on the line');
  for (const m of misplaced.slice(0, 10)) console.log('    line ' + m.line + '  (' + m.marker + ')  ' + m.preview);
}
if (duplicated.length) {
  console.log('  FAIL: ' + duplicated.length + ' story item(s) carry more than one marker');
  for (const d of duplicated.slice(0, 10)) console.log('    line ' + d.line + '  (' + d.markers + ')  ' + d.preview);
}
if (items === 0) console.log('  note: no story items found - is this a briefing?');
console.log(problems === 0 ? 'PROVENANCE: OK' : 'PROVENANCE: FAIL');
process.exit(problems === 0 ? 0 : 1);
