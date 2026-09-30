#!/usr/bin/env node
// Article-page reader for the daily-news-briefing skill.
//
// Outlets gate article pages differently. Some are hard blocks (Sky News, AP,
// Reuters, FT, WSJ). Others are UA-sensitive: measured 2026-09-25,
// france24.com returned 200 to curl's DEFAULT User-Agent and 403 to a Chrome
// User-Agent, so a browser UA is NOT strictly better. This script varies both
// the transport and the header profile across attempts and reports which
// combination won.
//
// This is NOT a tool for defeating access controls. It must not be used to get
// past a licensing gate - NPR answers 402 from TollBit, and the publisher's own
// RSS is the correct primary there. 402 is deliberately NOT retried.
//
// WHAT ONE URL COSTS. --retries counts ROUNDS, and each round walks 2 header
// profiles x 2 transports (fetch, curl), so the default of 2 rounds is up to 8
// requests and one URL can be asked for 8 times before the ladder gives up.
// The sleep between rounds is the largest Retry-After a 429 asked for (capped
// at 30s), or 1.2s then 2.4s when nothing asked for anything - a worst case of
// roughly a minute per URL. A 402 answers once: it is final and is returned
// without trying the rest of the ladder.
//
// A TRANSPORT FAILURE IS NOT AN HTTP STATUS. When neither transport gets a
// response - connection refused, DNS failure, TLS/SNI mismatch, a timeout - the
// attempt carries status 0 and MUST fall through to the next profile, round and
// transport. Reporting "HTTP 0" as permanent cost a coverage loss: measured
// 2026-09-30, "node fetch-page.mjs http://127.0.0.1:1/ --timeout 2000" gave up
// after 2 of its 8 requests with "permanent: HTTP 0". Only a real status that
// will not improve - 404/410, a licensing 402 - ends the ladder early.
//
// BODY CAP. MAX_BODY (default 64MiB) bounds what a response may be, in three
// places: a declared content-length over the cap is refused before the body is
// read, the streamed body is aborted the moment the running total exceeds the
// cap (fetch), and curl is given the same cap through --max-filesize so the
// transfer stops at the cap instead of after it. Overridable like the timeouts:
// --max-body BYTES, or the FETCH_PAGE_MAX_BODY environment variable; an
// unparseable or non-positive value is a usage error because a silently
// different cap would make two runs incomparable.
//
// Chinese outlets routinely serve legacy encodings, so the body is decoded from
// the charset the response declares - the content-type header first, then a
// <meta> declaration in the bytes themselves - and from its own bytes when it
// declares nothing. Decoding everything as UTF-8 garbled three in-window 200-OK
// pages (measured 2026-09-29: gwytb.gov.cn declares gb2312 in its header,
// military.cnr.cn and news.cnr.cn declare it only in their markup). A page that
// is still unreadable once the bytes and the declared charset have both been
// tried is reported garbled: true, not as a failure - the status and byte
// counts are real, the text is not.
//
// Zero dependencies. Usage:
//   node fetch-page.mjs <url> [<url> ...] [--retries N] [--timeout MS]
//                                     [--max-body BYTES] [--text] [--out FILE]
// Prints JSON: { fetchedAt, timeoutMs, maxBody, rounds, profiles, results: [
//   { url, ok, status, attempts, via, profile, title, titleSource, h1, h1s,
//     ogTitle, publishedAt, dateSource, dateOnly, charset, bytes, textLength,
//     textTruncated } ] } - charset is the encoding the body was decoded with,
//   h1 the first heading and h1s up to five of them in document order, so a page
//   whose first heading is navigation chrome is visible rather than silent,
//   bytes the body's true byte count, dateOnly true when the date field carries
//   no clock time, textTruncated true when --text returned fewer characters
//   than textLength, and garbled: true (ok: true only) when the decoded text
//   still carries replacement characters.
// Exit: 0 all fetched, 1 any failed, 2 usage.
//
// dateSource is a CLOSED SET. Every value this script can emit, what markup
// produces it and what it means:
//
//   | dateSource              | markup that produced it                                  | meaning |
//   |-------------------------|----------------------------------------------------------|---------|
//   | datePublished           | "datePublished":"..." (schema.org JSON-LD or inline)      | publication time |
//   | dateModified            | "dateModified":"..."                                      | modification time, later than publication |
//   | article:published_time  | <meta property="article:published_time" content="...">    | OG article publication time |
//   | itemprop:datePublished  | <meta itemprop="datePublished" content="...">             | microdata publication time |
//   | meta:date-published     | <meta name="pubdate" | name="publish-date">             | publication time (any date order) |
//   | meta:publishdate        | <meta name="publishdate" content="...">                   | publication date, often date-only |
//   | meta:firstpublishedtime | <meta name="firstpublishedtime" content="...">            | first-publication stamp, often full |
//   | meta:lastmodifiedtime   | <meta name="lastmodifiedtime" content="...">              | last-modified stamp |
//   | meta:date               | <meta name="date" content="...">                          | generic date field |
//   | time[datetime]          | <time datetime="...">                                     | machine-readable time element |
//   | body:text               | a dated element in the stripped body text                 | a stamp such as "2026-09-29 11:03:45" |
//   | null                    | -                                                         | no recognised date field |
//
// A label names the attribute that actually matched: <meta name="date"> is
// meta:date, never meta:pubdate. Labels only grow - an existing string keeps
// meaning what it meant, because downstream records copy dateSource verbatim.

