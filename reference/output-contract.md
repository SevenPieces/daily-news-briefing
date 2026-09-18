# Output contract

## Files

| File | Role |
|---|---|
| briefing-YYYY-MM-DD.md | editable source, written by the agent |
| briefing-YYYY-MM-DD.html | the deliverable, produced by render-html.mjs |
| briefing-state.json | memory, written by update-state.mjs |

Deliver only the HTML. Keep the Markdown and state on disk.

## Markdown structure

    # Daily Briefing / 每日简报 - 2026-09-10
    _Asia/Shanghai - generated 2026-09-10 17:30 - Last briefing 2026-09-05 - covering latest 72h (2026-09-07 17:00 -> 2026-09-10 17:00) - 48h not covered_

    ## Top stories / 今日要闻
    - **Headline** - Summary. [src:BBC 2026-09-10 09:30](https://primary) #new

    ## Market snapshot / 市场快照
    | Market | Level | Chg | As of |
    |---|---|---|---|
    | S&P 500 | 7636.36 | -0.48% | 2026-09-10 04:03 |
    | 10Y US Treasury | 4.8370 | +3.1 bp | 2026-09-10 02:59 |

    ## Global
    ### Economy
    - **Headline** - Summary. [src:BBC 2026-09-10 09:30](https://primary) [alt:SCMP](https://secondary) #new

    ### Politics
    (quiet - no significant news today)

    ## China / 中国
    ### 经济
    - **标题** - 摘要。 [src:财新 2026-09-10 09:30](https://primary) #followup

    ## Watchlist / 持续关注
    - **Headline** - one line on what is unresolved. [src:...](...)

    ## Coverage note / 覆盖说明
    ...

    ## Sources / 来源
    - BBC - https://...
    - 财新 - https://...

## Story line grammar

Every story is exactly one Markdown list item:

    - **Headline** - Summary sentence(s). [src:OUTLET YYYY-MM-DD HH:MM](PRIMARY_URL) [alt:OUTLET2](SECONDARY_URL) #tag #tag

- The heading is bold and contains no links.
- The summary is one or two sentences in the section language.
- src carries the primary outlet and its publication time, and its link target
  is the primary URL.
- alt is optional and may repeat.
- Tags are space separated at the end: #new, #followup, #developing,
  #paywalled, #unverified.
- Never put more than one story in a list item, and never omit src.
- `[find:OUTLET](SEARCH_URL)` is an optional, clearly-labelled search fallback
  for a blocked wire outlet whose canonical URL could not be resolved. It renders
  as a dashed "search" badge.
- An optional provenance marker ends the line: `[prov:full]`, `[prov:feed]` or
  `[prov:link]`. It renders as a coloured dot, not as text.

## Provenance and read-original

| Marker | Meaning | Summary written from |
|---|---|---|
| `[prov:full]` | the article page was fetched | the article |
| `[prov:feed]` | the publisher's own RSS (page may be bot-blocked) | the feed's own description |
| `[prov:link]` | headline + link only (blocked wire, not fetched) | the corroborating primary |

The renderer makes every **headline a link** to its primary source and adds a
"原文 / Original ↗" link to any item tagged #paywalled or #unverified. Never
paraphrase locked body text: for #paywalled items use only the publisher's own
feed title/description.

## Market snapshot formatting

Label the change column `Chg`. Quote indices, FX and commodities as a percent
change (for example `-0.48%`) and quote yields as basis points from the
collector's `changeBp` field (for example `+3.1 bp`). Write `n/a` when a
source publishes no change.

Include every instrument the collector returns, in the collector order - never
hand-pick a subset, so the table does not vary from day to day. Close the table
with this note, quoted verbatim:

    (Values from the collector APIs, each row with its own as-of time in Asia/Shanghai. Yields are quoted in basis points: changeBp is the move in percentage points x 100.)

## Section rules

| Section | Language | Aspect headings |
|---|---|---|
| Global | English | Economy, Politics, Business, Tech, Foreign affairs, Military, Social |
| China | Chinese | 经济, 时政, 商业, 科技, 外交, 军事, 社会 |

Both sections use the same aspect order. Structural labels (Top stories, Market
snapshot, Watchlist, Coverage note, Sources) are bilingual. Cross-section
stories live in Global with a China-implications note. The China section covers the mainland plus Hong Kong, Taiwan and Macau, and includes city-level stories when they are worth noting. All Hong Kong, Taiwan and Macau stories belong in the China section, including those involving a foreign power, because they are parts of China.

## HTML features

render-html.mjs produces one self-contained file: inline CSS and JS, no external
requests. The header and content flow as a single page with no separate sticky
bar. It provides collapsible aspect sections, a dark theme with a print
stylesheet that forces light, per-item source badges showing outlet and time,
and a client-side search filter. The output must open correctly from file://
with no network.

## Renderer mapping

| Markdown | HTML |
|---|---|
| h1 and the following italic line | title block and metadata |
| h2 | top-level section heading |
| h3 | collapsible aspect block (details/summary) |
| story list item | card with headline, summary, badges, tags |
| pipe table | responsive table |
| quiet marker | subdued note block |
