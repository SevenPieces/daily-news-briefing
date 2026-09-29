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
| headline | yes | the publisher's own headline, **verbatim**; never reworded, translated or summarized |
| outlet | yes | the outlet that published the cited page, not a republisher |
| primaryUrl | yes | the canonical primary link |
| publishedAt | yes | publication time in Asia/Shanghai, YYYY-MM-DD HH:MM; for a reused URL, the in-window update time |
| dateSource | yes | which date field that time came from: datePublished, pubDate, dateModified, or the page's own timestamp; record the field actually used |
| provenance | yes | full, feed or link - the depth actually reached |
| flags | yes | new, followup, developing, paywalled, unverified; classification against the state index is the agent's call (see `reference/output-contract.md`) |
| corroboratingOutlet | when one exists | a second credible outlet reporting the same event; it becomes the `[alt:]` link |
| altUrl | when one exists | that outlet's canonical URL |
| keyFacts | yes | the facts the summary will be written from, 1-2 sentences in the section language; for a paywalled or feed item, quote only the publisher's own title and description |
| gateNote | when the gate fired | what happened to this item: a non-200 fetch, a rejected date, a page-versus-RSS conflict |

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
- **dateRejected** - items dropped because their date field fell outside the
  window, or because the only date available was a modification time.
- **Page-versus-RSS conflicts** - a page and its publisher feed disagreeing on the
  headline, the time or the gist; report both and cite the page. For a reused URL
  whose `datePublished` is outside the window while `dateModified` and the RSS
  `pubDate` are inside, name all three fields and the one cited.

## Where it lives

Records and notes are working material. When written to disk they belong under the
run's staging directory (`$OUT/.staging/<YYYY-MM-DD>/`), which the run deletes
before it finishes. Nothing here is a deliverable and nothing here goes into the
state: the state is fed by `.items.json`, which `scripts/md-to-items.mjs` derives
from the finished briefing Markdown. Never cite a record that no fetch or
publisher feed backs.
