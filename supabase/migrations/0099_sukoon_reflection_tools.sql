-- Sukoon F6 (Exercise library) — a NEW exercise category: `reflection`, a set
-- of self-guided THINKING tools that sit alongside breathing/grounding/PMR/
-- meditation/timer. These are practical coping SKILLS drawn from well-
-- established self-help approaches (gentle thought-reframing, a values check-in,
-- and a worry-postponement "container"), written entirely in warm, plain
-- language — never named as a clinical method, and never diagnostic. The user
-- reads and reflects at their own pace; nothing is scored and nothing they type
-- is saved or sent anywhere (the player keeps every text/chip entry in local
-- component state only, exactly like grounding's optional per-step notes).
--
-- NO new player wiring beyond one config-driven page (tools-reflection.tsx):
-- the shared `reflection` config is a short sequence of prompt CARDS, each with
-- an optional text box (short/long) or a tap-to-pick chip set (`none` = read-
-- and-reflect). One player renders all three tools and any future one, the same
-- way the grounding player iterates its steps array.
--
-- Reuses the stable `key` seed column and the exact idempotent
-- `on conflict (key) do update` upsert from 0084/0094, so this is safe to
-- re-run and every surface (the tools grid, its filter chips, a journey's
-- exercise_ref step) picks the rows up automatically.
--
-- PREMIUM: all three are FREE (premium=false) — they're part of the core
-- coping toolkit, in the same spirit as "the core breathing, grounding, and
-- timer tools stay free forever". A coping skill someone reaches for on a hard
-- day should never sit behind a paywall.
--
-- SORT: 25–27, so the reflection tools appear right after grounding (20–21)
-- and before PMR (30–32) in the "All" view.
--
-- REGISTER: warm, second-person तुम, no clinical language (SUKOON_CONTEXT
-- banned-word list). Written to be read slowly, not machine-translated.
--
-- Applied to the cloud DB via `db push --db-url` — see [[supabase-headless-migrations]].

insert into public.sukoon_exercises (key, type, title_hi, title_en, config_json, premium, sort) values

-- 1. Thought-reframing — notice a stressful thought, look at it kindly, find a
--    steadier way to hold it. Self-guided cognitive reframing as a coping skill.
($t$reflect_reframe_thought$t$, $t$reflection$t$,
 $t$एक सोच को सुलझाना$t$, $t$Untangling a Thought$t$,
 $j${
   "intro_en": "Sometimes one stressful thought starts to loop and grow until it feels like the whole truth. This is a gentle way to notice it, look at it kindly, and find a steadier way to hold it.",
   "intro_hi": "कभी-कभी एक ही तनाव भरी सोच बार-बार घूमने लगती है और इतनी बड़ी हो जाती है कि पूरा सच लगने लगती है। यह उस सोच को धीरे से पहचानने, उसे नरमी से देखने, और उसे थामने का एक शांत तरीक़ा है।",
   "steps": [
     {
       "id": "notice",
       "prompt_en": "What's the thought weighing on you right now? Put it into a few plain words.",
       "prompt_hi": "अभी कौन-सी सोच तुम्हारे मन पर भारी है? उसे कुछ सीधे-सादे शब्दों में रखो।",
       "helper_en": "For example: \"I'll never finish the syllabus in time.\"",
       "helper_hi": "जैसे: \"मैं समय पर सिलेबस कभी पूरा नहीं कर पाऊँगा।\"",
       "input": "short",
       "placeholder_en": "The thought, in a few words",
       "placeholder_hi": "वह सोच, कुछ शब्दों में"
     },
     {
       "id": "feel",
       "prompt_en": "When this thought shows up, what do you feel — and where do you notice it in your body? Just notice; there's nothing to fix.",
       "prompt_hi": "जब यह सोच आती है, तो तुम्हें क्या महसूस होता है — और शरीर में कहाँ महसूस होता है? बस नोटिस करो; कुछ ठीक करने की ज़रूरत नहीं।",
       "input": "none"
     },
     {
       "id": "examine",
       "prompt_en": "Now look at it gently. Is this a solid fact, or is it a fear speaking? Would you say it, in these exact words, to a good friend in your place?",
       "prompt_hi": "अब इसे नरमी से देखो। क्या यह एक पक्का तथ्य है, या यह डर बोल रहा है? क्या तुम यही बात, इन्हीं शब्दों में, अपनी जगह खड़े किसी अच्छे दोस्त से कहोगे?",
       "input": "none"
     },
     {
       "id": "evidence",
       "prompt_en": "What's one small thing that doesn't quite fit this thought — a time it wasn't fully true?",
       "prompt_hi": "एक छोटी-सी बात जो इस सोच में ठीक से बैठती नहीं — कोई मौक़ा जब यह पूरी तरह सच नहीं थी?",
       "input": "short",
       "placeholder_en": "One thing that doesn't fit",
       "placeholder_hi": "एक बात जो इसमें फिट नहीं बैठती"
     },
     {
       "id": "reframe",
       "prompt_en": "Now write the same thing in a kinder, fairer way. Not fake-cheerful — just truer and steadier.",
       "prompt_hi": "अब वही बात एक नरम, न्यायसंगत तरीक़े से लिखो। बनावटी खुशी नहीं — बस ज़्यादा सच्ची और स्थिर।",
       "input": "long",
       "placeholder_en": "Even if it feels hard, I can take the next chapter one at a time.",
       "placeholder_hi": "भले ही यह कठिन लगे, मैं अगला अध्याय एक-एक करके कर सकता हूँ।"
     }
   ],
   "closing_en": "You looked at a heavy thought instead of being carried by it. That steadier version is yours — come back to it whenever the old one gets loud.",
   "closing_hi": "तुमने एक भारी सोच में बहने के बजाय उसे ठहरकर देखा। वह ज़्यादा स्थिर रूप तुम्हारा है — जब भी पुरानी सोच तेज़ हो, उसके पास लौट आना।"
 }$j$::jsonb,
 false, 25),

-- 2. Values / priorities reflection — reconnect with what the effort is really
--    for, when exam pressure crowds it out. Values-check as a coping skill.
($t$reflect_values_check$t$, $t$reflection$t$,
 $t$जो तुम्हारे लिए मायने रखता है$t$, $t$What Matters to You$t$,
 $j${
   "intro_en": "When exam pressure fills every hour, it's easy to lose sight of what you're really doing all this for. A few quiet minutes to reconnect with what matters — so today's effort feels like yours, not just a race.",
   "intro_hi": "जब परीक्षा का दबाव हर घंटे को भर देता है, तो यह भूल जाना आसान है कि आख़िर यह सब किसके लिए कर रहे हो। कुछ शांत पल, उस चीज़ से फिर जुड़ने के लिए जो मायने रखती है — ताकि आज की मेहनत सिर्फ़ एक दौड़ नहीं, तुम्हारी अपनी लगे।",
   "steps": [
     {
       "id": "pick",
       "prompt_en": "Which of these feel most important to you right now? Tap a few.",
       "prompt_hi": "इनमें से कौन-सी बातें अभी तुम्हारे लिए सबसे ज़रूरी लगती हैं? कुछ चुन लो।",
       "input": "chips",
       "chips": [
         {"id": "family", "label_en": "Family", "label_hi": "परिवार"},
         {"id": "growth", "label_en": "Learning & growing", "label_hi": "सीखना और बढ़ना"},
         {"id": "honesty", "label_en": "Honesty", "label_hi": "ईमानदारी"},
         {"id": "service", "label_en": "Serving others", "label_hi": "दूसरों की सेवा"},
         {"id": "independence", "label_en": "Independence", "label_hi": "आत्मनिर्भरता"},
         {"id": "health", "label_en": "Health", "label_hi": "सेहत"},
         {"id": "friendship", "label_en": "Friendship", "label_hi": "दोस्ती"},
         {"id": "steadiness", "label_en": "Calm & steadiness", "label_hi": "शांति और स्थिरता"},
         {"id": "curiosity", "label_en": "Curiosity", "label_hi": "जिज्ञासा"},
         {"id": "community", "label_en": "My community", "label_hi": "मेरा समाज"}
       ]
     },
     {
       "id": "why",
       "prompt_en": "Pick one of those. Why does it matter to you — in your own words?",
       "prompt_hi": "उनमें से एक चुनो। वह तुम्हारे लिए क्यों मायने रखती है — अपने शब्दों में?",
       "input": "long",
       "placeholder_en": "It matters to me because…",
       "placeholder_hi": "यह मेरे लिए इसलिए मायने रखती है क्योंकि…"
     },
     {
       "id": "step",
       "prompt_en": "One small thing you could do today that honours that — even five minutes of it.",
       "prompt_hi": "आज एक छोटा-सा काम जो उसका सम्मान करे — भले ही सिर्फ़ पाँच मिनट का।",
       "input": "short",
       "placeholder_en": "Today I could…",
       "placeholder_hi": "आज मैं…"
     },
     {
       "id": "reconnect",
       "prompt_en": "Notice this: your studies can be one way you live this value — not the opposite of it. Let that sit for a breath.",
       "prompt_hi": "इसे महसूस करो: तुम्हारी पढ़ाई इस मूल्य को जीने का एक तरीक़ा हो सकती है — उसके ख़िलाफ़ नहीं। इसे एक साँस भर ठहरने दो।",
       "input": "none"
     }
   ],
   "closing_en": "What matters to you is still here, underneath all the pressure. Let it quietly steer one small choice today.",
   "closing_hi": "जो तुम्हारे लिए मायने रखता है, वह सारे दबाव के नीचे अब भी मौजूद है। आज उसे चुपचाप एक छोटे फ़ैसले की दिशा तय करने दो।"
 }$j$::jsonb,
 false, 26),

-- 3. Worry-time container — set a worry down safely and give it a proper time
--    later, so it stops pulling at you mid-study. Worry-postponement skill.
($t$reflect_worry_time$t$, $t$reflection$t$,
 $t$चिंताओं के लिए एक समय$t$, $t$A Time for Worries$t$,
 $j${
   "intro_en": "Worries don't always need solving the moment they arrive — least of all mid-study. This is a way to set one down safely so it stops tugging at you, and give it a proper time later.",
   "intro_hi": "चिंताओं को हमेशा उसी पल हल करने की ज़रूरत नहीं होती — ख़ासकर पढ़ाई के बीच में। यह एक तरीक़ा है किसी चिंता को सुरक्षित रूप से नीचे रखने का, ताकि वह तुम्हें खींचना बंद कर दे, और उसे बाद में एक सही समय देने का।",
   "steps": [
     {
       "id": "name",
       "prompt_en": "What's the worry tugging at you right now? Name it plainly.",
       "prompt_hi": "अभी कौन-सी चिंता तुम्हें खींच रही है? उसे सीधे-सीधे नाम दो।",
       "input": "short",
       "placeholder_en": "The worry, in a line",
       "placeholder_hi": "वह चिंता, एक पंक्ति में"
     },
     {
       "id": "sort",
       "prompt_en": "Ask gently: is there anything I can actually do about this in this moment? If yes, note the one next step. If not, that's okay — it can wait.",
       "prompt_hi": "धीरे से पूछो: क्या इस पल में मैं सच में इसके बारे में कुछ कर सकता हूँ? अगर हाँ, तो अगला एक क़दम लिख लो। अगर नहीं, तो कोई बात नहीं — यह रुक सकती है।",
       "input": "short",
       "placeholder_en": "One next step, or leave it blank",
       "placeholder_hi": "अगला एक क़दम, या ख़ाली छोड़ दो"
     },
     {
       "id": "park",
       "prompt_en": "Now picture placing this worry in a box and gently closing the lid. You're not throwing it away — just keeping it safe. It will still be there; it doesn't need your attention this minute.",
       "prompt_hi": "अब कल्पना करो कि तुम इस चिंता को एक डिब्बे में रख रहे हो और ढक्कन धीरे से बंद कर रहे हो। तुम इसे फेंक नहीं रहे — बस संभालकर रख रहे हो। यह वहीं रहेगी; इसे इस मिनट तुम्हारे ध्यान की ज़रूरत नहीं।",
       "input": "none"
     },
     {
       "id": "appoint",
       "prompt_en": "Give it a time later today when you'll sit with it, if it still matters then. A short, fixed slot works best.",
       "prompt_hi": "आज दिन में इसे एक समय दो जब तुम इसके साथ बैठोगे, अगर तब भी यह मायने रखे। एक छोटा, तय समय सबसे अच्छा रहता है।",
       "input": "short",
       "placeholder_en": "e.g. 8:30 pm, for 10 minutes",
       "placeholder_hi": "जैसे रात 8:30 बजे, 10 मिनट के लिए"
     },
     {
       "id": "return",
       "prompt_en": "For now, take one slow breath and turn back to what's in front of you. The worry has a place and a time — it doesn't need to follow you around.",
       "prompt_hi": "अभी के लिए, एक धीमी साँस लो और जो तुम्हारे सामने है उसकी ओर लौट आओ। चिंता के पास एक जगह और एक समय है — अब उसे तुम्हारे पीछे-पीछे घूमने की ज़रूरत नहीं।",
       "input": "none"
     }
   ],
   "closing_en": "You gave that worry a home and a time. If it comes knocking early, you can gently tell it: not now — later.",
   "closing_hi": "तुमने उस चिंता को एक घर और एक समय दिया। अगर वह वक़्त से पहले दस्तक दे, तो उससे नरमी से कह सकते हो: अभी नहीं — बाद में।"
 }$j$::jsonb,
 false, 27)

on conflict (key) where key is not null do update set
  type        = excluded.type,
  title_hi    = excluded.title_hi,
  title_en    = excluded.title_en,
  config_json = excluded.config_json,
  premium     = excluded.premium,
  sort        = excluded.sort;
