# UPSC study chapters — model-switch regression test, and an independent coverage-ceiling audit

**Date:** 2026-08-07 · **Verdict: NO REGRESSION. No chapter was modified.**

This document exists so the "did the default-model switch degrade the later chapters?" hypothesis is
not re-raised and re-tested later without new cause. It records the actual numbers, the methodology,
and the two artifacts that had to be excluded before the numbers could be read.

**Cost: $0 of Anthropic API spend.** All eight agents (3 panel judges, 4 coverage auditors, 1 completeness
auditor) were free coding-agent subagents. No `pnpm notes:chapter` call, no paid path, no DB write —
**every script this session ran used only `.select()`** (12 calls, mechanically verified: zero
`insert`/`update`/`upsert`/`delete`).

---

## The hypothesis under test

Every chapter-publish commit up to and including `74bc3ea` (24 chapters, 2026-08-02→08-05) carries a
`Co-Authored-By: Claude Opus 5` git trailer. Every commit from `3d03596` through `c786b50`
(2026-08-06) carries **no trailer at all** — a clean break matching a known Claude Code default-model
change. Two prior quality panels had disagreed about UPSC chapter quality, and the switch was the
suspected cause.

Trailer break verified directly (`git log --format='%(trailers:key=Co-Authored-By,valueonly)'`):
11/11 EARLY commits carry it, 19/19 LATE commits do not. **The break is real.**

> **Caveat on the mechanism, stated because it is easy to over-read the trailer.** The trailer records the
> **orchestrator** session's model, not the model of the free subagent that actually authored each chapter.
> A subagent inherits the parent's model when none is specified, so propagation is plausible — but the
> trailer is circumstantial evidence of the authoring model, not proof of it.

### Arm membership was derived mechanically, not from commit prose

`docs/upsc-chapter-coverage.md` is regenerated in every publish commit. Diffing the *published* node_ids
between consecutive versions gives exactly which chapters each commit published.

| arm | commits | chapters |
|---|---:|---:|
| EARLY (trailered, Opus-confirmed) | 11 (`119d11d` … `74bc3ea`) | **24** |
| LATE (untrailered, suspected Sonnet) | 19 (`3d03596` … `c786b50`) | **54** |

⚑ **Premise correction: the LATE arm is 54 chapters, not 52.** 78 − 24 = 54, and the coverage-doc diff
confirms it node-for-node, with zero chapters dropping out of the published set in between.

---

## ⚑ The finding that reframes the whole question

**Both original panels ran on chapters that predate the switch entirely, so the switch cannot explain
their disagreement — regardless of what this panel found. This correction matters as much as the null
result below.**

`docs/OUTSTANDING.md` §U8 records the second panel as:

> `| 5 chapters | blind panel vs UPPSC chapters | ❌ FAIL 8-1 overall, 8-0 on depth ... |`

- **Premise correction: panel 2 was 5 chapters, not 8.** "8-1" and "8-0" are **win tallies**, not a
  sample size.
- **Both panels sampled the same pre-switch pool.** U8t records the chapter count at that time as
  **"8 of 195 authored, 7 published, 1 `needs_review`"**, all authored 2026-08-01/03. Panel 1 took 5 of
  them; panel 2 took 5 of them. The Aug-5→Aug-6 trailer break is *later than both*.
- **The panels reported incomparable metrics.** Panel 1 reported mean scores (4.91 vs 3.89, gap +1.02
  against a 0.24 noise floor). Panel 2 reported win tallies. A mean-gap and a win-tally are not the same
  quantity, and neither was ever converted into the other — so "one said ahead, one said behind" was never
  a like-for-like contradiction in the first place.
- **That pool was 25% defective.** U8m records that **2 of those 8 chapters were truncated** — "History
  of India and Indian National Movement" stopped at 1857 (omitting the entire INM) and "Environmental
  Ecology, Bio-diversity and Climate Change" contained zero Climate Change. A 5-draw from an 8-pool
  containing 2 truncated chapters very likely included at least one.

**A far better explanation for "8-0 on depth" than a model change: panel 2 drew from a pool a quarter of
which was silently truncated.** Panel 1 drew earlier, before the worst of it was published.

---

## Part 1 — Stratified panel

