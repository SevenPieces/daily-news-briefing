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

## 1. Inputs and configuration

| Key | Default |
|---|---|
| Output directory | $BRIEFING_DIR, else ./briefings under the working directory |
| Skill root | $SKILL, else ${DSH_HOME:-$HOME/.dsh}/skills/daily-news-briefing; pre-set it to run a candidate revision |
| Timezone | Asia/Shanghai |
| Sections | Global, China |
| Aspects | Economy, Politics, Business, Tech, Foreign affairs, Military, Social |
| Global scope | Major powers: US, EU/UK, Russia and Eastern Europe, China-world relations, Japan and the Koreas, Middle East, international institutions |
| China scope | Mainland national, plus Hong Kong, Taiwan and Macau, and city-level stories when they are genuinely worth noting |
| Volume | 20-25 distinct stories total; a Top story repeated in its section is one story but two story lines; allocated by importance; empty aspects are omitted |
| Budget | 20-30 article-page fetches for the run, about 3-5 minutes |

## 2. Coverage window (never ask)

Compute the window deterministically with the state script before collecting:

- Previous briefing exists: from its timestamp to now, **capped at the most
  recent 72 hours**.
- No previous briefing: the latest **24 hours**.
- **Never ask the user which window to use.** The rule is identical in every
  run, interactive or not.
- The header always prints the real coverage window, in one of three shapes. An
  uncapped window runs from the previous briefing to now and names its real
  length:
  `Last briefing 2026-09-08 - covering latest 48h (2026-09-08 17:00 ->
  2026-09-10 17:00 Asia/Shanghai)`. A capped window prints 72h and then the
  skipped span:
  `Last briefing 2026-09-05 - covering latest 72h (2026-09-07 17:00 ->
  2026-09-10 17:00 Asia/Shanghai) - 48h not covered`, and only a capped run
  prints that clause. A first run with no previous briefing prints neither a
  previous date nor a gap:
  `No previous briefing - covering latest 24h (2026-09-09 17:00 ->
  2026-09-10 17:00 Asia/Shanghai)`.
  The label's times are Asia/Shanghai (the header declares that zone), so the
  coverage note can quote them verbatim.
- When the 72h cap bites, say how much was skipped in the coverage note.
- A 72h window can span three days; keep the 20-25 distinct-story target and
  allocate by importance.
- Watchlist items appear only when they have a new development inside the
  window. Older background is omitted, not smuggled in.

## 3. Sources and the authenticity gate

Two tiers, with the full registry in `reference/sources.md` and the probe
evidence in `reference/feasibility.md`:

- **Fetch-verified primaries**: BBC, SCMP, The Guardian, Al Jazeera, Nikkei
  Asia, Xinhua (news.cn), 央广网 (CNR), gov.cn, 国防部 (mod.gov.cn), National
  Bureau of Statistics, PBoC, Caixin, Yicai, The Paper, CLS, STCN.
- **Discovery-only or blocked originals**: Reuters, AP, FT, Bloomberg, WSJ
  return 401/403 to automated fetch, but the story is still included. When a
  fetchable primary corroborates it, cite that primary as the `[src:]` and the
  wire as an `[alt:OUTLET](url)` link; when none does, cite the wire itself and
  tag the line `#unverified`. Keep the original link so the user can open it
  manually.

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
   text. Tag subscription outlets #paywalled. Mark provenance by depth - where the
   summary's words came from: `[prov:full]` when the cited page's own article body
   was obtained; `[prov:feed]` when the summary is the publisher's own RSS
   description (the page may be blocked); `[prov:link]` when no article body was
   obtained from the cited URL for any reason - a blocked wire, a 402 licensing
   gate, or an HTTP 200 that returned only masthead and navigation. The marker
   never means an HTTP request succeeded.
9. **Blocked wire copy is an alt, not a primary.** AP, Reuters, FT and WSJ cannot
   be fetched and have no working RSS: include them as a corroborated
   `[alt:AP](url)` link, tagged #unverified only when no fetchable primary
   corroborates the story. Never invent or paraphrase beyond what is corroborated.

## 4. Workflow

### Step 0 - Read the reference documents (in step order)

Four reads come before any work, each before the step it governs:

- `reference/state-schema.md` - the state fields and the planned-window
  record; read before touching state (Step 2).
- `reference/sources.md` - the source tiers and the feed registry, with the
  probe evidence behind them in `reference/feasibility.md`; read before
  collecting (Step 3).
- `reference/research-input.md` - the mandatory research-report schema; read
  before researching (Step 4).
- `reference/output-contract.md` - the briefing grammar, tag placement and
  coverage-note requirements; read before writing (Step 6).

### Step 1 - Resolve paths

