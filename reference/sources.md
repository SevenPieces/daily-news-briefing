# Source registry

Probe evidence for every claim here is recorded in `feasibility.md`. Re-probe
before promoting a new outlet to Tier 1.

## Tier 1 - fetch-verified primaries

These pages were fetched successfully (HTTP 200 with usable
content) and may be cited as the primary link.

| Outlet | Domain | Section | Notes |
|---|---|---|---|
| BBC | bbc.com, bbc.co.uk | Global | RSS works and carries pubDate |
| The Guardian | theguardian.com | Global | |
| Al Jazeera | aljazeera.com | Global | |
| Nikkei Asia | asia.nikkei.com | Global, Business | |
| SCMP | scmp.com | China, Global | curl is 403 but web_fetch is 200; use web_fetch |
| Xinhua | news.cn | China | RSS is stale, use HTML |
| State Council | gov.cn | China | |
| National Bureau of Statistics | stats.gov.cn | China, Economy | |
| People's Bank of China | pbc.gov.cn | China, Economy | use https, not http |
| Caixin | caixin.com | China, Economy | partly paywalled |
| Yicai | yicai.com | China, Business | |
| The Paper | thepaper.cn | China, Social | |
| CLS | cls.cn | China, Economy | fast wire |
| STCN | stcn.com | China, Business | |
| 光明网 (Guangming) | gmw.cn, politics.gmw.cn, m.gmw.cn | China | curl 200; homepage is a live dated index; article pages carry a full timestamp; no RSS (probe 2026-09-18) |
| 香港政府新闻网 (HK Government News) | news.gov.hk | China (Hong Kong) | curl 200; static dated article pages are the primary; no fetchable RSS and no static dated index - discover via web_search (probe 2026-09-18) |

## Publisher RSS primaries (dated, citable)

These outlets' article pages are bot-blocked, but their **own RSS feeds** are
fetchable, dated, and carry the publisher's title, link and description. An item
from a publisher feed is a valid primary: cite link + pubDate, write the summary
from the feed's own description, and never paraphrase locked body text. Tag
subscription outlets #paywalled.

| Outlet | Feeds | Note |
|---|---|---|
| Bloomberg | markets, economics, politics, technology (`feeds.bloomberg.com/<section>/news.rss`) | subscription; #paywalled |
| The New York Times | World, Politics, Business, Technology (`rss.nytimes.com/services/xml/rss/nyt/*.xml`) | partly metered; #paywalled |
| NPR | `feeds.npr.org/1004/rss.xml` | |
| DW | `rss.dw.com/rdf/rss-en-world` | RSS 1.0 / dc:date |
| France 24 | `france24.com/en/rss` | |
| CBC | `cbc.ca/webfeed/rss/rss-world` | |
| Sky News | `feeds.skynews.com/feeds/rss/world.xml` | |
| The Economist | `economist.com/international/rss.xml` | large weekly feed |

## Discovery surfaces (never cited as primary)

| Surface | How to use |
|---|---|
| Google News RSS | Titles and dates for cross-source prominence. Its item links do NOT resolve to publishers, so never cite them. |
| Baidu News | Chinese discovery |
| Bing News RSS | Global discovery |
| web_search | Primary discovery tool; returns title and URL only, no dates or snippets |

Weibo hot search is unusable: it returns 302 to a login wall.

## UA-sensitive outlets - vary the profile, never record as blocked

Some outlets answer 403 to one header profile and serve the page to another, and
a browser User-Agent is NOT automatically the better one. Measured 2026-09-25 on
live article pages:

| Outlet | plain curl (default UA) | curl + browser UA | harness fetch | behaviour |
|---|---|---|---|---|
| France 24 | 200 | 403 | 200 or 404 | 200 with the DEFAULT User-Agent, including `datePublished`; the Chrome User-Agent is rejected |

That is a profile preference, not a block. Treat France 24 as a fetch-verified
primary, and vary the header profile rather than simply retrying.

## Licensing gates - do not attempt to fetch

