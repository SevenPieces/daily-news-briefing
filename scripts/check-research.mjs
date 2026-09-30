#!/usr/bin/env node
// Research-report gate for the daily-news-briefing skill.
//
// Nothing validated a research report before the briefing was written, so three
// failure classes reached Step 6 and only the orchestrator caught them by hand:
// records tagged with a word that is not a contract tag, an "alternate" outlet
// that names the primary outlet, and headlines the run had rewritten instead of
// copied. A rewritten headline is indistinguishable from a verbatim one unless
// the record also carries the title the fetch printed, which is why sourceTitle
// is a required field and why this gate can check the class at all.
//
// Usage:
//   node check-research.mjs <report.json> [--window "<SINCE>" "<UNTIL>"]
//
// The report is the research stage's records as JSON: either an array of
// records, or an object { "records": [...], "window": { "since": ..., "until": ... } }
// (the array form is what reference/research-input.md tells research to write to
// $STAGE/records.json). --window overrides the report's own window; the window
// check runs only when both ends are known.
//
// A record is the per-story record of reference/research-input.md:
//   section        global | china
//   aspect         Economy ... Social (Global), 经济 ... 社会 (China), or top
//   headline       the publisher's own headline, verbatim
//   sourceTitle    the title the fetch (or the feed item) printed, verbatim and
//                  before entity decoding - the evidence the headline is checked
//                  against
//   outlet         the outlet that published the cited page
//   primaryUrl     the canonical primary link, http(s)
//   publishedAt    Asia/Shanghai, YYYY-MM-DD HH:MM
//   dateSource     the field the fetch printed, one of fetch-page.mjs's closed
//                  label set (datePublished, dateModified, article:published_time,
//                  itemprop:datePublished, meta:date-published, meta:publishdate,
//                  meta:firstpublishedtime, meta:lastmodifiedtime, meta:date,
//                  time[datetime], body:text), or null when it printed none
//   provenance     full | feed | link
//   textLength     the length of the text the provenance call rests on
//   flags          one or more of new, followup, developing, paywalled, unverified
//   keyFacts       the facts the summary will be written from
//   corroboratingOutlet / altUrl / altTitle    optional together, never the
//                  primary outlet
//
// Records are numbered from 1 in report order, and every problem line names the
// record and the field. Warnings are printed too and never change the exit code:
// a dateSource that is neither datePublished nor dateModified (the label alone
// cannot settle a reused-URL item), and an aspect of two or more records that all
// come from one outlet. Aspect "top" is a selection rather than an aspect and is
// left out of the single-outlet warning.
//
// Exit: 0 clean (warnings allowed), 1 a record violates a rule, 2 usage or
// unreadable input.

import { readFileSync } from 'node:fs';

// The tags reference/output-contract.md allows. A record carrying anything else
// would reach the briefing with a tag the renderer does not know.
const ALLOWED_TAGS = new Set(['new', 'followup', 'developing', 'paywalled', 'unverified']);

const GLOBAL_ASPECTS = new Set(['Economy', 'Politics', 'Business', 'Tech', 'Foreign affairs', 'Military', 'Social']);
const CHINA_ASPECTS = new Set(['经济', '时政', '商业', '科技', '外交', '军事', '社会']);
const SECTION_ASPECTS = { global: GLOBAL_ASPECTS, china: CHINA_ASPECTS };

// The labels scripts/fetch-page.mjs's extractDate() can emit, exactly - keep in
// step with that function. null is the documented "no recognised date field"
// case, not a missing value.
const DATE_SOURCES = new Set([
  'datePublished', 'article:published_time', 'itemprop:datePublished',
  'meta:date-published', 'meta:publishdate', 'meta:firstpublishedtime',
  'meta:lastmodifiedtime', 'meta:date', 'time[datetime]', 'body:text',
  'dateModified',
]);

// reference/research-input.md allows two sources that are not fetch-page labels:
// a record whose dated source is the publisher's own RSS item records the field
// the collector read, and a page read with another tool records that tool's
// name. Checking only DATE_SOURCES refused every feed-derived record - and the
// publisher feeds are primaries, so that is most of a normal run.
const FEED_DATE_SOURCES = new Set(['pubDate', 'published', 'updated', 'dc:date', 'date', 'publishedAt']);
const TOOL_DATE_SOURCES = new Set(['web_fetch']);

