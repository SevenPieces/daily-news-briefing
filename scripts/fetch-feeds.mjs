#!/usr/bin/env node
// Discovery-only RSS/Atom collector for the daily-news-briefing skill.
// Zero dependencies, no regex. Usage:
//   node fetch-feeds.mjs [--since ISO] [--out FILE] [--feeds url1,url2] [--timeout MS]
// Publisher feeds (BBC, The Guardian, Al Jazeera, Bloomberg, The New York Times,
// NPR, DW, France 24, CBC, Sky News, The Economist) are dated primaries: the
// feed carries the publisher's own title, timestamp and description. Google and
// Bing links are redirects; they never resolve to the publisher, so every item
// from those is discovery only and must be confirmed by a primary fetch.

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DIRECT_FEEDS = [
  // BBC
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',      outlet: 'BBC',               section: 'global', aspect: 'foreign' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',   outlet: 'BBC',               section: 'global', aspect: 'economy' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', outlet: 'BBC',               section: 'global', aspect: 'tech' },
  { url: 'https://feeds.bbci.co.uk/news/politics/rss.xml',   outlet: 'BBC',               section: 'global', aspect: 'politics' },
  // The Guardian
  { url: 'https://www.theguardian.com/world/rss',            outlet: 'The Guardian',      section: 'global', aspect: 'foreign' },
  { url: 'https://www.theguardian.com/business/rss',         outlet: 'The Guardian',      section: 'global', aspect: 'economy' },
  { url: 'https://www.theguardian.com/technology/rss',       outlet: 'The Guardian',      section: 'global', aspect: 'tech' },
  { url: 'https://www.theguardian.com/politics/rss',         outlet: 'The Guardian',      section: 'global', aspect: 'politics' },
  // Al Jazeera
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',        outlet: 'Al Jazeera',        section: 'global', aspect: 'foreign' },
  // Bloomberg (publisher feed; subscription outlet)
  { url: 'https://feeds.bloomberg.com/markets/news.rss',     outlet: 'Bloomberg',         section: 'global', aspect: 'economy' },
  { url: 'https://feeds.bloomberg.com/economics/news.rss',   outlet: 'Bloomberg',         section: 'global', aspect: 'economy' },
  { url: 'https://feeds.bloomberg.com/politics/news.rss',    outlet: 'Bloomberg',         section: 'global', aspect: 'politics' },
  { url: 'https://feeds.bloomberg.com/technology/news.rss',  outlet: 'Bloomberg',         section: 'global', aspect: 'tech' },
  // The New York Times
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',      outlet: 'The New York Times', section: 'global', aspect: 'foreign' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml',   outlet: 'The New York Times', section: 'global', aspect: 'politics' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',   outlet: 'The New York Times', section: 'global', aspect: 'business' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', outlet: 'The New York Times', section: 'global', aspect: 'tech' },
  // Other reputable international broadcasters and press
  { url: 'https://feeds.npr.org/1004/rss.xml',               outlet: 'NPR',               section: 'global', aspect: 'foreign' },
  { url: 'https://rss.dw.com/rdf/rss-en-world',              outlet: 'DW',                section: 'global', aspect: 'foreign' },
  { url: 'https://www.france24.com/en/rss',                  outlet: 'France 24',         section: 'global', aspect: 'foreign' },
  { url: 'https://www.cbc.ca/webfeed/rss/rss-world',         outlet: 'CBC',               section: 'global', aspect: 'foreign' },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml',    outlet: 'Sky News',          section: 'global', aspect: 'foreign' },
  { url: 'https://www.economist.com/international/rss.xml',  outlet: 'The Economist',     section: 'global', aspect: 'foreign' },
  // China
  { url: 'https://www.globaltimes.cn/rss/outbrain.xml',      outlet: 'Global Times',      section: 'china',  aspect: 'politics' },
];

const GLOBAL_QUERIES = [
  { q: 'world economy markets', aspect: 'economy' },
  { q: 'United States politics', aspect: 'politics' },
  { q: 'technology AI regulation', aspect: 'tech' },
  { q: 'Europe Russia Middle East', aspect: 'foreign' },
  { q: 'site:apnews.com', aspect: 'foreign' },
  { q: 'site:reuters.com', aspect: 'foreign' },
];

