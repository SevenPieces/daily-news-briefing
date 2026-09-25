# Feasibility notes and probe evidence

Recorded 2026-09-10; the hard-block, UA-sensitive and licensing rows were
re-probed 2026-09-25. Re-run the probes below before changing the source tiers.

## Environment

Host-specific facts - the proxy endpoint, env-var configuration, install paths
and the per-host network split - are deliberately not recorded anywhere in this
skill: they are not portable and go stale silently. Re-probe them from the host
before relying on any of them.

Transferable consequence, unchanged: when international sources are unreachable,
the run degrades to a China-only briefing. Mark the Global section unavailable
rather than failing the whole run.

## web_fetch versus curl

- Read article pages with `scripts/fetch-page.mjs`, which varies the header
  profile and transport; harvest `web_fetch` as the fallback. web_fetch reached
  SCMP (200) where header-less curl got 403, which is exactly why the profile is
  varied rather than assumed.
- web_fetch does not follow a cross-origin http-to-https redirect; use the https
  URL directly (for example pbc.gov.cn).
- web_fetch truncates very large pages near 100000 characters.

## Market data

- Yahoo Finance chart endpoint covers: ^GSPC, ^IXIC, ^DJI, ^FTSE, ^GDAXI, ^FCHI,
  ^N225, ^KS11, ^HSI, DX-Y.NYB, EURUSD=X, JPY=X, CNH=X, CL=F, GC=F, HG=F, ^TNX,
  000001.SS, 000300.SS, 399001.SZ.
- Yahoo also serves per-contract Brent symbols (BZ plus the month code plus a
  two-digit year plus .NYM); expired contracts return HTTP 404. The BZ=F
  front-month alias tracks the *most-active* contract, which can run a month
  ahead of the near-month (on 2026-09-22 it resolved to Dec 2026 while the
  near-month was Nov 2026, 96.42 vs 100.54), so collect-markets.mjs names the
  two nearest contracts explicitly and puts the month in the row label.
- Onshore CNY spot does not open until 09:30 Asia/Shanghai, and Yahoo's CNY=X
  can emit an isolated thin print before then: at 2026-09-22 08:24 it read
  6.6845 while the continuously-traded offshore CNH was 6.6919, and the onshore
  market was shut. The FX row therefore uses CNH=X (USD/CNH), which trades
  around the clock.
- WTI (CL=F), gold (GC=F) and copper (HG=F) keep the front-month alias because
  for those the front month is the volume leader; the misalignment above is
  specific to the secondary NYMEX Brent listing.
- Eastmoney ulist endpoint returns bond yields; collect-markets.mjs wires in only
  171.CN10Y (10Y China govt bond). The value is f2 scaled by 10^f1, so CN10Y reads
  about 1.6927. US 10Y comes from Yahoo (^TNX), not Eastmoney.
- Frankfurter (ECB daily FX) and qt.gtimg.cn (A-share, GBK) are reachable and usable as cross-checks; collect-markets.mjs currently wires in only Yahoo and Eastmoney.

## Blocked or dead

### Hard blocks - no article access by any route (probed 2026-09-25)

| Target | Result |
|---|---|
| reuters.com | 401 to curl and the harness fetch; RSS discontinued |
| apnews.com | 403 Cloudflare; RSS 403 |
| ft.com | 403; RSS returns a single item |
| wsj.com | 401; RSS stale since Jan 2025 |
| news.sky.com article pages | 403 from an Akamai edge block to plain curl, browser-header curl and the harness fetch alike; the probed article had no Wayback snapshot. The publisher RSS is healthy and dated, so Sky News items are cited from the feed as `[prov:feed]` rather than dropped |

### UA-sensitive outlets - vary the profile, never record as blocked (probed 2026-09-25)

| Target | Result |
|---|---|
| france24.com article pages | UA-sensitive, inversely to the usual assumption: curl's DEFAULT User-Agent returns 200 with the full page and `datePublished`, while a Chrome User-Agent gets 403. Not gated - treat as fetch-verified |

A single failed attempt is not evidence of a block. Reading a UA-sensitive
outlet as a block downgrades a readable article to a feed-only summary, which is
how France 24 came to be recorded here as exposing no date.

### Licensing gates - do not attempt to fetch (probed 2026-09-25)

| Target | Result |
|---|---|
| npr.org article pages | 402 TollBit ("not authorized ... without a valid TollBit Token") on every automated profile tried, and on 20/20 requests in a bounded retry run. A content-LICENSING control, not a flaky gate: do not defeat it. Cite NPR from its own RSS as `[prov:feed]` (verified present with a matching pubDate in the topical feed, e.g. `feeds.npr.org/1128/rss.xml`) |

### Dead feeds and endpoints

| Target | Result |
|---|---|
| s.weibo.com/top/summary | 302 to login |
| stooq.com CSV | endpoint removed |
| People's Daily RSS | newest item 2025-06-05 |
| Xinhua channel RSS | 200 + valid XML on 12 channels, but every channel is frozen at Dec 2022 (pubDates present, years old) - the window filter drops every item |
| SCMP RSS | timeout |
| Caixin RSS | HTML, not a feed |

## Discovery limits

web_search returns titles and URLs only, with no snippet and no publishedAt.
Google News RSS item links resolve to news.google.com, not to the publisher.
Both are discovery-only; a primary fetch is always required.

## Fetch budget

Writing a summary requires reading the article, so items are bounded by the
fetch budget: with 20-30 fetches, target 20-25 items total.

## Probe log 2026-09-18 - promoted outlets

Probed with curl (`-L --compressed -A Mozilla/5.0`). Both were reachable at
probe time, without a proxy.

| Target | Result |
|---|---|
| gmw.cn homepage | 200, 151 KB; a live dated index - 12 distinct in-window article links (`2026-09/18/content_*.htm`) on the page |
| gmw.cn article (`politics.gmw.cn/2026-09/18/content_39007773.htm`) | 200; title plus full timestamp (2026-09-18 11:15); about 5.7 KB of body text |
| gmw.cn mobile (`m.gmw.cn`) | 200; same article set, lighter markup |
| gmw.cn RSS (`gmw.cn/rss/`, `gmw.cn/rss/rss.htm`) | 404 - no feed; use the HTML index |
| news.gov.hk article (`chi/2026/09/20260917/20260917_120804_911.html`) | 200; static page carrying title, date and full body |
| news.gov.hk homepage | 200 but only 8.5 KB - a JS shell with no article list in the HTML |
| news.gov.hk RSS | `/chi/rss/index.html` is 200 and lists channels, but feed URLs are assembled in JS via `ajaxHTMLCustom()`; no static feed. `/rss/chi/news.rss` is 404 |
| news.gov.hk discovery pages (`archive_calendar.html`, `sitemap.html`) | 200, both JS shells with no dated links |

Consequence: 光明网 supports discovery (dated homepage) and primary reads.
news.gov.hk supports primary reads only - discover Hong Kong items with
web_search, then cite the news.gov.hk article URL.

