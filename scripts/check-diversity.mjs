#!/usr/bin/env node
// Source-diversity gate for the daily-news-briefing skill.
// A section whose primaries all come from one outlet fails.
// Usage: node check-diversity.mjs <briefing.md>
import { readFileSync } from 'node:fs';
import { describeProblems, isStoryLine, sectionOf, sourceRef, structureProblems } from './lib/sections.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: check-diversity.mjs <briefing.md>'); process.exit(2); }
const md = readFileSync(file, 'utf8');

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
let section = null, aspect = null;
for (const line of md.split('\n')) {
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
  if (!section || !isStoryLine(line)) continue;
  const outlet = sourceRef(line);
  if (!outlet) continue;
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