import {
  writeFileSync, readFileSync, mkdtempSync, rmSync, statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_MAX_BODY = 64 * 1024 * 1024;
// Curl's own exit code for "--max-filesize was exceeded": a transfer that was
// stopped AT the cap, not a page the ladder should treat as absent.
const CURL_MAX_FILESIZE_EXIT = 63;
// The longest a 429's Retry-After is ever honoured, so one hostile header
// cannot park a run for an hour.
const MAX_RETRY_AFTER_MS = 30000;
// The most rejected date candidates a result will carry, so a page whose every
// <meta> looks vaguely date-shaped cannot bloat the JSON.
const MAX_REJECTED = 8;

const PROFILES = [
  {
    name: 'browser',
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
  },
  { name: 'plain', headers: { Accept: '*/*' } },
];

// 403/429 and 5xx are retried: they are the shapes a UA-sensitive gate takes.
// 402 is NOT retried - that is a licensing answer, not a transient failure.
// 404/410 are permanent, and a 404 does not mean "blocked" either. Status 0 is
// not in this set on purpose: it is not an HTTP status at all but the shape a
// failed transport takes, and it must never be final.
const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

// One scratch directory per run, for curl's body files; removed in main().
let TMP_DIR = null;
// Set in parseArgs; the cap the whole run enforces, so both transports and the
// payload's maxBody all report the same number.
let MAX_BODY = DEFAULT_MAX_BODY;

function usage(msg) {
  if (msg) process.stderr.write('fetch-page: ' + msg + '\n');
  process.stderr.write('usage: fetch-page.mjs <url> [<url> ...] [--retries N] [--timeout MS] [--max-body BYTES] [--text] [--out FILE]\n');
  process.exit(2);
}

// A byte count from --max-body or FETCH_PAGE_MAX_BODY. Anything that is not a
// positive integer is refused rather than ignored: a cap that quietly did not
// apply is worse than a usage error.
function parseBytes(raw, origin) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) usage(origin + ' needs a positive byte count, got "' + raw + '"');
  return Math.floor(n);
}

function parseArgs(argv) {
  const opts = { urls: [], retries: 2, timeout: 25000, text: false, out: '', maxBody: null };
  const envBody = process.env.FETCH_PAGE_MAX_BODY;
  if (envBody !== undefined && envBody !== '') opts.maxBody = parseBytes(envBody, 'FETCH_PAGE_MAX_BODY');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--text') { opts.text = true; continue; }
    if (a === '--retries' || a === '--timeout' || a === '--max-body' || a === '--out') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) usage(a + ' needs a value');
      if (a === '--out') { opts.out = v; continue; }
      if (a === '--max-body') { opts.maxBody = parseBytes(v, a); continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) usage(a + ' needs a positive number, got "' + v + '"');
      if (a === '--retries') opts.retries = Math.floor(n); else opts.timeout = Math.floor(n);
      continue;
    }
    if (a.startsWith('--')) usage('unknown option ' + a);
    opts.urls.push(a);
  }
  if (!opts.urls.length) usage();
  MAX_BODY = opts.maxBody === null ? DEFAULT_MAX_BODY : opts.maxBody;
  return opts;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// HTML entities, decoded for every value that will be printed as text. The
// escaped source is not a headline: measured on a BBC page, og:title carried
// "BBC &amp; the &#039;test&#039;", which reads as garbage in a briefing.
function decodeEntities(value) {
  if (typeof value !== 'string' || !value.includes('&')) return value;
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ' };
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Number.isInteger also rejects NaN, and the range check rejects lone
      // surrogates and non-characters, which would otherwise make fromCodePoint
      // throw on a hostile page.
      if (!Number.isInteger(cp) || cp < 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return whole;
      return String.fromCodePoint(cp);
    }
    const key = body.toLowerCase();
    return Object.hasOwn(named, key) ? named[key] : whole;
  });
}

function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// The attribute map of one tag, order-independent. Every meta pattern used to
// require name-before-content, and og:title on a real page put content first -
// so a plain <title> fallback was reported and the og:title was never even
// seen. Measured 2026-09-30 on a BBC page: <meta content="BBC &amp; the..."
// property="og:title"> was invisible to the old pattern.
function attrMap(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.\-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>=]+)/g;
  let m;
  while ((m = re.exec(tag))) {
    let value = m[2];
    if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
      value = value.slice(1, -1);
    }
    attrs[m[1].toLowerCase()] = value;
  }
  return attrs;
}

