# Source registry

Probe evidence for every claim here is recorded in `feasibility.md`. Re-probe
before promoting a new outlet to Tier 1.

## Tier 1 - fetch-verified primaries

These pages were fetched successfully (HTTP 200 with usable
content) and may be cited as the primary link.

| Label | Domain | Section | Notes |
|---|---|---|---|
| BBC | bbc.com, bbc.co.uk | Global | RSS works and carries pubDate |
| The Guardian | theguardian.com | Global | article pages answer HTTP 200 but the 1500-character excerpt is chrome only (5 of 5 fetches, printed textLength 7330-9675, 2026-09-30), so a Guardian item is `[prov:feed]` from the Guardian's own RSS unless the body is obtained another way |
| Al Jazeera | aljazeera.com | Global | |
| Nikkei Asia | asia.nikkei.com | Global, Business | |
| SCMP | scmp.com | China, Global | curl is 403 but web_fetch is 200; use web_fetch |
| 新华网 | news.cn | China | (Xinhua) RSS is stale, use HTML; article pages answer 200 with a date-only `<meta name="publishdate">`, so `publishedAt` must come from a dated element in the body (probe 2026-09-30) |
| 央广网 | cnr.cn | China | (CNR) article pages answer 200 with a date-only `<meta name="publishdate">`, so `publishedAt` must come from a dated element in the body (probe 2026-09-30) |
| 中国政府网 | gov.cn | China | (State Council) cited under this label on three days (2026-10-02, 2026-10-03, 2026-10-06) from both `https://` and `http://` article URLs |
| 国家统计局 | stats.gov.cn | China, Economy | (NBS) |
| 中国人民银行 | pbc.gov.cn | China, Economy | (PBoC) use https, not http |
| 财新 | caixin.com | China, Economy | (Caixin) partly paywalled |
| 第一财经 | yicai.com | China, Business | (Yicai) cited under this label (2026-10-06) |
| 澎湃新闻 | thepaper.cn | China, Social | (The Paper) cited under this label (2026-10-02); also the page that carries a ministry release when the ministry site itself has no fetchable in-window page (2026-10-02) |
| 财联社 | cls.cn | China, Economy | (CLS) fast wire |
| 证券时报 | stcn.com | China, Business | (STCN) cited under this label (2026-10-01, 2026-10-02) |
| 光明网 | gmw.cn, politics.gmw.cn, m.gmw.cn | China | (Guangming) curl 200; homepage is a live dated index; no RSS; article pages answer 200 (re-probe 2026-09-30: 32294 bytes, textLength 5555) and their own `meta:publishdate` is date-only, so the clock time has to come from the body - `fetch-page.mjs` reads the body's dated stamp and prints `dateSource: body:text` with `publishedAt: "2026-09-18 11:15"` (the body carries `2026-09-18 11:15`), which is the only clock time the page offers |
| 香港政府新闻网 | news.gov.hk | China (Hong Kong) | (HK Government News) curl 200; static dated article pages are the primary; no fetchable RSS and no static dated index - discover via web_search (probe 2026-09-18) |
| 中华人民共和国国防部 | mod.gov.cn | China, Military | (MND) **http only** - the https form fails to connect (`status 0`), so always fetch `http://`; article pages answer 200 with a date-only `meta:publishdate`, so `publishedAt` must come from a dated element; the registry's primary for the 军事 aspect (probe 2026-09-30) |
| 外交部 | fmprc.gov.cn | China, Foreign affairs | (MOFA) an article page answered HTTP 200 on its first attempt (run gate note, 2026-10-01); no fetchable in-window page carried the 2026-10-02 release, which that run cited at a 澎湃新闻 URL (2026-10-02) |
| 国务院台办 | gwytb.gov.cn | China, Taiwan | (Taiwan Affairs Office) an article page answered HTTP 200 on its first attempt (run gate note, 2026-10-01) |
| 中国军网 | 81.cn, www.81.mil.cn | China, Military | (China Military Online) the cited article was fetched over `http://` (2026-10-02), as with MND above; the https form is unverified |
| 经济日报 | jingjiribao.cn | China, Economy | (Economic Daily) cited `[prov:full]` over `http://` (2026-10-02); the https form is unverified |
| 中国经济网 | ce.cn | China, Economy | (China Economic Net) cited `[prov:full]` (2026-10-02); a 新华财经早报 front page carries only a date-only field and was dropped as unplaceable (2026-10-02) |
| 上海证券报 | cnstock.com | China, Business | (Shanghai Securities News) cited `[prov:full]` (2026-10-02) |

