# Content acquisition pipeline

Real UPPSC source files (syllabus, previous-year question papers, official answer
keys) are downloaded automatically — **nobody downloads anything by hand as a
first step.** A fresh clone repopulates every file with:

```bash
pnpm content:fetch
```

## What it does

1. Reads [`/content-sources.yaml`](../content-sources.yaml) — the curated list of
   real source URLs, every one of which was verified to serve an actual PDF
   (`%PDF` magic bytes / `application/pdf`) on an official government domain or,
   where noted, a reputable coaching mirror.
2. Downloads each source to `content-raw/<section>/<id>.pdf`.
3. Validates every file: `%PDF` magic bytes **and** a real page count via
   `pdf-parse`. HTML error/login pages saved as `.pdf` are rejected as failures.
4. Maintains [`content-raw/manifest.json`](../content-raw/manifest.json):
   `{id, section, url, path, sha256, bytes, pages, fetched_at, status, origin, error?}`.

The binaries themselves are **git-ignored**; the yaml and the manifest are
committed, so the manifest is the source of truth for "what should exist" and
`pnpm content:fetch` reconstructs it.

## Sections

| section       | what                                                        |
| ------------- | ---------------------------------------------------------- |
| `syllabus`    | Current/reformed UPPCS syllabus (Prelims GS-I + CSAT, Mains 8 papers incl. UP-specific GS-V/VI), Hindi + English |
| `pyq_prelims` | Prelims GS-I + CSAT question papers                        |
| `pyq_mains`   | Mains question papers (8 papers/year, whatever is published) |
| `answer_key`  | Official Prelims answer keys                               |

## Politeness & robustness

- **1 request / 2s**, realistic desktop `User-Agent`.
- **3 retries** with exponential backoff (2s → 4s → 8s).
- **Session handling.** `uppsc.up.nic.in` is an ASP.NET/IIS site: its
  `View_Enclosure.aspx` / `Open_PDF.aspx` links **302-redirect to the homepage
  unless a session cookie exists.** Entries that need this carry `needs_cookie:
  true`, a `warmup` URL (hit first, same cookie jar, to mint
  `ASP.NET_SessionId` / `__AntiXsrfToken`), and a `referer`. The fetcher keeps a
  per-host cookie jar and, if it still gets HTML back, re-warms and retries.
  A couple of official `Open_PDF.aspx` tokens contain literal `/` or `+` — they
  are stored raw in the yaml and passed through un-re-encoded.
- **Idempotent + resumable.** A file already on disk that is still a valid PDF
  and whose `sha256` matches the manifest is **skipped** — a re-run only fetches
  what is missing or previously failed. The manifest is written after every item,
  so an interrupted run resumes cleanly.

## When a site blocks the script

Every run ends with a **failure table**: the failed `id`, the exact `url`, the
target `save` path, and why it failed. Grab those URLs in a browser and drop the
PDF at the printed `content-raw/<section>/<id>.pdf` path.

**Hand-dropped files are first-class citizens.** On the next `pnpm content:fetch`
any PDF you placed under `content-raw/` is validated and checksummed into the
manifest — `status: "manual"` if it fills a known source id, `status: "orphan"`
if it has no yaml entry. Either way it gets an `sha256`, `bytes`, and `pages`
like any downloaded file.

## Adding a source

Append an entry to `content-sources.yaml` under `verified:` (only after you have
confirmed the URL really serves a PDF):

```yaml
- id: uppsc_prelims_2024_gs1      # becomes content-raw/pyq_prelims/<id>.pdf
  section: pyq_prelims            # syllabus | pyq_prelims | pyq_mains | answer_key
  url: https://…/paper.pdf
  lang: both                      # hi | en | both
  year: 2024                      # optional
  paper: gs1                      # optional label
  notes: …
  # session-gated ASP.NET sources only:
  needs_cookie: true
  warmup: https://uppsc.up.nic.in/Default.aspx
  referer: https://uppsc.up.nic.in/OuterPages/PreQuesPapers.aspx?ID=PrevQues
```

Sources that are clearly useful but live **only** on a non-government domain and
need a human copyright call go under `needs_my_approval:` instead of `verified:`
— the fetcher ignores that section until an entry is promoted.

## Provenance & copyright

Government-hosted PDFs (`uppsc.up.nic.in`, other `*.gov.in` / `*.nic.in`) are the
primary, authoritative sources. Coaching-mirror URLs (e.g. Drishti IAS) are
included only as resilient fallbacks / for years the official site no longer
serves, are marked `domain_is_government: false` in the yaml, and are exam papers
that are already public record. The `needs_my_approval` gate exists so nothing
copyright-sensitive is downloaded without an explicit human decision.
