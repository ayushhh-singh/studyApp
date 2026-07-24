# Sukoon (सुकून) — Wellness Companion: Complete Build Blueprint
### Neev-integrated + Standalone-capable | Branch: `feature/sukoon` | For use with Claude Code, session by session

---

## 1. Product Definition

**What it is:** A Hindi-first, wellness-positioned (explicitly *not therapy*) emotional wellbeing companion for exam aspirants — journaling, mood tracking, calming exercises, guided stress journeys, an AI Saathi chat, and (premium) voice conversations. Lives inside Neev as a "Wellness" section reachable from the homepage next to "Go to Dashboard," and can also be deployed as a standalone app.

**What it is not (legal posture, non-negotiable):**
- Never uses the words "therapy," "therapist," "psychologist," "treatment," "diagnosis," "patient," or "medication" anywhere in UI, prompts, or marketing.
- Every user passes a consent gate: "Sukoon is a wellness companion, not a substitute for professional mental health care."
- Crisis detection always escalates to humans (Tele-MANAS 14416 + helplines), never tries to "handle" a crisis itself.
- No PHQ-9/GAD-7 (clinical screeners). Use the **WHO-5 Wellbeing Index** and custom stress self-checks framed as self-reflection.

---

## 2. Architecture: Integrated + Standalone from One Codebase

### 2.1 Branch & module strategy
```
neev/  (existing repo, branch: feature/sukoon)
├── client/src/
│   ├── sukoon/                  ← entire Sukoon frontend module
│   │   ├── routes.tsx           ← all routes under /sukoon/*
│   │   ├── theme/               ← separate design tokens (calm palette)
│   │   ├── components/
│   │   ├── pages/               ← Home, Chat, Journal, Mood, Exercises, Journeys, Insights, Settings
│   │   ├── stores/              ← Zustand stores (isolated from Neev stores)
│   │   └── lib/                 ← sukoon API client, audio utils
│   └── (existing Neev code untouched except: homepage card + router mount)
├── server/src/
│   ├── sukoon/                  ← entire Sukoon backend module
│   │   ├── routes/              ← mounted at /api/sukoon/*
│   │   ├── services/            ← chat, crisis, journal, insights, voice, billing
│   │   ├── prompts/             ← versioned system prompts
│   │   └── content/             ← exercises + journey content (JSON/MD)
│   └── (shared: auth middleware, supabase client, SSE helper, semantic-cache util, razorpay util)
└── supabase/migrations/sukoon/  ← self-contained migrations, all tables prefixed sukoon_
```

**Rules that make standalone possible later:**
1. Sukoon code imports from shared utils, **never** from Neev feature modules. Neev may import from Sukoon (the homepage card), never the reverse.
2. All Sukoon tables prefixed `sukoon_`, migrations self-contained in their own folder → can be applied to a fresh Supabase project unchanged.
3. All Sukoon API routes under `/api/sukoon/*` with their own router index → mountable in any Express app.
4. Config-driven mode: `SUKOON_MODE=integrated | standalone`.
   - **Integrated:** Neev homepage shows two primary cards — "Go to Dashboard" and "Wellness Companion (Sukoon)". Sukoon mounts at `/sukoon`. Shared Supabase auth session, shared user id.
   - **Standalone:** Vite env `VITE_APP=sukoon` makes the router mount Sukoon at `/`, loads Sukoon branding (name, logo, manifest, theme), hides all Neev nav. Same repo, second Cloudflare Pages project with different env vars. One codebase, two deployables.
5. Separate PWA manifest per mode (name, icons, theme color) selected at build time.