/** Every <meta> tag as an attribute map, in document order. */
function metaTags(html) {
  const tags = [];
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) tags.push(attrMap(m[0]));
  return tags;
}

function firstMeta(metas, attrs) {
  for (const meta of metas) {
    if (Object.entries(attrs).every(([k, v]) => (meta[k] || '').toLowerCase() === v)) return meta;
  }
  return null;
}

// The most trusted stripped text of one element, or null.
function textOf(html, re) {
  const m = re.exec(html);
  if (!m) return null;
  const text = decodeEntities(strip(m[1] || '')).trim();
  return text || null;
}

// Every <h1> in document order, with the offset the element starts at. The
// offset is what lets a nav heading be told from the article's own heading.
function h1List(html) {
  const found = [];
  const re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let m;
  while ((m = re.exec(html))) found.push({ at: m.index, text: decodeEntities(strip(m[1])).trim() });
  return found.filter((h) => h.text).map((h) => ({ at: h.at, text: h.text.slice(0, 500) }));
}

// Whether an offset sits inside one of the element's regions.
function inRegion(at, regions) {
  return regions.some((r) => at >= r.start && at < r.end);
}

// The h1 a reader would call the headline, when the page has more than one.
// Preferring the first <h1> outright reported site chrome as the headline:
// measured 2026-09-30 on https://politics.gmw.cn/2026-09/18/content_39007773.htm,
// the first <h1> is "全部导航" and the article's own heading is a later
// <h1 class="u-title">. So an h1 inside <article>/<main> wins, then the longest
// h1 (a nav label is short; a headline rarely is), and only then the first.
function bestH1(html, h1s) {
  if (!h1s.length) return null;
  const regions = [];
  const regionRe = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = regionRe.exec(html))) regions.push({ start: m.index, end: m.index + m[0].length });
  const inArticle = h1s.filter((h) => inRegion(h.at, regions));
  if (inArticle.length) return inArticle.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  return h1s.reduce((a, b) => (b.text.length > a.text.length ? b : a));
}