**Design (identical to the original methodology, so results are comparable).** 6 chapters drawn at random
from each arm; each paired with a domain-matched published **UPPSC** chapter as control; exam names
redacted; deterministic seeded shuffle; 3 free subagent judges scoring **depth / factual grounding /
structure** on 1–5, blind to arm and to side.

- **PRNG:** `mulberry32`, **seed `20260807`** (used for both the arm sampling and the 24-way shuffle).
- **Sample:** 24 files, ~92,000 words. Blinding verified: **0 occurrences of `UPSC`/`UPPSC`** in any file.
- **Control matching:** 10 of 12 pairs are exact or near-exact title matches. The token-Jaccard matcher
  produced two poor controls (0.000 and 0.167); both were **manually overridden** to sensible domain
  matches, recorded explicitly in the key file rather than silently accepted:
  - `Orderly Arrangement of Ideas` → `Skills Assessed and Evaluation Criteria` (essay craft ↔ essay craft)
  - `Resources of South Asia and the Indian Sub-continent` → `Distribution of Key Natural Resources`

### Result — headline

| comparison | depth | grounding | structure | overall |
|---|---:|---:|---:|---:|
| EARLY UPSC (n=6) | 4.72 | 4.44 | 4.72 | 4.63 |
| EARLY UPPSC control (n=6) | 3.17 | 4.28 | 3.56 | 3.67 |
| **→ EARLY gap vs control** | **+1.56** | **+0.17** | **+1.17** | **+0.96** |
| LATE UPSC (n=6) | 4.72 | 4.33 | 4.67 | 4.57 |
| LATE UPPSC control (n=6) | 3.50 | 3.83 | 3.89 | 3.74 |
| **→ LATE gap vs control** | **+1.22** | **+0.50** | **+0.78** | **+0.83** |
| **EARLY UPSC − LATE UPSC** | **+0.00** | **+0.11** | **+0.06** | **+0.06** |
| **NOISE FLOOR** (inter-judge mean absolute pairwise disagreement) | **0.28** | **0.31** | **0.25** | **0.23** |

**Every EARLY−LATE difference is far inside the noise floor. Depth — the dimension specifically under
suspicion — is exactly 0.00.** Both arms beat their controls by margins that *do* exceed the noise floor
(+0.96 and +0.83 overall).

### Per-judge — the direction does not even agree

| judge | EARLY gap vs control | LATE gap vs control | which arm did this judge prefer? |
|---|---:|---:|---|
| J1 | +0.89 | +1.00 | **LATE** |
| J2 | +1.06 | +0.67 | EARLY |
| J3 | +0.94 | +0.83 | EARLY |

One of three judges rated the *suspected-degraded* arm higher. Disagreement in sign across judges on a
difference smaller than the noise floor is the signature of noise, not of a regression.

### Corroborating signal — factual-error flags run the *wrong* way for the hypothesis

Judges were required to quote verbatim any claim they believed factually wrong.

- **EARLY UPSC chapters: 7 distinct error flags** across 3 of 6 chapters.
- **LATE UPSC chapters: 4 distinct error flags** across 4 of 6 chapters.

If the switch had degraded grounding, this should have gone the other way.

### Artifacts found and handled

**1. Exam-format artifact (the documented class) — EXCLUDED.** All three judges flagged sample-22's claim
that candidates "write **two essays**, choosing one topic each from **two different sections out of four
sections offered**". Judges 1 and 3 corrected it using the *other* exam's format ("two sections of four
topics each"). Sample-22 is the **UPPSC control**, and the four themes it names match the four
`MAINS_ESSAY` depth-1 section nodes in UPPSC's own syllabus tree exactly. Per the precedent set when this
class was first identified, sample-22 was **excluded from the grounding dimension** and the panel
re-scored.

⚑ **Note the direction: this artifact penalised the CONTROL, i.e. it *inflated* the UPSC arm's apparent
advantage** — the same direction as the original CSAT-question-count artifact. Excluding it moves the
LATE grounding gap from +0.50 to **+0.27** (noise floor 0.29 → inside noise). **The EARLY−LATE comparison
is unchanged** (+0.11), because the artifact sits in a control.