### 2.2 Design system (distinct identity inside the same repo)
- **Component architecture: same as Neev — Tailwind + shadcn/ui.** Sukoon uses the project's existing shadcn components everywhere possible (adding missing primitives via the shadcn CLI, never hand-rolling parallels). The distinct Sukoon look comes entirely from **scoped CSS variable overrides** of the shadcn theme tokens under a `.sukoon` root class — one theme file, zero component forks, Neev globals untouched. Custom components exist only where no primitive fits (breathing animation, waveform, garden, emotion wheel, crisis takeover) and compose shadcn primitives internally (e.g., takeover built on AlertDialog).
- Palette: deep indigo `#2E2A5E` + soft teal `#4FB3A9` + warm sand `#F4EDE3`; night-mode default after 9pm (aspirants study late).
- Motion: slow, breathing-paced animations (no snappy gamified motion like Neev's Conquest Map).
- Typography: reuse Neev's Hindi-capable font stack; larger line-height, calmer spacing.
- Microcopy voice: warm Hinglish by default ("थोड़ा रुकते हैं। एक गहरी साँस?"), full Hindi and full English toggles.

### 2.3 Cost-control spine (reuse Neev patterns)
- **Prompt caching** on the static system-prompt head (persona + safety rules + language style) — same pattern as Neev's AI mentor.
- **Semantic cache** (pgvector) for common emotional FAQ patterns ("exam me fail ho gaya," "neend nahi aati") → serve cached, human-reviewed responses with light personalization. Reuse Neev's semantic FAQ cache utility.
- **Generate-once, serve-many**: all meditation scripts, journey content, and exercise audio are pre-generated offline (Sonnet + one-time TTS render), human-reviewed, stored in Supabase Storage. Zero runtime AI cost for the calm library.
- **Tier caps** enforced server-side via a `sukoon_usage` table + daily-reset cron (GitHub Actions, same as Neev).

---

## 3. Feature Specifications (full, end-to-end)

### F1. Onboarding, Consent & Baseline
- **Flow:** Welcome → language pick (हिंदी / Hinglish / English) → wellness-not-therapy consent screen (versioned, stored) → age gate (18+ self-declaration; under-18 gets restricted mode: no open chat, exercises + journaling only, per DPDP children's-data caution) → optional WHO-5 baseline check-in → exam context (which exam, attempt number, exam date — powers exam-eve features) → notification permission.
- **Backend:** `POST /api/sukoon/onboarding`, consent stored with version + timestamp in `sukoon_consents`. Profile in `sukoon_profiles` (language, exam, exam_date, restricted_mode).
- **Model:** none (static flow).

### F2. Saathi — AI Companion Chat
The heart of the product. A warm, non-judgmental listener that validates first, advises gently, and never plays doctor.
- **UX:** WhatsApp-familiar chat; streaming responses (SSE via fetch-event-source, same as Neev); suggested conversation starters that rotate by time of day and exam proximity ("Kal mock test hai, ghabrahat ho rahi hai"); persistent footer: "Sukoon एक साथी है, इलाज नहीं"; session summaries so returning users feel remembered.
- **Prompt architecture:** layered system prompt — (1) cached head: persona, safety rules, language style, refusal rules (no diagnosis/medication → warm redirect to professionals); (2) dynamic tail: user context (name, exam, days-to-exam, last mood, last conversation summary ~100 tokens).
- **Memory:** rolling conversation summary per user (`sukoon_chat_summaries`), regenerated by Haiku every ~10 messages. Keeps context small and cheap.
- **Caps:** Free 15 messages/day; Plus 100/day fair use; Pro 200/day.
- **Model:** **Haiku 4.5** default (fast, cheap, warm enough with good prompting). **Auto-escalate to Sonnet 4.6** when: crisis level ≥ moderate, or the message is long/complex emotional narrative (>150 words), or user explicitly asks to "go deeper." Escalation decided by the crisis classifier + a length heuristic — no extra model call.
- **Endpoints:** `POST /api/sukoon/chat/stream` (SSE), `GET /api/sukoon/chat/history`.

### F3. Crisis Detection & Escalation (safety spine — built before chat launches)
- **Two-layer detector on every user message:**
  - Layer 1: deterministic regex/keyword list (Hindi + Hinglish + English self-harm vocabulary, transliteration variants). Zero latency, zero cost, catches the obvious.
  - Layer 2: **Haiku classifier** (single cheap call, JSON out): `{level: none|low|moderate|high|critical, reason}`. Runs in parallel with response generation; response held until classifier returns.
- **Escalation ladder:**
  - *low:* Saathi softens tone, checks in.
  - *moderate:* inline resource card (Tele-MANAS 14416, iCALL, Vandrevala) woven into the reply + Sonnet takes over the conversation.
  - *high/critical:* full-screen takeover card — "अभी किसी इंसान से बात करना ज़रूरी है" — tap-to-call `tel:` links (14416 first), option to see coping-in-this-moment grounding steps, chat resumes only after acknowledgment. Event logged to `sukoon_crisis_events` (level, hash of trigger, timestamp — no raw text stored at high levels beyond what's needed; privacy-first).
- **Anti-doom-loop:** if 3+ high events in 24h, chat rate-limits and the app pivots to static resources + helplines.
- **Red-team requirement:** a test suite of 100+ adversarial Hinglish/code-mixed inputs must pass before beta (build in Session 3, run in CI).
- **Model:** Haiku 4.5 (classifier). Keyword layer is code.

### F4. Journaling (full app-grade)
- **Modes:** free-write; **guided prompts** (daily rotating, exam-aware: "Aaj ke mock me kya seekha?", gratitude, worry-dump, letter-to-future-self); **voice-note journal** (premium: record → OpenAI STT (gpt-4o-transcribe) transcription → saved as text + audio).
- **Features:** rich-text-lite editor (bold, lists), mood tag per entry, tags/labels, full-text search, calendar heatmap view, streaks (gentle — no loss-aversion dark patterns), pin/favorite, PDF export of any date range, private lock (app-level PIN using existing auth session + local check).
- **AI Reflections (Plus+):** on request per entry — Haiku returns 2–3 sentences of warm reflection + one gentle question. Never unsolicited, never analytical/diagnostic.
- **Privacy:** journal entries are the most sensitive data in the product. RLS strict; server-side encryption at rest for entry bodies (pgcrypto `pgp_sym_encrypt` with server key) so raw text isn't casually readable in the dashboard; excluded from analytics; deletable individually and in bulk; export + delete surfaced in Privacy Center.
- **Schema:** `sukoon_journal_entries (id, user_id, body_enc, mood, tags[], prompt_id, audio_path, created_at)`, `sukoon_journal_prompts (id, text_hi, text_en, category, exam_phase)`.
- **Model:** Haiku 4.5 (reflections); gpt-4o-transcribe for voice-notes (premium).

### F5. Mood Tracking & Emotions
- **Check-in:** 10-second flow — emoji-scale mood (1–5) → optional emotion wheel (Hindi-labeled: चिंता, थकान, अकेलापन, उम्मीद…) → optional factors (पढ़ाई, परिवार, नींद, result, comparison) → optional one-line note.
- **Views:** daily calendar, weekly/monthly trend charts (Recharts, already in stack), factor-correlation view ("नींद कम → mood कम, इस महीने 6 बार"), streak of check-ins.
- **Smart timing:** push reminder at user-chosen time + adaptive nudge (skip if already checked in; extra gentle check-in the evening before a stored exam date).
- **Schema:** `sukoon_mood_entries (user_id, score, emotions[], factors[], note, created_at)`.
- **Model:** none daily; feeds F9 insights.

### F6. Exercise Library (calming toolkit, works offline)
Fully-built interactive experiences, not text lists:
- **Breathing:** animated box breathing, 4-7-8, and भ्रामरी-style humming breath — SVG animation synced to inhale/hold/exhale with haptics (Vibration API) and optional ambient audio; configurable duration (1/3/5/10 min).
- **Grounding:** interactive 5-4-3-2-1 (user taps through senses), body-scan with progress indicator.
- **PMR:** guided progressive muscle relaxation with pre-rendered Hindi audio.
- **Meditation timers:** unguided timer with singing-bowl start/end + ambient mixer (rain, tanpura, night crickets, fan — aspirant-hostel-authentic sounds).
- **Guided meditations (10–15 at launch):** scripts pre-written with Sonnet, human-reviewed, TTS-rendered once in Hindi + English, stored in Supabase Storage, streamed with a custom audio player (background-play capable via Media Session API).
- **Focus mode (Neev synergy):** Pomodoro with "calm breaks" — between study sprints, Sukoon offers a 3-min breathing break. In integrated mode this is cross-promoted from Neev's study screens.
- **Offline:** exercise definitions + top-5 audios cached by the service worker → works in hostels with bad network.
- **Schema:** `sukoon_exercises (id, type, config_json, audio_path_hi, audio_path_en)`, `sukoon_exercise_sessions (user_id, exercise_id, duration_s, completed, created_at)`.
- **Model:** none at runtime. Content pipeline: Sonnet 4.6 (scripts, offline) + TTS one-time render.

### F7. Guided Journeys (exam-stress programs — the differentiator)
Multi-day structured programs, each 5–7 short daily steps mixing psychoeducation, an exercise, a journal prompt, and a Saathi check-in:
1. **Exam-Eve Panic** (single-session, 20 min — available instantly when exam_date is tomorrow)
2. **Result के बाद** (post-result low mood / failure processing)
3. **Comparison का जाल** (peer comparison, Instagram/topper anxiety)
4. **Parental Pressure** (boundaries, conversations with family)
5. **Burnout Recovery** (7-day)
6. **Mock-Test Anxiety** (5-day)
7. **नींद** (sleep hygiene for late-night studiers, 5-day)
- **Content pipeline (Neev question-factory pattern):** Sonnet generates draft step content against a strict template → quality-gate checklist (no clinical language, culturally grounded, actionable, Hindi register correct) → human review in an admin queue → published as versioned JSON. Zero runtime generation cost.
- **UX:** journey cards with progress rings; daily step unlock; completion reflection; re-take anytime.
- **Schema:** `sukoon_journeys`, `sukoon_journey_steps`, `sukoon_journey_progress`.
- **Model:** Sonnet 4.6 offline (authoring); none at runtime.

### F8. Wellbeing Check-ins (WHO-5, not clinical screeners)
- WHO-5 (public domain, wellness-framed) offered at onboarding and monthly; custom 5-question "Exam Stress Self-Check" (authored, non-clinical).
- Results shown as trends with careful copy: "यह self-reflection है, कोई medical assessment नहीं." Low scores → gentle suggestion of journeys + helpline info (not alarm language).
- **Schema:** `sukoon_checkins (user_id, type, answers_json, score, created_at)`.

### F9. Weekly Insights Report (Plus+)
- Every Sunday (GitHub Actions cron), for opted-in paid users: Sonnet synthesizes the week's mood entries, exercise activity, journal *metadata* (counts, mood tags — **not** decrypted journal bodies unless the user opts into "deep insights") into a warm 150-word Hindi summary + one suggestion + one journey recommendation. Delivered as in-app card + push.
- **Model:** **Sonnet 4.6** (weekly, low volume → affordable quality).

### F10. Voice Mode (Premium — Sukoon Pro)
- **Architecture: half-duplex push-to-talk pipeline, NOT realtime API** (5–10× cheaper, simpler, good enough for a companion):
  1. Browser MediaRecorder captures user audio (hold-to-talk or tap-to-toggle)
  2. Upload chunk → **OpenAI STT (gpt-4o-transcribe)** (~$0.006/min, gpt-4o-mini-transcribe ~$0.003/min; better WER + language accuracy than legacy Whisper)
  3. Transcript → crisis check → **Haiku** response (same prompt stack as chat)
  4. Response → **TTS** → streamed audio back. TTS options: OpenAI `gpt-4o-mini-tts` (good Hindi, ~$0.015/min audio) or **Sarvam AI Bulbul** (Indian, Hindi-native, INR pricing — evaluate in build; likely best Hindi naturalness per rupee).
- **UX:** calm full-screen voice mode, waveform animation, transcript optionally visible, ambient background; every voice session's transcript also runs the crisis pipeline.
- **Caps:** Pro = 60 voice-minutes/month, meter shown in UI; hard server-side cut with a soft warning at 50. Blended cost ≈ ₹1–1.5/min → worst case ~₹90/user/month, priced into Pro.
- **Schema:** `sukoon_voice_usage (user_id, month, seconds_used)`.
- **Models:** OpenAI STT (gpt-4o-transcribe) + Haiku 4.5 (reply) + gpt-4o-mini-tts or Sarvam (TTS).

### F11. Reminders, Streaks & Gentle Gamification
- Web push (reuse Neev PWA push infra): mood check-in reminder, journey step reminder, exam-eve support ping.
- **"Sukoon Garden":** a plant that grows with check-ins/exercises — grows slowly, **never dies or regresses** (explicit anti-dark-pattern choice; contrast with streak-guilt apps).
- Streaks framed as "self-care days," break-forgiveness built in (1 free skip/week).

### F12. Privacy Center (DPDP compliance)
- View consents; withdraw consent (deactivates account); export all data (JSON + journal PDF); delete account with full cascade (immediate soft-delete, 7-day hard purge via cron); data-usage explainer in plain Hindi. Age-gate handling per DPDP children's rules.

### F13. Billing & Entitlements (standalone + bundle)
- Reuse Neev's Razorpay service + webhook infra; separate Razorpay plans for Sukoon products; a unified `entitlements` check so one user's Neev and Sukoon subscriptions coexist.
- **Integrated mode:** Neev pricing page gains a "+ Sukoon" toggle; Sukoon paywall offers standalone plans AND "already on Neev Pro? Add Sukoon at 40% off."
- **Standalone mode:** shows only Sukoon plans.

---

## 4. Pricing (calibrated to research: Wysa ~₹499/mo; therapy ₹1,400–3,500/session; aspirant budgets tight)

| Tier | Monthly | Quarterly | Yearly | What's included |
|---|---|---|---|---|
| **Sukoon Free** | ₹0 | — | — | 15 chat msgs/day, all breathing/grounding exercises, journaling (no AI reflections), mood tracking, 1 journey, WHO-5 |
| **Sukoon Plus** | ₹99 | ₹249 | ₹799 | 100 msgs/day, AI journal reflections, all journeys, weekly insights, full meditation library, voice-note journal |
| **Sukoon Pro** | ₹249 | ₹649 | ₹1,999 | Everything + Voice Mode (60 min/mo), Sonnet-priority deep conversations, deep insights (opt-in) |
| **Neev bundle** | — | — | — | Any active Neev plan → 40% off Sukoon Plus/Pro (e.g., Plus at ₹59/mo). Surfaced on both pricing pages. |

7-day full-Pro trial (mirror Neev's trial mechanics). All via Razorpay subscriptions.

---

## 5. Model Routing Summary

| Feature | Model | Mode | Why |
|---|---|---|---|
| Saathi chat (default) | **Claude Haiku 4.5** | runtime, cached prompt | Cheap, fast, warm with good prompting |
| Chat escalation (crisis-adjacent / deep) | **Claude Sonnet 4.6** | runtime, auto-escalate | Nuance where it matters |
| Crisis classifier | **Haiku 4.5** + keyword layer | runtime, every message | Safety-critical, cheap, parallel |
| Journal reflections | Haiku 4.5 | runtime, on request | Low-stakes warmth |
| Chat memory summaries | Haiku 4.5 | runtime, every ~10 msgs | Context compression |
| Weekly insights | **Sonnet 4.6** | weekly cron | Quality synthesis, low volume |
| Journey/meditation authoring | **Sonnet 4.6** (or Opus for flagship scripts) | offline pipeline + human review | One-time cost, quality-gated |
| Voice STT | gpt-4o-transcribe (mini variant for cost) | runtime, Pro only | Hindi-strong, $0.006/min |
| Voice TTS | gpt-4o-mini-tts vs **Sarvam Bulbul** (evaluate) | runtime Pro + one-time meditation renders | Hindi naturalness per rupee |
| Semantic cache embeddings | OpenAI text-embedding-3-small | runtime | Already in stack |

---

## 6. Database Schema (migration set `supabase/migrations/sukoon/`)

```sql
sukoon_profiles        (user_id PK→auth.users, language, exam, exam_date, restricted_mode, voice_pref, reminder_time)
sukoon_consents        (id, user_id, consent_version, consented_at)
sukoon_conversations   (id, user_id, started_at, summary, last_message_at)
sukoon_messages        (id, conversation_id, role, content, model_used, crisis_level, created_at)
sukoon_chat_summaries  (user_id, summary, updated_at)
sukoon_crisis_events   (id, user_id, level, layer, created_at)           -- minimal data, privacy-first
sukoon_journal_entries (id, user_id, body_enc, mood, tags[], prompt_id, audio_path, created_at, deleted_at)
sukoon_journal_prompts (id, text_hi, text_en, category, exam_phase, active)
sukoon_mood_entries    (id, user_id, score, emotions[], factors[], note, created_at)
sukoon_checkins        (id, user_id, type, answers_json, score, created_at)
sukoon_exercises       (id, type, title_hi, title_en, config_json, audio_hi, audio_en, premium, sort)
sukoon_exercise_sessions (id, user_id, exercise_id, duration_s, completed, created_at)
sukoon_journeys        (id, slug, title_hi, title_en, days, premium, version, published)
sukoon_journey_steps   (id, journey_id, day, step_order, type, content_json)
sukoon_journey_progress(id, user_id, journey_id, current_day, completed_steps[], started_at, completed_at)
sukoon_insights        (id, user_id, week_start, content, created_at)
sukoon_usage           (user_id, date, chat_msgs, reflections, PK(user_id,date))
sukoon_voice_usage     (user_id, month, seconds_used, PK(user_id,month))
sukoon_subscriptions   (reuse Neev billing tables with product='sukoon' OR mirror structure)
sukoon_semantic_cache  (id, embedding vector, response, lang, hits, reviewed)
```
RLS on every table (`user_id = auth.uid()`); pgcrypto for `body_enc`; indexes on `(user_id, created_at)` hot paths.

---

## 7. Claude Code Session Plan
Each session = one focused Claude Code run, backend + frontend together so you always see visible progress. Prefixed acceptance checks keep scope honest. (Sessions sized to your Neev cadence.)

### Session 1 — Module scaffold, dual-mode shell, theme
- **BE:** `server/src/sukoon` scaffold, router mounted at `/api/sukoon`, health route; shared middleware wired; env flags (`SUKOON_MODE`).
- **FE:** `client/src/sukoon` scaffold; router integration — Neev homepage gets "Wellness Companion" card alongside "Go to Dashboard"; `/sukoon` shell with bottom-nav (Home, Saathi, Journal, Tools, You); standalone entry via `VITE_APP=sukoon` renders Sukoon at `/` with own manifest + theme; Sukoon design tokens (palette, dark-mode-after-9pm).
- **Accept:** both modes boot locally; Neev untouched on main routes.

### Session 2 — Migrations, onboarding, consent, profile
- **BE:** full migration set above (empty feature tables fine); onboarding + consent endpoints; profile CRUD.
- **FE:** onboarding flow (language → consent → age gate → WHO-5 baseline → exam context → notifications); Privacy footer components.
- **Accept:** new user completes onboarding in Hindi; consent row versioned in DB; restricted_mode path renders.

### Session 3 — Crisis spine (BEFORE chat) + red-team suite
- **BE:** keyword layer (hi/hinglish/en lists), Haiku classifier service (JSON schema output), escalation rules engine, `sukoon_crisis_events` logging, anti-doom-loop rate limiter; **test suite: 100+ adversarial code-mixed inputs run in CI**.
- **FE:** full-screen crisis takeover card (tap-to-call 14416 etc.), inline resource card, acknowledgment flow.
- **Accept:** CI red-team suite green; manual Hinglish probes escalate correctly.

### Session 4 — Saathi chat MVP
- **BE:** `/chat/stream` SSE with cached prompt head + dynamic tail, Haiku default + Sonnet escalation hook into crisis levels, rolling summaries, daily caps via `sukoon_usage`, semantic-cache read path.
- **FE:** chat UI with streaming, starters, not-therapy footer, history, cap-reached UX.
- **Accept:** streamed Hindi conversation end-to-end; moderate-level message shows inline resources; caps enforce.

### Session 5 — Journaling end-to-end
- **BE:** encrypted entry CRUD, prompts API + seed 60 prompts, search (FTS on decrypted-at-query or tag/metadata search — decide: metadata+tag search to keep encryption strict), PDF export, AI reflections endpoint.
- **FE:** editor, guided-prompt picker, calendar heatmap, search, entry view with reflection button, export UI, streak chip.
- **Accept:** write/edit/search/export works; reflection returns warm Hindi output; DB shows ciphertext.

### Session 6 — Mood tracking + charts
- **BE:** mood CRUD, factor-correlation aggregate endpoint, reminder-time storage.
- **FE:** 10-second check-in flow, emotion wheel (Hindi), trend charts, correlations view, calendar.
- **Accept:** two weeks of seeded data renders correct trends + one correlation insight.

### Session 7 — Exercise library (interactive + audio)
- **BE:** exercises seed (breathing configs, grounding scripts, timers, ambient list); Storage buckets + signed URL service; exercise session logging.
- **FE:** animated breathing (SVG sync + haptics), interactive 5-4-3-2-1, PMR player, meditation timer + ambient mixer, Media Session background play, service-worker caching of top audios.
- **Accept:** box breathing animates in sync offline; audio plays with screen locked.
- **Parallel (you, outside Claude Code):** run the content pipeline — Sonnet-draft 10 meditation scripts + review → TTS render → upload.

### Session 8 — Guided journeys + admin content queue
- **BE:** journey/step/progress APIs; versioned JSON content loader; lightweight admin review queue (reuse Neev admin pattern) for journey drafts.
- **FE:** journey catalog, daily-step player (mixed step types: read / exercise / journal / saathi check-in), progress rings, completion reflection.
- **Accept:** "Exam-Eve Panic" single-session journey fully playable; a 5-day journey day-locks correctly.

### Session 9 — Check-ins + weekly insights
- **BE:** WHO-5 + stress self-check scoring; Sunday insights cron (GitHub Actions) calling Sonnet with mood/exercise/journal-metadata only; insights delivery + push.
- **FE:** check-in flows with careful non-clinical copy, trend views, insights card feed.
- **Accept:** cron dry-run generates a sane Hindi insight from seeded week.

### Session 10 — Billing: standalone + bundle
- **BE:** Razorpay plans (Plus/Pro × m/q/y), webhooks, entitlement service unified with Neev (`hasSukoon(user)`), 40%-bundle discount logic, 7-day trial, cap tiers wired to entitlements.
- **FE:** Sukoon pricing page (mode-aware: standalone shows Sukoon plans; integrated adds bundle upsell), paywall interstitials, Neev pricing page "+ Sukoon" toggle, manage-subscription screen.
- **Accept:** test-mode purchase upgrades caps live; Neev Pro user sees discounted add-on.

### Session 11 — Voice Mode (Pro)
- **BE:** push-to-talk pipeline (upload → gpt-4o-transcribe → crisis check → Haiku → TTS → stream), minute metering with hard cap, TTS provider abstraction (OpenAI mini-tts now, Sarvam eval later).
- **FE:** voice screen (hold-to-talk, waveform, transcript toggle, ambient bed), meter UI, cap warnings.
- **Accept:** full Hindi voice round-trip < 4s perceived latency; meter decrements; crisis phrase in voice escalates.

### Session 12 — Reminders, garden, PWA polish
- **BE:** push scheduling crons (check-in, journey step, exam-eve ping), garden state endpoint.
- **FE:** Sukoon Garden component, notification preferences, standalone-mode manifest/icons/splash, install prompts, offline pages.
- **Accept:** exam-eve push fires for a user with exam_date=tomorrow; garden grows on activity; Lighthouse PWA pass in both modes.

### Session 13 — Privacy Center + DPDP + hardening
- **BE:** export (JSON+PDF), delete cascade with 7-day purge cron, consent withdrawal, audit log; rate limits; cost dashboards (per-model spend logging).
- **FE:** Privacy Center (Hindi-first plain language), delete/export flows, Play-Store-ready disclaimer copy baked into About.
- **Accept:** export contains everything; delete purges on dry-run; abuse rate-limits trip.

### Session 14 — Beta hardening + launch
- **BE:** analytics events (privacy-aware, no journal content), feedback endpoint, feature flags for beta cohort, seed final content (60 prompts, 15 meditations, 7 journeys).
- **FE:** onboarding polish, empty states, error states, feedback widget, beta banner.
- **Launch:** merge `feature/sukoon` → main behind `SUKOON_ENABLED` flag; enable for a 300-user Neev cohort; watch: D7/D30 retention, safety events, cap-hit rates, conversion.

---

## 8. Beta Benchmarks (decision gates — from the research)
- **Continue standalone push** if: D30 ≥ 10%, paid conversion ≥ 2%, zero unhandled safety incidents.
- **Fold into Neev as retention feature** (still valuable!) if engagement is good but conversion < 2%.
- **Pause open chat, keep tools** if any serious safety near-miss — pivot chat to guided-only flows while you harden.
- **Prioritize B2B2C** the moment any coaching institute offers ≥ ₹1,500/student/year.

## 9. Risks & Mitigations (carried from research, now design-bound)
- **User harm / crisis mishandling** → Session 3 built first, CI red-team, human-escalation-always, anti-doom-loop.
- **Clinical-language drift** → banned-word lint check on prompts + UI copy (add to CI).
- **Journal data breach** → encryption at rest, RLS, no journal text in logs/analytics/insights-by-default.
- **Voice cost blowout** → hard metering, half-duplex pipeline, Pro-only.
- **Parasocial over-reliance** → session-length gentle nudges ("थोड़ा break? एक walk?"), Saathi actively encourages real-world connection, no engagement-maximizing notifications.
- **Solo-dev burnout** → Neev remains product #1; Sukoon sessions are deliberately independent so the branch can pause anytime without rot.