// The title as REPORTED, the candidates beside it, and which one won.
//
// og:title first: it is the publisher's own headline for the URL. It used to be
// returned HTML-escaped - an auditor measured "BBC &amp; the &#039;test&#039;"
// - so every candidate is entity-decoded, and the whole <meta> set is parsed
// attribute-order-independently because real pages put content before property.
//
// The h1 is the fallback, not the first choice, and it is picked from the h1s
// rather than taken as the first: the leading <h1> on a Tier-1 page is
// frequently navigation chrome (see bestH1). titleSource names whichever
// candidate won, ogTitle and h1s stay beside it, so a reader can see when the
// metadata and the rendered page disagree instead of having to trust the pick.
function extractTitle(html, metas) {
  const h1s = h1List(html);
  const og = firstMeta(metas, { property: 'og:title' }) || firstMeta(metas, { name: 'og:title' });
  const ogTitle = og && og.content ? decodeEntities(strip(og.content)).trim() || null : null;
  const tw = firstMeta(metas, { name: 'twitter:title' });
  const twitterTitle = tw && tw.content ? decodeEntities(strip(tw.content)).trim() || null : null;
  const docTitle = textOf(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const articleH1 = bestH1(html, h1s);
  const chosen = [[ogTitle, 'og:title'], [articleH1 && articleH1.text, 'h1'], [twitterTitle, 'twitter:title'], [docTitle, 'title']]
    .find(([value]) => value);
  return {
    title: chosen ? chosen[0].slice(0, 500) : null,
    source: chosen ? chosen[1] : null,
    h1: h1s.length ? h1s[0].text : null,
    h1s: h1s.slice(0, 5).map((h) => h.text),
    ogTitle,
  };
}

// A candidate date is only usable if it actually parses as one. Pages that ship
// un-rendered templates - for example <time datetime="${i}"> - otherwise yield a
// placeholder string as publishedAt, which reads to a downstream consumer as a
// real publication time. Observed live on a CNN video page, 2026-09-25.
function isPlausibleDate(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 8) return false;
  if (/[$<>{}%]/.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}

// The two ad-hoc stamp shapes the Chinese state publishers ship, in the two
// places they ship them: gov.cn puts "2026-09-30-11:23:00" in the CONTENT of
// <meta name="firstpublishedtime"> (measured 2026-09-30), and Xinhua/news.cn
// splits the same fact across three elements of its header - <span
// class="year"><em>2026</em></span> <span class="day"><em>09</em>/<em>30</em>
// </span> <span class="time">06:48:23</span> - which strips to "2026 09/30
// 06:48:23" (measured 2026-09-30). Date.parse reads neither, so without this
// the page's clock time was discarded and only the date-only meta survived.
function normalizeStamp(value) {
  const v = String(value).trim();
  // Already a full stamp: keep the date exactly as the page wrote it and put a
  // single space before the clock. gov.cn writes "2026-09-30-11:23:00", which
  // Date.parse rejects as written and reads once the last dash is a space.
  const joined = /^(\d{4}-\d{2}-\d{2})[ T-](\d{2}:\d{2}(?::\d{2})?)/.exec(v);
  if (joined) return joined[1] + ' ' + joined[2];
  const ymd = /^(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})日?[\sT]+(\d{1,2}:\d{2}(?::\d{2})?)/.exec(v);
  if (ymd) {
    const pad = (s) => s.padStart(2, '0');
    return ymd[1] + '-' + pad(ymd[2]) + '-' + pad(ymd[3]) + ' ' + ymd[4];
  }
  const split = /^(\d{4})\s+(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/.exec(v);
  if (split) {
    const pad = (s) => s.padStart(2, '0');
    return split[1] + '-' + pad(split[2]) + '-' + pad(split[3]) + ' ' + split[4];
  }
  return v;
}

// Whether a value names a clock time as well as a date. A date-only field
// cannot supply publishedAt on its own (see reference/research-input.md), and
// this is the flag that lets the consumer tell the two apart instead of reading
// "2026-09-29" as a timestamp.
function hasClock(value) {
  return /\d{1,2}:\d{2}/.test(String(value));
}

function extractDate(html, metas) {
  // The strongest available stamp, in preference order. datePublished before
  // dateModified on purpose: a modification time is later than publication and
  // can move an item across the coverage window.
  const preferred = [
    [/"datePublished"\s*:\s*["']([^"']+)["']/, 'datePublished'],
  ];
  for (const [re, source] of preferred) {
    const m = re.exec(html);
    if (!m || !m[1]) continue;
    const value = normalizeStamp(m[1]);
    if (isPlausibleDate(value)) return { value, source, dateOnly: !hasClock(value), rejected: [] };
  }

  // Every date-shaped field, by the attribute that actually carries it. A
  // date-only field is not the end of it: the clock time may be on the page in
  // an element that is not the primary date field, so every candidate is
  // consulted for a full stamp and date-only is only kept when none has one.
  const candidates = [];
  const push = (source, raw) => {
    if (raw === undefined || raw === null || raw === '') return;
    candidates.push({ source, value: normalizeStamp(raw) });
  };
  push('article:published_time', (firstMeta(metas, { property: 'article:published_time' }) || {}).content);
  push('itemprop:datePublished', (firstMeta(metas, { itemprop: 'datePublished' }) || {}).content);
  push('meta:date-published', (firstMeta(metas, { name: 'pubdate' }) || {}).content
    || (firstMeta(metas, { name: 'publish-date' }) || {}).content);
  push('meta:publishdate', (firstMeta(metas, { name: 'publishdate' }) || {}).content);
  push('meta:firstpublishedtime', (firstMeta(metas, { name: 'firstpublishedtime' }) || {}).content);
  push('meta:lastmodifiedtime', (firstMeta(metas, { name: 'lastmodifiedtime' }) || {}).content);
  push('meta:date', (firstMeta(metas, { name: 'date' }) || {}).content);
  push('time[datetime]', (firstMeta(metas, {}) ? (/<time[^>]+datetime=["']([^"']+)["']/i.exec(html) || [])[1] : undefined));
  const dm = /"dateModified"\s*:\s*["']([^"']+)["']/.exec(html);
  push('dateModified', dm ? dm[1] : undefined);

  const rejected = [];
  const plausible = [];
  for (const candidate of candidates) {
    if (isPlausibleDate(candidate.value)) plausible.push(candidate);
    else if (candidate.value && candidate.value.length < 60) rejected.push(candidate.value);
  }

  // The first plausible field is the strongest claim the page makes. A field
  // that carries only a date is not the end of it: the clock time may be on the
  // page in a place that does not count as the primary date field, so the
  // remaining candidates are asked for a full stamp before date-only is kept.
  const first = plausible.length ? plausible[0] : null;
  if (first && hasClock(first.value)) {
    return { value: first.value, source: first.source, dateOnly: false, rejected: rejected.slice(0, MAX_REJECTED) };
  }

  for (const candidate of plausible.slice(1)) {
    if (hasClock(candidate.value)) {
      return { value: candidate.value, source: candidate.source, dateOnly: false, rejected: rejected.slice(0, MAX_REJECTED) };
    }
  }

  // Nothing carried a clock. The last place to look is the rendered body: a
  // publisher can put the stamp in the visible page and no metadata at all.
  // The stripped text is searched because the date and the time are frequently
  // separate elements that only join once the tags are gone - news.cn strips to
  // "2026 09/30 06:48:23", cnr.cn to "2026-09-29 11:03:45", m.gmw.cn to
  // "timestamp:2026-09-29 19:46:01".
  const body = strip(html);
  const bodyPatterns = [
    /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s*(\d{1,2}:\d{2}(?::\d{2})?)/,
    /(\d{4})\s+(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/,
  ];
  for (const re of bodyPatterns) {
    const m = re.exec(body);
    if (!m) continue;
    const pad = (s) => s.padStart(2, '0');
    const value = m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) + ' ' + m[4];
    if (isPlausibleDate(value)) {
      return { value, source: 'body:text', dateOnly: false, rejected: rejected.slice(0, MAX_REJECTED) };
    }
  }
  // Still nothing: the date and its clock time can sit in separate elements with
  // the date first or the time first. Pair them only when they are close enough
  // that the surrounding text is one stamp - a page with many dated items must
  // not have one item's date take another item's clock.
  const paired = pairDateWithClock(body);
  if (paired) {
    return { value: paired, source: 'body:text', dateOnly: false, rejected: rejected.slice(0, MAX_REJECTED) };
  }

  if (first) return { value: first.value, source: first.source, dateOnly: true, rejected: rejected.slice(0, MAX_REJECTED) };
  return { value: null, source: null, dateOnly: false, rejected: rejected.slice(0, MAX_REJECTED) };
}

// A bare date and a bare clock within CLOCK_NEIGHBOURS characters of each other
// in the stripped text, joined into one stamp. The window is short on purpose:
// a wider one would splice a date to an unrelated clock on a page that carries
// several dated items.
const CLOCK_NEIGHBOURS = 120;
function pairDateWithClock(body) {
  const dateRe = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g;
  const clockRe = /(?:^|[^\d:])(\d{1,2}:\d{2}(?::\d{2})?)(?!\d)/g;
  const dates = [];
  let m;
  while ((m = dateRe.exec(body))) dates.push({ at: m.index, y: m[1], mo: m[2], d: m[3] });
  const clocks = [];
  while ((m = clockRe.exec(body))) clocks.push({ at: m.index + m[0].indexOf(m[1]), value: m[1] });
  const pad = (s) => s.padStart(2, '0');
  for (const date of dates) {
    let best = null;
    for (const clock of clocks) {
      const distance = Math.abs(clock.at - date.at);
      if (distance > CLOCK_NEIGHBOURS) continue;
      if (!best || distance < best.distance) best = { distance, clock };
    }
    if (best) {
      const value = date.y + '-' + pad(date.mo) + '-' + pad(date.d) + ' ' + best.clock.value;
      if (isPlausibleDate(value)) return value;
    }
  }
  return null;
}

function isHtml(body, contentType) {
  if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) return false;
  return /<html|<body|<!doctype html/i.test(body.slice(0, 2000));
}

