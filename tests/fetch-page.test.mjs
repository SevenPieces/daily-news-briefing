// fetch-page.mjs - the article reader, driven against local pages only. The
// fixture server lives in this process, so the child is spawned asynchronously:
// spawnSync would block the event loop and the server could never answer it.
// Every page is served from 127.0.0.1:0 and closed in t.after. Each test names
// the regression it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPTS, SKILL_ROOT, jsonOf, tempDir } from './helpers.mjs';

const SCRIPT = 'fetch-page.mjs';

/** Run the reader without blocking the event loop (see the file header). */
function runPage(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(SCRIPTS, SCRIPT), ...args], {
      cwd: SKILL_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

/** Start a loopback origin for the routes build() returns, and close it with the test. */
async function serve(t, build) {
  const routes = {};
  const server = createServer((req, res) => {
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('', '<h1>Not found</h1>'));
      return;
    }
    res.writeHead(route.status === undefined ? 200 : route.status,
      { 'content-type': route.type || 'text/html; charset=utf-8' });
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

/** Filler long enough to clear the reader's 400-byte body floor. */
const PAD = 'Synthetic filler sentence that only pads the page past the body floor. '.repeat(8);
const page = (head, body) => '<!doctype html><html><head>' + head + '</head><body>'
  + body + '<p>' + PAD + '</p></body></html>';

test('a transport failure walks the whole ladder and is not called permanent', async () => {
  // Nothing listens on port 1, so neither transport ever gets a response.
  const res = await runPage(['http://127.0.0.1:1/']);
  assert.equal(res.status, 1);
  const j = jsonOf(res.stdout);
  const r = j.results[0];
  assert.equal(r.ok, false);
  // No response arrived, so this is not an HTTP status at all.
  assert.equal(r.status, 0);
  // Regression: it used to give up after 2 of its 8 requests with
  // "permanent: HTTP 0", reporting a coverage loss as a dead end.
  assert.equal(r.attempts, 8, '2 profiles x 2 transports x 2 rounds at the default');
  assert.match(r.error, /transport failure/);
  assert.doesNotMatch(r.error, /permanent/);
  assert.equal(j.rounds, 2);
  assert.deepEqual(j.profiles, ['browser', 'plain']);
});

test('404 and 410 are permanent and end the ladder after one attempt', async (t) => {
  const origin = await serve(t, (o) => ({
    '/gone-404': { status: 404, body: page('', '<h1>Not found</h1>') },
    '/gone-410': { status: 410, body: page('', '<h1>Gone</h1>') },
  }));

  const res = await runPage([origin + '/gone-404', origin + '/gone-410']);
  assert.equal(res.status, 1);
  const [a, b] = jsonOf(res.stdout).results;
  assert.equal(a.status, 404);
  assert.equal(a.attempts, 1);
  assert.match(a.error, /^permanent: HTTP 404/);
  assert.equal(b.status, 410);
  assert.equal(b.attempts, 1);
  assert.match(b.error, /^permanent: HTTP 410/);
});

test('a 402 licensing gate is never retried', async (t) => {
  const origin = await serve(t, (o) => ({
    '/paywalled': { status: 402, body: page('', '<h1>Payment required</h1>') },
  }));

  const res = await runPage([origin + '/paywalled']);
  assert.equal(res.status, 1);
  const r = jsonOf(res.stdout).results[0];
  assert.equal(r.status, 402);
  // Regression: a licensing answer is not a transient block, so it must not
  // be walked through the remaining profiles, transports and rounds.
  assert.equal(r.attempts, 1);
  assert.match(r.error, /licensing gate/);
  assert.doesNotMatch(r.error, /permanent/);
});

test('og:title wins and is entity-decoded', async (t) => {
  const origin = await serve(t, (o) => ({
    '/og': {
      body: page('<meta content="BBC &amp; the &#039;test&#039;" property="og:title"><title>Doc title</title>',
        '<h1>Nav heading</h1><main><h1>Article heading</h1></main>'),
    },
  }));

  const res = await runPage([origin + '/og']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const r = jsonOf(res.stdout).results[0];
  // Regression: the raw attribute was returned HTML-escaped, so a briefing
  // read "BBC &amp; the &#039;test&#039;", and it was never even seen when the
  // attribute order put content before property.
  assert.equal(r.title, "BBC & the 'test'");
  assert.equal(r.titleSource, 'og:title');
  assert.equal(r.ogTitle, "BBC & the 'test'");
});

test('with no og:title the article heading wins over an earlier navigation h1', async (t) => {
  const origin = await serve(t, (o) => ({
    '/heading': { body: page('<title>Doc title</title>', '<h1>Nav heading</h1><main><h1>Article heading</h1></main>') },
  }));

  const res = await runPage([origin + '/heading']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const r = jsonOf(res.stdout).results[0];
  // Regression: the first <h1> outright reported site chrome ("全部导航") as
  // the headline; the heading inside <main> is the article's own.
  assert.equal(r.title, 'Article heading');
  assert.equal(r.titleSource, 'h1');
  // h1 keeps the first heading and h1s the document order, so the chrome the
  // pick skipped stays visible beside the winner instead of disappearing.
  assert.equal(r.h1, 'Nav heading');
  assert.deepEqual(r.h1s, ['Nav heading', 'Article heading']);
  assert.equal(r.ogTitle, null);
});

test('meta tags are read in either attribute order, per field', async (t) => {
  const origin = await serve(t, (o) => ({
    '/title-content-first': { body: page('<meta content="Content First Title" property="og:title">', '<h1>Body heading</h1>') },
    '/title-name-first': { body: page('<meta property="og:title" content="Name First Title">', '<h1>Body heading</h1>') },
    '/date-content-first': { body: page('<meta content="2026-09-30 11:23:00" property="article:published_time">', '<h1>Body heading</h1>') },
    '/date-name-first': { body: page('<meta property="article:published_time" content="2026-09-29 08:00:00">', '<h1>Body heading</h1>') },
  }));

  const urls = ['title-content-first', 'title-name-first', 'date-content-first', 'date-name-first'].map((p) => origin + '/' + p);
  const res = await runPage(urls);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const [tc, tn, dc, dn] = jsonOf(res.stdout).results;
  // Regression: every meta pattern required name-before-content, so a real
  // page that put content first lost both its og:title and its date.
  assert.equal(tc.title, 'Content First Title');
  assert.equal(tn.title, 'Name First Title');
  assert.equal(dc.publishedAt, '2026-09-30 11:23:00');
  assert.equal(dc.dateSource, 'article:published_time');
  assert.equal(dn.publishedAt, '2026-09-29 08:00:00');
  assert.equal(dn.dateSource, 'article:published_time');
});

test('a date-only meta plus a full stamp in the body yields the body stamp', async (t) => {
  const origin = await serve(t, (o) => ({
    '/date-body': { body: page('<meta name="publishdate" content="2026-09-29">', '<p>2026-09-29 11:03:45</p>') },
  }));

  const res = await runPage([origin + '/date-body']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const r = jsonOf(res.stdout).results[0];
  // Regression: the first plausible field ended the search, so the page's real
  // clock time was discarded and publishedAt stayed a bare date.
  assert.equal(r.publishedAt, '2026-09-29 11:03:45');
  assert.equal(r.dateSource, 'body:text');
  assert.equal(r.dateOnly, false);
});

test('<meta name="firstpublishedtime"> is used and normalised', async (t) => {
  const origin = await serve(t, (o) => ({
    '/date-first': { body: page('<meta name="firstpublishedtime" content="2026-09-30-11:23:00">', '<h1>Body heading</h1>') },
  }));

  const res = await runPage([origin + '/date-first']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const r = jsonOf(res.stdout).results[0];
  // Regression: Date.parse reads neither the gov.cn dash form nor the split
  // Xinhua form, so the field was dropped as implausible.
  assert.equal(r.publishedAt, '2026-09-30 11:23:00');
  assert.equal(r.dateSource, 'meta:firstpublishedtime');
  assert.equal(r.dateOnly, false);
});

test('a page whose only date is date-only reports dateOnly true', async (t) => {
  const origin = await serve(t, (o) => ({
    '/date-only': { body: page('<meta name="publishdate" content="2026-09-29">', '<h1>Body heading</h1>') },
  }));

  const res = await runPage([origin + '/date-only']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const r = jsonOf(res.stdout).results[0];
  assert.equal(r.publishedAt, '2026-09-29');
  assert.equal(r.dateSource, 'meta:publishdate');
  // The flag is what lets a consumer tell a date from a stamp.
  assert.equal(r.dateOnly, true);
});

test('a page with no date reports a null publishedAt and a null dateSource', async (t) => {
  const origin = await serve(t, (o) => ({
    '/no-date': { body: page('<title>No date page</title>', '<h1>Headline only</h1>') },
  }));

  const res = await runPage([origin + '/no-date']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const r = jsonOf(res.stdout).results[0];
  assert.equal(r.publishedAt, null);
  assert.equal(r.dateSource, null);
  assert.equal(r.dateOnly, false);
});

test('--text truncation is explicit', async (t) => {
  const long = 'The quick synthetic paragraph keeps going so the stripped text is long enough. '.repeat(40);
  const origin = await serve(t, (o) => ({
    '/text': { body: page('<title>Long text page</title>', '<h1>Long text heading</h1><p>' + long + '</p>') },
  }));

  const withText = await runPage([origin + '/text', '--text']);
  assert.equal(withText.status, 0, withText.stdout + withText.stderr);
  const r = jsonOf(withText.stdout).results[0];
  assert.ok(r.textLength > 1500, 'the fixture must exceed the excerpt cap, got ' + r.textLength);
  assert.equal(r.text.length, 1500);
  // Regression: a 1886-character page and a 1500-character one looked identical.
  assert.equal(r.textTruncated, true);

  // Positive control: without --text the same page keeps the full length and
  // carries no excerpt at all, so the truncation is about the returned text.
  const plain = await runPage([origin + '/text']);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  const p = jsonOf(plain.stdout).results[0];
  assert.equal(p.textLength, r.textLength);
  assert.equal(p.text, undefined);
  assert.equal(p.textTruncated, undefined);
});

test('--max-body rejects a value that is not a positive byte count with exit 2', async () => {
  const bad = await runPage(['http://127.0.0.1:1/', '--max-body', 'abc']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--max-body needs a positive byte count, got "abc"/);
  assert.match(bad.stderr, /usage: fetch-page\.mjs <url>/);
  assert.equal(bad.stdout, '');

  // A cap of zero would silently read nothing, so it is refused the same way.
  const zero = await runPage(['http://127.0.0.1:1/', '--max-body', '0']);
  assert.equal(zero.status, 2);
  assert.match(zero.stderr, /--max-body needs a positive byte count, got "0"/);
  assert.equal(zero.stdout, '');
});

test('a body over a small --max-body is refused, not accepted', async (t) => {
  const big = 'Synthetic oversized paragraph body. '.repeat(200);
  const origin = await serve(t, (o) => ({
    '/big': { body: page('<title>Big page</title>', '<h1>Big heading</h1><p>' + big + '</p>') },
  }));

  const refused = await runPage([origin + '/big', '--max-body', '1024']);
  assert.equal(refused.status, 1);
  const j = jsonOf(refused.stdout);
  assert.equal(j.maxBody, 1024, 'the cap in the payload must be the flag value');
  assert.equal(j.results[0].ok, false);
  assert.match(j.results[0].error, /1024/);
  // Regression: the cap is a property of the resource, so the ladder used to
  // re-fetch the same oversized body and refuse it again.
  assert.equal(j.results[0].attempts, 1);

  // Positive control: the same page is read normally under the default cap.
  const ok = await runPage([origin + '/big']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(jsonOf(ok.stdout).results[0].ok, true);
});

test('a missing --out value is a usage error with exit 2', async () => {
  const res = await runPage(['http://127.0.0.1:1/', '--out']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--out needs a value/);
  assert.equal(res.stdout, '');
});

test('an unwritable --out path fails and leaves no file behind', async (t) => {
  const dir = tempDir(t);
  const out = join(dir, 'missing-dir', 'page.json');
  const res = await runPage(['http://127.0.0.1:1/', '--retries', '1', '--out', out]);

  // An unwritable output is not a fetch failure: it exits 2 with its own
  // message, where it used to exit 1 - the same code as "a URL failed".
  assert.equal(res.status, 2);
  assert.match(res.stderr, /fetch-page: cannot write/);
  assert.match(res.stderr, /ENOENT/);
  assert.equal(res.stdout, '');
  assert.equal(existsSync(out), false, 'no output file may exist');
});

test('a malformed URL is a usage error, not a transport failure', async () => {
  // A value that is not http(s) cannot be fetched by either transport. It used
  // to walk the whole ladder - four attempts at --retries 1 - and report the
  // mistyped URL as a transport failure, which blamed the network.
  const res = await runPage(['not a url', '--retries', '1']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not an http\(s\) URL: not a url/);
  assert.equal(res.stdout, '', 'no JSON is printed for a usage error');
});
