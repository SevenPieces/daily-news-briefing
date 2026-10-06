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
| .fetch-ledger.json | run artifact: every article-page URL the run fetched, with the per-agent split and the union, written by the agent (reference/research-input.md), kept in the output directory. It also records the blocked-wire resolutions and the archive attempts as `blockedWireResolutions` and `archiveAttempts`; an empty array is the shape when the run probed nothing - never omitted, never null |

Deliver only the HTML. Keep the Markdown, the state and the run artifacts
(`.markets.json`, `.feeds.json`, `.items.json`, `.fetch-ledger.json`) on disk.

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

A quiet aspect carries no stories. Its heading is followed by the marker, and
nothing else: `(quiet - no significant news today)` under `## Global`,
`(无重大新闻)` under `## China / 中国`. The marker is written in the section's own
language. The renderer treats any paragraph opening with a bracket as the quiet
block, so the marker is what marks it; a run has written
`(quiet - 今日无重要新闻)`, which mixes the two languages and is not the form.

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
- Strip tracking query strings from a cited URL - the `?at_medium=RSS` a feed
  appends is not part of the address - and keep the parameters the URL needs to
  resolve at all, as a search URL does. Strip to the publisher's own canonical
  form, never to a different page.
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
  reader finds at the link; a Watchlist line's "what is unresolved" is the
  summary that follows the verbatim headline, never a rewording of the headline
  itself.