~~~sh
if [ -n "$BRIEFING_DIR" ]; then OUT="$BRIEFING_DIR"; else OUT="$PWD/briefings"; fi
mkdir -p "$OUT"
STAGE="$OUT/.staging/$(TZ=Asia/Shanghai date +%F)"
mkdir -p "$STAGE"
SKILL="${SKILL:-${DSH_HOME:-$HOME/.dsh}/skills/daily-news-briefing}"
DATE=$(TZ=Asia/Shanghai date +%F)
~~~

These variables live only in the shell that ran this block: each step usually runs
in a fresh shell, so a later step must re-establish the same values - `OUT=...;
STAGE=...; SKILL=...; DATE=...` - in its own shell before it uses `$OUT`,
`$STAGE`, `$SKILL` or `$DATE`. `STAGE` and `DATE` carry `$(TZ=Asia/Shanghai date
+%F)`, so a run that spans Shanghai midnight must reuse the values its first
execution captured rather than recompute them at 00:05: a new `DATE` would
retarget the briefing filename (Step 6), and a new `STAGE` would aim Step 7's
delete at a directory the run never used, leaving the real scratch behind. The
date is fixed for the whole run.

All research scratch - subagent output, feed dumps, fetched pages - lives under
`$STAGE`, and the run deletes that directory before it finishes (Step 7). The
run's own artifacts - `.markets.json`, `.feeds.json`, `.items.json` - stay in
`$OUT`; staging holds nothing the run keeps.

### Step 2 - Compute the window

~~~sh
node "$SKILL/scripts/update-state.mjs" plan --state "$OUT/briefing-state.json"
~~~

It prints JSON containing since, until, hours, capped, previousBriefingAt and a
one-line label. Use those values verbatim in the header and coverage note: when
the state already holds a **usable** `plannedWindow` - `until` parses, is not
behind `lastBriefingAt`, is at most 12h old and no more than 5 minutes ahead -
`plan` reuses it, so it computes nothing, writes nothing and prints the recorded
window instead, announcing the reuse on stderr with the record's age and end.
Otherwise it computes a fresh window and records it in the state as
`plannedWindow`. The window travels through the state file, not the shell:
`update` reads that record back from the same `--state` file and closes coverage
at the same end instead of reading its own clock, whichever shell runs it. The
shared predicate is `usablePlannedWindow(state, baseline, now)` in
`scripts/update-state.mjs`, so the announced end and the stored baseline agree
whenever `update` consumes a usable record.

### Step 3 - Collect deterministically, in parallel

`fetch-feeds.mjs` takes `--since` from the plan JSON Step 2 printed - that
JSON's `window.since` field, the announced window's start, not the shell's
clock.

~~~sh
node "$SKILL/scripts/collect-markets.mjs" --out "$OUT/.markets.json"
node "$SKILL/scripts/fetch-feeds.mjs" --since <SINCE> --out "$OUT/.feeds.json"
~~~

Markets come from Yahoo Finance (keyless), with Eastmoney as the
cross-check for the China 10-year bond row. The feed collector returns publisher
feeds (dated, with a description - usable as primaries) and Google News items
(discovery only: their links do not resolve to publishers, so confirm those
through a fetch-verified primary). It emits one record per item - `title`,
`link`, `outlet`, `section`, `aspect`, `publishedAt`, `summary`,
`discoveryOnly` - and its `aspect` is the collector's own coarse slug
(`foreign`, `economy`, `politics`, `tech`, `business`, `social`,
`military`), not one of the contract's seven aspects: never copy it into a
story line. See `reference/sources.md` for the full shape.

### Step 4 - Research both sections