**One outlet, one label.** `check-diversity.mjs` compares the `[src:]` label as a
raw string, so a story line prints the `Label` cell of the row it cites, character
for character - never the English name in the notes, never the variant the page
itself shows. A Chinese state or mainland row labels in Chinese (`新华网` for
news.cn, `中国政府网` for gov.cn, `中国人民银行` for pbc.gov.cn, `第一财经` for
yicai.com, `澎湃新闻` for thepaper.cn); a row labelled in English (`SCMP`) is cited
in English. Xinhua shows the cost of a second spelling: the page's own source line
reads 新华网 or 新华社 and the wire is also called Xinhua, so three spellings of one
publisher would count as three outlets and hide a section that really does rest on
one.

**A publisher with no row still has one label.** The rule above assumes a row
exists; this is what to do when it does not. Print the publisher's own name as the
cited page prints it, in the section's language - the name in the page's own
masthead or source line, not a wire's English name and not a spelling the page
does not carry - and use that same string every time the publisher appears in the
run. No row is needed for the run to be correct, and no run edits this file: a
newly seen publisher is named in the run's own artifacts (its run report, and the
coverage note's variable part when the publisher bears on coverage), and the row
is added here by a maintainer commit when the publisher recurs or matters. That
keeps this registry a curated, evidence-based list rather than something a run
rewrites, and keeps a run from having to guess.

Two outlets the runtime session saw but never cited as a `[src:]` primary, listed
here only so their label is fixed before a run needs it - neither has been probed,
and neither is a fetch-verification claim:

| Label | Domain | Section | Notes |
|---|---|---|---|
| 央视网 | cctv.com | China | (CCTV) seen as an `[alt:]` link on 2026-10-03; not yet cited as a primary and not probed |
| 环球时报 | globaltimes.cn | China, Foreign affairs | (Global Times) named in this document's feed prose; not yet cited as a primary and not probed |

## Publisher RSS primaries (dated, citable)

These outlets' article pages are bot-blocked, but their **own RSS feeds** are
fetchable, dated, and carry the publisher's title, link and description. An item
from a publisher feed is a valid primary: cite link + pubDate, write the summary
from the feed's own description, and never paraphrase locked body text. Tag
subscription outlets #paywalled.

| Label | Feeds | Note |
|---|---|---|
| Bloomberg | markets, economics, politics, technology (`feeds.bloomberg.com/<section>/news.rss`) | subscription; #paywalled |
| The New York Times | World, Politics, Business, Technology (`rss.nytimes.com/services/xml/rss/nyt/*.xml`) | article pages returned a hard HTTP 403 on every profile and both transports (8 attempts, 2026-09-30), a blocked wire's shape rather than a meter; its items come from NYT's own RSS as `[prov:feed]` - the blocked-wire treatment (AP/Reuters/FT/WSJ) minus the alt-link rule, since NYT publishes its own RSS; #paywalled |
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
a browser User-Agent is NOT automatically the better one. Measured 2026-09-25
and re-probed 2026-09-30, on live article pages:

