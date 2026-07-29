-- Sukoon F6 (Exercise library) — EXPANSION. Broadens the launch set (0084)
-- from 16 rows to 28 with real variety across every existing type — no new
-- schema, no new type, no code change. Reuses the stable `key` seed column and
-- the exact idempotent `on conflict (key) do update` upsert from 0084, so this
-- is safe to re-run and every player picks the rows up automatically (all five
-- players are fully config-driven: the breathing player filters `seconds > 0`
-- phases so a 2-phase pattern animates cleanly, PMR/grounding iterate their
-- arrays generically, and a meditation's `category` is rendered through an i18n
-- label with a raw-slug fallback).
--
-- WHAT'S ADDED (12 rows):
--   Breathing (+2): Coherent (resonance 5-5) and Extended Exhale (4-6) — joining
--     Box, 4-7-8 and Bhramari for a genuinely varied set (equal / hold-heavy /
--     humming / resonance / calming-exhale), each with its own phase-aligned
--     haptics_pattern_ms so the S1 Vibration-API breathing cues (sukoon-haptics.ts)
--     pace them on Android with zero extra wiring.
--   Grounding (+1): an exam-hall-specific 5-4-3-2-1. The grounding schema is
--     fixed at exactly five sense-steps (see/touch/hear/smell/taste), so a
--     non-sense technique (e.g. a "body scan" grounding) cannot be expressed here
--     without a schema+player change — the body-scan need is already served by
--     the `body_scan` meditation and by PMR (a tense-and-release body pass), so
--     the honest, schema-respecting variety is a second, context-built sense
--     grounding for the moment a wave of panic hits at the desk.
--   PMR (+2): a 2-min seated Desk Reset (mid-study micro-break, upper body only,
--     no lying down) and a 3-min Quick PMR (grouped major muscle groups) —
--     joining the full-body pass for real length + context variety.
--   Meditation (+7): exam-stress-specific themes an aspirant actually lives —
--     the night before, letting go of comparison, syllabus overwhelm, beginning
--     again after a setback, a morning study intention, quieting a racing mind at
--     night, and loving-kindness. New categories get labels in the web i18n
--     (Sukoon.tools.meditation.category.*, en+hi).
--
-- AUDIO: audio_hi/audio_en stay NULL (same generate-once-serve-many posture as
-- 0084) — meditations show the "audio not ready yet" empty state until an
-- operator uploads a Storage path, and pick it up with no code change. Breathing
-- /grounding/PMR are text+visual guided and need no audio at all.
--
-- PREMIUM: the core calming toolkit (breathing/grounding/PMR) stays FREE
-- (blueprint: "Free gets all breathing/grounding exercises"); the 7 new
-- meditations are premium (part of the Plus+ "full meditation library"),
-- matching 0084 where free users keep two taster meditations.
--
-- REGISTER: warm, second-person तुम, no clinical language (SUKOON_CONTEXT
-- banned-word list). Written to be read aloud, not machine-translated.
--
-- Applied to the cloud DB via `db push --db-url` — see [[supabase-headless-migrations]].

insert into public.sukoon_exercises (key, type, title_hi, title_en, config_json, premium, sort) values

-- Breathing ------------------------------------------------------------------
-- Coherent / resonance breathing: equal 5-in, 5-out (~6 breaths/min) — the
-- calm, steady pace research pairs with a settled nervous system. Two phases;
-- haptics one gentle pulse in, one longer pulse out.
($t$breathing_coherent$t$, $t$breathing$t$,
 $t$समस्वर श्वास (कोहेरेंट)$t$, $t$Coherent Breathing$t$,
 $j${"phases":[{"id":"inhale","seconds":5},{"id":"exhale","seconds":5}],"default_cycles":10,"haptics_pattern_ms":[200,300],"default_ambient":null}$j$::jsonb,
 false, 13),