Use web_search for discovery, then read candidate articles with
`scripts/fetch-page.mjs` (it varies the header profile and the transport, so a
UA-sensitive gate does not read as a block, and it reports which date field it
used); `web_fetch` remains a valid fallback. `--text` is the flag that returns
the page text, and it hard-truncates that text at 1500 characters - the
`textLength` the tool prints either way is the full stripped length. A record
whose summary needs the body must be read with `--text`, but a truncated
excerpt is not evidence of a body: when all 1500 characters are pure site
chrome - masthead, navigation, cookie notice - no body was obtained, so record
`[prov:feed]` or `[prov:link]`, never `[prov:full]`, and write the summary
from the feed's description or the headline alone. It never
retries a 402: that is a licensing answer, not a transient failure. Cover
both sections across all seven aspects, respecting the budget, and capture every
candidate in the research-report schema in `reference/research-input.md`. That
schema is mandatory; the subagent fan-out is not. The 20-30 fetch target is a
run-level budget for article-page fetches, not a per-agent one: the ledger is
the union of every agent's fetches plus the orchestrator's own. Overlap between
agents is only discovered after the fact, so budget the SUM of the allowances
you hand out - that sum, not the hoped-for union, is what a budget can promise.
A failed probe counts: it was a fetch the run made. A search-derived China
section commonly reaches the top of that band or passes it, and the overrun is
disclosed in the coverage note, never hidden or re-counted. Each item must end
with a
dated primary: a page whose own article body was obtained, a publisher's
own RSS item, or - for blocked wire copy - a corroborating primary with the
wire as an alt. A page that answered 200 but yielded no article body is
`[prov:link]`, not `[prov:full]` - unless the summary is taken from the
publisher's own feed description, which is `[prov:feed]`; otherwise the
summary comes from a corroborating primary or the headline alone - see
`reference/output-contract.md`. If you
do fan out, remember that a subagent is a fresh agent with no memory of this
skill: give it the resolved absolute path (for example
`/.../briefings/.staging/2026-09-29`) rather than the variable name `$STAGE`,
which a fresh shell cannot resolve, and require every scratch file to live there.
Run-level gate notes that the artifacts can check are computed from them, never
recalled: at this point derive each from `$OUT/.feeds.json` and
`$OUT/.markets.json`, and reconcile the note with them before writing it - a
note that disagrees with the artifacts is wrong. The Step 6 coverage note also
reconciles with `$OUT/.items.json`, which `md-to-items.mjs` writes in that
step, so read it there and not here; at Step 4 that file is absent or stale. A
quiet aspect is a claim about the world, not something a digest can settle, so
that stays your own judgement.

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
the story from it and still cite the original publisher URL.
Same-day stories usually have no snapshot yet. If no canonical URL can be found
at all, add a clearly-labelled search fallback instead of omitting the story:
`[find:AP](https://www.google.com/search?q=<headline>+site:apnews.com)`.

### Step 5 - Deduplicate, classify, select

Drop aggregator-only items. Drop anything published outside the window. Merge
duplicate coverage of one event into a single item and keep the strongest two
outlets. Rank items by importance within each aspect. Select the 3-5 Top
Stories by cross-source prominence. All Hong Kong, Taiwan and Macau stories
belong in the China section, because they are parts of China; this holds even
when a foreign power is involved, and it overrides the placement tie-break, so a
story *about* Hong Kong, Taiwan or Macau is China's wherever the event happens.
Cross-section stories follow the placement tie-break in
`reference/output-contract.md` for everything the rule above does not assign: the
place the event happens decides the section; disclose the call in the coverage
note.

### Step 6 - Write Markdown, render, update state

Write "$OUT/briefing-$DATE.md" in the exact structure in
`reference/output-contract.md`, then:

~~~sh
node "$SKILL/scripts/md-to-items.mjs" "$OUT/briefing-$DATE.md" --out "$OUT/.items.json" \
  && node "$SKILL/scripts/check-diversity.mjs" "$OUT/briefing-$DATE.md" \
  && node "$SKILL/scripts/check-provenance.mjs" "$OUT/briefing-$DATE.md"
node "$SKILL/scripts/update-state.mjs" update --state "$OUT/briefing-state.json" --items "$OUT/.items.json" --out "$OUT/briefing-state.json" --date "$DATE"
node "$SKILL/scripts/render-html.mjs" "$OUT/briefing-$DATE.md" --out "$OUT/briefing-$DATE.html"
~~~

`md-to-items.mjs` parses the Markdown you just wrote into the item index `update`
stores, so it runs first, and `update` must run against the same `--state` file
`plan` wrote, while the recorded window is still usable, so it closes coverage
at the end `plan` announced. Which shell runs it is irrelevant. If `md-to-items`
fails, do not run `update`. The `&&` chain still guards the run, though not
because a stale file would survive: `md-to-items` removes the `.items.json`
before it parses, so a failed parse leaves no file behind and `update` then
fails loudly with exit 2 on the missing index instead of ingesting one.

Both gates run **before** `update`, on purpose: the coverage note's per-story-line
counts and its fetch figure are copied from their output, and a note reconciled
after `update` means editing the Markdown once the window is already closed.
Re-running `plan` for that edit computes a window from the new baseline - under
`MIN_WINDOW_SECONDS` - so `update` refuses it and the fresh `plannedWindow` is
left behind for the next run to reuse. Get the note right in this pass; run
`update` only once both gates have printed OK.

`update` also refuses an `--items` file older than the window it would close -
`md-to-items` runs after `plan`, so the index it writes is never that old - so a
previous run's index cannot be ingested as this run's.

