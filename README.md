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
| `briefing-state.json` | Run state: the previous briefing's timestamp and story history, so the next run can size its window and tag `#new` / `#followup` |

Outputs go to `./briefings` under the working directory, or to `$BRIEFING_DIR`
when that is set.

## Requirements

- **Node.js 18 or newer.** Every script uses only the standard library, so there
  is nothing to install.
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

## Usage

Ask for it in plain language: "today's briefing", "global and China news", or a
catch-up run after several missed days.

The coverage window is a rule, not a question. The skill computes it with the
state script and **never asks**: from the previous briefing to now, capped at the
most recent 72 hours, or the latest 24 hours when there is no previous briefing.
When the cap bites, the coverage note says how much was skipped.

A briefing contains two sections across seven aspects (economy, politics,
business, tech, foreign affairs, military, social) with 20-25 items allocated by
importance, 3-5 Top Stories, a market snapshot, a watchlist, a coverage note and
a sources list. Global content is English; China content is Chinese; structural
labels are bilingual.

## Repository layout

```
SKILL.md                       the skill itself - start here
reference/sources.md           the two-tier source registry
reference/output-contract.md   the exact briefing grammar
reference/state-schema.md      the state file format
reference/feasibility.md       fetch probes: which outlets can actually be read
scripts/check-diversity.mjs    fails a section that rests on a single outlet
scripts/check-provenance.mjs   fails any story missing exactly one [prov:*] marker
scripts/collect-markets.mjs    keyless market data (Yahoo Finance, Eastmoney)
scripts/fetch-page.mjs         reads article pages with retry and profile variation
scripts/fetch-feeds.mjs        publisher RSS feeds plus discovery-only items
scripts/render-html.mjs        Markdown -> self-contained HTML
scripts/update-state.mjs       computes the window, records the run
examples/                      an illustrative sample briefing
```

### Running the scripts directly

```sh
SKILL=~/.dsh/skills/daily-news-briefing
OUT=${BRIEFING_DIR:-$PWD/briefings}; mkdir -p "$OUT"; DATE=$(date +%F)

node "$SKILL/scripts/update-state.mjs" plan --state "$OUT/briefing-state.json"
node "$SKILL/scripts/collect-markets.mjs" --out "$OUT/.markets.json"
node "$SKILL/scripts/fetch-feeds.mjs" --since <SINCE> --out "$OUT/.feeds.json"
# ... write "$OUT/briefing-$DATE.md" against reference/output-contract.md ...
node "$SKILL/scripts/check-diversity.mjs" "$OUT/briefing-$DATE.md"   # must print DIVERSITY: OK
node "$SKILL/scripts/check-provenance.mjs" "$OUT/briefing-$DATE.md" # must print PROVENANCE: OK
node "$SKILL/scripts/render-html.mjs" "$OUT/briefing-$DATE.md" --out "$OUT/briefing-$DATE.html"
```

| Script | Role |
|---|---|
| `update-state.mjs` | `plan` computes the coverage window; `update` records the run and the story history |
| `collect-markets.mjs` | Yahoo Finance (keyless), with Eastmoney as the cross-check for the China 10-year bond row |
| `fetch-feeds.mjs` | Publisher RSS feeds (dated, usable as primaries) and Google News items (discovery only) |
| `check-diversity.mjs` | Exits non-zero when a section's primaries are all one outlet |
| `check-provenance.mjs` | Exits non-zero when a story lacks exactly one `[prov:*]` marker |
| `fetch-page.mjs` | Reads an article page with retry and browser/plain profile variation; reports `dateSource` |
| `render-html.mjs` | Markdown to self-contained HTML |

## Sourcing rules

- Two source tiers: fetch-verified primaries (BBC, SCMP, The Guardian, Al
  Jazeera, Nikkei Asia, Xinhua, gov.cn, NBS, PBoC, Caixin, Yicai, The Paper, CLS,
  STCN) and blocked originals (Reuters, AP, FT, Bloomberg, WSJ return 401/403 to
  automated fetch).
- Every item needs a primary link and an in-window publication timestamp.
  Aggregator-only items are dropped; Google News, Baidu News and Weibo hot search
  are discovery surfaces, never the cited primary.
- Blocked wire copy appears as a corroborated `[alt:OUTLET](url)` link, tagged
  `#unverified` only when no fetchable primary corroborates the story.
- Paywalled items show headline plus link only - locked body text is never
  paraphrased.
- Every story carries a provenance marker: `[prov:full]` (article fetched),
  `[prov:feed]` (publisher RSS), `[prov:link]` (headline and link only).
- Market numbers come only from the collector APIs, each with its as-of time. A
  missing instrument is marked unavailable, never estimated from prose.
- Neither section may rest on a single outlet; a section written from one feed is
  a failed briefing.
- Quiet aspects are noted as quiet. Nothing is padded to hit the item count.

## Limitations

- Some outlets are simply unreadable by automated fetch. The skill records them
  as unverified rather than pretending otherwise.
- The 72-hour cap means a run after several missed days is a partial catch-up,
  and the briefing says so.
- `examples/sample-briefing.md` and its rendered HTML show the exact format.
  They are illustrative and their stories are placeholders - never copy them
  into a real briefing.

## License

MIT - see [LICENSE](LICENSE).