function knownDateSource(value) {
  return DATE_SOURCES.has(value) || FEED_DATE_SOURCES.has(value) || TOOL_DATE_SOURCES.has(value);
}

// The two labels that ARE a publication or modification time. A record whose
// dateSource is neither cannot lean on the label for the reused-URL check, so
// it warns - and it may not carry an invented 00:00 clock time either.
const REAL_TIME_FIELDS = new Set(['datePublished', 'dateModified']);

// The run's own annotation words, which a publisher's headline does not carry.
// A word that the sourceTitle itself carries (a publisher's own 【独家】, say) is
// the publisher's wording, not the run's, and is not reported.
const ANNOTATION_WORDS = [
  'updated', 'update', 'breaking', 'exclusive', 'developing', 'live',
  'live updates', 'unverified', 'correction', "editor's note", 'in-window',
  'briefing', 'watchlist', '更新', '快讯', '独家', '直播', '滚动', '要闻',
  '持续更新', '编者按',
];
const ANNOTATION = new RegExp(
  '(?:[（(\\[【]\\s*(?:' + ANNOTATION_WORDS.join('|') + ')[^）)\\]】]*[）)\\]】]'
  + '|\\s+[-–—|·]\\s*(?:' + ANNOTATION_WORDS.join('|') + ')\\s*$)',
  'i',
);

const ENTITIES = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '],
]);

function usage(msg) {
  if (msg) process.stderr.write('check-research: ' + msg + '\n');
  process.stderr.write('usage: check-research.mjs <report.json> [--window "<since>" "<until>"]\n');
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { file: '', window: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--window') {
      const since = argv[++i];
      const until = argv[++i];
      if (since === undefined || until === undefined) usage('--window needs two values: "<since>" "<until>"');
      opts.window = { since, until };
      continue;
    }
    if (a.startsWith('-')) usage('unknown option ' + a);
    if (!opts.file) { opts.file = a; continue; }
    usage('unexpected argument ' + a);
  }
  if (!opts.file) usage();
  return opts;
}

// A publisher writes its own title as HTML source, so the fetch prints it
// escaped. Decoding it is the one transformation the headline rule allows: the
// headline is the rendered title, not its escaped source text.
function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES.get(body.toLowerCase()) || whole;
  });
}

function squash(value) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

// A fetch's title is not always the headline on its own: fetch-page.mjs falls
// back to <title>, and a page routinely puts its own name there - the probed
// 光明网 article printed "习近平总书记指引民族团结进步事业高质量发展 _光明网" where
// the headline was the part before the separator (measured 2026-09-30). Only a
// separator followed by the outlet name is tolerated, so a truncated or
// paraphrased headline is still refused.
const SITE_SUFFIX = /^\s*[-–—|｜·:：_]\s*\S/;

/** The problem a headline has against the title the record carries, or null. */
function headlineProblem(headline, sourceTitle) {
  const head = squash(headline);
  const source = squash(sourceTitle);
  if (head === source) return null;
  if (source.startsWith(head) && SITE_SUFFIX.test(source.slice(head.length))) return null;
  const match = ANNOTATION.exec(head);
  if (match && !source.toLowerCase().includes(match[0].replace(/[\s（()）\[\]【】-]/g, '').toLowerCase())) {
    return 'carries the run\'s own annotation "' + match[0].trim() + '", which the page title does not carry';
  }
  return 'differs from sourceTitle "' + source + '"';
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/** Epoch ms of an Asia/Shanghai "YYYY-MM-DD HH:MM" stamp, or NaN. */
function stampMs(value) {
  const m = STAMP.exec(String(value));
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59) return NaN;
  return Date.parse(y + '-' + mo + '-' + d + 'T' + h + ':' + mi + ':00+08:00');
}

function isFilled(value) {
  return typeof value === 'string' && value.trim() !== '';
}

const REQUIRED_STRINGS = ['section', 'aspect', 'headline', 'sourceTitle', 'outlet', 'primaryUrl', 'publishedAt'];

/**
 * Every problem one record has, as { field, detail } pairs. The checks are the
 * gate rules of reference/research-input.md; a record with no problem is
 * publishable.
 */