const CHINA_QUERIES = [
  { q: '中国经济 政策', aspect: 'economy' },
  { q: '中国 时政', aspect: 'politics' },
  { q: '中国 科技 人工智能', aspect: 'tech' },
  { q: '中国 社会 民生', aspect: 'social' },
  // China has one direct feed (Global Times, politics) and no usable mainland
  // RSS, so its outlet set is search-derived. These queries widen the aspect
  // headings the searches reach instead of leaning on one outlet to fill seven.
  { q: '中国 外交 外交部', aspect: 'foreign' },
  { q: '中国 军事 国防', aspect: 'military' },
  { q: '中国 商业 企业', aspect: 'business' },
  { q: '中国 科技 突破', aspect: 'tech' },
  { q: '香港 政策 经济 民生', aspect: 'politics' },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function googleNews(q, locale) {
  const params = locale === 'china'
    ? '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans'
    : '&hl=en-US&gl=US&ceid=US:en';
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + params;
}

function decode(raw) {
  let text = raw;
  if (text.startsWith('<![CDATA[')) text = text.slice(9);
  if (text.endsWith(']]>')) text = text.slice(0, -3);
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .trim();
}

function field(block, name) {
  const open = '<' + name + '>';
  const close = '</' + name + '>';
  const i = block.indexOf(open);
  if (i < 0) return '';
  const j = block.indexOf(close, i + open.length);
  if (j < 0) return '';
  return decode(block.slice(i + open.length, j));
}

function atomLink(block) {
  const i = block.indexOf('<link');
  if (i < 0) return '';
  const h = block.indexOf('href="', i);
  if (h < 0) return '';
  const end = block.indexOf('"', h + 6);
  return end < 0 ? '' : decode(block.slice(h + 6, end));
}

// RSS 2.0 <item>, RSS 1.0/RDF <item rdf:about=...>, and Atom <entry>.
function splitItems(xml) {
  const rss = xml.split('<item>').slice(1).map((part) => part.split('</item>')[0]);
  if (rss.length) return rss;
  const rdf = xml.split(/<item[\s>]/).slice(1).map((part) => part.split('</item>')[0]);
  if (rdf.length) return rdf;
  return xml.split('<entry>').slice(1).map((part) => part.split('</entry>')[0]);
}

// Chinese feeds are commonly GBK/GB18030, and the XML prolog is ASCII, so
// "looks like XML" cannot tell a UTF-8 feed from a GBK one. The reliable signal
// is U+FFFD: a UTF-8 decode emits it for every byte it cannot map. Re-decode
// those as gb18030, and keep latin1 as the last resort for a single-byte feed.
function decodeBuffer(buf) {
  const asUtf8 = buf.toString('utf8');
  if (!asUtf8.includes('\uFFFD')) return asUtf8;
  const asGb18030 = new TextDecoder('gb18030').decode(buf);
  if (!asGb18030.includes('\uFFFD')) return asGb18030;
  return buf.toString('latin1');
}

// Tagged so fetchText never retries an authoritative HTTP status with curl.
function httpError(status, statusText, url) {
  const err = new Error('HTTP ' + status + (statusText ? ' ' + statusText : '') + ' for ' + url);
  err.httpStatus = status;
  return err;
}

function curlBuffer(url, ms) {
  const seconds = String(Math.max(5, Math.ceil(ms / 1000)));
  // -f so a 4xx/5xx is an error on this transport too: when fetch is
  // unavailable curl is the only transport, and its body is not a feed.
  return execFileSync('curl', ['-sS', '-f', '-m', seconds, '-L', '-H', 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) daily-news-briefing', url], { maxBuffer: 16 * 1024 * 1024 });
}

async function fetchText(url, ms) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) daily-news-briefing' },
      });
      // A 404/500 body is not a feed. The status is authoritative, so it must
      // not reach the parser, nor be retried through curl as content.
      if (!res.ok) throw httpError(res.status, res.statusText, url);
      return decodeBuffer(Buffer.from(await res.arrayBuffer()));
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err && err.httpStatus) throw err;
    return decodeBuffer(curlBuffer(url, ms));
  }
}