`update` then closes coverage at the window `plan` announced, and refuses to
write when that window is under two minutes (120s) - a second update moments
after the last one - unless you pass `--force`, which is only right once you have
checked the run is genuinely new. Two minutes is the "seconds old" case the
guard exists to catch: a mid-day re-run, a catch-up, or a normal day all clear
it. A second refusal band covers the same case minutes wide instead of seconds: a
second Step 6 pass has no planned window left - the first pass consumed it - so
when no usable record exists and the window it would close is under ten minutes
(600s), `update` refuses and says the state was already closed minutes ago,
because accepting it would move the baseline to a moment no `plan` announced.
Editing the Markdown after Step 6 therefore means re-running `plan` (Step 2), not
just the `md-to-items` and `update` pair; the index dedupes by date and title, so
even a forced re-run cannot append the same entries twice. `--force` excuses only
a short but positive window: a window whose end sits behind the recorded baseline
is refused even with `--force`, because the baseline would move backwards.

### Step 7 - Deliver

Present the HTML file, and summarize the same content in chat (never only a
link). Keep the Markdown, the state JSON and the run artifacts `.markets.json`,
`.feeds.json` and `.items.json` in `$OUT`, but deliver only the HTML. Then
delete the run's staging directory, so every research scratch file goes with it
and the next run starts from an empty path - the second line removes the
`.staging` parent once it is empty:

~~~sh
rm -rf "${STAGE:?}"
rmdir "$OUT/.staging" 2>/dev/null || true
~~~

## 5. Output contract

The full grammar is in `reference/output-contract.md`. In short: a title, a
metadata line with the window label, then Top stories, Market snapshot, the two
aspect sections, Watchlist, Coverage note and Sources. Each story is one line:

    - **Headline** - Summary. [src:OUTLET 2026-09-10 09:30](https://primary) [alt:OUTLET2](https://secondary) #new [prov:feed]

Tags: #new, #followup, #developing, #paywalled, #unverified. Global content is
English; China content is Chinese. Structural labels are bilingual.

## 6. Quality gate

- Window matches the rule: previous briefing to now, capped at 72h; 24h when
  there is no previous briefing; no question was asked.
- Every item has a primary link and an in-window publication time.
- Headlines are cited **verbatim** from the publisher: no rewording, no
  truncation, no translation.
- No aggregator-only item; no paywalled paraphrase.
- Blocked wire stories carry a canonical publisher URL (resolved by site search),
  cited as an `[alt:...]` link, not a Google News redirect.
- Market rows cover every instrument the collector returned, in its order, each with an as-of time; yield rows use basis points (changeBp); unavailable instruments are labelled.
- Top stories are the 3-5 most corroborated items.
- `#new` and `#followup` are your own classification, made against the item
  titles the state holds for the last seven days; the state derives nothing, so
  the tags are only as good as that comparison.
- Every story carries exactly one provenance marker, named for where the
  summary's words came from: `[prov:full]` when the cited page's own article body
  was obtained, `[prov:feed]` when the summary is the publisher's own RSS
  description, `[prov:link]` when no article body was obtained from the cited URL
  for any reason. A marker never means an HTTP request succeeded. #paywalled
  items carry the publisher's own feed abstract, never paraphrased locked text. Run
  `node "$SKILL/scripts/check-provenance.mjs" "$OUT/briefing-$DATE.md"` after
  writing the Markdown; it exits non-zero on any story missing a marker,
  carrying more than one, or carrying no `[src:...]` source reference.
- Source diversity: neither section may rest on a single outlet. Run
  `node "$SKILL/scripts/check-diversity.mjs" "$OUT/briefing-$DATE.md"` after
  writing the Markdown; it exits non-zero when a section's primaries are all one
  outlet and flags single-outlet aspects. Fix using the outlets in
  `reference/sources.md` before rendering. A section written from one feed is a
  failed briefing, not a stylistic choice. When an aspect carries two or more
  items, prefer at least two outlets; a single-outlet aspect stays a note, so
  rebalance it where a credible second outlet exists rather than dropping the
  story. If no different-outlet alternate exists, keep the stories and leave the
  note. Never drop a story to clear a note, and never relabel a republished page
  as a different outlet - the label must name the outlet that published the page
  you cite.
- The coverage note repeats the header window **verbatim** (same dates and times
  in Asia/Shanghai as the label in parentheses), so the header and the note can
  never disagree about the window.
- The coverage note states how many article-page fetches the run made, so an
  overrun of the 20-30 target is visible; the target stays guidance, not a gate.
- Quiet aspects are noted; nothing is padded to hit the item count.
- The HTML is self-contained: header and content flow as one page with no
  separate sticky bar, plus collapsible aspects, dark theme, print styles,
  source badges and a working search box.
- The chat reply summarizes the briefing, not just the path.

## 7. Example

`examples/sample-briefing.md` and its rendered `examples/sample-briefing.html`
show the exact format. They are illustrative and clearly labelled as such; never
copy their placeholder stories into a real briefing.
