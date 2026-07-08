# Edge-case audit — 2026-07-08

A systematic pass over every "click, open, show, close, redirect" interaction
in the app, done in two stages: (1) six parallel Explore agents each read a
section of the codebase and traced click handlers, mutations, and navigation
for concrete failure scenarios; (2) every finding was re-verified against the
real code (and, where possible, empirically against the live app) before being
treated as real — one flagged finding turned out to be a false positive and
was **not** changed. Confirmed bugs were fixed and live-verified via a
production preview build (Playwright), both locales, 1280px and 390px.

Use this doc as a map of *why* certain code looks the way it does — most of
the fixes below read strangely defensive unless you know the failure mode they
close.

## How to re-run this kind of audit

Six parallel `Explore` agents, one per app section, each given: the relevant
route/component/hook files, a checklist of "does this click/open/close/redirect
do what it looks like it does," and an instruction to report only bugs they
personally traced through the code (file:line + concrete user-facing failure),
not stylistic nitpicks or unverified theories. See the six prompts used this
session for the exact template — they're reusable for the next sweep.

**Verify every finding before fixing it.** One report (the Learn breadcrumb
"bug") looked completely plausible and cited real code, but was wrong — the
agent misread which row of `node.breadcrumb` was at index 0. Fetching a real
node from the live API and reading the actual response settled it in under a
minute. Don't skip this step just because a report is well-written.

---

## Confirmed bugs fixed

### Practice — the exam-mode test player (highest severity cluster)

All in `apps/web/src/components/practice/test-player.tsx` unless noted.

1. **No confirm-before-leave guard.** The header X button and browser
   back/forward could abandon an unsubmitted attempt with zero warning — only
   `beforeunload` (tab close/reload) was covered, not in-app navigation. Fixed
   with `useBlocker` (react-router v7, stable API) gated on `!submittedRef.current`;
   a `LeaveConfirmDialog` (new file: `leave-confirm-dialog.tsx`) renders when
   the blocker enters `"blocked"` state. `submittedRef` flips to `true` right
   before `onSubmitted()` fires so the post-submit navigation is never blocked.
   Because `useBlocker` intercepts *any* attempted navigation through the
   router regardless of what triggered it, this one hook covers the X button,
   back/forward, and any stray Link — no per-trigger wiring needed.

