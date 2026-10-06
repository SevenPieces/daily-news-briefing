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
| Budget | No fixed fetch count binds: coverage decides it, and a search-derived China section routinely runs past a band a feed-only run fits in; every article-page fetch is counted by URL in `.fetch-ledger.json` and stated in the coverage note |

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
  Asia, Xinhua (news.cn), 央广网 (CNR), 光明网 (gmw.cn), 香港政府新闻网
  (news.gov.hk), gov.cn, 国防部 (mod.gov.cn), National Bureau of Statistics,
  PBoC, Caixin, Yicai, The Paper, CLS, STCN. `reference/sources.md` carries the
  registry of record and its probe evidence; this list is the summary.
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
STAGE="${OUT:?}/.staging/$(TZ=Asia/Shanghai date +%F)"
mkdir -p "$STAGE"
: > "$STAGE/.run-start"
if [ -f "$OUT/briefing-state.json" ]; then
  cp "$OUT/briefing-state.json" "$STAGE/briefing-state.seed.json"
fi
SKILL="${SKILL:-${DSH_HOME:-$HOME/.dsh}/skills/daily-news-briefing}"
DATE=$(TZ=Asia/Shanghai date +%F)
~~~

These variables live only in the shell that ran this block: each step usually runs
in a fresh shell, so a later step must re-establish the same values - `OUT=...;
STAGE=...; SKILL=...; DATE=...` - in its own shell before it uses `$OUT`,
`$STAGE`, `$SKILL` or `$DATE`. `STAGE` is built from `OUT`, so a shell that
re-establishes `STAGE` must re-establish `OUT` first: the `${OUT:?}` in that
assignment refuses an unset or empty `OUT` instead of silently building
`/.staging/<date>`. `STAGE` and `DATE` carry `$(TZ=Asia/Shanghai date
+%F)`, so a run that spans Shanghai midnight must reuse the values its first
execution captured rather than recompute them at 00:05: a new `DATE` would
retarget the briefing filename (Step 6), and a new `STAGE` would aim Step 7's
delete at a directory the run never used, leaving the real scratch behind. The
date is fixed for the whole run.

The staging path is keyed by date alone, so only one run at a time may use a
given output directory: two runs sharing one `$OUT` on the same Shanghai day
share `$STAGE`, and Step 7's delete takes the other run's research scratch with
it. This run-at-a-time rule is chosen over a per-run unique path because every
shell of the run must re-derive the same `$STAGE` from `$OUT` and `$DATE`, and a
unique component such as a PID or a timestamp would change in each fresh shell,
leaving Step 7 aimed at a directory the run never used.

All research scratch - subagent output, feed dumps, fetched pages - lives under
`$STAGE`, and the run deletes that directory before it finishes (Step 7). The
run's own artifacts - `.markets.json`, `.feeds.json`, `.items.json`,
`.fetch-ledger.json` - stay in `$OUT`; staging holds nothing the run keeps.

Step 1 leaves two files of its own in `$STAGE`: `.run-start`, the mark Step 7
measures the run against, and `briefing-state.seed.json`, a copy of the state as
it stood before `plan` or `update` touched it - the baseline Step 6's
post-`update` repair restores. Step 7 clears both with the directory.

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