| Outlet | plain curl (default UA) | curl + browser UA | harness fetch | behaviour |
|---|---|---|---|---|
| France 24 | 200 | 403 | 200 or 404 | 200 with the DEFAULT User-Agent and `datePublished` on 2026-09-25, but the browser profile answered 200 on the FIRST attempt on 2026-09-30 (textLength 4223, `datePublished`) - the profile outcome is not stable, so try the profiles rather than assuming one |

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
`title` with `titleSource` naming the markup it came from - `ogTitle`, `h1` and
`h1s` (up to five headings in document order) are printed beside it, so a page
whose first heading is navigation chrome is visible rather than silent -
`publishedAt` - the page's own string, with any explicit zone kept
intact (`2026-09-30T05:00:05.479Z` stays a UTC stamp, so convert it to
Asia/Shanghai as `reference/research-input.md` requires; a value with no zone is
the page's own local time) - `dateSource` with `dateOnly` true when that field
carries no clock time, `charset`, `bytes`, `textLength`, plus
`garbled` when the decoded text still carries replacement characters,
`textTruncated` when `--text` cut the excerpt, `dateRejected` for the date
fields it saw and refused, and `maxBody` for the cap in effect - and
`error` instead of the content fields when a URL could not be fetched. `--text`
adds the stripped page text; `--out FILE` writes the JSON to a file. The top
level also carries `rounds`, `profiles` and `maxBody`. It exits 0 only when every URL was
fetched, 1 when any failed, and 2 on a usage error or an unreadable file.

- **Pass `--text` to read an article's body.** It is the flag that returns the
  page text, truncated at 1500 characters, while the `textLength` the tool
  prints either way is the full stripped length of the page, not the length of
  the excerpt; a record whose summary needs the body must be read with
  `--text`.
- **Vary the profile before concluding "blocked".** One failed attempt is
  evidence of nothing - but a 402 from a licensing gate is an answer, not a
  challenge.
- **A body over the cap is refused, not truncated, and never retried.** The cap
  is 64 MiB; `--max-body BYTES` (or `FETCH_PAGE_MAX_BODY`) moves it. A declared
  length over it is refused before a byte of the body is read, and a chunked body
  is stopped as the running total passes it, so the attempt costs at most the cap.
  The refusal is terminal: the first attempt settles it, because a body size is a
  property of the resource, not of the profile or the transport.
- **Prefer `datePublished` over `dateModified`.** That is why `dateSource` is
  reported: a bare modification time is later than publication and can silently
  move an item across the coverage window. A modification time alone is not a
  publication time - see "Reused URLs" below for when a modified page is still
  in-window. `dateSource` is whatever label the tool printed, copied character
  for character, and the set is closed: `datePublished`, `dateModified`,
  `article:published_time`, `itemprop:datePublished`, `meta:date-published`,
  `meta:publishdate`, `meta:firstpublishedtime`, `meta:lastmodifiedtime`,
  `meta:date`, `time[datetime]`, `body:text`, or `null` for a page that carried
  no recognised date field. When the label is neither `datePublished` nor
  `dateModified`, the label alone cannot settle an in-window update: the
  reused-URL check needs its own look at the page.
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
An archive read is best effort only, for an older wire story, and is often
unavailable: `https://web.archive.org/web/2/<url>` answered 403 on all four
attempts (2 header profiles x 2 transports) and
`https://archive.org/wayback/available?url=<url>` answered 429 when probed on
2026-09-30, and same-day stories are usually not archived. A refusal is
not evidence that no snapshot exists, and no snapshot is promised. When the read
fails - or finds nothing - fall through to the canonical publisher URL as an
`[alt:AP](url)` link, and to a
`[find:AP](https://www.google.com/search?q=<headline>+site:apnews.com)` search
fallback when no canonical URL can be found either.

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
under China, live but with an in-window yield that varies: all 50 raw items it
returned cleared the window filter in the 2026-09-29 dry run, and none did in
the production run later that evening, so its item dates cannot be relied
on. SCMP and Nikkei RSS are unusable as dated feeds (above) - reach Nikkei
and SCMP with web_fetch. Add one-off feeds per run with
`--feeds url1,url2`.

### What the feed collector emits

`scripts/fetch-feeds.mjs` emits discovery rows, one per feed item, in this
shape:

| Field | Meaning |
|---|---|
| title | the feed's own item title |
| link | the item URL |
| outlet | the feed's outlet, else the item's own `source`, else the feed's own `title` |
| section | global or china, from the feed's configuration; empty for a one-off `--feeds` URL |
| aspect | the collector's own coarse section slug - not a contract aspect (below); empty for a one-off `--feeds` URL |
| publishedAt | the feed's `pubDate`, `published`, `updated` or `dc:date`, or null |
| summary | a feed row's description, HTML stripped and capped at 400 characters, or null - the publisher's own words on a publisher feed, the aggregator's own snippet on a Google News row |
| discoveryOnly | true when the link is a Google or Bing redirect that never resolves to the publisher, so the row needs a primary fetch |

`discoveryOnly` is keyed off the link, so a redirect row is never cited as a
primary even when its outlet looks like a publisher.

The top level also carries one `feeds` record per configured or `--feeds` URL, so
a run that lost a source can be audited after the fact:

| Field | Meaning |
|---|---|
| url | the feed URL as configured, or as passed to `--feeds` |
| outlet, section | the feed's configuration; empty for a one-off `--feeds` URL |
| status | `ok` when the feed was fetched and items were parsed, `error` otherwise |
| count | items parsed from that feed (0 on error) |
| error | the failure message - `no items parsed`, or `HTTP <status> <statusText> for <url>` - empty on success |

A non-2xx response is an error, not content: the status goes in `error` and the
body is never parsed as a feed. A feed that is not UTF-8 is decoded as gb18030
before latin1, so a GBK feed does not arrive as mojibake. When every feed in
`feeds` is an error, the collector writes one
`fetch-feeds: all N feeds failed; itemCount M` line to stderr and exits 1; a
partial success exits 0 and leaves the audit to the `feeds` records.

The collector's `aspect` values are its own coarse section slugs, set per feed
or per discovery query - `foreign`, `economy`, `politics`, `tech`,
`business`, `social` and `military` - and they are **not** the contract's
seven aspect headings. They are lowercase slugs that bucket a whole feed: every
BBC world item is `foreign`, whether the story is Foreign affairs, Military or
Social. Treat `aspect` as a discovery hint only - re-derive the aspect from the
story, and never copy the slug into a story record or into the briefing.

### China has no feed backbone

The China section's one configured direct feed - **Global Times, politics** - is
live, but its in-window yield varies: all 50 raw items cleared the window filter
in the 2026-09-29 dry run and none did in the production run later that
evening, so its item dates cannot be relied on. One live feed is still not
a backbone, and no usable mainland RSS exists either: People's Daily and
every Xinhua channel are frozen (see the dead-feed table above), Caixin's RSS
endpoint returns HTML, and SCMP's redirects. Its coverage is therefore
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