// A TextDecoder per label: construction validates the label, so the first use of a
// bogus one is caught rather than throwing on every page.
const decoders = new Map();
function decoderFor(label) {
  if (!decoders.has(label)) {
    let decoder = null;
    try { decoder = new TextDecoder(label); } catch { decoder = null; }
    decoders.set(label, decoder);
  }
  return decoders.get(label);
}

// The charset out of a content-type, e.g. "text/html; charset=gb2312" -> "gb2312".
// Quoted values are legal (charset="gbk"), and the whole header is matched because
// the parameter order is not guaranteed.
function charsetOf(contentType) {
  const m = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType || '');
  return m ? m[1] : null;
}

// The charset a document declares about itself. Every ASCII-compatible legacy
// encoding writes this declaration in ASCII, so the opening bytes can be read as
// latin1 without knowing the encoding yet (the chicken-and-egg the header solves
// only when it carries a charset). html5 puts the declaration first, hence the
// 2048-byte head; the <meta http-equiv> form and a lone <meta charset> both count.
function metaCharsetOf(buffer) {
  const head = buffer.subarray(0, 2048).toString('latin1');
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_\-]+)/i.exec(head);
  return m ? m[1] : null;
}

// Whether the bytes are valid UTF-8 on their own. A legacy label can sit over a
// UTF-8 body and decode it without a single replacement character - the silent
// mojibake the count below cannot see - so the bytes are asked directly.
function isStrictUtf8(buffer) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

// Whether UTF-8 failed over the body rather than on a stray byte. A GBK body
// leaves a replacement character for nearly every high byte, while one bad byte
// in an otherwise UTF-8 page leaves one among many valid sequences - that page
// must stay flagged garbled, not flip into CJK-looking nonsense.
function utf8MostlyBroken(buffer) {
  let high = 0;
  for (const byte of buffer) if (byte >= 0x80) high++;
  if (!high) return false;
  const text = new TextDecoder('utf-8').decode(buffer);
  const fffd = (text.match(/\uFFFD/g) || []).length;
  return fffd > 0 && fffd * 2 >= high;
}