Both collectors exit non-zero when they collected nothing at all - every feed
failed, or no known instrument was requested - while a partial result stays exit
0. Check both exit codes: a failed collector is an outage to disclose in the
coverage note, never a quiet news day, and the per-feed records in
`.feeds.json` say which sources were lost.

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
from the feed's description or the headline alone. It never retries a 402:
that is a licensing answer, not a transient failure. A discovery hit is never a
citation until a fetch confirms it: web_search can return punycode IDN hosts
(`xn--...`), which must be resolved to the publisher's real host before citing
because the punycode host's TLS certificate does not match, so that page cannot
be fetched; and it can return 404 links for valid-looking articles (observed on
Xinhua), so a title and link alone prove nothing. Cover both sections across all
seven aspects, and capture every candidate in the research-report schema in
`reference/research-input.md`. That schema is
mandatory; the subagent fan-out is not. Validate the report with
`node "$SKILL/scripts/check-research.mjs" <report-path>` before any Markdown is
written: it exits 0 when the report satisfies the schema, 1 on violations and 2
on usage or an unreadable report. Fetches are counted, never capped. Count
article-page fetches by URL - the ledger is the union of every agent's fetches
plus the orchestrator's own, not a per-agent allowance - and state the resulting
URL count in the coverage note. No fixed count binds, because coverage across two
sections and seven aspects sets it: a search-derived China section routinely runs
past any band a feed-only run fits in, and that is disclosed, never hidden or
re-counted. `--retries` counts ROUNDS, not requests: each round is 2 header
profiles x 2 transports, so the default of 2 rounds is up to 8 requests per URL -
while the ledger counts a URL once, not its requests. A failed probe counts: it
was a fetch the run made. Overlap between agents is only discovered after the
fact, so budget the SUM of the allowances you hand out - that sum, not the
hoped-for union, is what a budget can promise. Each item must end with a
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
note that disagrees with the artifacts is wrong. The coverage note's per-story-line
counts come from `check-provenance.mjs`'s own first line at Step 6, not from here
and not from any index: `.items.json` carries no provenance split, and at Step 4
it is absent or stale. A
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

Before giving up on a blocked wire URL, try one archive read. This is best
effort and often unavailable: both header profiles and both transports are
routinely refused. On
2026-09-30 `https://web.archive.org/web/2/<url>` answered 403 on all four
attempts (2 header profiles x 2 transports) and
`https://archive.org/wayback/available?url=<url>` answered 429 on the same day.
A refusal is not evidence that no snapshot exists, and an unavailable archive
is never a reason to drop the story - fall through to the steps below.
When a snapshot is readable, verify the story from it and still cite the original
publisher URL.
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
place the event happens decides the section, and it decides ahead of source
language and scope. A China line for an event in China may be written from a
Chinese-language page or from the publisher's own page - never a Chinese outlet's
foreign-language edition - while `China-world relations` in the Global scope
covers relations whose event happens outside China. Disclose the call in the
coverage note.

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
`update` only once both gates have printed OK. The note itself is a set of short
labelled lines, not prose; `reference/output-contract.md` carries its rule.

`update` also refuses an `--items` file older than the window it would close -
`md-to-items` runs after `plan`, so the index it writes is never that old - so a
previous run's index cannot be ingested as this run's. That comparison is exact
and needs no timezone conversion: the file's mtime and the recorded `until` are
both absolute instants, so a `+08:00` state file cancels out. An `--items` file
removed between the read and the comparison exits 2 rather than being skipped.