function isDiscoveryOnly(url) {
  return url.includes('news.google.com') || url.includes('bing.com');
}

// Feed descriptions carry HTML; keep a plain, bounded abstract.
function plainText(raw) {
  if (!raw) return '';
  return String(raw).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

async function collect(feed, ms) {
  const record = { url: feed.url, outlet: feed.outlet || '', section: feed.section || '', status: 'ok', count: 0, error: '' };
  const items = [];
  try {
    const xml = await fetchText(feed.url, ms);
    const blocks = splitItems(xml);
    if (!blocks.length) throw new Error('no items parsed');
    const first = xml.indexOf('<item>') >= 0 ? xml.indexOf('<item>') : xml.indexOf('<entry>');
    const head = first > 0 ? xml.slice(0, first) : xml;
    const feedTitle = field(head, 'title') || feed.outlet || '';
    for (const block of blocks) {
      const title = field(block, 'title');
      if (!title) continue;
      const link = field(block, 'link') || atomLink(block);
      const published = field(block, 'pubDate') || field(block, 'published') || field(block, 'updated') || field(block, 'dc:date');
      const source = field(block, 'source') || feedTitle;
      const summary = plainText(field(block, 'description') || field(block, 'summary'));
      items.push({
        title,
        link,
        outlet: feed.outlet || source,
        section: feed.section,
        aspect: feed.aspect || '',
        publishedAt: published || null,
        summary: summary || null,
        discoveryOnly: isDiscoveryOnly(link),
      });
    }
    record.count = items.length;
  } catch (err) {
    record.status = 'error';
    record.error = String((err && err.message) || err);
  }
  return { record, items };
}

async function main() {
  const ms = Number(arg('--timeout', '20000'));
  const out = arg('--out', '');
  const sinceRaw = arg('--since', '');
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const extra = arg('--feeds', '').split(',').map((s) => s.trim()).filter(Boolean);

  const feeds = DIRECT_FEEDS.slice();
  for (const q of GLOBAL_QUERIES) feeds.push({ url: googleNews(q.q, 'global'), outlet: 'Google News', section: 'global', aspect: q.aspect });
  for (const q of CHINA_QUERIES) feeds.push({ url: googleNews(q.q, 'china'), outlet: 'Google News', section: 'china', aspect: q.aspect });
  for (const url of extra) feeds.push({ url, outlet: '', section: '', aspect: '' });

  const results = await Promise.all(feeds.map((f) => collect(f, ms)));
  let items = [];
  const feedRecords = [];
  for (const r of results) {
    feedRecords.push(r.record);
    items = items.concat(r.items);
  }

  if (since && !Number.isNaN(since.getTime())) {
    items = items.filter((it) => {
      if (!it.publishedAt) return true;
      const d = new Date(it.publishedAt);
      return Number.isNaN(d.getTime()) ? true : d >= since;
    });
  }

  // Whitespace-insensitive, but a title alone is not a story identity: two
  // different stories can carry one headline, and a space-free CJK headline is
  // a single token that ASCII-space normalisation never really compared. Key on
  // the title with every whitespace run stripped PLUS the link, so the same
  // story still collapses while two different links can never merge.
  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/\s+/g, '') + '\u0000' + (it.link || '');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    since: sinceRaw || null,
    feeds: feedRecords,
    itemCount: deduped.length,
    items: deduped,
  };
  const text = JSON.stringify(payload, null, 2);
  // Local state, not a deliverable: an explicit mode instead of the umask.
  if (out) writeFileSync(out, text + '\n', { mode: 0o600 });
  else process.stdout.write(text + '\n');

  // Every feed failing is an outage, not a quiet news day: an empty result with
  // nothing on stderr used to be indistinguishable from a slow-news run. The
  // records above still say which feeds failed; a partial success stays exit 0.
  const failed = feedRecords.filter((r) => r.status !== 'ok').length;
  if (feedRecords.length > 0 && failed === feedRecords.length) {
    process.stderr.write('fetch-feeds: all ' + failed + ' feeds failed; itemCount ' + deduped.length + '\n');
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write('fetch-feeds: ' + String((err && err.message) || err) + '\n');
  process.exit(1);
});
