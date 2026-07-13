---
name: frontend-design
description: "Design system for Neev (UPPSC exam prep). Use when creating or modifying any UI in apps/web."
---
## Brief: serious daily tool for UP civil-services aspirants, mostly budget Android, Hindi-first. Not a generic SaaS dashboard.
## Signature element: "the Rubric Dial" — a 180° graduated arc gauge (tick marks + coral->marigold->tulsi band + scoreboard numeral centered/below). Reads like an exam-hall meter, not a fitness-ring. Used for avg score stats, the Answers (flagship) nav accent, and future evaluation results. Component: `src/components/ui-x/score-gauge.tsx`.
## Colors (CSS vars in src/index.css, both light+dark defined). Light is the default mode — dark only activates on explicit user toggle (src/stores/theme-store.ts), never from OS preference:
- `--background`/`--foreground` (Chalk/Ink concept) — light: #F7F9FC / #0F172A. dark: #0D1526 / #F1F5F9. NOT cream, NOT pure black/gray.
- `--primary` (Rajdhani Blue) — light: #2563EB (vivid indigo-blue, trust/authority). dark: #60A5FA (lighter for contrast against the dark card, paired with dark `--primary-foreground` text).
- `--marigold` — light: #F59E0B / dark: #FBBF24. Accent: streak flame, flagship highlight, gauge high/mid band.
- `--tulsi` — light: #10B981 / dark: #34D399. Success / correct / gauge top band.
- `--coral` — light: #F43F5E / dark: #FB7185. Error / low score band.
- Each of marigold/tulsi/coral has a paired `-foreground` token (a dark shade in light mode, a light shade in dark mode) for text sitting on that color's `/15` tint — always use the pair together, never hardcode a text color against a tinted badge.
- Kept vivid/saturated on purpose (Tailwind blue-600/amber-500/emerald-500/rose-500 family) — a muted, low-chroma version of this same hue set reads as generic corporate SaaS, not a lively daily-use tool for students.
## Fonts: Noto Sans Devanagari (weight 500 body / 700 headings, line-height >=1.75 always — it's the star, not a fallback) + Inter (UI chrome: nav, buttons, labels, weight 500/600). Display/"scoreboard" numerals (streak count, score %, big stats): Inter weight 800, tabular-nums, tracking -0.02em, oversized — this is the "real character" display treatment, not a 3rd typeface.
## Spacing: strict 4px grid (Tailwind default scale — no arbitrary px values that break it).
## Radii: base `--radius: 0.75rem` (12px) for cards/inputs, 10px buttons. Pills only for streak/badge chips. Gauge is a true arc, never radius-based.
## Layout: ONE nav config array (`src/lib/nav.ts`) drives both desktop sidebar (all 7 items) and mobile bottom tab bar (<768px: 4 items + "More" sheet = 5 tabs). Flagship (Answers) always gets the gauge-accent treatment, never a plain icon.
## Quality floor (non-negotiable): visible focus rings, `prefers-reduced-motion` respected, tap targets >=44px, AA contrast in light AND dark, Devanagari line-height >=1.75.
## NEVER: cream bg + serif + terracotta accent; near-black + single acid-green; broadsheet hairline-rule newspaper look; stock shadcn neutral gray (oklch 0/0/0 grays) — always route through the named tokens above.
