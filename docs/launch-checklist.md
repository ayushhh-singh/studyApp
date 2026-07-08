# Launch checklist

Run this, in order, against the REAL deployed environment (not `pnpm dev`),
before telling anyone the app is live. Each step names the exact screen/action
and what "pass" looks like. Check items off as you go; do not skip a step
because an earlier one looked fine — several of these have broken independently
of each other in past sessions (see CLAUDE.md's session log).

This checklist has NOT been run yet as of this writing — it's written ahead of
the actual account/domain setup (see docs/operations.md and the deploy PR
description for what's still pending). Run it for real the first time
`prayasup-api` and the web app are both reachable at their production URLs.

## 0. Pre-flight (infra, before any user-facing test)

- [ ] `GET https://api.<domain>/api/v1/health` → `{"data":{"ok":true},"error":null}`
- [ ] `https://<domain>/en` and `https://<domain>/hi` both load, correct copy,
      no console errors (open devtools first)
- [ ] Supabase dashboard: point-in-time recovery / backups enabled on the
      project (Database → Backups)
- [ ] Supabase Auth → URL Configuration: Site URL + redirect allowlist include
      the real prod origin (not just localhost)
- [ ] Supabase Storage → `answer-images` bucket CORS allows the prod origin
- [ ] Render dashboard: `prayasup-api` shows healthy; all 5 cron jobs
      (`prayasup-daily-build`, `prayasup-ca-run`, `prayasup-qgen-topup`,
      `prayasup-nightly-settle`, `prayasup-notifications`) show at least one
      successful run once their first scheduled time has passed
- [ ] `pnpm --filter api security:rls` still passes against the prod project
      (run from a machine with the prod `.env` values — this hits the real DB,
      confirm you're prepared for that before running)

## 1. Signup → onboarding

- [ ] Sign up with a fresh email (password auth, since custom SMTP for
      OTP/magic-link email is still a TODO in CLAUDE.md — see
      "Custom SMTP for auth emails")
- [ ] Onboarding flow completes, lands on `/en/dashboard` (or `/hi/dashboard`)
      with a real (not stale/cached) empty-state dashboard
- [ ] Language toggle round-trips correctly; profile shows the just-created
      account

## 2. Daily quiz

- [ ] `/practice` → Daily Quiz tab shows today's real generated quiz (not a
      404/empty state — confirms `prayasup-daily-build` actually ran and
      wrote a row for today)
- [ ] Take the quiz, submit, land on the result page with a real score

## 3. Typed answer → streaming evaluation

- [ ] `/answers` → pick a PYQ, write a short answer, submit
- [ ] Evaluation screen streams dimension scores live (not a blank wait then
      a sudden dump) and finishes with a real score + model answer
- [ ] Re-open the same evaluation — instant replay, no second charge (confirm
      via `pnpm --filter api cost:report` that there's exactly one
      `answer_eval_analysis` call for this submission)

## 4. Handwritten upload

- [ ] `/answers/write` → Handwritten tab → capture/upload a real page photo
- [ ] OCR transcription streams live on the confirm screen
- [ ] Edit the transcribed text, confirm, evaluation runs against the
      confirmed text

## 5. Mentor doubt

- [ ] Ask a real doubt in the chatbot; response is grounded (cites a
      syllabus/PYQ concept, not a generic non-answer)
- [ ] A proactive mentor insight card appears on the dashboard within a day of
      real activity (confirms `prayasup-nightly-settle` ran)

## 6. Note reading

- [ ] Open a published note under `/learn/:paper/:node` (Notes tab) — both
      locales render, sources/citations show

## 7. Payment (test mode)

- [ ] `/pricing` → start checkout with a Razorpay TEST card
      (see razorpay docs for current test card numbers)
- [ ] Webhook fires: check Razorpay dashboard → Webhooks → recent deliveries
      shows a 200 to `https://api.<domain>/api/v1/billing/webhook`
- [ ] Entitlement flips in-app (quota chips / paywall unlock) within a few
      seconds of payment

## 8. Push notification

- [ ] Enable push from the in-app pre-prompt card; browser permission granted
- [ ] Trigger `pnpm --filter api push:send` manually (or wait for the hourly
      `prayasup-notifications` cron) and confirm a real push arrives

## 9. PWA install (real phone, not desktop devtools emulation)

- [ ] Visit the prod URL on an actual Android/iOS device
- [ ] "Add to Home Screen" / install prompt appears (or is installable via
      the browser menu); icon + name correct
- [ ] Launch from the home-screen icon — opens standalone (no browser chrome)
- [ ] Turn on airplane mode, reload an already-visited page — offline shell
      still renders (confirms the service worker actually cached it)

## Sign-off

Once every box above is checked against the real production URLs (not a
preview deploy, not `pnpm dev`), tag the release:

```
git tag v1.0.0
git push origin v1.0.0
```
