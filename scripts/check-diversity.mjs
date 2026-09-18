#!/usr/bin/env node
// Source-diversity gate for the daily-news-briefing skill.
// A section whose primaries all come from one outlet fails.
// Usage: node check-diversity.mjs <briefing.md>
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: check-diversity.mjs <briefing.md>'); process.exit(2); }
const md = readFileSync(file, 'utf8');

function sectionKey(heading) {
  if (/^Global/i.test(heading)) return 'global';
  if (/^China/i.test(heading)) return 'china';
  return null;
}

const stats = {
  global: { items: 0, outlets: new Map(), aspects: new Map() },
  china:  { items: 0, outlets: new Map(), aspects: new Map() },
};
let section = null, aspect = null;
for (const line of md.split('\n')) {
  const h2 = /^##\s+(.*)$/.exec(line);
  if (h2) { section = sectionKey(h2[1].trim()); aspect = null; continue; }
  const h3 = /^###\s+(.*)$/.exec(line);
  if (h3) { aspect = h3[1].trim(); continue; }
  if (!section || !/^\s*-\s+\*\*/.test(line)) continue;
  const m = /\[src:(.+?)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.exec(line);
  if (!m) continue;
  const outlet = m[1].trim();
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
