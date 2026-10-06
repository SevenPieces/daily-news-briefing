# Research input schema

The contract is what the briefing must contain. This file is what **research must
produce** before the briefing can be written: one record per candidate story, plus
the run's gate notes. The schema is mandatory; how the research is organised is
not. One agent or two, subagents or not, notes in context or files under the run's
staging directory - all fine - but nothing reaches the briefing that is not in this
shape.

Read `reference/sources.md` before collecting and `reference/output-contract.md`
before writing; this file sits between them.

## Per-story record

    {
      "section": "global",
      "aspect": "Economy",
      "headline": "Publisher's headline, word for word",
      "sourceTitle": "Raw title the fetch printed, before entity decoding",
      "outlet": "BBC",
      "primaryUrl": "https://...",
      "publishedAt": "2026-09-28 09:30",
      "dateSource": "datePublished",
      "provenance": "full",
      "textLength": 11847,
      "flags": ["new"],
      "corroboratingOutlet": "SCMP",
      "altUrl": "https://...",
      "altTitle": "The alternate page's own title",
      "keyFacts": ["...", "..."],
      "gateNote": "..."
    }

| Field | Required | Meaning |
|---|---|---|
| section | yes | global, china, or watch for a Watchlist entry |
| aspect | yes | the aspect heading verbatim: Economy ... Social for Global, 经济 ... 社会 for China; top for a Top story; watch for a Watchlist entry |
| headline | yes | the publisher's own headline, **verbatim**; never reworded, translated or summarized; `fetch-page.mjs` entity-decodes the title it reports and names the markup it came from in `titleSource`, so copy its `title` as it stands; the rendered headings are printed beside it - `h1` for the first and `h1s` for up to five in document order - so a page whose first heading is navigation chrome is visible rather than silent, and a chrome-only heading is never the headline |
| sourceTitle | yes | the title the tool printed, verbatim and **before any entity decoding**: for a fetched page, `fetch-page.mjs`'s `title` field (with `titleSource` naming the markup it came from); for a publisher-feed record, the feed item's own title; for a headline-and-link record, the wire's own headline as it was seen. It is the evidence the headline is checked against - `scripts/check-research.mjs` compares `headline` with `decodeEntities(sourceTitle)` and refuses a headline that differs, allowing only a trailing outlet name after a separator (a page's `<title>` routinely appends one) |
| outlet | yes | the outlet that published the cited page, not a republisher |
| primaryUrl | yes | the canonical primary link |
| publishedAt | yes | publication time in Asia/Shanghai, YYYY-MM-DD HH:MM; for a reused URL, the in-window update time; the tool prints the page's own string, so normalise it: an explicit offset is converted to Asia/Shanghai and the seconds dropped (`2026-09-29T17:30:10+08:00` -> `2026-09-29 17:30`); a bare `YYYY-MM-DD HH:MM:SS` with no zone is read as Asia/Shanghai and truncated the same way (`2026-09-29 11:14:25` -> `2026-09-29 11:14`), never shifted by a guessed offset; when the page states another zone, convert from it; a publisher-feed record takes the item's own `pubDate` - the collector prints it verbatim as an RFC-822 string in GMT (`Tue, 29 Sep 2026 16:23:58 GMT`), so convert it to Asia/Shanghai and drop the seconds before writing this field, and record `pubDate` in `dateSource`; a page whose every available field is date-only carries no clock time and cannot supply `publishedAt` on its own - take the time from another dated source, the publisher feed's `pubDate` when it is in-window or a dated page element that does carry a time, and name the field you read; if no dated source carries a time, reject the item as `dateRejected` and record the date-only value in the gate note; never invent `00:00` or any other clock time |
| dateSource | yes | the exact `dateSource` string the fetch printed, copied character for character; `fetch-page.mjs`'s labels are a closed set - `datePublished`, `dateModified`, `article:published_time`, `itemprop:datePublished`, `meta:date-published`, `meta:publishdate`, `meta:firstpublishedtime`, `meta:lastmodifiedtime`, `meta:date`, `time[datetime]`, `body:text`, and `null` for no recognised date field - and a publisher-feed item records the feed's own field name (`pubDate`); a page read with `web_fetch` or another tool that prints no `dateSource` records that tool's name (`web_fetch`); `fetch-page.mjs` printing `dateSource: null` means the page carried no date field it recognised - record `null`, never a field name the tool did not print, and source `publishedAt` elsewhere (the publisher feed's `pubDate`, or a dated page element read and named as such); no other dated source means `dateRejected`. A date-only field carries no clock time: it cannot supply a mandatory `publishedAt`, so the publishedAt row's rule decides such an item. Chinese state and central publishers (news.cn, cnr.cn, gmw.cn, mod.gov.cn) print a date-only `meta:publishdate`, and the same rule decides their records - the date is evidence, the clock must come from a dated element that carries one, which the tool reads from the rendered page and reports as `body:text`. That label is therefore the **normal** reading for these publishers, not an exception: it is what the clock in the page's own header looks like. When the value is neither `datePublished` nor `dateModified`, the reused-URL check below cannot lean on the label alone: look at the page itself before admitting or rejecting the item. `fetch-page.mjs` prints `dateOnly` - true when the field it chose carries no clock time - and `dateRejected`, the fields it saw and refused, so the distinction does not have to be re-derived |
| provenance | yes | full, feed or link - where the summary's words came from: the article body, the publisher feed's own description, or the headline and link alone; a fetched page with no article body is link unless the summary is taken from the publisher's own feed description, which is feed; it is never full |
| textLength | yes | the evidence for the provenance call it is attached to, exactly as counted, never rounded - the length of the text the call rests on, not of the fetch: `scripts/fetch-page.mjs` returned `ok:true` and the summary came from the page body - the `textLength` it printed, the full stripped length whether or not `--text` truncated the excerpt; returned `ok:false` (too small, non-HTML, blocked) - 0, with its `error` in `gateNote`; returned `ok:true` with `textTruncated` true - the excerpt was cut at 1500 characters while `textLength` is the full stripped length, so the truncation is visible rather than assumed; returned `ok:true` but the excerpt is chrome only with no publisher feed describing the story, so the item is recorded a link - 0, because the call rests on the headline and link rather than on the chrome, with the printed `textLength` reported in `gateNote` as the body-less fetch evidence; the page was read with `web_fetch` or another tool - the character length of the text obtained; a publisher RSS record, with the summary from the feed's own description - the character length of that description, never the printed `textLength` of a fetch that returned no body the summary used; a publisher RSS record whose item carries **no** description, so the summary is the headline alone (the paywalled case above) - 0, with the feed's own title in `sourceTitle` and the headline-only fallback named in the coverage note; a headline-and-link wire item, neither fetched nor described by a feed - 0. A printed `textLength` that measures no body the summary came from does not become this field's value: report it in `gateNote` as the body-less fetch evidence |
| flags | yes | new, followup, developing, paywalled, unverified; classification against the state index is the agent's call (see `reference/output-contract.md`) |
| corroboratingOutlet | when one exists | a second credible outlet reporting the same event, never the outlet already cited as `[src:]`, and its page's own title must confirm that event (record that title in `altTitle`); it becomes the `[alt:]` link |
| altUrl | when one exists | that outlet's canonical URL |
| keyFacts | yes | the facts the summary will be written from, 1-2 sentences in the section language; for a paywalled or feed item, quote only the publisher's own title and description |
| gateNote | when the gate fired | what happened to this item: a non-200 fetch, a body-less 200, a rejected date, a page-versus-RSS conflict |

