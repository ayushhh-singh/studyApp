PROJECT: "Sukoon" — a wellness companion module inside the Neev app (this repo).
Read sukoon-build-blueprint.md for full feature specs before writing any code.

WHAT SUKOON IS: An emotional wellbeing companion for exam aspirants — AI chat
(Saathi), journaling, mood tracking, calming exercises, guided stress journeys,
weekly insights, premium voice mode. It is a WELLNESS product, NOT therapy.

HARD SAFETY RULES (apply to all code, prompts, and UI copy you write):
- NEVER use these words anywhere in UI, prompts, or docs: therapy, therapist,
  psychologist, treatment, diagnosis, patient, medication, cure, clinical.
- Every AI feature includes the footer/disclaimer pattern already defined.
- Crisis detection escalates to human helplines (Tele-MANAS 14416 primary);
  the AI never attempts to manage a crisis conversation alone.

LANGUAGE: Fully bilingual, EQUAL Hindi and English — exactly like the rest of
Neev. Every user-facing string goes through the existing i18n system with both
hi and en values. All content tables store text_hi AND text_en. The AI chat
replies in the user's chosen language (hi / en / hinglish preference stored in
sukoon_profiles.language). Never build anything English-only or Hindi-only.

ARCHITECTURE RULES:
- Frontend module: client/src/sukoon/** — pages, components, stores, lib.
  May import shared utils/components from Neev's shared/common directories,
  but NEVER from Neev feature modules. Neev may import from sukoon; never
  the reverse.
- Backend module: server/src/sukoon/** with its own router index mounted at
  /api/sukoon/*. Reuses shared middleware (auth, Supabase client, SSE helper,
  Razorpay util, semantic-cache util) — follow existing Neev patterns exactly.
- DB: all tables prefixed sukoon_, migrations in supabase/migrations/sukoon/,
  RLS on everything (user_id = auth.uid()), self-contained (no FKs into Neev
  feature tables; auth.users FK is fine).
- ACCESS POINTS (integrated mode): (1) Neev public homepage gets a "Wellness
  Companion" card next to "Go to Dashboard"; (2) inside the logged-in Neev
  app, the main navigation (sidebar/bottom nav) gets a "Wellness" item that
  routes to /sukoon — Sukoon must be fully reachable and functional from
  within the authenticated Neev shell.
- STANDALONE MODE: VITE_APP=sukoon mounts Sukoon at "/" with its own
  branding/manifest/theme and hides all Neev nav. Same codebase, build-time
  switch. Keep this working at all times.
- Design: Sukoon has its own theme tokens (calm indigo/teal/sand palette,
  slower motion) defined in client/src/sukoon/theme — do not restyle Neev.

MODELS & COST RULES:
- Chat default: claude-haiku-4-5. Auto-escalate to claude-sonnet-4-6 on
  crisis level >= moderate or long/complex messages. Weekly insights: Sonnet.
- Anthropic prompt caching on the static system-prompt head, always.
- Nothing generates content at runtime that can be pre-generated (journeys,
  meditations, prompts are static seeded content).
- Enforce tier caps server-side via sukoon_usage before any model call.

FRONTEND ARCHITECTURE: identical to Neev — React + Vite + Tailwind +
shadcn/ui. Use existing shadcn components wherever possible (Button, Card,
Dialog, Sheet, Drawer, Tabs, Input, Textarea, Select, Slider, Progress,
Calendar, Toast/Sonner, Skeleton, Badge, Accordion, etc.); if a needed
primitive isn't in the project yet, add it via the shadcn CLI — never
hand-roll a parallel version. Sukoon's calm theme is implemented as CSS
variable overrides of the shadcn theme tokens, scoped under a `.sukoon`
root class on the Sukoon layout — Neev's global theme stays untouched.
Build fully custom components ONLY where no shadcn primitive exists
(breathing animation, voice waveform, garden SVG, emotion wheel, crisis
takeover) and even then compose shadcn primitives internally (e.g., the
takeover uses Dialog/AlertDialog as its base).

CONVENTIONS: TypeScript strict everywhere. Zod validation on all API inputs.
Follow existing Neev patterns for: SSE streaming (fetch-event-source), auth
middleware, error handling, Zustand store shape, i18n, admin pages, Razorpay.
When showing me code changes, show ONLY changed/updated sections, not whole
files. Never hardcode absolute local filesystem paths (portability rule).