function recordProblems(rec, window) {
  const problems = [];
  const add = (field, detail) => problems.push({ field, detail });
  const has = (field) => Object.prototype.hasOwnProperty.call(rec, field);

  for (const field of REQUIRED_STRINGS) {
    if (!has(field)) add(field, 'missing');
    else if (!isFilled(rec[field])) add(field, 'empty');
  }
  if (!has('textLength')) add('textLength', 'missing');
  else if (typeof rec.textLength !== 'number' || !Number.isFinite(rec.textLength) || rec.textLength < 0) {
    add('textLength', 'not a non-negative number: ' + JSON.stringify(rec.textLength));
  }
  if (!has('flags')) add('flags', 'missing');
  else if (!Array.isArray(rec.flags)) add('flags', 'not an array');
  else if (!rec.flags.length) add('flags', 'empty - no classification tag');
  else for (const tag of rec.flags) {
    if (!ALLOWED_TAGS.has(tag)) add('flags', 'tag "' + tag + '" is outside the allowed set');
  }
  if (!has('keyFacts')) add('keyFacts', 'missing');
  else if (!Array.isArray(rec.keyFacts) || !rec.keyFacts.length) add('keyFacts', 'empty - no facts for the summary');

  if (has('section') && isFilled(rec.section) && !SECTION_ASPECTS[rec.section]) {
    add('section', 'not global or china: ' + JSON.stringify(rec.section));
  }
  if (has('aspect') && isFilled(rec.aspect) && rec.aspect !== 'top' && SECTION_ASPECTS[rec.section]) {
    if (!SECTION_ASPECTS[rec.section].has(rec.aspect)) {
      add('aspect', '"' + rec.aspect + '" is not an aspect of ' + rec.section);
    }
  }

  if (isFilled(rec.headline) && isFilled(rec.sourceTitle)) {
    const headline = headlineProblem(rec.headline, rec.sourceTitle);
    if (headline) add('headline', headline);
  }

  if (isFilled(rec.provenance) && !['full', 'feed', 'link'].includes(rec.provenance)) {
    add('provenance', 'not full, feed or link: ' + JSON.stringify(rec.provenance));
  }
  // full rests on the page's own article body, and textLength is the evidence
  // for it: a full with nothing counted is a claim with nothing behind it.
  if (rec.provenance === 'full' && rec.textLength === 0) {
    add('provenance', '[prov:full] recorded with textLength 0 - no body evidence');
  }

  if (has('dateSource')) {
    if (rec.dateSource !== null && typeof rec.dateSource !== 'string') {
      add('dateSource', 'not a field name or null: ' + JSON.stringify(rec.dateSource));
    } else if (typeof rec.dateSource === 'string' && !knownDateSource(rec.dateSource)) {
      add('dateSource', '"' + rec.dateSource + '" is not a label fetch-page.mjs prints, a field the feed'
        + ' collector reads (pubDate, published, updated, dc:date, date), or the name of another tool (web_fetch)');
    }
  } else {
    add('dateSource', 'missing - record the printed label, or null when there is none');
  }

  if (isFilled(rec.primaryUrl) && !/^https?:\/\/\S+$/i.test(rec.primaryUrl)) {
    add('primaryUrl', 'not an http(s) URL: ' + JSON.stringify(rec.primaryUrl));
  }

  if (isFilled(rec.publishedAt) && Number.isNaN(stampMs(rec.publishedAt))) {
    add('publishedAt', 'not YYYY-MM-DD HH:MM (Asia/Shanghai): ' + JSON.stringify(rec.publishedAt));
  }
  // The contract forbids inventing a clock time. Midnight is the shape an
  // invented one takes when a date-only field was promoted to a full stamp.
  if (isFilled(rec.publishedAt) && / 00:00$/.test(rec.publishedAt) && !REAL_TIME_FIELDS.has(rec.dateSource)) {
    add('publishedAt', '00:00 with dateSource ' + JSON.stringify(rec.dateSource)
      + ' - a date-only field cannot supply a clock time');
  }

  if (has('corroboratingOutlet') || has('altUrl') || has('altTitle')) {
    if (!isFilled(rec.corroboratingOutlet)) add('corroboratingOutlet', 'missing - an alternate needs its outlet');
    if (!isFilled(rec.altUrl)) add('altUrl', 'missing - an alternate needs its canonical URL');
    else if (!/^https?:\/\/\S+$/i.test(rec.altUrl)) add('altUrl', 'not an http(s) URL: ' + JSON.stringify(rec.altUrl));
    if (!isFilled(rec.altTitle)) add('altTitle', 'missing - the alternate page\'s own title is its evidence');
    if (isFilled(rec.corroboratingOutlet) && isFilled(rec.outlet)
        && rec.corroboratingOutlet.trim().toLowerCase() === rec.outlet.trim().toLowerCase()) {
      add('corroboratingOutlet', 'names the primary outlet "' + rec.outlet.trim() + '" - an alternate is a different outlet');
    }
  }

  if (isFilled(rec.publishedAt) && window) {
    const at = stampMs(rec.publishedAt);
    const since = stampMs(window.since);
    const until = stampMs(window.until);
    if (!Number.isNaN(at) && !Number.isNaN(since) && at < since) {
      add('publishedAt', rec.publishedAt + ' is before the window start ' + window.since);
    }
    if (!Number.isNaN(at) && !Number.isNaN(until) && at > until) {
      add('publishedAt', rec.publishedAt + ' is after the window end ' + window.until);
    }
  }

  return problems;
}