NPR answers **402 from TollBit** ("not authorized ... without a valid TollBit
Token") to every automated profile tried: curl's default User-Agent, a Chrome
User-Agent, and the harness fetch. That is a content-licensing control, not a
flaky CDN, so do **not** try to defeat it. Cite NPR from its own RSS as
`[prov:feed]`, which is a legitimate dated primary. An NPR article page is not
a fetch target. (Earlier runs recorded NPR as "feed-only by design"; the accurate
reason is a licence gate.)

## Reading an article page

Use `scripts/fetch-page.mjs`, which varies the header profile and transport,
and reports which date field it used:

~~~sh
node "$SKILL/scripts/fetch-page.mjs" <url> [<url> ...] [--retries 2] [--timeout 25000] [--text] [--out FILE]
~~~

`--retries` counts ROUNDS, not requests: each round tries 2 header profiles
(browser, then a plain profile that overrides no User-Agent) across 2 transports
(fetch, curl). The default of 2 rounds is therefore up to 8 requests per URL.
A 402 is treated as final and is never retried, so a licensing gate costs one
request, not eight.

It prints JSON per URL: `url`, `ok`, `status`, `attempts`, `via`, `profile`,
`title`, `publishedAt`, `dateSource`, `charset`, `bytes`, `textLength`, plus
`garbled` when the decoded text still carries replacement characters - and
`error` instead of the content fields when a URL could not be fetched. `--text`
adds the stripped page text; `--out FILE` writes the JSON to a file. The top
level also carries `rounds` and `profiles`. It exits 0 only when every URL was
fetched, 1 when any failed, and 2 on a usage error or an unreadable file.

- **Pass `--text` to read an article's body.** It is the flag that returns the
  page text, truncated at 1500 characters, while the `textLength` the tool
  prints either way is the full stripped length of the page, not the length of
  the excerpt; a record whose summary needs the body must be read with
  `--text`.
- **Vary the profile before concluding "blocked".** One failed attempt is
  evidence of nothing - but a 402 from a licensing gate is an answer, not a
  challenge.
- **Prefer `datePublished` over `dateModified`.** That is why `dateSource` is
  reported: a bare modification time is later than publication and can silently
  move an item across the coverage window. A modification time alone is not a
  publication time - see "Reused URLs" below for when a modified page is still
  in-window. `dateSource` is whatever label the tool printed, copied character
  for character - `datePublished`, `article:published_time`,
  `itemprop:datePublished`, `meta:pubdate`, `time[datetime]`,
  `dateModified` - so the names are examples, not a closed set. When it is
  neither `datePublished` nor `dateModified`, the label alone cannot settle
  an in-window update: the reused-URL check needs its own look at the page.
- `web_fetch` remains a valid fallback when the script cannot reach a page.
- `[prov:full]` means the cited page's own article body was obtained; a publisher
  RSS abstract is `[prov:feed]`. Neither is second-class - the marker states depth
  only, never that an HTTP request succeeded.
- **A 200 whose text is unreadable is not a fetch.** A page that is not UTF-8
  (GBK or GB18030) decodes as mojibake unless its charset is honoured, so
  `fetch-page.mjs` reads the charset from the content-type header, falling back
  to the page's own `<meta>`, and probes the bytes themselves when the page
  declares nothing, reporting the encoding it decoded with as `charset`. A page
  the reader reports as `garbled` has yielded no article body: record the item as
  `[prov:link]`, report it as a body-less fetch in the
  run-level gate notes with the failed charset in `gateNote`, and never upgrade
  the page to a stronger marker on the strength of its 200 alone. A publisher
  feed that describes the story in its own words still earns `[prov:feed]` -
  the marker names where the words came from.
- **A chrome-only excerpt is no body.** The 1500-character window can hold
  nothing but a cookie banner, masthead and navigation, so a large
  `textLength` is not evidence of an article. A page whose excerpt is chrome
  has yielded no article body: take the summary from the publisher's own RSS
  description or from the headline alone, and record the item `[prov:feed]`
  or `[prov:link]` - never `[prov:full]` - whatever length the tool printed.

### Reused URLs - `datePublished` outside, `dateModified` and `pubDate` inside

Some outlets update one article URL in place (BBC does this constantly), so a page
can carry a `datePublished` outside the coverage window while `dateModified` and
the publisher RSS `pubDate` are both inside it. Check all three fields before
accepting or rejecting such an item.

- `dateModified` **and** the RSS `pubDate` inside the window: the item IS an
  in-window update. Include it, cite the update time as the story's published
  time, record the field as `dateSource`, and disclose the original publication
  date in the coverage note.
- A modification time alone, with no RSS match and no new facts inside the window:
  do not admit it.

Report the disagreement between page and feed in the run-level gate notes.

## Tier 2 - blocked originals (corroborated alt links)

Reuters (401), AP (403 Cloudflare), FT (403 Security Verification) and WSJ (401)
return hard blocks to both curl and the harness fetch. Their official RSS is
dead or blocked too: AP `index.rss` and `apnews.com/hub/*.rss` are 403, Reuters
`arc/outboundfeeds` is 404 and `feeds.reuters.com` is gone, RSSHub is 403,
WSJ's `feeds.a.dj.com` has been stale since Jan 2025, and FT's `ft.com/rss/home`
returns a single item.

Rules for these: include the story as an `[alt:AP](url)` / `[alt:Reuters](url)`
link when a fetchable primary reports the same event; tag the item #unverified
only when no fetchable primary corroborates it; keep the original link so the
user can read it manually. Never summarize beyond what is corroborated.

Resolve the canonical publisher URL with a site-restricted search - for example
`<exact headline> site:apnews.com` - which returns `apnews.com/article/...`
links even though the page itself is 403. Verified for AP. Google News item links
never resolve to the publisher (they stay on news.google.com), so never cite them.
For an older wire story, one archive read may verify it:
`https://web.archive.org/web/2/<url>` (same-day stories are usually not archived).
If no canonical URL exists, cite a `[find:AP](google-search-url)` search fallback.

**Sky News is a third shape.** Its article pages return a hard 403 from an
Akamai edge block to plain curl, browser-header curl and the harness fetch
alike, and the article probed had no Wayback snapshot. Its publisher RSS is
healthy and dated, so Sky News items are cited from the feed as `[prov:feed]` -
contribute them, do not drop them.

## Known stale or dead feeds - do not use

| Feed | Problem |
|---|---|
| People's Daily RSS (people.com.cn/rss/politics.xml) | newest item 2025-06-05 |
| Xinhua channel RSS (`news.cn/<channel>/news_<channel>.xml`) | returns HTTP 200 and valid XML for politics, fortune, tech, world, legal, mil, local, health, edu, house, energy and finance - but every channel is frozen at Dec 2022. pubDates are present and years old, so the window filter drops every item. Use HTML/web_fetch for Xinhua. |
| SCMP RSS (scmp.com/rss/91/feed, /rss/4/feed) | HTTP 301, no feed; use web_fetch (curl is 403) |
| Caixin RSS (caixin.com/rss/) | returns HTML, not a feed |
| Stooq CSV quotes | endpoint removed |
| Nikkei Asia RSS (asia.nikkei.com/rss/feed/nar) | RSS 1.0; item blocks carry title and link only, NO date - usable for discovery, but fetch the article for its timestamp |
| AP RSS (apnews.com/index.rss, /hub/*.rss) | 403 - use corroborated alt links instead |
| Reuters RSS (arc/outboundfeeds, feeds.reuters.com) | 404 / discontinued |
| WSJ RSS (feeds.a.dj.com) | items stale since Jan 2025 |
| FT RSS (ft.com/rss/home) | returns a single item; article pages 403 |
| RSSHub (rsshub.app) | 403 |

### Dated RSS pool

The deterministic collector (`scripts/fetch-feeds.mjs`) ships a broad Global
pool: **BBC** (world, business, technology, politics), **The Guardian** (same
four), **Al Jazeera**, **Bloomberg** (markets, economics, politics, technology),
**The New York Times** (World, Politics, Business, Technology), **NPR**, **DW**,
**France 24**, **CBC**, **Sky News** and **The Economist**; plus **Global Times**
under China, live and dated (the 2026-09-29 dry run returned 50 items from it,
every one clearing that run's window filter - one dated measurement, not a fixed
yield). SCMP and Nikkei RSS are unusable as dated feeds (above) - reach Nikkei
and SCMP with web_fetch. Add one-off feeds per run with `--feeds url1,url2`.

### China has no feed backbone

The China section's one configured direct feed - **Global Times, politics** - is
live and dated: in the 2026-09-29 dry run all its items cleared the window
filter, one day's count rather than a standing yield. One live feed is still not
a backbone, and no usable mainland RSS exists either: People's Daily and every
Xinhua channel are frozen (see the dead-feed table above), Caixin's RSS endpoint
returns HTML, and SCMP's redirects. Its coverage is therefore
**search-derived**: discover with
`web_search` against the Tier 1 Chinese outlets, read the page with
`scripts/fetch-page.mjs`, and cite what was actually verified. The cited outlet
set will vary from run to run; that is a property of the sources, not a
regression. Widen the China discovery queries across the aspect headings
(including 外交, 军事, 社会, 商业, 科技 and 香港) rather than leaning on one
outlet to fill seven aspects.

## Per-aspect search starters

Global: US politics and policy, EU and UK, Russia and Eastern Europe,
China-world relations, Japan and the Koreas, Middle East, international
institutions, global markets.

China: 时政, 宏观经济, 货币政策, 财政政策, 产业政策, 科技/AI, 社会民生, 国防军事,
外交, 香港, 台湾, 澳门, 值得关注的城市级新闻。

Hong Kong, Taiwan, Macau and city-level stories use the same Tier 1 outlets and
the same worth-noting bar as everything else: cover them when they carry real
significance, not as routine local coverage. They always belong in the China
section.

Prefer a specific query over a broad one, and prefer an outlet query (for
example "site:reuters.com" is useless here; use the Tier 1 domains) when you
need an authoritative hit.

## Market endpoints

| Purpose | Endpoint | Notes |
|---|---|---|
| Global equities, FX, commodities, 10Y UST | query1.finance.yahoo.com/v8/finance/chart/SYMBOL | keyless; returns price, change percent, timestamp |
| 10Y China govt bond | push2delay.eastmoney.com ulist (171.CN10Y) | the only non-Yahoo source wired into collect-markets.mjs |
| FX reference cross-check | api.frankfurter.app/latest?from=USD | probed and reachable, NOT implemented in collect-markets.mjs |
| Mainland A-share cross-check | qt.gtimg.cn/q=sh000001,sz399001 | probed and reachable, NOT implemented in collect-markets.mjs (A-share rows come from Yahoo) |

Yahoo symbol map lives in `scripts/collect-markets.mjs`. A symbol that fails is
reported as unavailable; never substitute a number from prose.
