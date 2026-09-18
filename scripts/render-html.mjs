#!/usr/bin/env node
// Markdown -> self-contained HTML for the daily-news-briefing skill.
// Zero dependencies. Usage: node render-html.mjs briefing.md [--out briefing.html]
// Inline CSS and JS only; the result opens correctly from file:// offline.

import { readFileSync, writeFileSync } from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function esc(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function linkify(text) {
  let out = '';
  let rest = String(text);
  while (true) {
    const i = rest.indexOf('http');
    if (i < 0) { out += esc(rest); break; }
    out += esc(rest.slice(0, i));
    let j = i;
    while (j < rest.length && rest[j] !== ' ' && rest[j] !== '<' && rest[j] !== ')') j++;
    const url = rest.slice(i, j);
    out += '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>';
    rest = rest.slice(j);
  }
  return out;
}

function findRefStart(text) {
  let best = -1;
  for (const key of ['[src:', '[alt:', '[find:']) {
    const i = text.indexOf(key);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

function parseStory(line) {
  const provMatch = /\[prov:(full|feed|link)\];?/.exec(line);
  const provenance = provMatch ? provMatch[1] : '';
  let rest = line.slice(2).trim();
  let headline = '';
  if (rest.startsWith('**')) {
    const end = rest.indexOf('**', 2);
    if (end > 0) {
      headline = rest.slice(2, end).trim();
      rest = rest.slice(end + 2).trim();
    }
  }
  if (!headline) { headline = rest; rest = ''; }
  if (rest.startsWith('- ')) rest = rest.slice(2).trim();
  else if (rest.startsWith('– ')) rest = rest.slice(2).trim();
  else if (rest.startsWith('— ')) rest = rest.slice(2).trim();

  let summary = '';
  let tail = '';
  const refStart = findRefStart(rest);
  if (refStart >= 0) {
    summary = rest.slice(0, refStart).trim();
    tail = rest.slice(refStart);
  } else {
    const tagStart = rest.indexOf(' #');
    if (tagStart >= 0) {
      summary = rest.slice(0, tagStart).trim();
      tail = rest.slice(tagStart);
    } else {
      summary = rest.trim();
    }
  }

  const refs = [];
  const tags = [];
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
      tags.push(tail.slice(i + 1, j).trim());
      i = j;
    } else {
      i++;
    }
  }
  return { headline, summary, refs, tags, provenance };
}

const PROV = {
  full: ['p-full', 'Verified: full article fetched'],
  feed: ['p-feed', 'Publisher feed: summary from the outlet own RSS'],
  link: ['p-link', 'Link only: open the original to read'],
};

function renderStory(line, index, aspectToken, counts) {
  const story = parseStory(line);
  counts[aspectToken] = (counts[aspectToken] || 0) + 1;
  const primary = story.refs.find((r) => r.kind === 'src' && r.url);
  const prov = story.provenance && PROV[story.provenance]
    ? '<span class="prov ' + PROV[story.provenance][0] + '" title="' + esc(PROV[story.provenance][1]) + '"></span>'
    : '';
  const headline = primary
    ? '<a class="hl" href="' + esc(primary.url) + '" target="_blank" rel="noopener">' + esc(story.headline) + '</a>'
    : '<span class="hl">' + esc(story.headline) + '</span>';
  const badges = [];
  for (const ref of story.refs) {
    const cls = ref.kind === 'src' ? 'badge src' : ref.kind === 'find' ? 'badge find' : 'badge alt';
    const text = ref.kind === 'find' ? '\ud83d\udd0d ' + (ref.label || 'search') : (ref.label || (ref.kind === 'src' ? 'source' : 'also'));
    if (ref.url) badges.push('<a class="' + cls + '" href="' + esc(ref.url) + '" target="_blank" rel="noopener">' + esc(text) + '</a>');
    else badges.push('<span class="' + cls + '">' + esc(text) + '</span>');
  }
  const tagHtml = story.tags.map((t) => '<span class="tag t-' + esc(t) + '">' + esc(t) + '</span>').join('');
  const needsOriginal = story.tags.includes('paywalled') || story.tags.includes('unverified');
  const original = needsOriginal && primary
    ? '<a class="orig" href="' + esc(primary.url) + '" target="_blank" rel="noopener">原文 / Original \u2197</a>'
    : '';
  const summary = story.summary ? '<p class="sum">' + esc(story.summary) + '</p>' : '';
  return '<li class="story" id="it-' + index + '"><div class="hlrow">' + prov + headline + '</div>' + summary + '<div class="badges">' + badges.join('') + tagHtml + original + '</div></li>';
}

function renderTable(rows) {
  if (rows.length < 2) return '';
  const cells = (row) => {
    let text = row.trim();
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|')) text = text.slice(0, -1);
    return text.split('|').map((c) => c.trim());
  };
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  let html = '<div class="tablewrap"><table><thead><tr>';
  for (const h of head) html += '<th>' + esc(h) + '</th>';
  html += '</tr></thead><tbody>';
  for (const row of body) {
    html += '<tr>';
    for (const c of row) html += '<td>' + esc(c) + '</td>';
    html += '</tr>';
  }
  return html + '</tbody></table></div>';
}

const mdPath = process.argv[2];
if (!mdPath) {
  process.stderr.write('usage: render-html.mjs briefing.md [--out briefing.html]\n');
  process.exit(1);
}
const outPath = arg('--out', mdPath.replace(/\.md$/, '') + '.html');
const md = readFileSync(mdPath, 'utf8');
const lines = md.split('\n');

let title = 'Daily Briefing';
let meta = '';
if (lines[0] && lines[0].startsWith('# ')) title = lines[0].slice(2).trim();
for (const line of lines) {
  if (line.startsWith('_') && line.trim().endsWith('_')) { meta = line.trim().slice(1, -1); break; }
}

const counts = {};
const topics = [];
const html = [];
let openSection = false;
let openDetails = false;
let inList = false;
let inPlain = false;
let tableRows = [];
let secIndex = -1;
let aspIndex = -1;
let currentAspect = '';
let storyIndex = 0;

function flushList() { if (inList) { html.push('</ul>'); inList = false; } }
function flushPlain() { if (inPlain) { html.push('</ul>'); inPlain = false; } }
function flushTable() { if (tableRows.length) { html.push(renderTable(tableRows)); tableRows = []; } }
function closeDetails() {
  flushList(); flushPlain();
  if (openDetails) { html.push('</div></details>'); openDetails = false; }
}
function closeSection() {
  closeDetails(); flushTable();
  if (openSection) { html.push('</section>'); openSection = false; }
}

for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  if (!line.trim()) { flushTable(); continue; }
  if (line.startsWith('# ')) continue;
  if (line.startsWith('_') && line.trim().endsWith('_')) continue;

  if (line.startsWith('## ')) {
    closeSection(); flushTable();
    secIndex++;
    const name = line.slice(3).trim();
    const id = 's' + secIndex;
    topics.push({ level: 2, id, name });
    html.push('<section class="sec" id="' + id + '"><h2>' + esc(name) + '</h2>');
    openSection = true;
    continue;
  }

  if (line.startsWith('### ')) {
    closeDetails(); flushTable();
    aspIndex++;
    const name = line.slice(4).trim();
    currentAspect = 'c' + aspIndex;
    counts[currentAspect] = counts[currentAspect] || 0;
    const id = 'a' + aspIndex;
    topics.push({ level: 3, id, name });
    html.push('<details class="aspect" id="' + id + '" open><summary><span class="ah">' + esc(name) + '</span><span class="count">%%' + currentAspect + '%%</span></summary><div class="aspect-body">');
    openDetails = true;
    continue;
  }

  if (line.trim().startsWith('|')) {
    flushList(); flushPlain();
    tableRows.push(line.trim());
    continue;
  }

  if (line.startsWith('- ')) {
    flushTable(); flushPlain();
    const isStory = line.includes('[src:') || line.trim().startsWith('- **');
    if (isStory) {
      if (!inList) { html.push('<ul class="stories">'); inList = true; }
      storyIndex++;
      html.push(renderStory(line, storyIndex, currentAspect, counts));
    } else {
      if (!inPlain) { html.push('<ul class="plain">'); inPlain = true; }
      html.push('<li>' + linkify(line.slice(2).trim()) + '</li>');
    }
    continue;
  }

  flushList(); flushPlain(); flushTable();
  const trimmed = line.trim();
  if (trimmed.startsWith('(') || trimmed.startsWith('（')) {
    html.push('<p class="quiet">' + esc(trimmed) + '</p>');
  } else {
    html.push('<p>' + linkify(trimmed) + '</p>');
  }
}
closeSection();

