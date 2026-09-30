#!/usr/bin/env node
// Parse a briefing Markdown file into the item index update-state.mjs stores.
// Zero dependencies. Usage:
//   node md-to-items.mjs briefing.md [--out .items.json]
//
// The index is derived from the briefing, never the other way round: one entry
// per story line, in document order, carrying only what the line itself says.
// Section mapping follows the output contract - Top stories -> global/top,
// Global + '### X' -> global/X, China + '### X' -> china/X, Watchlist ->
// watch/watch flagged watch. Sections outside those four (Market snapshot,
// Coverage note, Sources) hold no stories, so their bullets are ignored.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isStoryLine, sectionOf, unknownHeadings } from './lib/sections.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function findRefStart(text) {
  let best = -1;
  for (const key of ['[src:', '[alt:', '[find:']) {
    const i = text.indexOf(key);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

// One story line: '- **Headline** - Summary. [src:OUTLET YYYY-MM-DD HH:MM](URL)'
// then optional [alt:](), [find:](), #tags and [prov:*], in any order after the
// source. Only the [src:](url) link is required; everything else is optional.
function parseStory(line) {
  let rest = line.slice(2).trim();
  let title = '';
  if (rest.startsWith('**')) {
    const end = rest.indexOf('**', 2);
    if (end > 0) {
      title = rest.slice(2, end).trim();
      rest = rest.slice(end + 2).trim();
    }
  }

  let tail = '';
  const refStart = findRefStart(rest);
  if (refStart >= 0) {
    if (!title) title = rest.slice(0, refStart).trim();
    tail = rest.slice(refStart);
  } else {
    const tagStart = rest.indexOf(' #');
    if (tagStart >= 0) {
      if (!title) title = rest.slice(0, tagStart).trim();
      tail = rest.slice(tagStart);
    } else if (!title) {
      title = rest.trim();
    }
  }

  const refs = [];
  const flags = [];
  let i = 0;
  while (i < tail.length) {
    if (tail.startsWith('[src:', i) || tail.startsWith('[alt:', i) || tail.startsWith('[find:', i)) {
      const kind = tail.startsWith('[src:', i) ? 'src' : tail.startsWith('[alt:', i) ? 'alt' : 'find';
      const open = kind === 'find' ? 6 : 5;
      const close = tail.indexOf('](', i);
      const urlEnd = close >= 0 ? tail.indexOf(')', close + 2) : -1;
      if (close < 0 || urlEnd < 0) break;
      refs.push({ kind, label: tail.slice(i + open, close).trim(), url: tail.slice(close + 2, urlEnd).trim() });
      i = urlEnd + 1;
    } else if (tail[i] === '#') {
      let j = i + 1;
      while (j < tail.length && tail[j] !== ' ' && tail[j] !== '#') j++;
      flags.push(tail.slice(i + 1, j).trim());
      i = j;
    } else {
      i++;
    }
  }

  const primary = refs.find((r) => r.kind === 'src' && r.url) || { label: '', url: '' };
  // The label is 'OUTLET YYYY-MM-DD HH:MM'; the outlet is what precedes the
  // stamp. A label with no stamp is kept as it stands.
  const outlet = primary.label.replace(/\s+\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2})?\s*$/, '').trim();
  return { title, outlet, primaryUrl: primary.url, flags };
}

function main() {
  const mdPath = process.argv[2];
  if (!mdPath || mdPath.startsWith('--')) {
    process.stderr.write('usage: md-to-items.mjs briefing.md [--out .items.json]\n');
    process.exit(2);
  }
  const outPath = arg('--out', join(dirname(mdPath), '.items.json'));
  // The index is derived fresh from this run's Markdown, so any previous run's
  // file goes before parsing: a failure below must leave nothing for update to
  // ingest. Removal is forced, so a missing file is not an error.
  try {
    rmSync(outPath, { force: true });
  } catch (err) {
    process.stderr.write('md-to-items: cannot remove ' + outPath + ': ' + String((err && err.message) || err) + '\n');
    process.exit(2);
  }

  let md;
  try {
    md = readFileSync(mdPath, 'utf8');
  } catch (err) {
    process.stderr.write('md-to-items: cannot read ' + mdPath + ': ' + String((err && err.message) || err) + '\n');
    process.exit(2);
  }

  // A '## ' heading this parser cannot map used to drop every bullet under it
  // silently - the whole China section vanished from the index when the heading
  // was written in Chinese alone. Refuse the run instead of losing stories.
  const unknown = unknownHeadings(md);
  if (unknown.length) {
    process.stderr.write('md-to-items: unrecognised section heading(s): '
      + unknown.map((h) => 'line ' + h.line + ' "## ' + h.text + '"').join(', ') + '\n'
      + '  Every "## " heading must be a contract section (Top stories, Global, China,'
      + ' Watchlist, Market snapshot, Coverage note, Sources, in either language);'
      + ' an unmapped heading would silently drop its stories from the index.\n');
    process.exit(2);
  }

  const items = [];
  let section = '';
  let aspect = '';
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('## ')) {
      const mapped = sectionOf(line.slice(3).trim());
      if (mapped === 'top') { section = 'global'; aspect = 'top'; }
      else if (mapped === 'global') { section = 'global'; aspect = ''; }
      else if (mapped === 'china') { section = 'china'; aspect = ''; }
      else if (mapped === 'watch') { section = 'watch'; aspect = 'watch'; }
      else { section = ''; aspect = ''; }
      continue;
    }
    if (line.startsWith('### ')) {
      // A '### ' under '## Top stories' must not overwrite the 'top' aspect:
      // only the Global/China aspect headings re-point it.
      if ((section === 'global' || section === 'china') && aspect !== 'top') aspect = line.slice(4).trim();
      continue;
    }
    if (!section || !isStoryLine(line) || !line.includes('[src:')) continue;
    const story = parseStory(line);
    if (!story.title) continue;
    items.push({
      title: story.title,
      section,
      aspect,
      outlet: story.outlet,
      primaryUrl: story.primaryUrl,
      flags: story.flags,
      watch: section === 'watch',
    });
  }

  if (!items.length) {
    process.stderr.write('md-to-items: no stories parsed from ' + mdPath
      + ' - expected story lines of the form - **Headline** - Summary. [src:OUTLET](URL)\n');
    process.exit(1);
  }

  try {
    writeFileSync(outPath, JSON.stringify(items, null, 2) + '\n');
  } catch (err) {
    process.stderr.write('md-to-items: cannot write ' + outPath + ': ' + String((err && err.message) || err) + '\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify({ out: outPath, items: items.length }) + '\n');
}

main();