**2. Export artifact of my own making — NOT a content defect.** All three judges independently reported
"empty `[pyq_inline]` placeholder boxes" as a real content hole (e.g. a box reading only *"Real PYQs
testing this sub-topic:"*). **All 29 such boxes across the whole bank carry real `pyq_ids`** (1–6 each) —
the box text is a lead-in and the reader UI renders the actual questions from those ids. **My markdown
export dropped the PYQ chips**, manufacturing the appearance of an unkept promise. Three independent
judges were confidently wrong about the same thing because the harness misrepresented the artefact.
The defect is in the export, not the chapters; it affected both arms (EARLY 3/24, LATE 3/54) so it does
not bias the comparison, but it did mildly depress absolute structure scores.

### Limitations, stated rather than buried

- **n=6 per arm.** This is larger than either prior panel (both n=5) but still small. It is adequate to
  rule out a gap of the size the hypothesis predicted; it could not detect a gap of ~0.2.
- **Residual de-blinding.** Redaction removed exam names but not `Uttar Pradesh` as ordinary content, and
  UPPSC controls carry roughly twice as many redactions as UPSC chapters (70 vs 36 in EARLY). This is a
  mild signal a judge could in principle exploit, and it would inflate the **UPSC-vs-control** gap.
  It does **not** touch the EARLY-vs-LATE comparison, which is the actual question — both UPSC arms were
  treated identically. (Redaction also produced 2 "the the Commission" double-article artifacts, both in
  controls.)
- **The UPSC-vs-control gaps should be read with the structural caveat recorded when the first panel ran:**
  the UPSC chapters were, by the documented workflow, drafted *from* the UPPSC ones and expanded, so a
  derived-and-expanded arm beating its source is close to tautological. **That caveat does not apply to
  the EARLY-vs-LATE comparison**, which is the finding this document is actually about.

---

## Objective structural metrics (all 78 chapters, not the sample)

The arms **do** differ measurably in shape — which is worth recording, because it is what a reasonable
person would point at next, and it did not translate into a quality difference the panel could see.

| metric | EARLY (n=24) | LATE (n=54) |
|---|---:|---:|
| sections | 7.7 | **6.0** |
| words (English) | 3906 | 3902 |
| **words per section** | 512 | **657** |
| decisive facts | 25.8 | 22.1 |
| boxes | 13.8 | **9.2** |
| diagrams | 3.3 | **1.7** |
| PYQ references | 12.3 | **9.4** |
| unresolved fact-audit flags | 0 | 0 |

**Total length is identical (3906 vs 3902 words). LATE writes fewer, longer sections with fewer study
aids.** EARLY's minimum is 5 sections; LATE has 7 chapters at ≤4 sections, the thinnest being
`Historical Underpinnings, Evolution and Features` at 2 sections / 2 PYQ refs.

**This is a real stylistic difference that the panel did not score as a quality difference.** Fewer boxes
and diagrams are a legitimate concern for a study product, but they are not "depth", and depth measured
exactly equal. Recorded here so the observation is available without being mistaken for the regression it
is not.

---

## Completeness audit (the U8m truncation class), both arms

An independent agent read all 78 chapters against each node's **own declared syllabus scope** — never
against section or word counts, which is precisely the proxy that failed before.

**Result: 68 complete · 5 thin · 5 truncated.** All 10 defects named:

| verdict | arm | paper | chapter | what is missing |
|---|---|---|---|---|
| truncated | EARLY | `UPSC_PRE_GS1` | **Political System** | **Vice-President** — S1's heading is literally "The President and Vice-President"; the term appears once in the whole file, in that heading. No Art. 63–66, no election/tenure/role. Also federalism's Lists / Art. 248–252 mechanics. |
| truncated | EARLY | `UPSC_PRE_GS1` | **Economic and Social Development** | **Social schemes** — no MGNREGA/PDS/PM-JAY/PM-KISAN/Jan Dhan anywhere; demographics is mention-only. |
| truncated | LATE | `UPSC_PRE_GS1` | **Indian National Movement** | **Early nationalists** — declared scope is "*from the early nationalists* to independence and partition"; 0 hits for moderate/extremist/1885/Swadeshi/Tilak/Gokhale/Naoroji/Quit India. Jumps 1931→1947. |
| truncated | LATE | `UPSC_MAINS_GS2` | **Historical Underpinnings, Evolution and Features** | **Constituent Assembly** (named in the description; only a passing sub-clause inside the 1935 Act section); salient features narrowed to the Preamble's five adjectives. |
| truncated | LATE | `UPSC_MAINS_GS2` | **Appointment to Constitutional Posts and Constitutional Bodies** | **"powers and functions"** — the description's whole second half. UPSC's functions, the Governor's actual powers and CAG's audit powers are all absent; the chapter self-reframes around appointment/removal/funding only. |
| thin | LATE | `UPSC_MAINS_GS1` | **History of the World** | colonization as its own topic (only its *effects* are taught) |
| thin | LATE | `UPSC_MAINS_GS1` | **Natural Resources and Industrial Location** | tertiary-sector location factors (one aside) |
| thin | LATE | `UPSC_MAINS_GS1` | **Resources of South Asia and the Indian Sub-continent** | soil resources (only regur, inside another section) |
| thin | LATE | `UPSC_PRE_CSAT` | **General Mental Ability** | series, analogies, classification — the chapter openly admits no PYQ backing |
| thin | LATE | `UPSC_PRE_GS1` | **Sustainable Development** | the SDG framework itself (one passing clause) |

**Rates: truncated — EARLY 2/24 (8.3%), LATE 3/54 (5.6%). The severe defect is slightly MORE common in
the EARLY arm.** `thin` appears only in LATE (0/24 vs 5/54), consistent with the fewer-sections /
fewer-aids shape above. Any-defect: EARLY 8.3%, LATE 14.8%.

The two historically-defective chapters (U8m) both now pass — they were repaired.

> The auditor **corrected its own readers in both directions**: it overturned two false positives
> (`Challenges of Corruption` looked bare with zero Lokpal/CVC/CBI mentions but genuinely teaches
> institutional response through Citizen's Charters, Right to Public Service Acts, the PC Act 1988/2018
> and the CCS Conduct Rules — literal-term absence ≠ component absence; and `History of India and Indian
> National Movement` in fact reaches the 20 Feb 1947 Attlee handoff) and it *upgraded* one verdict from
> `thin` to `truncated`. Several `complete` verdicts rest on an **explicit** deferral to a named sibling
> chapter; the five `truncated` ones differ precisely in that their gaps are **silent**.

---

## Part 2 — Remediation: **NOT TRIGGERED**

The branch condition was "LATE scores meaningfully below EARLY, where a gap must exceed the inter-judge
mean absolute pairwise disagreement to count as real". It does not:

| dimension | EARLY − LATE | noise floor | real? |
|---|---:|---:|---|
| depth | +0.00 | 0.28 | no |
| grounding | +0.11 | 0.31 (0.29 artifact-excluded) | no |
| structure | +0.06 | 0.25 | no |
| overall | +0.06 | 0.23 | no |

**No chapter was read for rewriting, re-authored, superseded, or modified in any way. No `chapter_version`
was incremented. Zero DB writes.**

**Verification method for the no-op, stated because "I didn't change anything" is worth proving rather
than asserting:** every script this session ran was scanned for Supabase write verbs. The scan returns
**12 `.select(` calls and zero `.insert(`/`.update(`/`.upsert(`/`.delete(`**. `uppsc`'s 284 published
chapters and `upsc`'s 78 are therefore untouched *by construction* — not merely unchanged as far as a
re-count could tell. `git status` shows no tracked file modified by the analysis.

> **One verification could not be completed.** A closing re-read of the live chapter counts failed on a
> transient outbound-network failure in this sandbox (node's `fetch` returning `ENOTFOUND` while
> `nslookup` resolved the host correctly, and `curl` to unrelated hosts also failing). It is not
> load-bearing given the write-verb proof above, and `docs/upsc-chapter-coverage.md` (regenerated
> 2026-08-06, 78/195) remains accurate and needed no regeneration because nothing changed.

### The hypothesis is ruled out — record it, do not re-test it

**The default-model switch did not cause a quality regression in the untrailered batch.** Three
independent lines of evidence agree:

1. The panel measures the EARLY−LATE difference at **0.00–0.11 across all three dimensions**, against a
   noise floor of 0.23–0.31, with judges disagreeing on the sign.
2. **Factual-error flags are higher in EARLY** (7 vs 4).
3. **The severe completeness defect is more common in EARLY** (8.3% vs 5.6%).

**And the original contradiction was never about the switch in the first place** — both panels ran on
pre-switch chapters (see the reframing above).

### The original contradiction — what it actually was

Not "one panel is wrong", but **three concrete methodological differences that were assumed away**:

1. **Different metrics.** Mean-score gap vs win tally. Never reconciled.
2. **A defective population.** Panel 2 drew 5 from an 8-chapter pool of which 2 were silently truncated.
3. **A blinding artifact inflating panel 1.** Already documented at the time: excluding it dropped panel 1's
   factual-grounding gap from +0.60 to +0.20, *inside* its own 0.27 noise floor.

Panel 1's *depth* and *structure* findings survived its artifact; panel 2's depth failure is explained by
the truncated chapters. **Read that way the two panels are not in contradiction at all** — they measured
different things, with different metrics, on a population that changed underneath them.

**If chapter quality is ever re-tested, fix these first:** report one metric consistently, exclude
chapters with known completeness defects from the sample or stratify on them, and render `pyq_inline`
boxes' actual questions into the judged text.

---

## Part 3 — Independent coverage-ceiling audit

Four fresh auditors (none authored any chapter) walked **all 117 unauthored nodes** against the **actual
published body text** of all 78 chapters — not headings, not the rollout's own summary claims. A
`redundant` verdict required naming the covering chapter and section **and quoting a verbatim ≥2-sentence
teaching passage**; a matching heading was explicitly ruled insufficient. Cross-paper coverage was in
scope.

**Result: 101 redundant · 16 partial · 0 uncovered.** All 117 classified, no node skipped. **Zero
`redundant` verdicts rested on a weak quote** (all evidence quotes ≥20 words; verified mechanically).

| auditor | scope | redundant | partial | uncovered |
|---|---|---:|---:|---:|
| A | `UPSC_MAINS_GS1` (32) | 28 | 4 | 0 |
| B | `UPSC_MAINS_GS3` (29) | 26 | 3 | 0 |
| C | `UPSC_MAINS_GS4` + `UPSC_PRE_CSAT` (27) | 26 | 1 | 0 |
| D | `UPSC_MAINS_GS2` + `UPSC_PRE_GS1` (29) | 21 | 8 | 0 |
| **total** | **117** | **101** | **16** | **0** |

### Verdict on the rollout's "78 is the structural ceiling" claim

**Directionally right, but not exact — and it should not be quoted as "everything is covered".**

- **Right:** no node is wholly uncovered. Authoring 117 more chapters would overwhelmingly duplicate
  existing content, so stopping at 78 was a defensible call, and the redundancy verdicts hold up against
  a deliberately adversarial standard.
- **Wrong in detail:** **16 nodes have real, specifically named gaps** — content taught nowhere in the
  bank. These are not "thin coverage"; they are absences confirmed by corpus-wide zero-hit searches that
  the auditors re-ran themselves rather than trusting their own sub-readers.

### All 16 gaps, by real PYQ weight — this is the future authoring worklist

| weight | paper | node | what is missing |
|---:|---|---|---|
| 23 | `UPSC_PRE_CSAT` | **Data Interpretation** | **charts and graphs** — 2 of the 4 named forms have no worked item and no technique anywhere; the entire treatment is one pie-chart central-angle formula and one caution. Tables and data sufficiency *are* taught properly. |
| 23 | `UPSC_PRE_GS1` | **World Geography** | **continents** — the whole treatment is one sentence ("Seven continents; Asia is the largest…"); 0 hits for Great Plains / Savanna / Steppe / Prairie / Pampas. No continent is taught as a regional entity. |
| 20 | `UPSC_PRE_GS1` | **Rights Issues** | **human rights** as a concept (0 hits for "Universal Declaration"; 4 incidental mentions) and **NCSC/NCST/NCBC/Art. 338** (0 hits). NHRC appears only as a rhetorical foil. |
| 15 | `UPSC_MAINS_GS3` | **Environmental Pollution and Degradation** | **soil pollution** as a distinct form (the section naming the four forms covers air/noise/thermal/radioactive and skips it) and **municipal solid-waste management** (no SWM Rules 2016, segregation, landfills or waste-to-energy). |
| 13 | `UPSC_MAINS_GS2` | **Statutory, Regulatory and Quasi-Judicial Bodies** | the **regulatory** limb — TRAI 0 hits; IRDAI only as an anachronism trap; SEBI only as an example of who issues a Regulation. Sectoral regulators are never taught as an institutional category. |
| 10 | `UPSC_MAINS_GS2` | **Structure and Functioning of the Executive and the Judiciary** | **ministries and departments** — 0 hits for Allocation of Business / Transaction of Business / Art. 77 / Secretary to the Government. Both organs themselves are covered in depth. |
| 8 | `UPSC_MAINS_GS1` | **Salient Aspects of Indian Art Forms** | **folk traditions** and **theatre** — 0 hits for Yakshagana, Nautanki, Tamasha, Bhavai, Madhubani, Warli, Pattachitra, "folk theatre". The covering section confines itself to classical dance/music. |
| 7 | `UPSC_MAINS_GS2` | **Salient Features of the Representation of People's Act** | **qualification** and **election disputes** — 0 hits for election petition, Art. 84 / 102 / 191, office of profit. Section 123 corrupt practices *is* taught properly. |
| 5 | `UPSC_MAINS_GS1` | **Salient Aspects of Indian Architecture** | **modern** architecture entirely (no Chandigarh/Corbusier/Lutyens) and **Delhi Sultanate** architecture (0 hits for Qutb, Alai Darwaza, "true arch"), so the arrival of the arch-and-dome idiom c.1200–1500 is untaught. |
| 5 | `UPSC_PRE_GS1` | **Poverty** | **alleviation programmes** as a policy architecture — "poverty alleviation" 0 hits, Lakdawala 0 hits, NSAP 0 hits. Measurement and committees are well taught. |
| 5 | `UPSC_PRE_GS1` | **Inclusion** | **regional balance** — 0 hits for regional balance / imbalance / backward region; Aspirational Districts name-dropped but never taught. Financial and social inclusion are strong. |
| 4 | `UPSC_PRE_GS1` | **Demographics** | **age structure** and **demographic dividend** — 0 hits for dependency ratio / population pyramid. |
| 2 | `UPSC_MAINS_GS1` | **World Wars and the Redrawal of National Boundaries** | **the Second World War itself** and its peace settlement — 0 hits for Yalta, Potsdam, Oder-Neisse, Pearl Harbor, Hiroshima, Nagasaki. The section is ~95% First World War. |
| 2 | `UPSC_MAINS_GS1` | **Colonization and Decolonization** | the **colonization** half — 0 hits for Berlin Conference, Scramble for Africa, New Imperialism. In the covering chapter `coloniz/colonis` appears only inside the word "decolonization". |
| 1 | `UPSC_MAINS_GS3` | **Indian Economy: Planning and Mobilization of Resources** | **savings**, one of three channels the description names — no gross domestic savings, no household/corporate/public split, no savings-investment gap. |
| 0 | `UPSC_MAINS_GS3` | **Indigenization of Technology and Developing New Technology** | **technology transfer**, one of three named elements — no defence offsets policy, ToT, licensed production, co-development or indigenous-content thresholds. |

**143 of the 786 PYQ weight sitting on unauthored nodes (18%) is on a node with a real gap.**

### ⚑ The Demographics heading-scan trap — keep this

`Demographics` is "covered" by a parent chapter containing a section titled literally
**"Demographics and Human Development"** — whose body teaches only HDI and PLFS, and never touches age
structure or the demographic dividend. **A heading-based or index-based coverage scan would score that
node as fully covered.**

This is exactly why the audit required verbatim body-text quotes, and exactly the failure mode the
rollout's own redundancy scan (title-word overlap against section headings) is vulnerable to. A matching
heading is not evidence of coverage.

### Recommended next authoring round

These 16 gaps are **not** best served by authoring 16 new chapters — most are a missing *section* inside
an already-published chapter, which is the same "richer version supersedes via `chapter_version`" move the
rollout already established. The highest-value four by weight (`Data Interpretation` charts/graphs,
`World Geography` continents, `Rights Issues` human rights + the SC/ST/OBC commissions,
`Environmental Pollution` soil + MSW) account for **81 of the 143** gapped weight.

Three smaller gaps were found but judged too small to downgrade a node, and are recorded here so they are
not lost: **Socrates** is named first in GS4's "world thinkers" description and appears in no published
chapter (Kant, Bentham, Mill, Aristotle and Rawls all do); **Buddha, Vivekananda and Mahavir** get one
clause each; and **"Objectivity and Dedication"** is the thinnest foundational-values sub-node.

---

## ⚑ ADDENDUM 2026-08-15 — 7 of the 16 gaps were already closed. Re-measure before authoring.

The 16-gap table above is a snapshot of **2026-08-07**. The 2026-08-12 remediation round superseded
six chapters, and closed seven of these gaps as a side effect of doing so. **A session that reads that
table as a worklist will author content that already exists** — the exact duplication the redundancy
discipline exists to prevent.

Re-measured 2026-08-15 against all 78 published `upsc` chapters, PROSE only (headings + `body_md` +
`boxes[].content` + `table`-kind diagram source — the `notes:chapter:checkpoint --stage scope`
definition; a hit in overview or fact-audit metadata does not count):

| gap | 2026-08-15 verdict | evidence |
|---|---|---|
| Salient Aspects of Indian Art Forms | **CLOSED** | 8/8 terms present in a dedicated 1471w section "Theatre and Folk Traditions" |
| Salient Aspects of Indian Architecture | **CLOSED** | 6/6 present; 1181w Delhi Sultanate + 1703w Modern Indian Architecture sections |
| Poverty (alleviation programmes) | **CLOSED** | 5/5 present in "Poverty Alleviation: The Programme Architecture" (Economic and Social Development) |
| Demographics (age structure) | **CLOSED** | 4/4 present in "Age Structure, the Demographic Dividend, and Regional Balance" |
| World Wars (WWII + settlement) | **CLOSED** | 6/6 present in a 1321w "The Second World War and the 1945 Settlement" |
| Colonization (the colonization half) | **CLOSED** | 3/3 present in a 1365w "Colonization: The New Imperialism, 1870-1914" |
| Inclusion (regional balance) | **CLOSED** | dedicated section-title clause + a substantive income-distance/backward-region-grant passage |
| Data Interpretation (charts + graphs) | **REAL → CLOSED 2026-08-15** | words present, technique absent — see the trap note below. Closed by a 1185w section "Charts and Graphs: Bar, Pie, Line and the Histogram Family" added to `Basic Numeracy and Data Interpretation` (v1→v2), with a fully worked item per family. |
| World Geography (continents) | **REAL → CLOSED 2026-08-15** | Great Plains / Prairie / Pampas / Sahel all 0 hits. Closed by a 936w section "World regional geography — the continents, their natural regions" in `Indian and World Geography` (v1→v2). The two Part-2 depth checks on the same chapter (Physical Geography 30 PYQs, Economic Geography 14) were read and found ADEQUATE — left untouched, deliberately. |
| Rights Issues (human rights + commissions) | **REAL → CLOSED 2026-08-15** | UDHR / ICCPR / NCSC / NCBC / Art 338 all 0 hits. Closed by a 1191w section "Human Rights as a Concept, and the Constitutional Commissions That Safeguard Them" added to `Social Justice` (v1→v2). The same pass also acted on this chapter's two depth checks: Health 527→950w, Education 892→1132w. |
| Environmental Pollution (soil + MSW) | **REAL → CLOSED 2026-08-15** | soil pollution / SWM Rules / waste-to-energy / source segregation / sanitary landfill all 0 hits. Closed by two sections in `Environmental Ecology` (v1→v2): soil pollution + land degradation (730w) and municipal solid-waste management (678w). ⚑ **The research corrected the brief:** the SWM Rules **2016** are superseded by the **SWM Rules 2026** (S.O. 388(E), 27 Jan 2026; in force 1 Apr 2026), which move segregation from three streams to four. |
| Statutory-Regulatory (regulatory limb) | **REAL → CLOSED 2026-08-15** | TRAI / CERC / TDSAT all 0 hits. (⚑ my scan also claimed "appellate tribunal" was 0-hit — **wrong**, see trap 4 below; one pre-existing hit exists in `Indian Polity`, but it is constitutional-law framing of tribunal independence, not the sectoral-regulator appellate architecture, so the gap verdict is unaffected.) Closed by a 694w section "The Regulatory State: Sectoral Regulators and Their Appellate Architecture" in `Public Policy` (v1→v2). |
| Executive machinery (ministries) | **REAL → CLOSED 2026-08-15** | Allocation of Business / Transaction of Business / Article 77 all 0 hits. Closed by an 884w section "The Executive Machinery: Ministries, Departments and the Business Rules" in `Indian Polity` (v1→v2). |
| RPA (qualification + disputes) | **REAL → CLOSED 2026-08-15** | election petition / Art 84 / Art 102 / Art 191 all 0 hits. Closed by a 925w section "The Representation of the People Act: Qualification, Disqualification and Election Petitions" in `Indian Polity` (v1→v2). The same pass expanded Separation of Powers 620→1295w (its Part-2 depth check). |
| Planning & Mobilization (savings) | **REAL → CLOSED 2026-08-15** | domestic/household/gross savings, savings rate all 0 hits. Closed by a 1115w section "Domestic Savings and Capital Formation" in `Indian Economy, Planning and Investment` (v1→v2); Inclusive Growth also expanded 842→1255w (its Part-2 depth check). ⚑ Verification caught a **denominator conflation** — see below. |
| Indigenization (technology transfer) | **REAL → CLOSED 2026-08-15** | transfer of technology / defence offset / offset policy / indigenous content all 0 hits. Closed by a 1131w section "Technology Transfer: The Mechanism Behind Indigenisation" in `Science and Technology` (v1→v2). ⚑ This is the one chapter where the **publish gate actually fired** — see below. |

**Net: 7 closed, 9 real.** The 9 survivors match, almost item for item, the "remaining" list the
2026-08-12 remediation session recorded for itself in `CLAUDE.md` — two independent derivations
agreeing is the reason to trust this.

### ⚑ Three matching traps, all hit during this single re-measurement

Every one produced a wrong verdict before being caught, in both directions. Any future coverage scan
must handle all three:

1. **False positive — substring inside a longer word.** `/TRAI/i` matched "cons**trai**nt" in the
   General Mental Ability chapter and reported TRAI as covered. It is absent corpus-wide. Use word
   boundaries. (`CLAUDE.md` already records this exact trap with this exact acronym; it still caught
   this session.)
2. **False negative — punctuation between words.** `"backward region"` missed **"backward-region
   grant lineage"**, which is exactly the content being searched for. Match hyphen-or-space tolerantly.
3. **False negative — plurals, introduced by the fix for (1).** Tightening to
   `(?![A-Za-z])` then made `"Aspirational District"` miss **"Aspirational Districts Programme"**.
   A word-boundary assertion and a plural are in direct tension; check both forms.
4. **⚑ The plural trap AGAIN, hours after documenting it, on a different term — and it reached a
   commit message.** The same `(?![A-Za-z])` boundary made `"appellate tribunal"` miss
   **"appellate tribunals"**, which pre-existed in `Indian Polity`. I recorded that gap as 0-hit in
   the table above and in commit `68bbe61` before an authoring agent's own paginated re-scan caught
   it. **Writing a trap down does not stop you walking into it; only searching for the plural does.**
   The safe form is a stem match (`appellate[\s-]+tribunals?`), not an exact-phrase boundary.

### ⚑ And the trap that only reading catches: a trap-table is not teaching

`Data Interpretation` is the sharpest case, and no term scan of any sophistication would have got it
right. "bar chart", "bar graph", "line graph", "pie chart" and "central angle" are **all present** —
so a term scan scores it covered. Reading the section shows what they are: one row each in a
*table of common traps*, one formula in a facts box, and one caution not to read a graph by its
visual height. The two worked examples in that section are both over **tables**. So of the four
presentation forms the syllabus names, tables and data sufficiency are taught with worked items, and
charts and graphs have no worked item and no reading technique at all.

This is the same family as the **Demographics heading-scan trap** recorded above, one level deeper:
there, a matching *heading* was not coverage; here, matching *body terms* are not coverage either.
For a skills node, the unit of evidence is **a worked item with the arithmetic shown**, not a mention.

---

## Reproducing this

| artefact | path |
|---|---|
| panel key (seed, pairs, blinding map) | `/tmp/panel1_key.json` |
| panel samples (24 blinded chapters) | `/tmp/panel1/sample-*.md` |
| per-judge scores + computed gaps | `/tmp/panel1_scores.json` |
| coverage audit inputs + 4 result sets | `/tmp/coverage_audit/RESULT_{A,B,C,D}.json` |
| completeness audit | `/tmp/coverage_audit/COMPLETENESS.json` |

These are scratch paths and are **not** committed. The seed (`20260807`) plus the arm-membership
derivation (coverage-doc diff, above) is sufficient to rebuild the sample exactly.