const topicsHtml = topics.map((t) => '<a class="lvl' + t.level + '" href="#' + t.id + '">' + esc(t.name) + '</a>').join('');
let body = html.join('\n');
for (const key of Object.keys(counts)) body = body.replaceAll('%%' + key + '%%', String(counts[key]));
body = body.replaceAll('%%c0%%', '0');

const css = [
  ':root{--bg:#0f1216;--panel:#161b22;--panel2:#1c232c;--fg:#e6edf3;--dim:#9aa7b4;--line:#28313c;--acc:#4da3ff;--new:#2ea043;--follow:#d29922;--warn:#f85149;}',
  '*{box-sizing:border-box;}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,Segoe UI,Roboto,Noto Sans SC,Helvetica,Arial,sans-serif;}',
  'a{color:var(--acc);text-decoration:none;} a:hover{text-decoration:underline;}',
  'header.top{padding:20px 0 12px;border-bottom:1px solid var(--line);background:var(--panel);}',
  '.wrap{max-width:1100px;margin:0 auto;padding:0 22px;}',
  '.topics{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;}',
  '.topics a{font-size:13px;padding:4px 9px;border:1px solid var(--line);border-radius:999px;white-space:nowrap;color:var(--dim);}',
  '.topics a:hover{color:var(--fg);border-color:var(--acc);}',
  '.topics a.lvl3{opacity:.85;}',
  'header.top h1{margin:0 0 6px;font-size:22px;}',
  '.meta{color:var(--dim);font-size:13px;margin:0 0 12px;}',
  '.controls{display:flex;gap:14px;align-items:center;flex-wrap:wrap;}',
  '#q{flex:1;min-width:220px;background:var(--panel2);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:8px 12px;font-size:14px;}',
  '.tog{color:var(--dim);font-size:13px;display:flex;gap:6px;align-items:center;}',



  'main{padding:18px 22px 60px;max-width:1100px;margin:0 auto;}',
  'html{scroll-behavior:smooth;}',
  '#toTop{position:fixed;right:22px;bottom:22px;z-index:20;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);color:var(--fg);cursor:pointer;font-size:18px;line-height:1;box-shadow:0 4px 14px rgba(0,0,0,.35);text-decoration:none;}',
  '#toTop:hover{border-color:var(--acc);color:var(--acc);text-decoration:none;}',
  'section.sec{margin:0 0 26px;} h2{font-size:19px;margin:22px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px;}',
  'details.aspect{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:10px 0;}',
  'details.aspect>summary{cursor:pointer;padding:10px 14px;font-weight:600;display:flex;justify-content:space-between;align-items:center;list-style:none;}',
  'details.aspect>summary::-webkit-details-marker{display:none;}',
  '.count{color:var(--dim);font-weight:400;font-size:13px;}',
  '.aspect-body{padding:2px 14px 12px;}',
  'ul.stories{list-style:none;margin:0;padding:0;}',
  'li.story{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:8px 0;}',
  '.hlrow{display:flex;gap:8px;align-items:baseline;} .hl{font-weight:600;margin-bottom:4px;} a.hl{color:var(--fg);} a.hl:hover,span.hl:hover{color:var(--acc);} .sum{margin:0 0 7px;color:var(--fg);}',
  '.badges{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}',
  '.badge{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);}',
  '.badge.src{background:#132b45;color:#9fd0ff;border-color:#1d4a75;}',
  '.badge.alt{background:#1a2230;color:var(--dim);}',
  '.badge.find{background:#2a2412;color:#f0d59a;border-color:#5a4a1d;border-style:dashed;}',
  '.tag{font-size:11px;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em;}',
  '.t-new{background:#12351d;color:#7ee2a1;} .t-followup{background:#3a2d0d;color:#f0c96b;}',
  '.t-developing{background:#3a230d;color:#ffb27a;} .t-paywalled{background:#2b1d33;color:#d9a7ff;}',
  '.t-unverified{background:#3a1517;color:#ff9d9d;}',
  '.prov{width:9px;height:9px;border-radius:999px;display:inline-block;flex:0 0 auto;} .p-full{background:#2ea043;} .p-feed{background:#4da3ff;} .p-link{background:#d29922;}',
  '.orig{font-size:12px;color:var(--acc);}',
  '.tablewrap{overflow-x:auto;} table{border-collapse:collapse;width:100%;font-size:14px;}',
  'th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;} th{background:var(--panel2);}',
  '.quiet{color:var(--dim);font-style:italic;padding:8px 12px;border-left:3px solid var(--line);background:var(--panel);}',
  'ul.plain{margin:6px 0 6px 18px;}',
  '@media print{:root{--bg:#fff;--panel:#fff;--panel2:#fafafa;--fg:#111;--dim:#555;--line:#bbb;}',
  '.controls,.topics,#toTop{display:none;} body{font-size:11pt;} details.aspect{border:1px solid #ccc;} li.story{break-inside:avoid;}}',
].join('\n');

