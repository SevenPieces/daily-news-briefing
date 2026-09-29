# Output contract

## Files

| File | Role |
|---|---|
| briefing-YYYY-MM-DD.md | editable source, written by the agent |
| briefing-YYYY-MM-DD.html | the deliverable, produced by render-html.mjs |
| briefing-state.json | memory, written by update-state.mjs (plan records the window; update writes the state) |
| .markets.json | run artifact: the market collector's rows, kept in the output directory |
| .feeds.json | run artifact: the feed collector's output, kept in the output directory |
| .items.json | run artifact: the parsed item index, written by md-to-items.mjs, kept in the output directory |

Deliver only the HTML. Keep the Markdown, the state and the run artifacts
(`.markets.json`, `.feeds.json`, `.items.json`) on disk.

## Markdown structure

    # Daily Briefing / 每日简报 - 2026-09-10
    _Asia/Shanghai - generated 2026-09-10 17:30 - Last briefing 2026-09-05 - covering latest 72h (2026-09-07 17:00 -> 2026-09-10 17:00 Asia/Shanghai) - 48h not covered_

    ## Top stories / 今日要闻
    - **Headline** - Summary. [src:BBC 2026-09-10 09:30](https://primary) #new [prov:feed]

    ## Market snapshot / 市场快照
    | Market | Level | Chg | As of |
    |---|---|---|---|
    | S&P 500 | 7636.36 | -0.48% | 2026-09-10 04:03 |
    | 10Y US Treasury | 4.8370 | +3.1 bp | 2026-09-10 02:59 |

    ## Global
    ### Economy
    - **Headline** - Summary. [src:BBC 2026-09-10 09:30](https://primary) [alt:SCMP](https://secondary) #new [prov:feed]

    ### Politics
    (quiet - no significant news today)

    ## China / 中国
    ### 经济
    - **标题** - 摘要。 [src:财新 2026-09-10 09:30](https://primary) #followup [prov:full]

    ## Watchlist / 持续关注
    - **Headline** - one line on what is unresolved. [src:...](...) [prov:feed]

    ## Coverage note / 覆盖说明
    ...

    ## Sources / 来源
    - BBC - https://...
    - 财新 - https://...

## Story line grammar

Every story is exactly one Markdown list item:

    - **Headline** - Summary sentence(s). [src:OUTLET YYYY-MM-DD HH:MM](PRIMARY_URL) [alt:OUTLET2](SECONDARY_URL) #tag #tag [prov:MARKER]

- The heading is bold and contains no links.
- The summary is one or two sentences in the section language.
- src carries the primary outlet and its publication time, and its link target
  is the primary URL.
- alt is optional: use one whenever a credible second outlet corroborates the
  same event - check that page's own title, not a search snippet - at most
  three, never padding.
- Tags are space separated at the end: #new, #followup, #developing,
  #paywalled, #unverified. `#developing` means the story is still unfolding,
  not that the run is tracking it. `#unverified` marks a wire cited without a
  fetchable primary; a publisher's own dated RSS item is itself a primary, so a
  line carried from it is never `#unverified`.
- Never put more than one story in a list item, and never omit src.
- `[find:OUTLET](SEARCH_URL)` is a clearly-labelled search fallback for a
  blocked wire outlet whose canonical URL could not be resolved. It renders as a
  dashed "search" badge, never replaces the mandatory `[src:]`, and a search URL
  is never a primary link.
- That is the one case where `[src:]` does not point at a primary URL: it still
  carries the wire outlet and its publication time, its link target is the same
  search URL, the line is tagged `#unverified`, and
  `[find:OUTLET](SEARCH_URL)` repeats that URL so the badge says search rather
  than article:
  `[src:Reuters 2026-09-10 09:30](https://www.google.com/search?q=HEADLINE) #unverified [find:Reuters](https://www.google.com/search?q=HEADLINE) [prov:link]`
- A URL containing `)` is truncated at the first `)` by both `md-to-items.mjs` and
  `render-html.mjs`, so the index stays faithful to the delivered link; prefer a
  primary URL without parentheses.
- A provenance marker is **required** and is the final token on the line:
  `[prov:full]`, `[prov:feed]` or `[prov:link]`, exactly one per story. Trailing
  `#tags` after the marker are also accepted. It renders as a coloured dot, not
  as text. `scripts/check-provenance.mjs` enforces this and exits non-zero when a
  story has no marker, more than one, or a marker that is not the last token.
  The gate also requires a source reference - a `[src:...]` link - on every
  story line. Passing it is necessary, not sufficient, for the state index: a
  line reaches the index only when it also sits under a recognised section
  heading and yields a title, so a bullet under an unrecognised heading, or one
  that carries a source reference but no title, passes the gate and is not
  indexed.

## Classification, headlines and the watchlist

- **New versus follow-up is the agent's classification.** `briefing-state.json`
  holds the item titles of the last seven days and derives nothing; the agent
  reads that index and decides whether a story is `#new` or `#followup`.
  `scripts/update-state.mjs` never writes either flag.
- **Cite the publisher's headline verbatim.** Do not reword, translate or trim
  it. The headline is evidence, and a reworded one no longer matches what the
  reader finds at the link.
- **Tag placement.** `#tags` normally precede `[prov:*]`. Trailing tags after
  the marker are also accepted by the provenance gate, so both of these pass:

      - **Headline** - Summary. [src:BBC 2026-09-10 09:30](https://primary) #new [prov:feed]
      - **Headline** - Summary. [src:BBC 2026-09-10 09:30](https://primary) [prov:feed] #new

- **A watchlist entry is an unresolved developing story that also has a new
  development inside the window.** A briefing lists a watchlist title only when
  it moved inside the window; retention in the state's watchlist is not a report
  (see `reference/state-schema.md`). A story with no movement in this run does
  not appear; older background is omitted, not smuggled in. A Watchlist line
  uses the language of the story's own reporting - English for a Global outlet,
  Chinese for a Chinese one - while the section label stays bilingual.

## Provenance and read-original

| Marker | Meaning | Summary written from |
|---|---|---|
| `[prov:full]` | the cited page's own article body was obtained | the page's own article body |
| `[prov:feed]` | the publisher's own RSS description (the page may be blocked) | the feed's own description |
| `[prov:link]` | no article body was obtained from the cited URL, for any reason | a corroborating primary when one exists, otherwise the headline alone |

Reasons for `[prov:link]`: a blocked wire, a 402 licensing gate, or an HTTP 200
that returned only masthead and navigation. The marker names where the summary's
words came from; it never means an HTTP request succeeded. Keep exactly three
markers - never invent a fourth.

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

Stale as-of times are normal: a weekend or exchange-holiday close, or a pre-open
value, carries the last published time rather than the current one. Explain each
one in the coverage note. The table shape stays exactly as specified above - no
row is dropped, re-timed or hand-picked.

## Section rules

| Section | Language | Aspect headings |
|---|---|---|
| Global | English | Economy, Politics, Business, Tech, Foreign affairs, Military, Social |
| China | Chinese | 经济, 时政, 商业, 科技, 外交, 军事, 社会 |

A China line is written from the Chinese-language page. A Chinese outlet's
foreign-language edition (`jp.news.cn`, `en.news.cn` and the like) is not the
China source, however directly it carries the story.

Both sections use the same aspect order. Structural labels (Top stories, Market
snapshot, Watchlist, Coverage note, Sources) are bilingual. The China section covers the mainland plus Hong Kong, Taiwan and Macau, and includes city-level stories when they are worth noting. All Hong Kong, Taiwan and Macau stories belong in the China section, including those involving a foreign power, because they are parts of China. This rule takes precedence over the placement tie-break below: a story **about** Hong Kong, Taiwan or Macau belongs to the China section wherever the event happens, so the place-of-event test decides only the cross-border stories this rule does not already assign (for example, US-China trade decided in Washington stays in Global).

**Placement tie-break.** The place the event happens decides the section. A
Global outlet covering a China-subject policy story whose decision is made
outside China stays in Global; a cross-border story whose event happens in China
belongs to the China section; either way a cross-border story carries a
China-implications note. Disclose the call in the coverage note, so a reader can
see why a story sits where it does.

## Coverage note

The coverage note has a **fixed part** and a **variable part**. The fixed part
must contain the items below. Provenance counts are per story line, so they
equal the number of stories in the briefing when no story line is repeated.

- the header window **verbatim** - the parenthesised window in the metadata line
  is copied character for character, with the same dates, times and zone. That
  window is a string, not a sentence: the note may state it inside a sentence of
  its own if the string itself is unchanged;
- the item provenance counts - how many story lines came from each of full,
  feed and link. Count them from the Markdown you just wrote and confirm them
  against `scripts/check-provenance.mjs`'s output before `update`: `.items.json`
  carries no provenance split, and the gate can only read a note that is already
  in the file. If the two disagree, correct the note and re-run `md-to-items`
  and both gates - safe only while `update` has not run. Count story lines, not
  distinct stories: a line printed twice -
  a Top story that is also shown in its aspect - is counted twice, and a
  Watchlist entry is a story line for these counts even though it is an
  unresolved developing story. Repeating a story is the writer's choice, never a
  requirement, so never duplicate a story to move the counts;
- the fetch count - how many distinct **article-page** fetches the run made (one
  per URL, however many HTTP requests the retries cost), against the 20-30
  target, which stays guidance and not a gate. The deterministic collectors'
  polls - the feed URLs in `.feeds.json` and the market instruments in
  `.markets.json` - are not article-page fetches and are not part of this count;
- the section-placement disclosure - any call made under the tie-break above;
- the quiet aspects - every aspect with no significant news, named rather than
  silently omitted;
- the stale-data explanation - any market row whose as-of time is older than the
  run, and why.

The two gates count different things: `scripts/check-diversity.mjs` counts only
the `## Global` and `## China` story lines, so its per-section figures leave out
the Top stories and the Watchlist, while `scripts/check-provenance.mjs` counts
every story line - Top stories, both sections and the Watchlist - plus
story-shaped bullets in the preamble and in sections it does not recognise, so
in practice its figure is the larger of the two. Not always: provenance counts
a line only when it starts with `- `, while diversity also matches an indented
bullet, so an indented story line can make diversity exceed provenance. A Top
story repeated in its aspect is counted twice by `check-provenance.mjs`, while
`check-diversity.mjs` sees only the aspect copy, because it counts just the
`## Global` and `## China` lines. The provenance counts
above are story lines - the figure the coverage note follows - and so agree
with `check-provenance.mjs`.

The variable part is free: add anything else the run judges worth noting (a
capped window, a licence gate that blocked a wire, two reports in conflict). Keep
it short and plain.

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
