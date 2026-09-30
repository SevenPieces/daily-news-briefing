# daily-news-briefing

An agent skill that writes one dated news briefing - **Global** in English and
**China** in Chinese (including Hong Kong, Taiwan and Macau) - each organized
into the same seven aspects, and delivers it as a self-contained HTML file plus
its Markdown source.

Every item traces to a real, date-stamped source. Nothing is invented,
estimated, or padded.

## What a run produces

| Output | Purpose |
|---|---|
| `briefing-YYYY-MM-DD.html` | The deliverable: self-contained, dark theme, collapsible aspects, print styles, source badges and a working search box |
| `briefing-YYYY-MM-DD.md` | The editable source of the same briefing |
| `briefing-state.json` | The coverage baseline and a seven-day index of recent stories; the agent classifies `#new` / `#followup` against it |
| `.fetch-ledger.json` | Run artifact: every article-page URL the run fetched, with the per-agent split and the union |

Outputs go to `./briefings` under the working directory, or to `$BRIEFING_DIR`
when that is set.

Only the HTML is a deliverable. The agent's own writes - the Markdown and
`.fetch-ledger.json` - land at mode `0600`; the script-written artifacts
(`.markets.json`, `.feeds.json`, `.items.json`), `briefing-state.json` and the
HTML follow the process umask (`0664` under a `0002` umask, `0644` under the
common `0022`), so one run's files can differ in mode. The state and the run
artifacts are local state, never deliverables: ship the HTML and keep the rest
on disk.

## Requirements

- **Node.js 18 or newer** for the scripts; **Node 20.11 or newer** to run the
  test harness, because `tests/helpers.mjs` uses `import.meta.dirname`, which
  Node 18 does not provide. Every script uses only the Node standard library, so
  there is nothing to install.
- **The `curl` binary on `PATH`.** `fetch-page.mjs`, `fetch-feeds.mjs` and
  `collect-markets.mjs` shell out to it as their fallback transport, because some
  publishers answer a browser profile and reject Node's own `fetch`. It is a
  binary, not a package: no `npm install` provides it.
- A skill-capable agent harness (DeepSeek Harness, Claude Code, ...) with web
  search and fetch available.
- Network access. Market data comes from keyless public APIs - no API keys and
  no accounts.

## Install

Clone into your harness's skills directory, keeping the directory name equal to
the `name:` in the frontmatter:

```sh
git clone <repo-url> ~/.dsh/skills/daily-news-briefing
# Claude Code
git clone <repo-url> ~/.claude/skills/daily-news-briefing
```

The skill root is `$SKILL` when set, otherwise
`${DSH_HOME:-$HOME/.dsh}/skills/daily-news-briefing`; set `$SKILL` to run a
candidate revision from a checkout that is not the install. Outputs follow
`$BRIEFING_DIR` as above.

## Usage

Ask for it in plain language: "today's briefing", "global and China news", or a
catch-up run after several missed days.

The coverage window is a rule, not a question. The skill computes it with the
state script and **never asks**: from the previous briefing to now, capped at the
most recent 72 hours, or the latest 24 hours when there is no previous briefing.
When the cap bites, the coverage note says how much was skipped.

A briefing contains two sections across seven aspects (economy, politics,
business, tech, foreign affairs, military, social) with 20-25 distinct
stories allocated by importance, 3-5 Top Stories, a market snapshot, a
watchlist, a coverage note and a sources list. Global content is English; China
content is Chinese; structural labels are bilingual.

## Repository layout

```
SKILL.md                       the skill itself - start here
reference/sources.md           the two-tier source registry
reference/output-contract.md   the exact briefing grammar
reference/research-input.md    the mandatory per-story research schema
reference/state-schema.md      the state file format
reference/feasibility.md       fetch probes: which outlets can actually be read
scripts/check-diversity.mjs    fails a section that rests on a single outlet
scripts/check-provenance.mjs   fails a story line missing [src:] or [prov:*] marker
scripts/collect-markets.mjs    keyless market data (Yahoo Finance, Eastmoney)
scripts/fetch-page.mjs         reads article pages with retry and profile variation
scripts/fetch-feeds.mjs        publisher RSS feeds plus discovery-only items
scripts/md-to-items.mjs        Markdown -> the item index update stores
scripts/render-html.mjs        Markdown -> self-contained HTML
scripts/update-state.mjs       computes the window, records the run
scripts/check-research.mjs     fails a research report before the briefing is written
scripts/lib/sections.mjs       the shared section and story-line grammar every parser imports
tests/                         the node --test harness (needs Node 20.11+)
examples/                      an illustrative sample briefing
```

