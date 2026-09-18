---
name: daily-news-briefing
description: Produce a dated two-section news briefing, Global (English) and China including Greater China (Chinese), across seven aspects, with fetch-verified sources, keyless-API market data, new-vs-follow-up tracking, and a self-contained HTML deliverable. Use for daily briefing, news briefing, what happened today, global and China news, or catching up after missed days.
whenToUse: Any request for a daily news briefing or a Global + China news digest, including a run for a specific date or a catch-up run after several missed days. Not for single-topic research or travel planning.
---

# Daily News Briefing

Produce one dated briefing with two sections, **Global** (English) and **China**
(Chinese), each organized into the same seven aspects, and deliver it
as a single self-contained HTML file plus its Markdown source. Every item must
trace to a real source. Nothing is invented, estimated, or padded.

Read `reference/sources.md` before collecting, `reference/output-contract.md`
before writing, and `reference/state-schema.md` before touching state.

## 1. Inputs and configuration

| Key | Default |
|---|---|
| Output directory | $BRIEFING_DIR, else ./briefings under the working directory |
| Timezone | Asia/Shanghai |
| Sections | Global, China |
| Aspects | Economy, Politics, Business, Tech, Foreign affairs, Military, Social |
| Global scope | Major powers: US, EU/UK, Russia and Eastern Europe, China-world relations, Japan and the Koreas, Middle East, international institutions |
| China scope | Mainland national, plus Hong Kong, Taiwan and Macau, and city-level stories when they are genuinely worth noting |
| Volume | 20-25 items total, allocated by importance; empty aspects are omitted |
| Budget | 20-30 fetches, about 3-5 minutes |

## 2. Coverage window (never ask)

Compute the window deterministically with the state script before collecting:

- Previous briefing exists: from its timestamp to now, **capped at the most
  recent 72 hours**.
- No previous briefing: the latest **24 hours**.
- **Never ask the user which window to use.** The rule is identical in every
  run, interactive or not.
- The header always prints the real coverage window, for example:
  `Last briefing 2026-09-05 - covering latest 72h (2026-09-07 17:00 -> 2026-09-10 17:00 Asia/Shanghai) - 48h not covered`.
  The label's times are Asia/Shanghai (the header declares that zone), so the
  coverage note can quote them verbatim.
- When the 72h cap bites, say how much was skipped in the coverage note.
- A 72h window can span three days; keep the 20-25 item target and allocate by importance.
- Watchlist items appear only when they have a new development inside the
  window. Older background is omitted, not smuggled in.

## 3. Sources and the authenticity gate

Two tiers, with the full registry in `reference/sources.md` and the probe
evidence in `reference/feasibility.md`:

- **Fetch-verified primaries**: BBC, SCMP, The Guardian, Al Jazeera, Nikkei
  Asia, Xinhua (news.cn), gov.cn, National Bureau of Statistics, PBoC, Caixin,
  Yicai, The Paper, CLS, STCN.
- **Discovery-only or blocked originals**: Reuters, AP, FT, Bloomberg, WSJ
  return 401/403 to automated fetch. Include such a story only when it is
  corroborated, keep the original link so the user can open it manually, and
  tag it unverified.

Hard rules:

1. Every item has a primary link and a publication timestamp inside the window.
2. Aggregator-only items are dropped. Google News, Baidu News and Weibo hot
   search are discovery surfaces, never the cited primary.
3. Paywalled items show headline plus link only, tagged paywalled. Never
   paraphrase locked content.
4. Conflicting reports are shown side by side; do not silently pick a winner.
5. Developing or unconfirmed stories are labelled as such.
6. Market numbers come only from the collector APIs, each with its as-of time.
   A missing instrument is marked unavailable, never estimated from prose.
7. No filler. An aspect with no real news is omitted and noted as quiet.
8. **Publisher feeds are primaries.** An item from an outlet's own RSS feed (its
   domain, with a per-item pubDate) is a dated primary: cite link + time, write
   the summary from the feed's own description, and never paraphrase locked body
   text. Tag subscription outlets #paywalled. Mark provenance with `[prov:full]`
   (article fetched), `[prov:feed]` (publisher RSS) or `[prov:link]`
   (headline + link only).
9. **Blocked wire copy is an alt, not a primary.** AP, Reuters, FT and WSJ cannot
   be fetched and have no working RSS: include them as a corroborated
   `[alt:AP](url)` link, tagged #unverified only when no fetchable primary
   corroborates the story. Never invent or paraphrase beyond what is corroborated.

## 4. Workflow

### Step 1 - Resolve paths

~~~sh
if [ -n "$BRIEFING_DIR" ]; then OUT="$BRIEFING_DIR"; else OUT="$PWD/briefings"; fi
mkdir -p "$OUT"
SKILL="${DSH_HOME:-$HOME/.dsh}/skills/daily-news-briefing"
DATE=$(date +%F)
~~~

### Step 2 - Compute the window

~~~sh
node "$SKILL/scripts/update-state.mjs" plan --state "$OUT/briefing-state.json"
~~~

It prints JSON containing since, until, hours, capped, previousBriefingAt and a
one-line label. Use those values verbatim in the header and coverage note.

### Step 3 - Collect deterministically, in parallel

~~~sh
node "$SKILL/scripts/collect-markets.mjs" --out "$OUT/.markets.json"
node "$SKILL/scripts/fetch-feeds.mjs" --since <SINCE> --out "$OUT/.feeds.json"
~~~

Markets come from Yahoo Finance (keyless), with Eastmoney as the
cross-check for the China 10-year bond row. The feed collector returns publisher feeds (dated, with a
description - usable as primaries) and Google News items (discovery only: their
links do not resolve to publishers, so confirm those through a fetch-verified
primary).