function warningsFor(rec) {
  const out = [];
  if (rec && rec.dateSource !== 'datePublished' && rec.dateSource !== 'dateModified') {
    out.push('dateSource: ' + JSON.stringify(rec.dateSource === undefined ? null : rec.dateSource)
      + ' is neither datePublished nor dateModified - the reused-URL check needs its own look at the page');
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  let raw;
  try {
    raw = readFileSync(opts.file, 'utf8');
  } catch (err) {
    process.stderr.write('check-research: cannot read ' + opts.file + ': ' + String((err && err.message) || err) + '\n');
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch (err) {
    process.stderr.write('check-research: ' + opts.file + ' is not JSON: ' + String((err && err.message) || err) + '\n');
    process.exit(2);
  }

  const records = Array.isArray(report) ? report : report && report.records;
  if (!Array.isArray(records)) {
    process.stderr.write('check-research: ' + opts.file
      + ' must be an array of records, or an object carrying "records"\n');
    process.exit(2);
  }
  let window = opts.window || (report && !Array.isArray(report) && report.window) || null;
  if (window && (!isFilled(window.since) || !isFilled(window.until))) window = null;
  if (window && (Number.isNaN(stampMs(window.since)) || Number.isNaN(stampMs(window.until)))) {
    process.stderr.write('check-research: window ends must be YYYY-MM-DD HH:MM\n');
    process.exit(2);
  }

  const problems = [];
  const warnings = [];
  records.forEach((rec, i) => {
    const index = i + 1;
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      problems.push({ index, field: 'record', detail: 'not an object' });
      return;
    }
    for (const p of recordProblems(rec, window)) problems.push({ index, field: p.field, detail: p.detail });
    for (const w of warningsFor(rec)) warnings.push({ index, detail: w });
  });

  // One outlet cannot corroborate itself: an aspect written from a single
  // outlet is the failure check-diversity.mjs catches in the briefing, and it
  // is worth catching while the report is still the only artifact.
  const byAspect = new Map();
  records.forEach((rec, i) => {
    if (!rec || typeof rec !== 'object' || rec.aspect === 'top') return;
    const key = rec.section + '\u0000' + rec.aspect;
    if (!byAspect.has(key)) byAspect.set(key, []);
    byAspect.get(key).push({ index: i + 1, outlet: rec.outlet });
  });
  for (const [key, rows] of byAspect) {
    if (rows.length < 2) continue;
    const outlets = new Set(rows.map((r) => String(r.outlet).trim()));
    if (outlets.size === 1) {
      const [section, aspect] = key.split('\u0000');
      warnings.push({ index: rows[0].index, detail: 'aspect ' + aspect + ' (' + section + ') has ' + rows.length
        + ' records, all from ' + [...outlets][0] + ' - prefer a second outlet' });
    }
  }

  console.log('research records: ' + records.length + ' | problems: ' + problems.length
    + ' | warnings: ' + warnings.length + (window ? ' | window ' + window.since + ' -> ' + window.until : ' | no window'));
  for (const p of problems) console.log('  record ' + p.index + '  ' + p.field + ': ' + p.detail);
  for (const w of warnings) console.log('  WARN record ' + w.index + '  ' + w.detail);
  if (records.length === 0) console.log('  note: no records - is there a research report?');
  console.log(problems.length === 0 ? 'RESEARCH: OK' : 'RESEARCH: FAIL');
  process.exit(problems.length === 0 ? 0 : 1);
}

main();
