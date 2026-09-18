# Feasibility notes and probe evidence

Recorded 2026-09-10. Re-run the probes below before changing the
source tiers.

## Environment

Host-specific facts - the proxy endpoint, env-var configuration, install paths
and the per-host network split - are deliberately not recorded anywhere in this
skill: they are not portable and go stale silently. Re-probe them from the host
before relying on any of them.

Transferable consequence, unchanged: when international sources are unreachable,
the run degrades to a China-only briefing. Mark the Global section unavailable
rather than failing the whole run.

## web_fetch versus curl

- web_fetch reached SCMP (200) where curl got 403, so prefer web_fetch for
  article reads.
- web_fetch does not follow a cross-origin http-to-https redirect; use the https
  URL directly (for example pbc.gov.cn).
- web_fetch truncates very large pages near 100000 characters.

## Market data

- Yahoo Finance chart endpoint covers: ^GSPC, ^IXIC, ^DJI, ^FTSE, ^GDAXI, ^FCHI,
  ^N225, ^KS11, ^HSI, DX-Y.NYB, EURUSD=X, JPY=X, CNY=X, BZ=F, CL=F, GC=F, HG=F,
  ^TNX, 000001.SS, 000300.SS, 399001.SZ.
- Eastmoney ulist endpoint returns bond yields; collect-markets.mjs wires in only
  171.CN10Y (10Y China govt bond). The value is f2 scaled by 10^f1, so CN10Y reads
  about 1.6927. US 10Y comes from Yahoo (^TNX), not Eastmoney.
- Frankfurter (ECB daily FX) and qt.gtimg.cn (A-share, GBK) are reachable and usable as cross-checks; collect-markets.mjs currently wires in only Yahoo and Eastmoney.

## Blocked or dead

| Target | Result |
|---|---|
| reuters.com | 401 to curl and web_fetch |
| apnews.com | 403 Cloudflare |
| ft.com | 403 |
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