### Running the scripts directly

```sh
SKILL=~/.dsh/skills/daily-news-briefing
OUT=${BRIEFING_DIR:-$PWD/briefings}; mkdir -p "$OUT"; DATE=$(TZ=Asia/Shanghai date +%F)

node "$SKILL/scripts/update-state.mjs" plan --state "$OUT/briefing-state.json"
node "$SKILL/scripts/collect-markets.mjs" --out "$OUT/.markets.json"
node "$SKILL/scripts/fetch-feeds.mjs" --since <SINCE> --out "$OUT/.feeds.json"
# ... write "$OUT/briefing-$DATE.md" against reference/output-contract.md ...
node "$SKILL/scripts/md-to-items.mjs" "$OUT/briefing-$DATE.md" --out "$OUT/.items.json" \
  && node "$SKILL/scripts/check-diversity.mjs" "$OUT/briefing-$DATE.md" \
  && node "$SKILL/scripts/check-provenance.mjs" "$OUT/briefing-$DATE.md"
# gates first: the coverage note's counts are copied from check-provenance's output
node "$SKILL/scripts/update-state.mjs" update --state "$OUT/briefing-state.json" --items "$OUT/.items.json" --out "$OUT/briefing-state.json" --date "$DATE"
node "$SKILL/scripts/render-html.mjs" "$OUT/briefing-$DATE.md" --out "$OUT/briefing-$DATE.html"
```

| Script | Role |
|---|---|
| `md-to-items.mjs` | Parses the briefing Markdown into the item index `update` consumes |
| `update-state.mjs` | `plan` computes the coverage window and records it; `update` appends this run's items, rebuilds the watchlist and writes the state |
| `collect-markets.mjs` | Yahoo Finance (keyless), with Eastmoney as the cross-check for the China 10-year bond row |
| `fetch-feeds.mjs` | Publisher RSS feeds (dated, usable as primaries) and Google News items (discovery only) |
| `check-diversity.mjs` | Exits non-zero when a section's primaries are all one outlet |
| `check-provenance.mjs` | Exits non-zero when a story line lacks a `[src:]` reference or exactly one `[prov:*]` marker |
| `fetch-page.mjs` | Reads an article page with retry and browser/plain profile variation; reports `dateSource` |
| `render-html.mjs` | Markdown to self-contained HTML |

The two gates count different things: `check-diversity.mjs` counts only the
`Global` and `China` section lines, while `check-provenance.mjs` counts every
story line - Top stories, both sections and the Watchlist, never a bullet in the
Market snapshot, the Coverage note or the Sources and never an indented one - so
the two item counts differ for the same briefing.

## Sourcing rules

- Two source tiers: fetch-verified primaries (BBC, SCMP, The Guardian, Al
  Jazeera, Nikkei Asia, Xinhua, gov.cn, NBS, PBoC, Caixin, Yicai, The Paper, CLS,
  STCN, Guangming Online (gmw.cn) and Hong Kong Government News (news.gov.hk))
  and blocked originals (Reuters, AP, FT, Bloomberg, WSJ return 401/403 to
  automated fetch). `reference/sources.md` carries the full registry and its
  probe evidence - it is the list of record, this line is a summary.
- Every item needs a primary link and an in-window publication timestamp.
  Aggregator-only items are dropped; Google News, Baidu News and Weibo hot search
  are discovery surfaces, never the cited primary.
- Blocked wire copy appears as a corroborated `[alt:OUTLET](url)` link, tagged
  `#unverified` only when no fetchable primary corroborates the story.
- Paywalled items show headline plus link only - locked body text is never
  paraphrased.
- Every story carries a provenance marker: `[prov:full]` (article body
  obtained), `[prov:feed]` (publisher RSS), `[prov:link]` (no article body
  obtained from the cited URL, for any reason).
- Market numbers come only from the collector APIs, each with its as-of time. A
  missing instrument is marked unavailable, never estimated from prose.
- Neither section may rest on a single outlet; a section written from one feed is
  a failed briefing.
- Quiet aspects are noted as quiet. Nothing is padded to hit the item count.

## Limitations

- Some outlets are simply unreadable by automated fetch. The provenance marker
  records the shallower reading rather than pretending otherwise.
- The 72-hour cap means a run after several missed days is a partial catch-up,
  and the briefing says so.
- `examples/sample-briefing.md` and its rendered HTML show the exact format.
  They are illustrative and their stories are placeholders - never copy them
  into a real briefing.

## License

MIT - see [LICENSE](LICENSE).
