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
   `pdf-parse` for PDF sections; JPEG/PNG/WEBP magic bytes (pages fixed at 1)
   for the `handwriting_samples` image section. HTML error/login pages saved
   with the wrong extension are rejected as failures either way.
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
| `handwriting_samples` | Public-domain Devanagari handwriting photos (Wikimedia Commons) used to smoke-test the Answer-Writing OCR pipeline |

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

---

# Content ingestion pipeline

Once the raw PDFs are on disk (above), the **ingestion** CLIs in
[`apps/api/src/ingest`](../apps/api/src/ingest) turn them into real rows in the
cloud Supabase project. Every script reads real files from `/content-raw` (per
`manifest.json`) and writes real data — **there is no mock data anywhere.**

Run any step with `pnpm ingest:<name>` from the repo root (delegates to the
`api` workspace, which loads `apps/api/.env`).

```
content-raw/*.pdf ──► ingest:syllabus ─► syllabus_nodes
                 └──► ingest:pyq ─► content-raw/parsed/*.json  ─(review)─► ingest:pyq:load ─► questions
                                                                                    │
                                                        ingest:tests ◄──────────────┘─► tests + test_questions
                                                        ingest:embed ─► embeddings (pgvector)
                       ingest:verify ─► counts / coverage report
```

Models come from ONE constants module ([`src/lib/models.ts`](../apps/api/src/lib/models.ts)):
`claude-sonnet-5` for reasoning + vision (structuring, OCR), `claude-haiku-4-5`
for high-volume drafts (translation, classification). Model ids are never inlined.

## `ingest:syllabus`

```
pnpm ingest:syllabus [--paper PRE_GS1] [--dry-run] [--limit-nodes N]
```

1. Extracts text from the official 2026 syllabus PDFs (Hindi + English) with
   `pdf-parse`. **If a PDF is scanned/image-only** (very low chars/page) it is
   **not** skipped — it is routed through Claude vision (`claude-sonnet-5`
   reads the PDF directly) and that language is **flagged** in the run output.
2. For each paper — Prelims (GS-I, CSAT) and reformed Mains (GS-I…GS-VI incl.
   the UP-specific GS-V/GS-VI, plus General Hindi and Essay) — `claude-sonnet-5`
   structures the subtree under a strict JSON schema, grounded in the PDF text.
3. Where only one language parsed cleanly, the other is generated with
   `claude-haiku-4-5` and the node is marked `meta.machine_translated=true` for
   review. (With both official PDFs present, this is usually 0.)
4. **Idempotent upsert keyed on `(paper_code, path)`** — `path` is a
   materialized tree path (`history/ancient-india`); the paper root has path `''`.

Paper codes are globally unique (`PRE_GS1`, `PRE_CSAT`, `MAINS_GH`,
`MAINS_ESSAY`, `MAINS_GS1…GS6`) so the `(paper_code, path)` key never collides
across exam stages.

## `ingest:pyq` (parse) → review → `ingest:pyq:load`

Parsing and loading are **deliberately separate** so a human reviews the parse
before anything touches `questions`.

```
pnpm ingest:pyq --id uppsc_prelims_2024_gs1     # writes JSON, STOPS
#   ...review content-raw/parsed/pyq_uppsc_prelims_2024_gs1.json ...
pnpm ingest:pyq:load --id uppsc_prelims_2024_gs1   # loads reviewed JSON
```

`ingest:pyq`:
1. `claude-sonnet-5` reads the PDF **natively** (best for the bilingual,
   2-column papers — `pdf-parse` mangles the non-Unicode Devanagari font) and
   extracts each question under a strict JSON contract (MCQ options A–D for
   Prelims; descriptive stems for Mains). Large papers are extracted in
   question-number windows that halve on truncation.
2. **Answer-key cross-check** — for Prelims papers with a downloaded official
   answer key, the key is parsed and each MCQ is checked. Mismatches are
   flagged (`meta.answer_key_mismatch`); the official key is treated as source
   of truth and `meta.answer_key_verified=true` is set.
3. **Syllabus classification** — `claude-haiku-4-5` maps each question to the
   best node in that paper's syllabus tree (fetched from the DB).
4. **Bilingual fill** — any missing language is drafted with `claude-haiku-4-5`
   and flagged `meta.machine_translated=true`.
5. Writes `content-raw/parsed/pyq_<id>.json` (questions + a summary block) and
   **stops**. The JSON is a review artifact (git-ignored).

A structured **CSV** source (`year,paper,question,options A–D,answer,…`) is the
alternative input to the PDF path (`--csv <path>`).

`ingest:pyq:load`:
- `source='pyq'`; idempotent upsert keyed on `external_id`
  (`pyq:<manifest_id>:q<n>`).
- Resolves `syllabus_path → syllabus_node_id` via `(paper_code, path)`.
- `is_published=true` **only** when both languages are present (bilingual
  publish gate) — the DB trigger enforces the same rule, so an incomplete row
  loads as a draft instead of failing.

## `ingest:tests`

```
pnpm ingest:tests
```

From **published** questions already in the DB:
1. **Full PYQ papers** — one `pyq_full` test per `(paper_code, year)` (e.g.
   "UPPSC Prelims GS-I 2024"). The real marking scheme is stored on the test
   row (`meta.marking_scheme`): UPPSC Prelims **one-third (−0.33) negative
   marking**; descriptive papers carry none.
2. **Sectional tests** — one `sectional` test per top-level syllabus node, built
   from the published MCQs classified under that section.

Idempotent: tests keyed on `slug`; membership is rebuilt each run.

## `ingest:embed`

```
pnpm ingest:embed [--only syllabus|question] [--limit N]
```

Chunks syllabus node descriptions and question stems/explanations **per locale**,
embeds them with **OpenAI `text-embedding-3-small` (1536-dim)** via the swappable
provider in [`src/lib/embeddings.ts`](../apps/api/src/lib/embeddings.ts), and
upserts into the `embeddings` table (HNSW cosine index). Idempotent upsert keyed
on `(source_type, source_id, locale, chunk_index)`. Vectors are written in
pgvector's `[...]` text format.

## `ingest:verify`

```
pnpm ingest:verify
```

Prints: syllabus nodes per paper, questions per year/paper, % bilingual-complete
(publish gate), % MCQ answer-key-verified, tests by kind, and embedding coverage
per source type.

## Schema support (migration `0018_ingest_support.sql`)

The pipeline added a few columns/keys the ingestion needs (all additive; tables
were empty):

| table | added | why |
| --- | --- | --- |
| `syllabus_nodes` | `path`, `meta`, unique `(paper_code, path)` | idempotency key + provenance |
| `questions` | `external_id`, `meta`, unique `external_id` | idempotency key + provenance/flags |
| `tests` | `slug`, `meta`, unique `slug` | idempotency key + marking scheme |
| `embeddings` | `chunk_index`, unique `(source_type, source_id, locale, chunk_index)` | idempotent re-embedding |

## Embedding decision (recorded per CLAUDE.md)

- Provider: **OpenAI `text-embedding-3-small`**, `dimensions: 1536` — matches
  `extensions.vector(1536)` and the HNSW cosine index in migration `0012`.
- Isolated behind `EmbeddingProvider` in `src/lib/embeddings.ts`; swap the one
  constructor to change vendors. Keep the dimension at 1536 or the column +
  index must change too.
- One embedding row per source per locale per chunk; `chunk_text` is stored
  alongside the vector for debuggability.