`update` then closes coverage at the window `plan` announced, and refuses to
write when that window is under two minutes (120s) - a second update moments
after the last one - unless you pass `--force`, which is only right once you have
checked the run is genuinely new. A record the shared usability predicate
rejects as shorter than two minutes is not reused: `plan` recomputes from the
baseline, so a retry widens with real time instead of reusing a window `update`
is guaranteed to refuse - and if one is ever in the way, delete `plannedWindow`
in the state file, since `plan` reuses it and freezes the window at that length.
Two minutes is the "seconds old" case the
guard exists to catch: a mid-day re-run, a catch-up, or a normal day all clear
it. A second refusal band covers the same case minutes wide instead of seconds: a
second Step 6 pass has no planned window left - the first pass consumed it - so
when no usable record exists and the window it would close is under ten minutes
(600s), `update` refuses and says the state was already closed minutes ago,
because accepting it would move the baseline to a moment no `plan` announced.
Editing the Markdown **before** `update` has run is just the `md-to-items` and
gates pass again. Editing it **after** `update` has run is not a re-`plan` away:
`plan` measures from the new baseline, which is the moment that update closed, so
the window it computes is minutes wide and excludes everything the run just
researched - a verification run on 2026-09-30 followed the old advice and got a
six-minute window, which failed `check-research` on every record. Restore the
state from the seed Step 1 wrote -
`cp "$STAGE/briefing-state.seed.json" "$OUT/briefing-state.json"` - with `OUT`
and `STAGE` re-established in that same shell, and replay Step 2 through Step 6,
so the window is the one the briefing covers. When Step 1's copy found no prior
state, delete `$OUT/briefing-state.json` instead, which puts `plan` on its
no-previous-briefing route. The index dedupes by date and title, so replaying
cannot append the same entries twice. A replay may move the window end: `plan`
recomputes from the restored baseline, so the replayed window ends after the one
the first pass announced (2026-10-06: 24h ending 08:30 became 24.1h ending
08:37). A replay therefore re-cuts the hours figure, the parenthesised span and
the `generated` stamp in the same pass, and any label it reports is the one on
disk. `--force` excuses only
a short but positive window: a window whose end sits behind the recorded baseline
is refused even with `--force`, because the baseline would move backwards.

### Step 7 - Deliver

Present the HTML file, and summarize the same content in chat (never only a
link). Keep the Markdown, the state JSON and the run artifacts `.markets.json`,
`.feeds.json`, `.items.json` and `.fetch-ledger.json` in `$OUT`, but deliver only
the HTML.

The run must have written nothing outside `$OUT`, and Step 1's `.run-start` mark
makes that measurable. The first command below lists every file under the working
directory changed since Step 1, with `$OUT` pruned; empty output is the pass. Each
path printed is a candidate, not a verdict: delete the ones this run wrote - they
are scratch, and Step 1 confines scratch to `$STAGE` - and leave any this run
cannot account for, naming it in the coverage note. This measurement runs before
`.run-start` itself goes.

Then delete the run's staging directory - the run's own, under Step 1's
one-run-at-a-time rule for a shared `$OUT` - so every research scratch file goes
with it and the next run starts from an empty path - the last line removes the
`.staging` parent once it is empty:

~~~sh
find "${PWD:?}" -name .staging -prune -o -path "${OUT:?}" -prune -o -newer "${STAGE:?}/.run-start" -type f -print
rm -rf "${STAGE:?}"
rmdir "${OUT:?}/.staging" 2>/dev/null || true
~~~

## 5. Output contract

The full grammar is in `reference/output-contract.md`. In short: a title, a
metadata line with the window label, then Top stories, Market snapshot, the two
aspect sections, Watchlist, Coverage note and Sources. Each story is one line:

    - **Headline** - Summary. [src:OUTLET 2026-09-10 09:30](https://primary) [alt:OUTLET2](https://secondary) #new [prov:feed]

Tags: #new, #followup, #developing, #paywalled, #unverified. Global content is
English; China content is Chinese. Structural labels are bilingual.

A quiet aspect carries no stories: its heading is followed by the marker and
nothing else, written in the section's own language - `(quiet - no significant
news today)` under Global, `(无重大新闻)` under China - never a mixed form such
as `(quiet - 今日无重要新闻)`.

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
- The coverage note states the run's article-page fetch count by URL; the ledger
  is the record it comes from.
- Quiet aspects are noted with the canonical marker in the section's own
  language (see section 5); nothing is padded to hit the item count.
- The HTML is self-contained: header and content flow as one page with no
  separate sticky bar, plus collapsible aspects, dark theme, print styles,
  source badges and a working search box.
- The chat reply summarizes the briefing, not just the path.

## 7. Example

`examples/sample-briefing.md` and its rendered `examples/sample-briefing.html`
show the exact format. They are illustrative and clearly labelled as such; never
copy their placeholder stories into a real briefing.