const js = [
  '(function(){',
  '  var stories = Array.prototype.slice.call(document.querySelectorAll(".story"));',
  '  var q = document.getElementById("q");',
  '  var collapse = document.getElementById("collapse");',
  '  function apply(){',
  '    var v = (q.value || "").toLowerCase().trim();',
  '    stories.forEach(function(s){ s.style.display = (!v || s.textContent.toLowerCase().indexOf(v) >= 0) ? "" : "none"; });',
  '    Array.prototype.slice.call(document.querySelectorAll("details.aspect")).forEach(function(d){',
  '      var shown = d.querySelectorAll(".story").length === 0 ? true : Array.prototype.slice.call(d.querySelectorAll(".story")).some(function(s){ return s.style.display !== "none"; });',
  '      d.style.display = shown ? "" : "none";',
  '      if (v && shown) d.setAttribute("open", "");',
  '    });',
  '  }',
  '  q.addEventListener("input", apply);',
  '  collapse.addEventListener("change", function(){',
  '    Array.prototype.slice.call(document.querySelectorAll("details.aspect")).forEach(function(d){',
  '      if (collapse.checked) d.removeAttribute("open"); else d.setAttribute("open", "");',
  '    });',
  '  });',
  '})();',
].join('\n');

const doc = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>' + esc(title) + '</title>\n<style>\n' + css + '\n</style>\n</head>\n<body id="top">\n<header class="top"><div class="wrap"><h1>' + esc(title) + '</h1><p class="meta">' + esc(meta) + '</p><div class="controls"><input id="q" type="search" placeholder="Search / 搜索"><label class="tog"><input type="checkbox" id="collapse"> collapse all / 折叠全部</label></div><nav class="topics">' + topicsHtml + '</nav></div></header>\n\n<main>\n' + body + '\n</main>\n<script>\n' + js + '\n</script>\n<a id="toTop" href="#top" aria-label="Back to top" title="Back to top / 回到顶部">&#8593;</a>\n</body>\n</html>\n';

writeFileSync(outPath, doc);
process.stdout.write(JSON.stringify({ out: outPath, bytes: doc.length, stories: storyIndex, sections: secIndex + 1, aspects: aspIndex + 1 }) + '\n');
