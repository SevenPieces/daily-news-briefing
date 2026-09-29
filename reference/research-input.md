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
      "outlet": "BBC",
      "primaryUrl": "https://...",
      "publishedAt": "2026-09-28 09:30",
      "dateSource": "datePublished",
      "provenance": "full",
      "textLength": 11847,
      "flags": ["new"],
      "corroboratingOutlet": "SCMP",
      "altUrl": "https://...",
      "keyFacts": ["...", "..."],
      "gateNote": "..."
    }

| Field | Required | Meaning |
|---|---|---|
| section | yes | global or china |
| aspect | yes | the aspect heading verbatim: Economy ... Social for Global, 经济 ... 社会 for China; top for a Top story |
| headline | yes | the publisher's own headline, **verbatim**; never reworded, translated or summarized; `fetch-page.mjs` prints the raw HTML title, so decode HTML entities (for example `&#039;` and `&#x27;`) before publishing - the headline must be the publisher's rendered headline, not its escaped source text |
| outlet | yes | the outlet that published the cited page, not a republisher |
| primaryUrl | yes | the canonical primary link |
| publishedAt | yes | publication time in Asia/Shanghai, YYYY-MM-DD HH:MM; for a reused URL, the in-window update time; the tool prints the page's own string, so normalise it: an explicit offset is converted to Asia/Shanghai and the seconds dropped (`2026-09-29T17:30:10+08:00` -> `2026-09-29 17:30`); a bare `YYYY-MM-DD HH:MM:SS` with no zone is read as Asia/Shanghai and truncated the same way (`2026-09-29 11:14:25` -> `2026-09-29 11:14`), never shifted by a guessed offset; when the page states another zone, convert from it; a page whose every available field is date-only carries no clock time and cannot supply `publishedAt` on its own - take the time from another dated source, the publisher feed's `pubDate` when it is in-window or a dated page element that does carry a time, and name the field you read; if no dated source carries a time, reject the item as `dateRejected` and record the date-only value in the gate note; never invent `00:00` or any other clock time |
| dateSource | yes | the exact `dateSource` string the fetch printed, copied character for character; the tool's names are examples, not a closed set - `datePublished`, `article:published_time`, `itemprop:datePublished`, `meta:pubdate`, `meta:publishdate`, `time[datetime]`, `dateModified` - and a publisher-feed item records the feed's own field name (`pubDate`); a page read with `web_fetch` or another tool that prints no `dateSource` records that tool's name (`web_fetch`); `fetch-page.mjs` printing `dateSource: null` means the page carried no date field it recognised - record `null`, never a field name the tool did not print, and source `publishedAt` elsewhere (the publisher feed's `pubDate`, or a dated page element read and named as such); no other dated source means `dateRejected`. A date-only field carries no clock time: it cannot supply a mandatory `publishedAt`, so the publishedAt row's rule decides such an item. Chinese state and central publishers (news.cn, cnr.cn) print a date-only `meta:publishdate`, and the same rule decides their records - the date is evidence, the clock must come from a dated element that carries one. When the value is neither `datePublished` nor `dateModified`, the reused-URL check below cannot lean on the label alone: look at the page itself before admitting or rejecting the item |
| provenance | yes | full, feed or link - where the summary's words came from: the article body, the publisher feed's own description, or the headline and link alone; a fetched page with no article body is link unless the summary is taken from the publisher's own feed description, which is feed; it is never full |
| textLength | yes | the evidence for the provenance call it is attached to, exactly as counted, never rounded - the length of the text the call rests on, not of the fetch: `scripts/fetch-page.mjs` returned `ok:true` and the summary came from the page body - the `textLength` it printed, the full stripped length whether or not `--text` truncated the excerpt; returned `ok:false` (too small, non-HTML, blocked) - 0, with its `error` in `gateNote`; returned `ok:true` but the excerpt is chrome only with no publisher feed describing the story, so the item is recorded a link - 0, because the call rests on the headline and link rather than on the chrome, with the printed `textLength` reported in `gateNote` as the body-less fetch evidence; the page was read with `web_fetch` or another tool - the character length of the text obtained; a publisher RSS record, with the summary from the feed's own description - the character length of that description, never the printed `textLength` of a fetch that returned no body the summary used; a headline-and-link wire item, neither fetched nor described by a feed - 0. A printed `textLength` that measures no body the summary came from does not become this field's value: report it in `gateNote` as the body-less fetch evidence |
| flags | yes | new, followup, developing, paywalled, unverified; classification against the state index is the agent's call (see `reference/output-contract.md`) |
| corroboratingOutlet | when one exists | a second credible outlet reporting the same event, never the outlet already cited as `[src:]`, and its page's own title must confirm that event (record that title beside the URL); it becomes the `[alt:]` link |
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
- **Archive attempts** - every blocked wire URL probed with the archive
  availability API, and what each answered, so Step 4b's archive rule leaves a
  trace.

## Where it lives

Records and notes are working material. When written to disk they belong under the
run's staging directory (`$OUT/.staging/<YYYY-MM-DD>/`), which the run deletes
before it finishes. Nothing here is a deliverable and nothing here goes into the
state: the state is fed by `.items.json`, which `scripts/md-to-items.mjs` derives
from the finished briefing Markdown. Never cite a record that no fetch or
publisher feed backs.