// The labels a body is read with, in order. A strict UTF-8 decode settles it
// outright, because a stale legacy label over a UTF-8 body is exactly the
// mojibake the replacement count cannot catch. When UTF-8 fails, the declared
// label goes first; a body that declared nothing gets gb18030 - a superset of
// gbk and gb2312, the labels the header would have carried - but only when
// UTF-8 failed over the body rather than on one stray byte.
function labelsFor(buffer, declared) {
  if (isStrictUtf8(buffer)) return ['utf-8'];
  const labels = declared ? [declared] : [];
  if (!labels.some((l) => /^utf-?8$/i.test(l))) labels.push('utf-8');
  if (!declared && utf8MostlyBroken(buffer)) labels.push('gb18030');
  return labels;
}

// Decodes with the labels labelsFor() put in order; the first candidate that
// decodes without a single replacement character wins, and when none does the
// one with the fewest is kept. A label Node cannot resolve is not a reason to
// lose the page: utf-8 is always among the candidates, so the old behaviour is
// the fallback rather than gone.
function decodeBody(buffer, contentType) {
  const declared = charsetOf(contentType) || metaCharsetOf(buffer);
  const labels = labelsFor(buffer, declared);
  let clean = null;
  let best = null;
  for (const label of labels) {
    const decoder = decoderFor(label);
    if (!decoder) continue;
    const text = decoder.decode(buffer);
    const fffd = (text.match(/\uFFFD/g) || []).length;
    const attempt = { text, encoding: decoder.encoding, fffd };
    if (fffd === 0) { clean = attempt; break; }
    if (!best || fffd < best.fffd) best = attempt;
  }
  let chosen = clean || best;
  // A label Node cannot resolve is not a reason to lose the page: fall back to the
  // one encoding every response is allowed to be in.
  if (!chosen) {
    const text = new TextDecoder('utf-8').decode(buffer);
    chosen = { text, encoding: 'utf-8', fffd: (text.match(/\uFFFD/g) || []).length };
  }
  return {
    // The raw declaration is not returned separately: `charset` is the documented
    // field for how the body was read, and the probe's pick lands there too.
    charset: chosen.encoding,
    text: chosen.text,
    fffd: chosen.fffd,
    // Replacement characters prove the bytes were not the declared encoding - the
    // one signal that survives every mojibake shape, unlike a byte-pattern guess.
    garbled: chosen.fffd > 0,
  };
}

// The response's bytes, capped WHILE they are read. The declared length is a
// claim and a chunked response makes none, so the running total is enforced as
// the stream arrives. Reading the body first and measuring it afterwards
// allocated whatever the server sent: measured 2026-09-30 against a local
// origin streaming 210MiB with no content-length, one URL took peak RSS from
// ~59MiB to ~782MiB and moved 4 x 210MiB across its 4 attempts before the cap
// rejected them. Aborting the stream at the cap tears the connection down.
async function readBodyCapped(res) {
  const chunks = [];
  let length = 0;
  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        length += value.byteLength;
        if (length > MAX_BODY) {
          const err = new Error('body exceeds the ' + MAX_BODY + ' byte cap (stopped reading at ' + length + ' bytes)');
          err.oversize = true;
          throw err;
        }
        chunks.push(Buffer.from(value));
      }
    } catch (err) {
      // The oversize rejection is the answer, not an unreadable body; a read
      // failure that is not about the cap tears the stream down and is left to
      // the caller's transport-failure path.
      if (!err || !err.oversize) {
        try { await reader.cancel(); } catch { /* the stream is already gone */ }
      }
      throw err;
    }
  } else if (typeof res.arrayBuffer === 'function') {
    // No stream handle, so the cap can only be a refusal after the fact.
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BODY) {
      const err = new Error('body ' + buffer.length + ' bytes exceeds the ' + MAX_BODY + ' cap');
      err.oversize = true;
      throw err;
    }
    return buffer;
  } else {
    throw new Error('response carried no readable body');
  }
  return Buffer.concat(chunks, length);
}

async function viaFetch(url, ms, profile) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: profile.headers, redirect: 'follow' });
    const declared = Number(res.headers.get('content-length') || 0);
    // The cheap refusal first: a declared length over the cap is answered
    // without reading a byte of the body.
    if (declared > MAX_BODY) { ctl.abort(); throw new Error('declared body ' + declared + ' bytes exceeds the ' + MAX_BODY + ' cap'); }
    // The body is taken as bytes, not text(): res.text() would decode it as UTF-8
    // and destroy the very bytes the charset above is supposed to interpret.
    const buffer = await readBodyCapped(res);
    const contentType = res.headers.get('content-type');
    return { status: res.status, buffer, via: 'fetch', contentType, retryAfter: retryAfterMs(res.headers) };
  } catch (err) {
    // No response arrived: this is a transport failure, NOT an HTTP status.
    // It carries status 0 so the ladder keeps going, and the cause is handed on
    // as err.cause so the final message can name what actually happened.
    if (err && err.oversize) throw err;
    const failure = new Error((err && err.message) || 'transport failure');
    failure.cause = (err && err.message) || 'fetch failed';
    return { status: 0, buffer: Buffer.alloc(0), via: 'fetch', contentType: null, transportError: true, cause: failure.cause };
  } finally {
    clearTimeout(timer);
  }
}

