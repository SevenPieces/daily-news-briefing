// fetch-feeds.mjs - the discovery collector against a local origin. The
// collector always adds its own publisher and search feeds, so --feeds alone
// cannot keep a test offline: guardEnv() blocks every non-loopback fetch and
// puts a failing curl shim on PATH, and each test's server listens on
// 127.0.0.1:0 and closes itself in t.after. Each test names the regression it
// guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCRIPTS, SKILL_ROOT, jsonOf, tempDir } from './helpers.mjs';

const SCRIPT = 'fetch-feeds.mjs';

/**
 * Run the collector without blocking the event loop: spawnSync (the helper the
 * file-based tests use) would starve the in-process fixture server, which then
 * could never answer the child.
 */
function runFeeds(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(SCRIPTS, SCRIPT), ...args], {
      cwd: SKILL_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

/**
 * An environment that cannot reach the public internet. The collector appends
 * its ~39 built-in feeds to every run, so the preload rejects any fetch whose
 * host is not loopback and the curl shim fails the same way, which keeps both
 * transports at the machine's edge. The shim also replaces curl for the local
 * feeds, whose fetch never fails.
 */
function guardEnv(t) {
  const dir = tempDir(t);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const preload = join(dir, 'block-net.mjs');
  writeFileSync(preload, [
    'const real = globalThis.fetch;',
    'globalThis.fetch = (input, init) => {',
    "  const url = typeof input === 'string' ? input : String((input && input.url) || input);",
    "  let host = '';",
    '  try { host = new URL(url).hostname; } catch { /* an unparseable URL is blocked below */ }',
    "  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {",
    "    return Promise.reject(new Error('blocked by the test harness: ' + url));",
    '  }',
    '  return real(input, init);',
    '};',
    '',
  ].join('\n'));
  writeFileSync(join(bin, 'curl'),
    '#!/bin/sh\necho "test-harness curl shim: blocked" >&2\nexit 7\n', { mode: 0o755 });
  return {
    NODE_OPTIONS: '--import=' + pathToFileURL(preload).href,
    PATH: bin + ':' + process.env.PATH,
  };
}

/** Start a loopback origin for the routes build() returns, and close it with the test. */
async function serve(t, build) {
  const routes = {};
  const server = createServer((req, res) => {
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(route.status === undefined ? 200 : route.status,
      { 'content-type': route.type || 'application/xml' });
    res.end(route.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  Object.assign(routes, build(origin));
  t.after(() => new Promise((resolve) => {
    // Undici keeps its sockets; closeAllConnections lets close() finish.
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  return origin;
}

const rssItem = (link, title, pubDate) => '<item><title>' + title + '</title><link>' + link + '</link>'
  + '<pubDate>' + pubDate + '</pubDate><description><![CDATA[<p>synthetic description</p>]]></description></item>';

const rssDoc = (title, items) => '<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>'
  + '<title>' + title + '</title>' + items + '</channel></rss>';

// "中国测试" in GBK, byte by byte: Node can encode UTF-8 only, so the legacy
// bytes are written literally.
const GBK_TITLE = Buffer.from([0xd6, 0xd0, 0xb9, 0xfa, 0xb2, 0xe2, 0xca, 0xd4]);

function gbkFeed(origin) {
  return Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="gbk"?><rss version="2.0"><channel><title>', 'latin1'),
    GBK_TITLE,
    Buffer.from('</title><item><title>', 'latin1'),
    GBK_TITLE,
    Buffer.from('</title><link>' + origin + '/gbk/one</link>'
      + '<pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>', 'latin1'),
  ]);
}

test('a local RSS 2.0 feed is parsed into the payload', async (t) => {
  const env = guardEnv(t);
  const origin = await serve(t, (o) => ({
    '/rss': { body: rssDoc('Fixture Feed', rssItem(o + '/story/one', 'Fixture Item One', 'Tue, 29 Sep 2026 12:10:00 GMT')) },
  }));

  const res = await runFeeds(['--feeds', origin + '/rss', '--timeout', '2000'], env);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = jsonOf(res.stdout);
  const record = j.feeds.find((f) => f.url === origin + '/rss');
  assert.ok(record, 'the --feeds URL must have its own feed record');
  // Regression: an item's title, link and date are the record the briefing
  // cites, so each is asserted verbatim rather than counted.
  assert.equal(record.status, 'ok');
  assert.equal(record.count, 1);
  assert.equal(j.itemCount, 1);
  assert.equal(j.items.length, 1);
  assert.equal(j.items[0].title, 'Fixture Item One');
  assert.equal(j.items[0].link, origin + '/story/one');
  assert.equal(j.items[0].publishedAt, 'Tue, 29 Sep 2026 12:10:00 GMT');
  assert.equal(j.items[0].summary, 'synthetic description');
});

test('a 404 whose body is a parseable feed is an error record, never content', async (t) => {
  const env = guardEnv(t);
  const errorFeed = rssDoc('Error Feed', rssItem('https://example.com/err', 'ERROR PAGE ITEM', 'Tue, 29 Sep 2026 12:10:00 GMT'));
  const origin = await serve(t, (o) => ({
    '/missing': { status: 404, body: errorFeed },
    '/served': { body: errorFeed },
  }));

  const bad = await runFeeds(['--feeds', origin + '/missing', '--timeout', '2000'], env);
  // Every feed failed, so this is also an outage exit.
  assert.equal(bad.status, 1);
  const j = jsonOf(bad.stdout);
  const record = j.feeds.find((f) => f.url === origin + '/missing');
  assert.equal(record.status, 'error');
  assert.equal(record.count, 0);
  assert.match(record.error, /HTTP 404/);
  assert.equal(j.itemCount, 0);
  assert.equal(j.items.length, 0);
  // The error page's own <item> must not survive as a story anywhere.
  assert.ok(!j.items.some((it) => it.title === 'ERROR PAGE ITEM'),
    'the 404 body reached the items');

  // Positive control: the very same bytes over a 200 ARE the feed, so the
  // absence above is about the status and not about the parser.
  const ok = await runFeeds(['--feeds', origin + '/served', '--timeout', '2000'], env);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const jok = jsonOf(ok.stdout);
  assert.equal(jok.itemCount, 1);
  assert.equal(jok.items[0].title, 'ERROR PAGE ITEM');
});

test('an Atom feed and an RSS 1.0/RDF feed with dc:date both parse', async (t) => {
  const env = guardEnv(t);
  const origin = await serve(t, (o) => ({
    '/atom': {
      body: '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">'
        + '<title>Atom Fixture Feed</title><entry><title>Atom Item One</title>'
        + '<link href="' + o + '/atom/one"/><published>2026-09-29T10:00:00Z</published>'
        + '<summary>Atom summary one</summary></entry></feed>',
    },
    '/rdf': {
      body: '<?xml version="1.0" encoding="utf-8"?>'
        + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
        + 'xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>RDF Fixture Feed</title></channel>'
        + '<item rdf:about="' + o + '/rdf/one"><title>RDF Item One</title>'
        + '<link>' + o + '/rdf/one</link><dc:date>2026-09-29T09:30:00Z</dc:date></item></rdf:RDF>',
    },
  }));

  const res = await runFeeds(['--feeds', origin + '/atom,' + origin + '/rdf', '--timeout', '2000'], env);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = jsonOf(res.stdout);
  assert.equal(j.itemCount, 2);
  const atom = j.items.find((it) => it.link === origin + '/atom/one');
  const rdf = j.items.find((it) => it.link === origin + '/rdf/one');
  assert.ok(atom, 'the Atom entry link must come from <link href>');
  assert.equal(atom.title, 'Atom Item One');
  assert.equal(atom.publishedAt, '2026-09-29T10:00:00Z');
  assert.ok(rdf, 'the RDF item must survive the <item rdf:about=...> split');
  assert.equal(rdf.title, 'RDF Item One');
  assert.equal(rdf.publishedAt, '2026-09-29T09:30:00Z');
});

test('a GBK feed decodes without replacement characters', async (t) => {
  const env = guardEnv(t);
  const origin = await serve(t, (o) => ({ '/gbk': { body: gbkFeed(o) } }));

  const res = await runFeeds(['--feeds', origin + '/gbk', '--timeout', '2000'], env);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = jsonOf(res.stdout);
  assert.equal(j.itemCount, 1);
  // Regression: a UTF-8-only decode left U+FFFD in every Chinese title.
  assert.equal(j.items[0].title, '中国测试');
  for (const item of j.items) {
    assert.doesNotMatch(item.title, /\uFFFD/, 'no title may carry a replacement character');
  }
});

test('every feed failing exits 1 with the outage line; a mix exits 0', async (t) => {
  const env = guardEnv(t);
  const origin = await serve(t, (o) => ({
    '/good': { body: rssDoc('Good Feed', rssItem(o + '/good/one', 'Good Item', 'Tue, 29 Sep 2026 12:00:00 GMT')) },
  }));

  const all = await runFeeds(['--feeds', 'http://127.0.0.1:1/', '--timeout', '2000'], env);
  // Regression: an all-failed run was indistinguishable from a quiet news day.
  assert.equal(all.status, 1);
  const line = /^fetch-feeds: all (\d+) feeds failed; itemCount 0$/m.exec(all.stderr);
  assert.ok(line, 'expected the outage line on stderr, got:\n' + all.stderr);
  const payload = jsonOf(all.stdout);
  assert.equal(Number(line[1]), payload.feeds.length, 'the count must be every feed');
  assert.ok(payload.feeds.every((f) => f.status !== 'ok'), 'no feed may report ok');
  assert.equal(payload.itemCount, 0);

  const mix = await runFeeds(['--feeds', origin + '/good,http://127.0.0.1:1/', '--timeout', '2000'], env);
  assert.equal(mix.status, 0, mix.stdout + mix.stderr);
  assert.doesNotMatch(mix.stderr, /feeds failed/);
  const j = jsonOf(mix.stdout);
  assert.equal(j.feeds.find((f) => f.url === origin + '/good').status, 'ok');
  assert.equal(j.feeds.find((f) => f.url === 'http://127.0.0.1:1/').status, 'error');
  assert.equal(j.itemCount, 1);
});

test('the dedupe key includes the link, and only an exact repeat collapses', async (t) => {
  const env = guardEnv(t);
  const origin = await serve(t, (o) => ({
    '/dedupe': {
      body: rssDoc('Dedupe Feed',
        rssItem(o + '/d/1', 'Shared Headline', 'Tue, 29 Sep 2026 12:00:00 GMT')
        + rssItem(o + '/d/2', 'Shared Headline', 'Tue, 29 Sep 2026 12:05:00 GMT')
        + rssItem(o + '/d/1', 'Shared Headline', 'Tue, 29 Sep 2026 12:06:00 GMT')
        + rssItem(o + '/d/3', 'Other Headline', 'Tue, 29 Sep 2026 12:07:00 GMT')),
    },
  }));

  const res = await runFeeds(['--feeds', origin + '/dedupe', '--timeout', '2000'], env);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const j = jsonOf(res.stdout);
  const record = j.feeds.find((f) => f.url === origin + '/dedupe');
  // Control: the feed really served four items, so the collapse below is real.
  assert.equal(record.count, 4);
  // Regression: keying the title alone merged two different stories that
  // happened to share a headline.
  assert.equal(j.itemCount, 3);
  assert.deepEqual(j.items.map((it) => it.link), [origin + '/d/1', origin + '/d/2', origin + '/d/3']);
  assert.equal(j.items.filter((it) => it.title === 'Shared Headline').length, 2);
});
