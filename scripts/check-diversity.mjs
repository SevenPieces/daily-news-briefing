#!/usr/bin/env node
// Source-diversity gate for the daily-news-briefing skill.
// A section whose primaries all come from one outlet fails.
// Usage: node check-diversity.mjs <briefing.md>
// Exit: 0 OK; 1 the briefing violates a rule; 2 usage, an unreadable file, or a
// briefing whose section grammar this gate cannot account for.
import { readFileSync } from 'node:fs';
import { describeProblems, isStoryLine, looksLikeStory, sectionOf, sourceRef, structureProblems } from './lib/sections.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: check-diversity.mjs <briefing.md>'); process.exit(2); }
let md;
try {
  md = readFileSync(file, 'utf8');
} catch (err) {
  // Unguarded, a missing file threw a raw stack trace and exited 1 - the same
  // code this gate uses for a real diversity failure.
  console.error('check-diversity: cannot read ' + file + ': ' + String((err && err.message) || err));
  process.exit(2);
}

// A heading this gate cannot map used to leave its whole section unchecked
// while the gate still printed DIVERSITY: OK. Refuse the structure instead.
const structure = structureProblems(md);
if (structure.length) {
  console.error('check-diversity: the briefing does not match the output contract:');
  for (const l of describeProblems(structure)) console.error('  ' + l);
  console.error('  "## " headings must be contract sections (Top stories, Global, China,'
    + ' Watchlist, Market snapshot, Coverage note, Sources, in either language);'
    + ' aspects sit under Global and China; the Coverage note is paragraphs plus at most'
    + ' one "### Additional notes / 补充说明"; and only Top stories, Global, China and'
    + ' the Watchlist carry story lines.');
  process.exit(2);
}

const stats = {
  global: { items: 0, outlets: new Map(), aspects: new Map() },
  china:  { items: 0, outlets: new Map(), aspects: new Map() },
};
// Story lines whose [src:] is missing or carries no clock time cannot be
// attributed to an outlet. They used to be skipped, so a briefing whose src
// labels omitted the time printed "Global: 0 items" and still exited 0: the
// section was never checked at all.
const unparsed = [];
let section = null, aspect = null, lineNo = 0;
for (const line of md.split('\n')) {
  lineNo++;
  const h2 = /^##\s+(.*)$/.exec(line);
  if (h2) {
    // Top stories are a selection of stories that already appear in an aspect,
    // so only the two section headings are counted here - counting the digest
    // again would double every prominent story's weight.
    const mapped = sectionOf(h2[1].trim());
    section = (mapped === 'global' || mapped === 'china') ? mapped : null;
    aspect = null;
    continue;
  }
  const h3 = /^###\s+(.*)$/.exec(line);
  if (h3) { aspect = h3[1].trim(); continue; }
  if (!section || !looksLikeStory(line)) continue;
  const outlet = isStoryLine(line) ? sourceRef(line) : null;
  if (!outlet) {
    unparsed.push({ line: lineNo, preview: line.slice(0, 72) });
    continue;
  }
  const s = stats[section];
  s.items++;
  s.outlets.set(outlet, (s.outlets.get(outlet) || 0) + 1);
  if (aspect) {
    const a = s.aspects.get(aspect) || new Map();
    a.set(outlet, (a.get(outlet) || 0) + 1);
    s.aspects.set(aspect, a);
  }
}

let fail = false;
if (unparsed.length) {
  console.log('  FAIL: ' + unparsed.length + ' story line(s) in Global or China carry no usable [src:OUTLET YYYY-MM-DD HH:MM] reference, so no outlet could be counted');
  for (const u of unparsed.slice(0, 10)) console.log('    line ' + u.line + '  ' + u.preview);
  if (unparsed.length > 10) console.log('    ... and ' + (unparsed.length - 10) + ' more');
  fail = true;
}
for (const [key, label] of [['global', 'Global'], ['china', 'China']]) {
  const s = stats[key];
  const distinct = [...s.outlets.keys()];
  console.log(`${label}: ${s.items} items, ${distinct.length} distinct outlet(s): ${distinct.join(', ') || '(none)'}`);
  if (s.items > 0 && distinct.length < 2) { console.log(`  FAIL: ${label} rests on a single outlet`); fail = true; }
  for (const [asp, a] of s.aspects) {
    const d = [...a.keys()];
    const total = [...a.values()].reduce((x, y) => x + y, 0);
    if (d.length === 1 && total >= 2) console.log(`  note: ${label}/${asp} has ${total} items all from ${d[0]}`);
  }
}
console.log(fail ? 'DIVERSITY: FAIL' : 'DIVERSITY: OK');
process.exit(fail ? 1 : 0);