// A 429 may say how long to wait. Honouring it (capped) beats a fixed backoff
// that either ignores the server or hammers it.
function retryAfterMs(headers) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS);
  // The other legal form is an HTTP-date.
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), MAX_RETRY_AFTER_MS);
  return null;
}

function tempDir() {
  if (!TMP_DIR) TMP_DIR = mkdtempSync(join(tmpdir(), 'fetch-page-'));
  return TMP_DIR;
}

// -w carries status and content-type out of band, so no -D header dump is
// needed: with redirects the header blocks would otherwise leak into the body.
// The body goes to a file (-o) and is read back as a Buffer: execFileSync can
// only capture stdout as a string, which would decode a GBK page as UTF-8 before
// any charset is known - and, at the 64MB cap, would truncate the trailer this
// function has to parse. A non-2xx body is written and read just the same.
// --max-filesize is the same cap given to curl itself, so an oversized body
// stops the transfer at the cap rather than being written in full and refused.
function viaCurl(url, ms, profile) {
  const seconds = String(Math.max(5, Math.ceil(ms / 1000)));
  const bodyFile = join(tempDir(), 'body.bin');
  const args = ['-sS', '--compressed', '-m', seconds, '-L', '--max-filesize', String(MAX_BODY),
    '-o', bodyFile, '-w', '__STATUS__%{http_code} __CT__%{content_type}'];
  for (const [k, v] of Object.entries(profile.headers)) args.push('-H', k + ': ' + v);
  args.push(url);
  let out = '';
  let exitCode = 0;
  try {
    out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  } catch (err) {
    // curl failed before it could print a trailer. --max-filesize stops the
    // transfer at the cap with exit 63, and a body over the cap is refused -
    // the cap is a refusal in both transports, never a truncated page reported
    // as ok. Any other failure is a transport failure: status 0, so the ladder
    // moves on instead of calling it permanent.
    exitCode = typeof err.status === 'number' ? err.status : 1;
    out = String((err && err.stdout) || '');
  }
  // curl may have failed before it created the file, and /tmp is not guaranteed
  // to have one; a missing body file is size 0, not an exception.
  let size = 0;
  try { size = statSync(bodyFile).size; } catch { size = 0; }
  if (size > MAX_BODY) {
    throw new Error('body ' + size + ' bytes exceeds the ' + MAX_BODY + ' cap');
  }
  if (exitCode === CURL_MAX_FILESIZE_EXIT) {
    throw new Error('body exceeded the ' + MAX_BODY + ' byte cap (curl stopped the transfer)');
  }
  // A real response is the only case that reads the file back, so a transport
  // failure can never surface the scratch path as its cause.
  const trailer = /__STATUS__(\d{3}) __CT__([^\n]*)\s*$/.exec(out.trim());
  // A trailer without an error exit is a real response - error statuses keep
  // their body and their code. No trailer at all, or the 000 curl prints when
  // it never got a response, is a transport failure: status 0 with curl's own
  // reason, and the ladder keeps going. The file is not read on that path at
  // all, because curl creates it only for a response it actually received.
  const status = trailer ? Number(trailer[1]) : 0;
  if (!trailer || status === 0) {
    return {
      status: 0, buffer: Buffer.alloc(0), via: 'curl', contentType: null,
      transportError: true, cause: 'curl exit ' + exitCode + ' (' + curlCause(exitCode) + ')',
    };
  }
  return { status, buffer: readFileSync(bodyFile), via: 'curl', contentType: trailer[2] || null };
}

// Why curl gave up, in words. The raw cases are opaque numbers, and the one
// that reaches a reader most often is 7 - the closed port of a dead host.
function curlCause(code) {
  return {
    6: "couldn't resolve host",
    7: 'failed to connect',
    28: 'timed out',
    35: 'TLS handshake failed',
    52: 'empty reply from server',
    56: 'recv failure',
  }[code] || 'no status trailer';
}

// One short label for a failed attempt, so the final message names the distinct
// causes the ladder saw instead of collapsing them into "HTTP 0".
function causeLabel(r) {
  const label = r.via + ':' + r.profile;
  // A transport failure is a property of the URL, not of the profile or the
  // transport, so it carries no label: the same cause six times over reads as
  // noise, and the distinct-causes list below is what a reader needs.
  if (r.transportError || r.status === 0) return 'transport failure: ' + (r.cause || 'no response');
  if (r.status === 429) return 'HTTP 429 rate-limited' + (r.retryAfter ? ' (Retry-After ' + Math.round(r.retryAfter / 1000) + 's)' : '') + ' (' + label + ')';
  return 'HTTP ' + r.status + ' (' + label + ')';
}

