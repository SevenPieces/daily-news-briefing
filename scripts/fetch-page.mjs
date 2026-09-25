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
// Zero dependencies. Usage:
//   node fetch-page.mjs <url> [<url> ...] [--retries N] [--timeout MS] [--text] [--out FILE]
//   --retries is ROUNDS: each round tries 2 profiles x 2 transports (up to 4 requests).
// Prints JSON: { fetchedAt, timeoutMs, rounds, profiles, results: [ { url, ok,
//   status, attempts, via, profile, title, publishedAt, dateSource, bytes, textLength } ] }
// Exit: 0 all fetched, 1 any failed, 2 usage.

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

function firstMatch(text, patterns) {
  for (const [re, source] of patterns) {
    const m = re.exec(text);
    if (m && m[1]) return { value: m[1].trim(), source };
  }
  return { value: null, source: null };
}

function extractDate(html) {
  return firstMatch(html, [
    [/"datePublished"\s*:\s*"([^"]+)"/, 'datePublished'],
    [/property=["']article:published_time["'][^>]*content=["']([^"']+)["']/, 'article:published_time'],
    [/content=["']([^"']+)["'][^>]*property=["']article:published_time["']/, 'article:published_time'],
    [/itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/, 'itemprop:datePublished'],
    [/<meta[^>]+name=["'](?:pubdate|publish-date|date)["'][^>]*content=["']([^"']+)["']/i, 'meta:pubdate'],
    [/<time[^>]+datetime=["']([^"']+)["']/, 'time[datetime]'],
    [/"dateModified"\s*:\s*"([^"]+)"/, 'dateModified'],
  ]);
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

async function viaFetch(url, ms, profile) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: profile.headers, redirect: 'follow' });
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BODY) { ctl.abort(); throw new Error('declared body ' + declared + ' bytes exceeds the ' + MAX_BODY + ' cap'); }
    const body = await res.text();
    return { status: res.status, body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body, via: 'fetch', contentType: res.headers.get('content-type') };
  } finally {
    clearTimeout(timer);
  }
}

// -w carries status and content-type out of band, so no -D header dump is
// needed: with redirects the header blocks would otherwise leak into the body.
function viaCurl(url, ms, profile) {
  const seconds = String(Math.max(5, Math.ceil(ms / 1000)));
  const args = ['-sS', '--compressed', '-m', seconds, '-L', '-w', '\n__STATUS__%{http_code}\n__CT__%{content_type}'];
  for (const [k, v] of Object.entries(profile.headers)) args.push('-H', k + ': ' + v);
  args.push(url);
  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: MAX_BODY });
  const trailer = /\n__STATUS__(\d{3})\n__CT__([^\n]*)\s*$/.exec(out);
  if (!trailer) return { status: 0, body: out, via: 'curl', contentType: null };
  return { status: Number(trailer[1]), body: out.slice(0, trailer.index), via: 'curl', contentType: trailer[2] || null };
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
          if (r.status >= 200 && r.status < 300 && r.body && r.body.length > 400 && isHtml(r.body, r.contentType)) {
            const date = extractDate(r.body);
            const out = {
              url, ok: true, status: r.status, attempts, via: r.via, profile: profile.name,
              title: extractTitle(r.body), publishedAt: date.value, dateSource: date.source,
              bytes: r.body.length, textLength: strip(r.body).length,
            };
            if (wantText) out.text = strip(r.body).slice(0, 1500);
            return out;
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
  for (const url of opts.urls) results.push(await fetchOne(url, opts.retries, opts.timeout, opts.text));
  const payload = { fetchedAt: new Date().toISOString(), timeoutMs: opts.timeout, rounds: opts.retries, profiles: PROFILES.map((p) => p.name), results };
  const text = JSON.stringify(payload, null, 2);
  if (opts.out) writeFileSync(opts.out, text + '\n'); else process.stdout.write(text + '\n');
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write('fetch-page: ' + String((err && err.message) || err) + '\n');
  process.exit(1);
});
