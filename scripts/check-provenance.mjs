#!/usr/bin/env node
// Provenance-marker gate for the daily-news-briefing skill.
//
// Every story line must END with exactly one [prov:full|feed|link] marker: the
// marker is the reader-facing statement of how deep the evidence is, and
// render-html.mjs turns it into a coloured dot. This gate mirrors the
// renderer's idea of what a story is, so it cannot pass a line the renderer
// publishes as a story, and it additionally requires the [src:] reference
// md-to-items.mjs indexes by, so a counted line cannot vanish from the state
// index unnoticed.
//
// Usage: node check-provenance.mjs <briefing.md>
// Exit: 0 OK; 1 a story line violates a gate rule; 2 usage, an unreadable file,
// or a briefing whose section grammar this gate cannot account for (a refusal
// to evaluate, distinct from a briefing that violates a rule).

import { readFileSync } from 'node:fs';
import { STORY_SECTIONS, describeProblems, hasSourceRef, isStoryLine, looksLikeStory, sectionOf, structureProblems } from './lib/sections.mjs';

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

// Structure first: a heading this gate cannot map, a stray sub-heading or a
// story-shaped bullet in a section that holds no stories used to slip through,
// because whatever the exclusion list did not match was simply skipped.
const structure = structureProblems(md);
if (structure.length) {
  console.error('check-provenance: the briefing does not match the output contract:');
  for (const l of describeProblems(structure)) console.error('  ' + l);
  console.error('  "## " headings must be contract sections (Top stories, Global, China,'
    + ' Watchlist, Market snapshot, Coverage note, Sources, in either language);'
    + ' aspects sit under Global and China; the Coverage note is paragraphs plus at most'
    + ' one "### Additional notes / 补充说明"; and only Top stories, Global, China and'
    + ' the Watchlist carry story lines.');
  process.exit(2);
}

const counts = { full: 0, feed: 0, link: 0 };
const missing = [];
const unsourced = [];
const misplaced = [];
const duplicated = [];
const malformed = [];   // bullet meant as a story but not in the contract's shape
let items = 0;
let section = 'preamble';      // the raw heading text, for messages
let sectionKey = null;         // the mapped section, or null outside a story section

md.split('\n').forEach((line, i) => {
  const h2 = /^##\s+(.*)$/.exec(line);
  if (h2) { section = h2[1].trim(); sectionKey = sectionOf(section); return; }
  if (!sectionKey || !STORY_SECTIONS.has(sectionKey)) return;

  // A bullet that is meant to be a story but is not in the contract's shape
  // (no bold headline) is reported, never skipped: skipping is what let a
  // garbage "headline" into the state index and let check-diversity print OK.
  if (!looksLikeStory(line)) return;
  const where = { line: i + 1, section, preview: line.slice(0, 72) };
  if (!isStoryLine(line)) { malformed.push(where); return; }

  items++;
  // md-to-items.mjs indexes only lines carrying a [src:] reference, so a story
  // line without one would pass this gate and then vanish from the state index.
  // Report it here instead of letting the loss stay silent.
  if (!hasSourceRef(line)) { unsourced.push(where); return; }
  const found = [...line.matchAll(ANY_MARKER)].map((m) => m[1]);
  if (found.length === 0) missing.push(where);
  else if (found.length > 1) duplicated.push(Object.assign({ markers: found.join(', ') }, where));
  else if (!ENDS_WITH.test(line)) misplaced.push(Object.assign({ marker: found[0] }, where));
  else counts[found[0]]++;
});

const problems = missing.length + unsourced.length + misplaced.length + duplicated.length + malformed.length;
// The printed buckets partition the total: every counted line lands in exactly
// one of the three markers or one of the four failure lists, and a zero bucket
// is omitted, so the numbers always add up.
console.log('story lines: ' + items + ' | full: ' + counts.full
  + ' | feed: ' + counts.feed + ' | link: ' + counts.link
  + (malformed.length ? ' | malformed: ' + malformed.length : '')
  + (unsourced.length ? ' | unsourced: ' + unsourced.length : '')
  + (missing.length ? ' | unmarked: ' + missing.length : '')
  + (misplaced.length ? ' | misplaced: ' + misplaced.length : '')
  + (duplicated.length ? ' | duplicated: ' + duplicated.length : ''));
if (malformed.length) {
  console.log('  FAIL: ' + malformed.length + ' bullet(s) are meant as stories but do not open with a bold headline');
  for (const m of malformed.slice(0, 10)) console.log('    line ' + m.line + '  (' + m.section + ')  ' + m.preview);
  if (malformed.length > 10) console.log('    ... and ' + (malformed.length - 10) + ' more');
}
if (unsourced.length) {
  console.log('  FAIL: ' + unsourced.length + ' story item(s) carry no [src:...] source reference');
  for (const u of unsourced.slice(0, 10)) console.log('    line ' + u.line + '  (' + u.section + ')  ' + u.preview);
  if (unsourced.length > 10) console.log('    ... and ' + (unsourced.length - 10) + ' more');
}
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