-- Extended-exhale calming breath: 4-in, 6-out, no hold — the gentlest,
-- most accessible way to lengthen the out-breath (softer than 4-7-8's long hold).
($t$breathing_extended_exhale$t$, $t$breathing$t$,
 $t$लंबी साँस छोड़ना (शांति श्वास)$t$, $t$Extended Exhale (Calming Breath)$t$,
 $j${"phases":[{"id":"inhale","seconds":4},{"id":"exhale","seconds":6}],"default_cycles":8,"haptics_pattern_ms":[200,350],"default_ambient":null}$j$::jsonb,
 false, 14),

-- Grounding ------------------------------------------------------------------
-- Exam-hall 5-4-3-2-1: same five senses, but every prompt is built for the
-- moment panic rises at the desk — pulls attention back into the room. No text
-- input (you're mid-exam, not typing).
($t$grounding_exam_hall$t$, $t$grounding$t$,
 $t$परीक्षा हॉल में ग्राउंडिंग$t$, $t$Grounding in the Exam Hall$t$,
 $j${
   "steps": [
     {"sense":"see","count":5,"prompt_hi":"नज़र ऊपर उठाओ और कमरे में 5 चीज़ें देखो — घड़ी, खिड़की, अपना पेपर, बगल की मेज़। मन को कमरे में वापस लाओ।","prompt_en":"Lift your eyes and find 5 things in the room — the clock, a window, your paper, the desk beside you. Bring your mind back into the room."},
     {"sense":"touch","count":4,"prompt_hi":"4 चीज़ों को महसूस करो — कुर्सी की सतह, पैर ज़मीन पर, पेन की पकड़, मेज़ की ठंडक।","prompt_en":"Notice 4 things you can feel — the chair beneath you, feet on the floor, the pen in your grip, the cool desk."},
     {"sense":"hear","count":3,"prompt_hi":"3 आवाज़ें सुनो — पंखे की गूँज, किसी का पेज पलटना, अपनी अपनी साँस।","prompt_en":"Listen for 3 sounds — the fan's hum, a page turning nearby, your own breath."},
     {"sense":"smell","count":2,"prompt_hi":"2 गंध पर ध्यान दो — कागज़ की, कमरे की हवा की। बस नोटिस करो, नाम देने की ज़रूरत नहीं।","prompt_en":"Notice 2 smells — the paper, the air in the hall. Just notice; you don't need to name them."},
     {"sense":"taste","count":1,"prompt_hi":"1 गहरी साँस लो और मुँह का स्वाद महसूस करो। अब वापस अपने पेपर पर — एक सवाल, एक बार में।","prompt_en":"Take 1 slow breath and notice the taste in your mouth. Now, back to your paper — one question at a time."}
   ],
   "allow_text_input": false
 }$j$::jsonb,
 false, 21),

-- PMR ------------------------------------------------------------------------
-- Desk Reset (~2 min): upper body only, done sitting at your study desk —
-- tense each group for a moment, then let it go. A mid-study micro-break.
($t$pmr_desk_reset$t$, $t$pmr$t$,
 $t$डेस्क पर तनाव-मुक्ति (2 मिनट)$t$, $t$Desk Tension Reset (2 min)$t$,
 $j${
   "segments": [
     {"id":"hands","name_hi":"हाथ और मुट्ठियाँ","name_en":"Hands and fists","seconds":25},
     {"id":"forearms","name_hi":"कलाई और बाजू","name_en":"Wrists and forearms","seconds":25},
     {"id":"shoulders","name_hi":"कंधे (कानों तक उठाओ)","name_en":"Shoulders (lift to your ears)","seconds":30},
     {"id":"neck","name_hi":"गर्दन","name_en":"Neck","seconds":25},
     {"id":"face","name_hi":"जबड़ा और चेहरा","name_en":"Jaw and face","seconds":25}
   ]
 }$j$::jsonb,
 false, 31),

-- Quick PMR (~3 min): grouped major muscle groups for a fast full-body release
-- when there isn't time for the full pass.
($t$pmr_quick_reset$t$, $t$pmr$t$,
 $t$3 मिनट क्विक PMR$t$, $t$Quick 3-Minute PMR$t$,
 $j${
   "segments": [
     {"id":"legs","name_hi":"पैर और पिंडलियाँ","name_en":"Legs and calves","seconds":35},
     {"id":"core","name_hi":"पेट और कूल्हे","name_en":"Stomach and hips","seconds":30},
     {"id":"hands_arms","name_hi":"हाथ और बाजू","name_en":"Hands and arms","seconds":30},
     {"id":"shoulders_neck","name_hi":"कंधे और गर्दन","name_en":"Shoulders and neck","seconds":35},
     {"id":"face","name_hi":"चेहरा","name_en":"Face","seconds":25},
     {"id":"whole_body","name_hi":"पूरा शरीर एक साथ","name_en":"Whole body together","seconds":25}
   ]
 }$j$::jsonb,
 false, 32),

-- Meditation (7 exam-stress themes; audio filled in later — see header) -------
($t$med_exam_eve_calm$t$, $t$meditation$t$,
 $t$परीक्षा से एक रात पहले$t$, $t$The Night Before the Exam$t$,
 $j${"category":"exam_eve","duration_min":12}$j$::jsonb, true, 60),

($t$med_letting_go_comparison$t$, $t$meditation$t$,
 $t$तुलना को छोड़ना$t$, $t$Letting Go of Comparison$t$,
 $j${"category":"comparison","duration_min":10}$j$::jsonb, true, 61),

($t$med_overwhelm_syllabus$t$, $t$meditation$t$,
 $t$जब सब कुछ ज़्यादा लगे$t$, $t$When It All Feels Too Much$t$,
 $j${"category":"overwhelm","duration_min":9}$j$::jsonb, true, 62),

($t$med_after_setback$t$, $t$meditation$t$,
 $t$ठोकर के बाद फिर से शुरुआत$t$, $t$Beginning Again After a Setback$t$,
 $j${"category":"setback","duration_min":11}$j$::jsonb, true, 63),

($t$med_morning_intention$t$, $t$meditation$t$,
 $t$सुबह का संकल्प$t$, $t$Morning Intention$t$,
 $j${"category":"morning_intention","duration_min":6}$j$::jsonb, true, 64),

($t$med_racing_thoughts_night$t$, $t$meditation$t$,
 $t$रात को बेचैन मन को शांत करना$t$, $t$Quieting a Racing Mind at Night$t$,
 $j${"category":"racing_thoughts","duration_min":10}$j$::jsonb, true, 65),

($t$med_loving_kindness$t$, $t$meditation$t$,
 $t$मैत्री ध्यान$t$, $t$Loving-Kindness (Metta)$t$,
 $j${"category":"loving_kindness","duration_min":10}$j$::jsonb, true, 66)

on conflict (key) where key is not null do update set
  type        = excluded.type,
  title_hi    = excluded.title_hi,
  title_en    = excluded.title_en,
  config_json = excluded.config_json,
  premium     = excluded.premium,
  sort        = excluded.sort;