### Step 4 - Research both sections

Use web_search for discovery and web_fetch to read candidate articles. Cover
both sections across all seven aspects, respecting the budget. Fan out with
subagents if it helps, but each item must end with a fetched, date-stamped
primary: a fetched article, a publisher's own RSS item, or - for blocked wire
copy - a corroborating primary with the wire as an alt. Capture, per item:
section, aspect, headline, 1-2 sentence summary in the section language, primary
outlet, primary URL, published time, optional secondary URL, provenance
(full | feed | link), and flags (new, followup, developing, paywalled,
unverified).

### Step 4b - Resolve wire headlines to publisher URLs

For a blocked wire story (AP, Reuters, FT, WSJ), recover its canonical URL with a
site-restricted search - for example `<exact headline> site:apnews.com` or
`<exact headline> site:reuters.com`. This returns `apnews.com/article/...` /
`reuters.com/...` links even though the page itself is 401/403. Cite the
canonical URL as an `[alt:AP](url)` (or `[alt:Reuters](url)`) link; use it as
the src tagged #unverified only when no fetchable primary corroborates the
story. Google News item links never resolve to the publisher, so never cite them.

Before giving up on a blocked wire URL, try one archive read:
`https://web.archive.org/web/2/<url>` (or the availability API
`https://archive.org/wayback/available?url=<url>`). If a snapshot exists, verify
the story from it and still cite the original publisher URL, tagged #unverified.
Same-day stories usually have no snapshot yet. If no canonical URL can be found
at all, add a clearly-labelled search fallback instead of omitting the story:
`[find:AP](https://www.google.com/search?q=<headline>+site:apnews.com)`.

### Step 5 - Deduplicate, classify, select

Drop aggregator-only items. Drop anything published outside the window. Merge
duplicate coverage of one event into a single item and keep the strongest two
outlets. Rank items by importance within each aspect. Select the 3-5 Top
Stories by cross-source prominence. All Hong Kong, Taiwan and Macau stories
belong in the China section, because they are parts of China; this holds even
when a foreign power is involved. Other cross-section stories (US-China trade,
chips) live in Global with a China-implications note.

### Step 6 - Write Markdown, render, update state

Write "$OUT/briefing-$DATE.md" in the exact structure in
`reference/output-contract.md`, then:

~~~sh
node "$SKILL/scripts/update-state.mjs" update --state "$OUT/briefing-state.json" --items "$OUT/.items.json" --out "$OUT/briefing-state.json" --date "$DATE"
node "$SKILL/scripts/check-diversity.mjs" "$OUT/briefing-$DATE.md"   # must print DIVERSITY: OK
node "$SKILL/scripts/render-html.mjs" "$OUT/briefing-$DATE.md" --out "$OUT/briefing-$DATE.html"
~~~

### Step 7 - Deliver

Present the HTML file, and summarize the same content in chat (never only a
link). Keep the Markdown and state JSON on disk but deliver only the HTML.

## 5. Output contract

The full grammar is in `reference/output-contract.md`. In short: a title, a
metadata line with the window label, then Top stories, Market snapshot, the two
aspect sections, Watchlist, Coverage note and Sources. Each story is one line:

    - **Headline** - Summary. [src:OUTLET 2026-09-10 09:30](https://primary) [alt:OUTLET2](https://secondary) #new

Tags: #new, #followup, #developing, #paywalled, #unverified. Global content is
English; China content is Chinese. Structural labels are bilingual.

## 6. Quality gate

- Window matches the rule: previous briefing to now, capped at 72h; 24h when
  there is no previous briefing; no question was asked.
- Every item has a primary link and an in-window publication time.
- No aggregator-only item; no paywalled paraphrase.
- Blocked wire stories carry a canonical publisher URL (resolved by site search),
  cited as an `[alt:...]` link, not a Google News redirect.
- Market rows cover every instrument the collector returned, in its order, each with an as-of time; yield rows use basis points (changeBp); unavailable instruments are labelled.
- Top stories are the 3-5 most corroborated items.
- Every story carries a provenance marker: `[prov:full]` only for pages actually
  fetched, `[prov:feed]` for publisher RSS, `[prov:link]` for headline+link
  only. #paywalled items carry the publisher's own feed abstract, never
  paraphrased locked text.
- Source diversity: neither section may rest on a single outlet. Run
  `node "$SKILL/scripts/check-diversity.mjs" "$OUT/briefing-$DATE.md"` after
  writing the Markdown; it exits non-zero when a section's primaries are all one
  outlet and flags single-outlet aspects. Fix using the outlets in
  `reference/sources.md` before rendering. A section written from one feed is a
  failed briefing, not a stylistic choice. When an aspect carries two or more
  items, prefer at least two outlets; a single-outlet aspect stays a note, so
  rebalance it where a credible second outlet exists rather than dropping the
  story.
- The coverage note repeats the header window **verbatim** (same dates and times
  in Asia/Shanghai as the label in parentheses), so the header and the note can
  never disagree about the window.
- Quiet aspects are noted; nothing is padded to hit the item count.
- The HTML is self-contained: header and content flow as one page with no
  separate sticky bar, plus collapsible aspects, dark theme, print styles,
  source badges and a working search box.
- The chat reply summarizes the briefing, not just the path.

## 7. Example

`examples/sample-briefing.md` and its rendered `examples/sample-briefing.html`
show the exact format. They are illustrative and clearly labelled as such; never
copy their placeholder stories into a real briefing.