2. **`offline-queue.ts`'s `flush()` had a re-entrancy bug that could let submit
   proceed before the last answer was actually persisted.** `flush()` returned
   immediately if another flush was already in-flight, without waiting for it.
   `handleSubmit` does `await flushNow()` specifically to guarantee the final
   answer synced before submitting — but if an autosave-triggered background
   flush was already running at that moment, the awaited call resolved
   instantly without confirming anything. Rewrote `flush()` to track the
   active flush as a shared promise: a second caller awaits the *same* in-flight
   round, then (since new items may have been enqueued mid-flight) recurses
   until the queue is genuinely empty. A background-triggered flush's own
   failure is swallowed (`scheduleFlush`'s `.catch(() => {})`); an explicit
   `flushNow()` caller now sees the rejection so it can react (see #3).

3. **`handleSubmit` had no re-entrancy guard.** The countdown timer expiring
   right as the user clicks Confirm could fire two concurrent
   `POST /attempts/:id/submit` calls — `submitAttempt.isPending` doesn't cover
   the `await flushNow()` window before `.mutate()` is even called. Fixed with
   a synchronous `submittingRef` set at the top of `handleSubmit`.

4. **Submit dialog's Cancel button had no `disabled` state during an in-flight
   submit** (`submit-confirm-dialog.tsx`) — clicking Cancel while the request
   was still in flight closed the dialog but the submit completed anyway and
   redirected moments later, which reads as "I clicked Cancel and it did the
   thing anyway." Disabled Cancel to match Confirm's existing `disabled={isSubmitting}`,
   and made the dialog's `onOpenChange` ignore Escape/backdrop-close during
   that window too. Also added an `error` prop so a sync failure (#2/#3) shows
   inline instead of silently returning the dialog to its normal state.

5. **No visible feedback for autosave state.** `use-attempt-answers.ts` already
   exposed a `status: "idle"|"pending"|"error"` the player never read. Added a
   small header indicator ("Saving…" / a coral "Sync error" chip).

### Answers section

1. **Draft key collision across custom (non-catalogued) questions**
   (`routes/answers-write.tsx`). Every custom question shared one localStorage
   key (`answers-draft:custom`), storing only the answer text. Returning to
   Write Room for an unrelated custom prompt silently pre-filled its editor
   with a *previous* prompt's answer, with the question box starting blank —
   looked like a fresh session, wasn't. Fixed by persisting `{question, answer}`
   together under that key and restoring both — a resumed draft is now always a
   *visibly coherent* pair (old question text next to its own old answer), so a
   stale draft reads as obviously stale instead of silently wrong. Backward
   compatible with the old plain-string format (treated as answer-only on read).

2. **OCR confirm screen could override a confirmed edit with raw OCR text**
   (`routes/answers-confirm.tsx`). The effect that prefers persisted
   `typed_text` over a fresh OCR replay ran as soon as `stream.done` fired,
   even if the independent `useSubmissionDetail` fetch hadn't resolved yet —
   `detail?.submission.typed_text` read as `undefined` mid-load, so it fell
   through to the raw OCR text, and the `editedText === null` guard meant it
   never re-synced once `detail` actually arrived. Fixed by also gating on
   `!isDetailLoading`.

3. **Handwritten photo picker silently dropped extras over the page cap.**
   Picking more images than remaining room (e.g. 5 at 4/6 already) truncated
   the extras with no message — `rejectedCount` only ever tracked non-image
   MIME rejects. Added a second counter + message for this case.

4. **Submission history: no click target for a typed submission stuck in
   `evaluating`/`failed`/`pending`.** `resumeHref` only linked `complete` items;
   everything else with `mode !== "handwritten"` was a dead, unclickable row —
   even though the evaluation page's `planEvaluation` already replays/reclaims/
   retries all three of those statuses correctly. Every status now resolves to
   a real destination (evaluation page, or the confirm screen pre-evaluation
   for handwritten).

5. **Daily Answer Set always linked to "write a new answer,"** even for an
   already-evaluated item (`components/answers/daily-answer-set.tsx`) — the
   shared schema already carried `submission_id` for exactly this case, just
   never read. Fixed to link to the existing evaluation when `status === "evaluated"`.

6. **"Ask a doubt" from a practice result was a context-blind stub**
   (`components/practice/result-review-list.tsx` → `routes/doubts.tsx`). The
   link carried `?question=&attempt=` but the Mentor page ignored both and
   opened the most recent unrelated thread. Fixed: `doubts.tsx` now reads
   `?question=`, fetches it, and (once resolved) opens a **fresh** thread
   seeded with `Mentor.seedFromQuestion` + the question's `syllabus_node_id`
   for retrieval scoping — instead of auto-selecting an existing thread.

### Admin Review queue — data-corruption risk

`routes/review.tsx` and `components/review/notes-review-panel.tsx`: the
prev/next chevrons stayed clickable while an edit form was open, and the edit
form's local state (`useState(q.stem_i18n.en)` etc.) only ever initializes
once on mount. Navigating away mid-edit didn't unmount the form (same
component, same tree position) — so it kept showing item A's (possibly edited)
text while `onSubmit` silently closed over item B's id. Save & Approve would
then PATCH item B with item A's text. Fixed two ways, belt-and-suspenders:
`disabled={... || editing}` on both nav buttons, and `key={current.id}` on the
edit form so React fully remounts (fresh state) if `current` ever changes
while `editing` stays true through some other path (e.g. a concurrent
approve/reject elsewhere shrinking the queue and the index-clamp effect
shifting `current`).

### Learn section

1. **Shared pending-state across every "add to revision" button in a note**
   (`components/learn/notes-view.tsx`). All of overview/up_angle/every key
   fact read the *same* `addBlock.isPending` — clicking fact #1 grayed out
   fact #2/#3's buttons too, though nothing was happening to them. Fixed by
   deriving a `pendingBlockKey` from the shared mutation's own `.variables`
   (mirrors the pattern `learn-paper.tsx`'s `NodeRow` already used correctly
   via `addToRevision.variables`) so only the *actually*-pending button
   disables. Live-verified: clicking fact #1 leaves fact #2 clickable.

2. **Conquest Map silently ignored the exam filter.** Outline and Map view
   share one `?exam=` URL param, but `ConquestMap`/`useMastery`/the mastery
   route/`getMasteryMap` had no `exam` parameter anywhere, and the
   `ExamFilter` control was hidden entirely in Map view (`{view === "outline" && <ExamFilter/>}`) —
   so a "UPPSC only" filter set in Outline silently stopped applying the
   moment you switched to Map, with no indication anything changed. Fixed
   end-to-end: `getMasteryMap(userId, paperCode, exam)` now filters the PYQ
   query by `exam_code` (mirrors `getNodeDetail`'s existing `pyqCountQuery`
   pattern) → route parses `exam` via the shared `examCodeSchema` → `useMastery`
   takes and key-scopes it → `ConquestMap` accepts an `exam` prop →
   `learn-paper.tsx` passes it through and now shows `ExamFilter` in both
   views. Live-verified against real data: "Indian Polity" tile share went
   from 19.6% (all exams) to 26.2% (UPPSC only) on toggling the filter.

3. **No error UI for a failed "add to revision"** in either `learn-paper.tsx`
   or `notes-view.tsx` — a failed POST just returned the button to its normal
   enabled state, indistinguishable from never having clicked it. Added inline
   error messages keyed off `.isError` on the relevant mutations.

4. **"Practice PYQs" per-node link dropped the active exam filter**
   (`learn-paper.tsx`) — the sibling "View trends" link a few lines up already
   forwarded `?exam=`; this one didn't, even though the destination
   (`practice.tsx`'s `PyqFilterView`) reads and applies the same param. Fixed
   to match.

### Revision

**Keyboard auto-repeat could double-rate the same card**
(`components/revision/review-player.tsx`). Holding a rating key (1-4) can fire
multiple native `keydown` events before React commits the `revealed=false`
state update *and* re-subscribes the listener with a fresh closure (the
`useEffect` re-subscription is a passive effect, not synchronous with the
click). The stale-closure listener could re-fire `rate()` for the same card,
skipping the next card and inflating the rating tally past the session total —
the same *symptom* as the historical query-invalidation bug already fixed
here, via a different mechanism. Fixed with a synchronous `lastRatedIdRef`
guard in `rate()` (a ref, unlike the `revealed` state check, is available
before the next paint).

### Magazine

Print button had no `disabled` gate on `isLoading` — printing immediately
after navigating produced a page of skeleton bars instead of the article.
Added `disabled={isLoading || isError || !mag}`.

### Mentor (this session's own earlier feature)

1. **Floating mentor button: no error path for a failed thread creation** —
   the sheet's spinner spun forever with no retry, discoverable only by
   closing and reopening (not hinted at anywhere). Added an error state +
   Retry button, refactored thread-creation into `attemptCreate()` so both the
   auto-trigger effect and the manual retry button share one code path.

2. **`mentor-chat.tsx`'s `onDone` handler could make a just-completed exchange
   silently vanish.** `queryClient.invalidateQueries()` resolves once the
   triggered refetch *settles* — including when that refetch itself errored
   (TanStack Query doesn't reject here). The handler unconditionally cleared
   the transient streamed bubble after awaiting it, so a flaky refetch meant
   both the question and the answer disappeared with nothing replacing them.
   Fixed by checking the refetched cache for the actual persisted message
   (matched by `stream.doneMessageId`) before clearing; the render also
   independently suppresses the transient bubble once that message shows up
   in `messages`, so leaving state uncleared on a failed check can never
   produce a duplicate.

### Loading-state polish (explicit ask: "show a loader where any action is
taking time")

- Mentor thread list (`doubts.tsx`): showed "No threads yet" during the
  initial fetch (before `isLoading` was checked) for a user who actually has
  history. Added a skeleton state.
- Mentor chat transcript (`mentor-chat.tsx`): opening an existing thread with
  real history briefly flashed the "ask me anything" empty state before
  `detail.data` arrived. Gated `isEmpty` on `!detail.isLoading` + added a
  skeleton bubble pair while loading.
- Arriving at `/doubts?question=…` from a practice result briefly showed the
  generic empty state + "New doubt" button while the seeded thread was still
  being created. Added a dedicated loading branch for that path.

---

## False positive — verified, not fixed

**Learn breadcrumb link** (`routes/learn-node.tsx`). An audit report claimed
the *first* breadcrumb crumb was mislabeled with a depth-1 ancestor's title
but linked to the paper root. Checked the actual backend query
(`getNodeDetail`'s `prefixes` array starts at `""`, i.e. depth 0 — the paper
root itself) and confirmed empirically against a live node
(`GET /syllabus/nodes/:id`): `breadcrumb[0]` really is the paper-root row
(title = the paper's own name, e.g. "Prelims — General Studies Paper I"), and
`index === 0 → /learn/:paperCode` correctly matches that title. Every other
crumb already links via its own `crumb.id`. No change made — applying the
suggested "fix" would have broken genuinely-correct behavior.

---

## Verification method

- Live guardrail battery via `curl` for every new/changed API contract (404s,
  400s, 429, the mastery exam-filter response actually changing PYQ counts:
  501 → 149 when filtering to UPPSC-only on PRE_GS1).
- Playwright against a **production preview build** (`vite preview`), not the
  dev server — catches real build-time issues the dev server's HMR can mask.
- Practice test-player: full scripted run — start → answer → Exit → confirm
  dialog appears → Stay → state intact → Exit again → Leave anyway → navigates
  away → restart → answer all questions → Submit → confirm dialog → Cancel
  disabled during a network-throttled in-flight submit → completes → lands on
  the real result page. Zero console errors throughout.
- Review admin: opened a real `machine_translated` queue item, clicked Edit,
  confirmed prev/next are visually disabled *and* a forced click is truly
  inert (form stays open, same item).
- Notes-view: clicked one key fact's "add to revision," confirmed a sibling
  fact's button stayed enabled mid-request.
- Conquest Map: confirmed the exam filter control now renders in Map view and
  that toggling it actually changes tile weights against live data.
- Both locales × 1280px/390px smoke pass across all touched routes — zero
  horizontal overflow, zero console errors (one transient overflow reading was
  traced to this session's own rate-limiter exhaustion from rapid repeated
  testing, not a real regression — reproduced clean once isolated).
- All synthetic attempts/SRS test rows created during verification were
  cleaned up afterward; one real "add to revision" card from the notes-view
  test was deliberately left (legitimate data, not test pollution).

## Known pre-existing issue found, not fixed here

`apps/api/src/mastery/compute.ts` had a stray null byte baked into its
**already-committed** content (confirmed via `git show HEAD:...`), unrelated
to anything touched this session — it happened to sit a few lines away from
this session's actual edits and was caught only because it made `git diff`
render the file as binary. Fixed as a low-risk byproduct of touching this file
anyway (the surrounding `pk()` helper's template literal was reconstructed
character-for-character); flagged here in case the same corruption shows up
elsewhere in the codebase from whatever originally introduced it.