### Reused URLs - datePublished outside the window

An outlet that updates one URL in place (BBC does this constantly) can carry a
`datePublished` outside the window while `dateModified` and its RSS `pubDate`
are both inside it. Check all three fields before accepting or rejecting such an
item:

- `dateModified` **and** the RSS `pubDate` inside the window: the item IS an
  in-window update. Include it, cite the update time as the story's published
  time, and disclose the original publication date in the coverage note.
- A modification time alone, with no RSS match and no new facts inside the
  window: do not admit it.

Set `dateSource` to the field used and report the disagreement in the run-level
gate notes below.

## Run-level gate notes

Beyond the per-story records, research reports what it could not find, so the
coverage note can say so honestly:

- **Quiet aspects** - an aspect with no real news inside the window, named as quiet
  rather than padded.
- **Non-200 codes** - every fetch that ended in a status other than 200, with the
  URL, so a licence gate (402) is not mistaken for a flaky CDN.
- **Body-less fetches** - a fetch that returned HTTP 200 with no article body: a
  chrome-only excerpt (the 1500-character window can be nothing but chrome even
  when the printed `textLength` runs to thousands of characters), a consent
  wall, a non-HTML answer - each with the URL and whichever evidence exists:
  `fetch-page.mjs`'s `textLength` when it returned `ok:true`, otherwise its
  `error`; the item is feed when the summary is taken from the publisher's own
  feed description, link otherwise - never full.
- **dateRejected** - items dropped because their date field fell outside the
  window, because the only date available was a modification time, or because
  every available field was date-only and no dated source carried a clock time
  (record the date-only value here rather than inventing one).