async function fetchOne(url, rounds, ms, wantText) {
  let attempts = 0;
  let lastStatus = null;
  let lastVia = null;
  const errors = [];
  for (let round = 0; round < rounds; round++) {
    // The longest wait this round's 429s asked for, applied once at the end of
    // the round; a 429 also ends the round's remaining profiles and transports
    // because the server has answered "not now" in the clearest way it has.
    let retryAfter = null;
    let rateLimited = false;
    for (const profile of PROFILES) {
      if (rateLimited) break;
      for (const attempt of [viaFetch, viaCurl]) {
        attempts++;
        try {
          const r = await attempt(url, ms, profile);
          lastStatus = r.status;
          lastVia = r.via;
          r.profile = profile.name;
          const label = r.via + ':' + profile.name;
          // The 400-byte floor counts the response's bytes, not the characters
          // a decode produced, so a multi-byte page can clear it on far fewer
          // than 400 characters: measured 2026-09-29, a 532-byte page of 150
          // Chinese characters passes here and failed the decoded-length floor
          // it replaced.
          const size = r.buffer ? r.buffer.length : 0;
          if (r.status >= 200 && r.status < 300 && size > 400) {
            const decoded = decodeBody(r.buffer, r.contentType);
            const html = decoded.text;
            if (isHtml(html, r.contentType)) {
              const metas = metaTags(html);
              const date = extractDate(html, metas);
              const heading = extractTitle(html, metas);
              const full = strip(html);
              const excerpt = wantText ? full.slice(0, 1500) : null;
              const out = {
                url, ok: true, status: r.status, attempts, via: r.via, profile: profile.name,
                title: heading.title, titleSource: heading.source, h1: heading.h1, h1s: heading.h1s, ogTitle: heading.ogTitle,
                publishedAt: date.value, dateSource: date.source, dateOnly: date.dateOnly,
                ...(date.rejected.length ? { dateRejected: date.rejected } : {}),
                charset: decoded.charset, bytes: size, textLength: full.length,
                ...(decoded.garbled ? { garbled: true } : {}),
              };
              if (wantText) {
                out.text = excerpt;
                // The excerpt is capped at 1500 characters, and without this a
                // 1886-character page and a 1500-character one looked identical.
                out.textTruncated = full.length > excerpt.length;
              }
              return out;
            }
          }
          if (r.status === 429) {
            rateLimited = true;
            if (r.retryAfter !== null && r.retryAfter !== undefined) {
              retryAfter = retryAfter === null ? r.retryAfter : Math.max(retryAfter, r.retryAfter);
            }
          }
          errors.push(causeLabel(r));
          if (r.status >= 200 && r.status < 300) errors.push('non-HTML or too small (' + label + ')');
          else if (!RETRYABLE.has(r.status) && !(r.transportError || r.status === 0)) {
            const reason = r.status === 402 ? 'licensing gate - not retried; cite the publisher RSS instead' : 'permanent';
            return { url, ok: false, status: r.status, attempts, via: r.via, profile: profile.name, error: reason + ': ' + causeLabel(r) };
          }
        } catch (err) {
          errors.push(String((err && err.message) || err).slice(0, 80));
        }
      }
    }
    if (round < rounds - 1) {
      // A Retry-After is honoured up to the cap; without one the backoff stays
      // exponential per round.
      await sleep(retryAfter === null ? 1200 * Math.pow(2, round) : retryAfter);
    }
  }
  // Every DISTINCT reason, not the first six strings: with a transport failure
  // repeated across profiles and transports, the old list showed the same cause
  // many times and the real variety (a block, a timeout, a size refusal) only if
  // it happened to fit.
  const seen = [...new Set(errors)];
  const shown = seen.slice(0, 6).join('; ') + (seen.length > 6 ? '; +' + (seen.length - 6) + ' more' : '');
  return { url, ok: false, status: lastStatus, attempts, via: lastVia, error: 'exhausted ' + attempts + ' attempt(s) [' + shown + ']' };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const results = [];
  try {
    for (const url of opts.urls) results.push(await fetchOne(url, opts.retries, opts.timeout, opts.text));
    const payload = {
      fetchedAt: new Date().toISOString(), timeoutMs: opts.timeout, maxBody: MAX_BODY,
      rounds: opts.retries, profiles: PROFILES.map((p) => p.name), results,
    };
    const text = JSON.stringify(payload, null, 2);
    // Local scratch, not a deliverable: an explicit mode instead of the umask.
    if (opts.out) writeFileSync(opts.out, text + '\n', { mode: 0o600 }); else process.stdout.write(text + '\n');
  } finally {
    // Unconditional, so a throw after the fetches - an unwritable --out, say -
    // cannot leave the scratch directory and the last body file in it behind.
    // process.exit() sits outside the try below, because it ends the process
    // before a finally could run.
    if (TMP_DIR) { try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* scratch only */ } }
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write('fetch-page: ' + String((err && err.message) || err) + '\n');
  process.exit(1);
});