- **Tag placement.** `#tags` normally precede `[prov:*]`. Trailing tags after
  the marker are also accepted by the provenance gate, so both of these pass:

      - **Headline** - Summary. [src:BBC 2026-09-10 09:30](https://primary) #new [prov:feed]
      - **Headline** - Summary. [src:BBC 2026-09-10 09:30](https://primary) [prov:feed] #new

- **A watchlist entry is an unresolved developing story that also has a new
  development inside the window.** A briefing lists a watchlist title only when
  it moved inside the window; retention in the state's watchlist is not a report
  (see `reference/state-schema.md`). A story with no movement in this run does
  not appear; older background is omitted, not smuggled in. Hong Kong, Taiwan and
  Macau material goes to the China section wherever it sits, so a Watchlist
  entry about Greater China is not a placement exception. A Watchlist line
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

`[prov:full]` rests on the text `--text` returned, and that excerpt is capped at
1500 characters while `textLength` reports the full stripped length: "the page's
own article body was obtained" means the body was reached and read as far as the
cap, not that every word of it was read. A summary drawn from inside the excerpt
is still `[prov:full]`; a summary that needs the part beyond it is not, because
those words did not come from the cited page's own body as read.

The renderer makes every **headline a link** to its primary source and adds a
"原文 / Original ↗" link to any item tagged #paywalled or #unverified. Never
paraphrase locked body text: for #paywalled items use only the publisher's own
feed title/description. When the feed carries no description for that item - a
Bloomberg row on 2026-10-02 had none - the title alone is the summary: keep the
tag, and disclose headline-only in the coverage note.

## Market snapshot formatting

Label the change column `Chg`. Quote indices, FX and commodities as a percent
change (for example `-0.48%`) and quote yields as basis points from the
collector's `changeBp` field (for example `+3.1 bp`). Write `n/a` when a
source publishes no change.

Include every instrument the collector returns, in the collector order - never
hand-pick a subset, so the table does not vary from day to day. The Market cell
is the collector's own label verbatim, never a house-styled or shortened one.
Close the table with this note, quoted verbatim:

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
snapshot, Watchlist, Coverage note, Sources) are bilingual. The China section covers the mainland plus Hong Kong, Taiwan and Macau, and includes city-level stories when they are worth noting. All Hong Kong, Taiwan and Macau stories belong in the China section, including those involving a foreign power, because they are parts of China. A republication of the same originating body
does not count as a second outlet - a 央广网 page reprinting 央视新闻 is one
outlet, not two - because it corroborates nothing the page's own producer did
not publish, and labelling it otherwise is the relabel the story grammar
forbids. This rule takes precedence over the placement tie-break below: a story **about** Hong Kong, Taiwan or Macau belongs to the China section wherever the event happens, so the place-of-event test decides only the cross-border stories this rule does not already assign (for example, US-China trade decided in Washington stays in Global).

**Placement tie-break.** The place the event happens decides the section. A
Global outlet covering a China-subject policy story whose decision is made
outside China stays in Global; a cross-border story whose event happens in China
belongs to the China section; either way a cross-border story carries a
China-implications note. Disclose the call in the coverage note, so a reader can
see why a story sits where it does.

## Coverage note

The coverage note has a **fixed part** and a **variable part**. The fixed part
must contain the items below, each stated as one short line - no explanation, no
justification, no method note. Provenance counts are per story line, so they equal
the number of story lines when no line is repeated.

- the header window **verbatim** - the parenthesised window in the metadata line
  is copied character for character, with the same dates, times and zone. That
  window is a string, not a sentence: the note may state it inside a sentence of
  its own if the string itself is unchanged;
- the item provenance counts - how many story lines came from each of full, feed
  and link. Run `scripts/check-provenance.mjs` and copy the three marker figures
  from its own first line. Never count them by grepping the file for the marker:
  the Coverage note's own prose quotes the marker, so a text search over-counts.
  On 2026-09-30 a grep returned 18 full / 7 feed / 1 link against the gate's
  18 / 6 / 1; on 2026-09-29 it returned 25 / 0 / 0 against 24 / 0 / 0. The surplus
  is the note's own words, not a story. The gate's figure is the one the reader
  can reproduce, because it counts a story line as this contract defines one:
  every non-indented `- ` bullet in `## Top stories`, `## Global`, `## China` and
  `## Watchlist` that carries a `[src:...]` reference or opens with a bold
  headline - bullets in the Market snapshot, the Coverage note and the Sources
  are not story lines, and an indented bullet is never one. A line printed twice
  is two story lines, and a Watchlist entry is a story line here even though it
  is an unresolved developing story. A Watchlist entry does not count toward the
  20-25 distinct stories: it is a story the run already counted, unresolved and
  printed again - and repeating a story is the writer's choice, never a
  requirement, so never duplicate a story to move the counts. If the note and the
  gate disagree, correct the note and re-run `md-to-items` and both gates - safe only
  while `update` has not run;
- the fetch count - how many distinct **article-page** fetches the run made (one
  per URL, however many HTTP requests the retries cost), against the 20-30
  target, which stays guidance and not a gate. The count is by URL, never by
  request: a URL that exhausted all eight attempts counts once. The request cost
  behind it is recorded separately as `requests` in `.fetch-ledger.json` (see
  `reference/research-input.md`), so state the URL count and the request count
  together in the variable part when the run is near the top of the band - one
  unresponsive URL can cost eight requests and up to 8 x `--timeout`. Discovery
  index and section pages are not article-page fetches, and neither are the
  deterministic collectors' polls - the feed URLs in `.feeds.json` and the market
  instruments in `.markets.json`;
- the section-placement disclosure - any call made under the tie-break above;
- the quiet aspects - every aspect with no significant news, named rather than
  silently omitted;
- the stale-data explanation - any market row whose as-of time is older than the
  run, and why;
- other disclosures - a paywalled item summarized from its headline alone because
  its feed carried no description, and any archive attempt.

For brevity a label with a number carries the meaning alone, and the fixed part in
that shape is:

    Story lines: 31 | full: 23 | feed: 8 | link: 0.
    Fetches: 42 URLs / 56 requests (guidance 20-30).
    Quiet: China 科技 (无重大新闻).
    Stale rows: CSI 300, Shanghai Composite, Shenzhen Component (2026-09-30 close, holiday).
    Blocked: Bloomberg pages 403, cited from its own RSS, two headline-only.

The variable part is at most one or two short sentences - a capped window, a
blocked wire whose canonical URL could not be resolved, a licence gate, two
reports in conflict. An additional-notes block is allowed under the same rule,
which is wording too: one short line, not a paragraph.

Run mechanics do not belong in the note: per-URL or per-agent fetch bookkeeping,
duplicate-count arithmetic, date-source label inventories, archive no-ops and
tie-break reasoning restated from the run report all belong in the run report and
the ledger. The note's prose never quotes marker syntax - `[prov:...]`, `[src:]`,
`[alt:]`, `[find:]` - which also feeds the over-count trap above; name what a line
stands on in words. Marker syntax is also what a gate reads as a story-shaped
bullet, so quoting it in the note's prose is a defect a gate can catch.

Two gates count different things, and their figures are not interchangeable.
`scripts/check-diversity.mjs` counts only the `## Global` and `## China` story
lines, so its per-section figures leave out the Top stories and the Watchlist -
it asks whether each section draws on more than one outlet, and a Top story is
already counted under its aspect. `scripts/check-provenance.mjs` counts every
story line - Top stories, both sections and the Watchlist - and its `story lines`
figure is the one the coverage note follows. Both count a non-indented `- ` bullet
only; neither counts a bullet in the Market snapshot, the Coverage note or the
Sources. A Top story repeated in its aspect is two lines for
`check-provenance.mjs` and one for `check-diversity.mjs`, which sees only the
aspect copy.

Both gates refuse a briefing whose structure they cannot account for, rather than
skipping what they do not recognise: an unmapped `## ` heading, a `### ` outside
Global and China, a Coverage-note sub-heading other than the one optional
`### Additional notes / 补充说明`, or a story-shaped bullet in a section that holds
no stories. Every one of those used to be possible to ship, and the first two
used to take whole sections out of the gates' scope in silence.

The note is short labelled lines, not prose - the fixed part above states each
item as one line, and the variable part is at most one or two sentences. Its one
optional sub-heading is `### Additional notes / 补充说明`, at most one, after the
fixed part, for notes that read better in Chinese, under the same rule: one short
line, not a paragraph. Both gates refuse any other sub-heading there and refuse a
story-shaped bullet anywhere in the note. A run used
`### Additional notes / 补充说明` on 2026-09-30, which nothing policed before.

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