- **Page-versus-RSS conflicts** - a page and its publisher feed disagreeing on the
  headline, the time or the gist; report both and cite the page. For a reused URL
  whose `datePublished` is outside the window while `dateModified` and the RSS
  `pubDate` are inside, name all three fields and the one cited.
- **Fetch ledger** - every article-page URL the run fetched, with the per-agent
  split and the union. Write it to `$OUT/.fetch-ledger.json` beside the other run
  artifacts so it outlives Step 7 and the coverage note's count can be
  reconciled against it rather than an agent's memory. The deterministic
  collectors - the feed URLs in `.feeds.json` and the market instruments in
  `.markets.json` - are not part of it.
  The coverage note counts URLs, one per URL, however many HTTP requests the
  retries cost (see `reference/output-contract.md`), and one URL can cost up to
  8 requests (2 header profiles x 2 transports x 2 rounds - `reference/sources.md`).
  The ledger carries that cost so the two reconcile. Its per-agent lists hold one
  entry per URL that agent fetched, and each entry records the attempts behind
  it; `requests` totals every entry. **The ledger is the record.** A subagent may
  report its own tally of URLs and requests, and that tally may disagree with its
  own records - on 2026-10-06 the agents self-reported 43 distinct / 59 requests
  against the ledger's 42 / 56. Reconcile to what the ledger holds; the
  reconciled figure is what the coverage note carries, and the disagreement is not
  reported:

      {
        "generatedAt": "2026-09-30T00:37:17.805Z",
        "briefingDate": "2026-09-30",
        "distinctUrlsFetched": 24,
        "requests": 33,
        "orchestrator": [ { "url": "https://...", "attempts": 12 },
                          { "url": "https://...", "attempts": 1 } ],
        "globalAgent":  [ { "url": "https://...", "attempts": 1 } ],
        "chinaAgent":   [ { "url": "https://...", "attempts": 4 } ]
      }

  `attempts` is what `fetch-page.mjs` printed for that URL, or the requests the
  agent made for it when the probe failed; a deterministic collector's poll is
  never an entry. `distinctUrlsFetched` is the union across the lists - a URL two
  agents both fetched is one distinct URL - while `requests` sums every entry, so
  an overlap counts its requests twice, as the run really spent them. The live
  2026-09-30 ledger recorded 24 distinct URLs, one of which cost 12 requests; the
  ledger keys around these fields (`window`, `target`, `allowanceBreakdown`,
  `failures`, `unionNote`, `gates`, `blockedWireResolutions`, `archiveAttempts`)
  are unchanged; `blockedWireResolutions` and `archiveAttempts` are written as
  empty arrays when the run probed nothing - never omitted, never null.
- **Archive attempts** - every blocked wire URL probed for a snapshot and what
  each probe answered, so Step 4b's archive rule leaves a trace. Either probe
  counts: the `https://web.archive.org/web/2/<url>` read or the
  `https://archive.org/wayback/available?url=<url>` API, with the HTTP status it
  answered, the date, and which fall-through was taken (`[alt:AP](url)`, then
  `[find:AP](search)`). A refusal is a result, not a finding that no snapshot
  exists, and a failed read never drops the story.

## Where it lives

Records and notes are working material. When written to disk they belong under the
run's staging directory (`$OUT/.staging/<YYYY-MM-DD>/`), which the run deletes
before it finishes. The records go there as `records.json`, a JSON array in
report order, so they can be checked before the briefing that would carry their
errors is written:

~~~sh
node "$SKILL/scripts/check-research.mjs" "$STAGE/records.json" --window "<SINCE>" "<UNTIL>"
~~~

`<SINCE>` and `<UNTIL>` are Step 2's `window.since` and `window.until` copied
straight from the plan JSON - the ISO-8601 instants - or the same instants in the
local `YYYY-MM-DD HH:MM` form. The gate accepts either, reads a zone-less ISO
instant as Asia/Shanghai, and prints the window back in local time so its messages
and the records are written in the same language. Copy the fields; do not
hand-convert them first, and do not invent a window the plan did not announce.

It prints one line per problem, naming the record index and the field, and exits
0 clean, 1 on a violation, 2 on a usage error or unreadable input. Two findings
are warnings that print without failing the run: an aspect whose records all come
from one outlet, and a `dateSource` that is neither `datePublished` nor
`dateModified`. Its checks and the record shape it expects are documented in its
own header.

Nothing here is a deliverable and nothing here goes into the state: the state is
fed by `.items.json`, which `scripts/md-to-items.mjs` derives from the finished
briefing Markdown. Never cite a record that no fetch or publisher feed backs.
