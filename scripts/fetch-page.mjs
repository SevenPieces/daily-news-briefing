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
//   node fetch-page.mjs <url> [<url> ...] [--retries N] [--timeout MS] [--text] [--out FILE]
//   --retries is ROUNDS: each round tries 2 profiles x 2 transports (up to 4 requests).
// Prints JSON: { fetchedAt, timeoutMs, rounds, profiles, results: [ { url, ok,
//   status, attempts, via, profile, title, publishedAt, dateSource, charset, bytes,
//   textLength } ] } - charset is the encoding the body was decoded with, bytes the
//   body's true byte count, and garbled: true (ok: true only) when the decoded text
//   still carries replacement characters.
// Exit: 0 all fetched, 1 any failed, 2 usage.

import {
  writeFileSync, readFileSync, mkdtempSync, rmSync, statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_BODY = 64 * 1024 * 1024;

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
// 404/410 are permanent, and a 404 does not mean "blocked" either.
const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

// One scratch directory per run, for curl's body files; removed in main().
let TMP_DIR = null;

function usage(msg) {
  if (msg) process.stderr.write('fetch-page: ' + msg + '\n');
  process.stderr.write('usage: fetch-page.mjs <url> [<url> ...] [--retries N] [--timeout MS] [--text] [--out FILE]\n');
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { urls: [], retries: 2, timeout: 25000, text: false, out: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--text') { opts.text = true; continue; }
    if (a === '--retries' || a === '--timeout' || a === '--out') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) usage(a + ' needs a value');
      if (a === '--out') { opts.out = v; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) usage(a + ' needs a positive number, got "' + v + '"');
      if (a === '--retries') opts.retries = Math.floor(n); else opts.timeout = Math.floor(n);
      continue;
    }
    if (a.startsWith('--')) usage('unknown option ' + a);
    opts.urls.push(a);
  }
  if (!opts.urls.length) usage();
  return opts;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
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

