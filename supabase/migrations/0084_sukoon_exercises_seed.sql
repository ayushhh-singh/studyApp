-- Sukoon F6 (Exercise library) — a stable seed key on sukoon_exercises (same
-- idempotent-upsert pattern as 0081/0082 for sukoon_journal_prompts), the
-- private `sukoon-audio` Storage bucket, and the launch content set: 3
-- breathing patterns, one interactive 5-4-3-2-1 grounding, one full-body PMR,
-- one unguided timer, and 10 guided-meditation catalog slots.
--
-- AUDIO: audio_hi/audio_en are left NULL for every row here — these are
-- pre-rendered TTS files the operator uploads to Storage once recorded
-- (blueprint: "generate-once, serve-many", zero runtime AI cost). The player
-- degrades to a text/visual-guided experience when audio is absent (PMR shows
-- the segment list on a timer; meditations show a "not uploaded yet" empty
-- state) and picks the real file up automatically the moment a row's
-- audio_hi/audio_en is updated to a real Storage path — no code change needed.
--
-- Applied to the cloud DB via `db push --db-url` — see [[supabase-headless-migrations]].

-- ---------------------------------------------------------------------------
-- 1. Seed key (idempotent re-run / edit support, mirrors 0081's journal-prompt key)
-- ---------------------------------------------------------------------------

alter table public.sukoon_exercises
  add column if not exists key text;
create unique index if not exists sukoon_exercises_key_uidx
  on public.sukoon_exercises (key)
  where key is not null;

-- ---------------------------------------------------------------------------
-- 2. Storage bucket — private. Every exercise/meditation/ambient audio file is
-- operator-uploaded reviewed content, never user data, so there is no bucket
-- RLS policy at all (same "internal, service-role only" posture as 0079's
-- sukoon_semantic_cache — see that file's header). The API mints short-lived
-- signed URLs with the SERVICE ROLE client (bypasses RLS regardless), which is
-- also the one place premium-gating is enforced (a locked exercise's audio
-- path is never signed for a free-tier caller) — a bucket-level policy could
-- not express that tier check, so signing must stay server-side by design.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sukoon-audio', 'sukoon-audio', false,
  20971520, -- 20MB — long guided meditations, still well under Supabase's default limits
  array['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Seed content — bilingual, warm Hinglish-adjacent register (तुम), no
-- clinical language (SUKOON_CONTEXT banned-word list). sort groups the tools
-- grid: breathing (10s) -> grounding (20) -> pmr (30) -> timer (40) ->
-- meditations (50s). premium=false for the whole core calming toolkit
-- (breathing/grounding/pmr/timer — blueprint F6/pricing: Free gets "all
-- breathing/grounding exercises"); 2 of 10 meditations are free as a taste of
-- "full meditation library" (Plus+), the rest premium.
-- ---------------------------------------------------------------------------

insert into public.sukoon_exercises (key, type, title_hi, title_en, config_json, premium, sort) values

-- Breathing --------------------------------------------------------------
($t$box_breathing$t$, $t$breathing$t$,
 $t$बॉक्स ब्रीदिंग$t$, $t$Box Breathing$t$,
 $j${"phases":[{"id":"inhale","seconds":4},{"id":"hold1","seconds":4},{"id":"exhale","seconds":4},{"id":"hold2","seconds":4}],"default_cycles":6,"haptics_pattern_ms":[200,120,200,120],"default_ambient":null}$j$::jsonb,
 false, 10),

($t$breathing_478$t$, $t$breathing$t$,
 $t$4-7-8 ब्रीदिंग$t$, $t$4-7-8 Breathing$t$,
 $j${"phases":[{"id":"inhale","seconds":4},{"id":"hold1","seconds":7},{"id":"exhale","seconds":8},{"id":"hold2","seconds":0}],"default_cycles":4,"haptics_pattern_ms":[200,120,300,0],"default_ambient":null}$j$::jsonb,
 false, 11),

($t$breathing_bhramari$t$, $t$breathing$t$,
 $t$भ्रामरी (हमिंग ब्रीदिंग)$t$, $t$Bhramari (Humming Breath)$t$,
 $j${"phases":[{"id":"inhale","seconds":4},{"id":"hold1","seconds":2},{"id":"exhale","seconds":6},{"id":"hold2","seconds":0}],"default_cycles":5,"haptics_pattern_ms":[200,0,400,0],"default_ambient":null}$j$::jsonb,
 false, 12),

-- Grounding ----------------------------------------------------------------
($t$grounding_54321$t$, $t$grounding$t$,
 $t$5-4-3-2-1 ग्राउंडिंग$t$, $t$5-4-3-2-1 Grounding$t$,
 $j${
   "steps": [
     {"sense":"see","count":5,"prompt_hi":"अपने आस-पास 5 चीज़ें ढूंढो जिन्हें तुम देख सकते हो — एक-एक करके नाम लो।","prompt_en":"Find 5 things around you that you can see — name them one by one."},
     {"sense":"touch","count":4,"prompt_hi":"अब 4 चीज़ों को छूकर महसूस करो — बनावट, तापमान, कैसा लगता है।","prompt_en":"Now touch 4 things and notice how they feel — texture, temperature, weight."},
     {"sense":"hear","count":3,"prompt_hi":"3 आवाज़ें सुनो जो अभी तुम्हारे आस-पास हैं — दूर की भी, पास की भी।","prompt_en":"Listen for 3 sounds around you right now — near or far."},
     {"sense":"smell","count":2,"prompt_hi":"2 चीज़ों को सूँघो, या 2 ऐसी खुशबू याद करो जो तुम्हें पसंद हैं।","prompt_en":"Smell 2 things nearby, or recall 2 scents you like."},
     {"sense":"taste","count":1,"prompt_hi":"1 स्वाद पर ध्यान दो — मुँह में अभी क्या स्वाद है, या पानी की एक घूँट लो।","prompt_en":"Notice 1 taste — whatever is in your mouth right now, or take a sip of water."}
   ],
   "allow_text_input": true
 }$j$::jsonb,
 false, 20),

-- PMR ------------------------------------------------------------------------
($t$pmr_full_body$t$, $t$pmr$t$,
 $t$पूरे शरीर की PMR$t$, $t$Full-Body PMR$t$,
 $j${
   "segments": [
     {"id":"feet","name_hi":"पैर","name_en":"Feet","seconds":25},
     {"id":"calves","name_hi":"पिंडली","name_en":"Calves","seconds":25},
     {"id":"thighs","name_hi":"जांघें","name_en":"Thighs","seconds":25},
     {"id":"glutes","name_hi":"कूल्हे","name_en":"Glutes","seconds":25},
     {"id":"stomach","name_hi":"पेट","name_en":"Stomach","seconds":25},
     {"id":"hands","name_hi":"हाथ और मुट्ठी","name_en":"Hands and fists","seconds":20},
     {"id":"arms","name_hi":"बाजू","name_en":"Arms","seconds":25},
     {"id":"shoulders","name_hi":"कंधे","name_en":"Shoulders","seconds":25},
     {"id":"face","name_hi":"चेहरा","name_en":"Face","seconds":20},
     {"id":"whole_body","name_hi":"पूरा शरीर","name_en":"Whole body","seconds":30}
   ]
 }$j$::jsonb,
 false, 30),

-- Unguided timer ---------------------------------------------------------
($t$unguided_timer$t$, $t$timer$t$,
 $t$मौन ध्यान टाइमर$t$, $t$Silent Meditation Timer$t$,
 $j${"duration_options_min":[1,3,5,10,15,20],"default_duration_min":5,"chime":"singing_bowl","ambient_options":["rain","tanpura","crickets","fan"]}$j$::jsonb,
 false, 40),

-- Guided meditations (10 slots; audio filled in later — see header) --------
($t$med_sleep_wind_down$t$, $t$meditation$t$,
 $t$नींद के लिए शांति$t$, $t$Sleep Wind-Down$t$,
 $j${"category":"sleep","duration_min":15}$j$::jsonb, false, 50),

($t$med_exam_morning_calm$t$, $t$meditation$t$,
 $t$परीक्षा की सुबह की शांति$t$, $t$Exam Morning Calm$t$,
 $j${"category":"exam_day","duration_min":8}$j$::jsonb, false, 51),

($t$med_easing_anxiety$t$, $t$meditation$t$,
 $t$चिंता को शांत करना$t$, $t$Easing Anxiety$t$,
 $j${"category":"anxiety","duration_min":10}$j$::jsonb, true, 52),

($t$med_body_scan$t$, $t$meditation$t$,
 $t$बॉडी स्कैन ध्यान$t$, $t$Body Scan Meditation$t$,
 $j${"category":"body_scan","duration_min":12}$j$::jsonb, true, 53),

($t$med_five_min_reset$t$, $t$meditation$t$,
 $t$5 मिनट रीसेट$t$, $t$5-Minute Reset$t$,
 $j${"category":"quick_reset","duration_min":5}$j$::jsonb, true, 54),

($t$med_self_compassion$t$, $t$meditation$t$,
 $t$आत्म-करुणा ध्यान$t$, $t$Self-Compassion Meditation$t$,
 $j${"category":"self_compassion","duration_min":10}$j$::jsonb, true, 55),

($t$med_focus_before_study$t$, $t$meditation$t$,
 $t$पढ़ाई से पहले फोकस$t$, $t$Focus Before Studying$t$,
 $j${"category":"focus","duration_min":7}$j$::jsonb, true, 56),

($t$med_gratitude$t$, $t$meditation$t$,
 $t$कृतज्ञता ध्यान$t$, $t$Gratitude Meditation$t$,
 $j${"category":"gratitude","duration_min":8}$j$::jsonb, true, 57),

($t$med_breath_awareness$t$, $t$meditation$t$,
 $t$साँस के प्रति जागरूकता$t$, $t$Breath Awareness$t$,
 $j${"category":"breath_awareness","duration_min":10}$j$::jsonb, true, 58),

($t$med_after_result_calm$t$, $t$meditation$t$,
 $t$रिज़ल्ट के बाद शांति$t$, $t$After the Result — Finding Calm$t$,
 $j${"category":"post_result","duration_min":12}$j$::jsonb, true, 59)

on conflict (key) where key is not null do update set
  type        = excluded.type,
  title_hi    = excluded.title_hi,
  title_en    = excluded.title_en,
  config_json = excluded.config_json,
  premium     = excluded.premium,
  sort        = excluded.sort;