function extractDate(html) {
  const patterns = [
    [/"datePublished"\s*:\s*"([^"]+)"/, 'datePublished'],
    [/property=["']article:published_time["'][^>]*content=["']([^"']+)["']/, 'article:published_time'],
    [/content=["']([^"']+)["'][^>]*property=["']article:published_time["']/, 'article:published_time'],
    [/itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/, 'itemprop:datePublished'],
    [/<meta[^>]+name=["'](?:pubdate|publish-date|date)["'][^>]*content=["']([^"']+)["']/i, 'meta:pubdate'],
    [/<time[^>]+datetime=["']([^"']+)["']/, 'time[datetime]'],
    [/"dateModified"\s*:\s*"([^"]+)"/, 'dateModified'],
  ];
  const rejected = [];
  for (const [re, source] of patterns) {
    const m = re.exec(html);
    if (!m || !m[1]) continue;
    const value = m[1].trim();
    if (isPlausibleDate(value)) return { value, source, rejected };
    rejected.push(value.slice(0, 40));
  }
  return { value: null, source: null, rejected };
}

function extractTitle(html) {
  const og = /property=["']og:title["'][^>]*content=["']([^"']+)["']/.exec(html);
  if (og) return og[1].trim();
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return t ? strip(t[1]) : null;
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

async function viaFetch(url, ms, profile) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: profile.headers, redirect: 'follow' });
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BODY) { ctl.abort(); throw new Error('declared body ' + declared + ' bytes exceeds the ' + MAX_BODY + ' cap'); }
    // The body is taken as bytes, not text(): res.text() would decode it as UTF-8
    // and destroy the very bytes the charset above is supposed to interpret.
    const buffer = Buffer.from(await res.arrayBuffer());
    // A declared length is a claim, and a chunked response makes none, so the
    // bytes actually read are capped too. Measured 2026-09-29 on a 68MiB
    // chunked page with no content-length: the whole body was accepted
    // (71303168 bytes, over the 67108864 cap) while curl refused the same
    // page. The over-cap body is REFUSED, not truncated, so the two transports
    // answer alike; both read the body in full before the cap rejects it (curl
    // writes the file before it stats it), so the cap bounds what is accepted,
    // not what is allocated.
    if (buffer.length > MAX_BODY) throw new Error('body ' + buffer.length + ' bytes exceeds the ' + MAX_BODY + ' cap');
    const contentType = res.headers.get('content-type');
    return { status: res.status, buffer, via: 'fetch', contentType };
  } finally {
    clearTimeout(timer);
  }
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
function viaCurl(url, ms, profile) {
  const seconds = String(Math.max(5, Math.ceil(ms / 1000)));
  const bodyFile = join(tempDir(), 'body.bin');
  let out;
  try {
    const args = ['-sS', '--compressed', '-m', seconds, '-L', '-o', bodyFile, '-w', '__STATUS__%{http_code} __CT__%{content_type}'];
    for (const [k, v] of Object.entries(profile.headers)) args.push('-H', k + ': ' + v);
    args.push(url);
    out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  } catch (err) {
    // curl failed before it could print a trailer, and the body file is left
    // unread: the little -w did write is handed back with status 0, which the
    // caller reports as a failed attempt - the same outcome the partial stdout
    // body produced before the body moved to a file.
    return { status: 0, buffer: Buffer.from(String((err && err.stdout) || ''), 'utf8'), via: 'curl', contentType: null };
  }
  // The cap HEAD enforced through curl's stdout buffer applies to the file too:
  // an oversized body is refused before it is read, not handed back as ok.
  const size = statSync(bodyFile).size;
  if (size > MAX_BODY) throw new Error('body ' + size + ' bytes exceeds the ' + MAX_BODY + ' cap');
  const trailer = /__STATUS__(\d{3}) __CT__([^\n]*)\s*$/.exec(out.trim());
  if (!trailer) return { status: 0, buffer: readFileSync(bodyFile), via: 'curl', contentType: null };
  return { status: Number(trailer[1]), buffer: readFileSync(bodyFile), via: 'curl', contentType: trailer[2] || null };
}

async function fetchOne(url, rounds, ms, wantText) {
  let attempts = 0;
  let lastStatus = null;
  let lastVia = null;
  const errors = [];
  for (let round = 0; round < rounds; round++) {
    for (const profile of PROFILES) {
      for (const attempt of [viaFetch, viaCurl]) {
        attempts++;
        try {
          const r = await attempt(url, ms, profile);
          lastStatus = r.status;
          lastVia = r.via;
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
              const date = extractDate(html);
              const out = {
                url, ok: true, status: r.status, attempts, via: r.via, profile: profile.name,
                title: extractTitle(html), publishedAt: date.value, dateSource: date.source,
                ...(date.rejected.length ? { dateRejected: date.rejected } : {}),
                charset: decoded.charset, bytes: size, textLength: strip(html).length,
                ...(decoded.garbled ? { garbled: true } : {}),
              };
              if (wantText) out.text = strip(html).slice(0, 1500);
              return out;
            }
          }
          errors.push('HTTP ' + r.status + ' (' + label + ')');
          if (r.status >= 200 && r.status < 300) errors.push('non-HTML or too small (' + label + ')');
          else if (!RETRYABLE.has(r.status)) {
            const reason = r.status === 402 ? 'licensing gate - not retried; cite the publisher RSS instead' : 'permanent';
            return { url, ok: false, status: r.status, attempts, via: r.via, profile: profile.name, error: reason + ': HTTP ' + r.status + ' (' + label + ')' };
          }
        } catch (err) {
          errors.push(String((err && err.message) || err).slice(0, 80));
        }
      }
    }
    if (round < rounds - 1) await sleep(1200 * Math.pow(2, round));
  }
  const seen = [...new Set(errors)].slice(0, 6).join('; ');
  return { url, ok: false, status: lastStatus, attempts, via: lastVia, error: 'exhausted ' + attempts + ' attempt(s) [' + seen + ']' };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const results = [];
  try {
    for (const url of opts.urls) results.push(await fetchOne(url, opts.retries, opts.timeout, opts.text));
    const payload = { fetchedAt: new Date().toISOString(), timeoutMs: opts.timeout, rounds: opts.retries, profiles: PROFILES.map((p) => p.name), results };
    const text = JSON.stringify(payload, null, 2);
    if (opts.out) writeFileSync(opts.out, text + '\n'); else process.stdout.write(text + '\n');
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
