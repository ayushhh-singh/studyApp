-- Sukoon F7 (Guided Journeys) — two placeholder journeys, authored in the exact
-- shape the admin content-queue validates/publishes (sukoonJourneyContentSchema
-- in packages/shared/src/sukoon.ts): a journey row (sukoon_journeys) + one
-- sukoon_journey_steps row per step, `day`/`step_order`/`type` as real columns,
-- everything else (title_hi/en + the type's own fields) in content_json.
--
-- Both journeys are PUBLISHED placeholders — real, replaceable seed content
-- (per the session brief), not disabled drafts, so the catalog/player/admin
-- queue can all be exercised end-to-end immediately.
--
-- Idempotent re-run: upsert-by-slug for the journey row, delete+reinsert for
-- its steps (a step SET has no natural per-row idempotency key to upsert on
-- the way exercises' `key` column does — replacing the whole set is simpler
-- and matches the admin API's own upsert-by-slug semantics: POST /admin/journeys
-- always replaces a journey's full step set).
--
-- exercise_key references sukoon_exercises.key seeded in 0084 (box_breathing,
-- grounding_54321) — both free, non-premium tools, so a locked exercise never
-- blocks a free-tier journey step.
--
-- Applied to the cloud DB via `db push --db-url` — see [[supabase-headless-migrations]].

do $$
declare
  exam_eve_id uuid;
  mock_anx_id uuid;
begin
  -- ---------------------------------------------------------------------
  -- 1. Exam-Eve Panic (blueprint F7 #1) — single session, free, exempt from
  -- day-locking by construction (days=1, so there's never a "next day").
  -- ---------------------------------------------------------------------
  insert into public.sukoon_journeys (slug, title_hi, title_en, description_hi, description_en, days, premium, version, published)
  values (
    'exam_eve_panic',
    $t$परीक्षा की पूर्व संध्या — घबराहट के लिए$t$,
    $t$Exam-Eve Panic$t$,
    $t$कल परीक्षा है और घबराहट बढ़ रही है? 20 मिनट में साँस लो, मन हल्का करो, और थोड़ा भरोसा वापस पाओ।$t$,
    $t$Exam tomorrow and the nerves are climbing? A 20-minute reset — breathe, unload the worry, and find a little steadiness before you sleep.$t$,
    1, false, 1, true
  )
  on conflict (slug) do update set
    title_hi = excluded.title_hi, title_en = excluded.title_en,
    description_hi = excluded.description_hi, description_en = excluded.description_en,
    days = excluded.days, premium = excluded.premium,
    version = public.sukoon_journeys.version + 1, published = excluded.published
  returning id into exam_eve_id;

  delete from public.sukoon_journey_steps where journey_id = exam_eve_id;

  insert into public.sukoon_journey_steps (journey_id, day, step_order, type, content_json) values
  (exam_eve_id, 1, 1, 'read', $j${
    "title_hi": "पहले, एक गहरी साँस",
    "title_en": "First, one deep breath",
    "body_hi": "जो घबराहट अभी महसूस हो रही है, वो बताती है कि तुम्हें परवाह है — यह सामान्य है। अगले 20 मिनट सिर्फ़ अपने लिए हैं। कोई जल्दी नहीं।",
    "body_en": "The nervousness you're feeling right now just means you care — that's normal. The next 20 minutes are only for you. No rush."
  }$j$::jsonb),
  (exam_eve_id, 1, 2, 'checkin_scale', $j${
    "title_hi": "अभी कैसा महसूस हो रहा है?",
    "title_en": "How are you feeling right now?",
    "question_hi": "1 से 5 में, अभी घबराहट कितनी है?",
    "question_en": "On a scale of 1-5, how anxious do you feel right now?",
    "scale_min": 1, "scale_max": 5,
    "scale_labels_hi": ["बहुत शांत", "थोड़ा शांत", "ठीक-ठाक", "घबराया हुआ", "बहुत घबराया हुआ"],
    "scale_labels_en": ["Very calm", "A little calm", "So-so", "Anxious", "Very anxious"]
  }$j$::jsonb),
  (exam_eve_id, 1, 3, 'exercise_ref', $j${
    "title_hi": "बॉक्स ब्रीदिंग करें",
    "title_en": "Do box breathing",
    "exercise_key": "box_breathing"
  }$j$::jsonb),
  (exam_eve_id, 1, 4, 'journal_prompt', $j${
    "title_hi": "मन का बोझ उतारो",
    "title_en": "Unload what's on your mind",
    "prompt_hi": "अभी दिमाग़ में जो भी डर या चिंता घूम रही है, बिना सोचे-समझे यहाँ लिख दो। इसे किसी को दिखाना नहीं है।",
    "prompt_en": "Whatever fear or worry is circling in your head right now — write it down here without filtering. No one else needs to see this."
  }$j$::jsonb),
  (exam_eve_id, 1, 5, 'saathi_checkin', $j${
    "title_hi": "साथी से एक मिनट बात करो",
    "title_en": "Talk to Saathi for a minute",
    "seed_message_hi": "कल मेरी परीक्षा है और आज रात बहुत घबराहट हो रही है।",
    "seed_message_en": "My exam is tomorrow and I'm feeling really anxious tonight."
  }$j$::jsonb);

  -- ---------------------------------------------------------------------
  -- 2. Mock-Test Anxiety (blueprint F7 #6) — 5-day program, Plus+ (premium).
  -- ---------------------------------------------------------------------
  insert into public.sukoon_journeys (slug, title_hi, title_en, description_hi, description_en, days, premium, version, published)
  values (
    'mock_test_anxiety',
    $t$मॉक टेस्ट की चिंता$t$,
    $t$Mock-Test Anxiety$t$,
    $t$हर मॉक के बाद दिल बैठ जाता है? 5 दिनों में, मॉक टेस्ट को डर की जगह जानकारी के तौर पर देखना सीखो।$t$,
    $t$Does every mock test leave you shaken? Over 5 days, learn to treat a mock score as information, not a verdict.$t$,
    5, true, 1, true
  )
  on conflict (slug) do update set
    title_hi = excluded.title_hi, title_en = excluded.title_en,
    description_hi = excluded.description_hi, description_en = excluded.description_en,
    days = excluded.days, premium = excluded.premium,
    version = public.sukoon_journeys.version + 1, published = excluded.published
  returning id into mock_anx_id;

  delete from public.sukoon_journey_steps where journey_id = mock_anx_id;

  insert into public.sukoon_journey_steps (journey_id, day, step_order, type, content_json) values
  (mock_anx_id, 1, 1, 'read', $j${
    "title_hi": "एक मॉक स्कोर, एक कहानी नहीं",
    "title_en": "A mock score, not a life sentence",
    "body_hi": "मॉक टेस्ट का मतलब है 'अभी कहाँ खड़े हो', असली परीक्षा नहीं। पाँच दिनों में हम इसे थोड़ा हल्के ढंग से देखना सीखेंगे।",
    "body_en": "A mock test tells you where you stand right now — it isn't the real exam. Over the next five days we'll practice holding it a little more lightly."
  }$j$::jsonb),
  (mock_anx_id, 2, 1, 'checkin_scale', $j${
    "title_hi": "मॉक के बाद की भावना",
    "title_en": "How mocks leave you feeling",
    "question_hi": "पिछले मॉक के बाद तुम कितने परेशान थे?",
    "question_en": "After your last mock, how shaken did you feel?",
    "scale_min": 1, "scale_max": 5,
    "scale_labels_hi": ["बिलकुल नहीं", "थोड़ा", "ठीक-ठाक", "काफ़ी", "बहुत ज़्यादा"],
    "scale_labels_en": ["Not at all", "A little", "Moderately", "Quite a bit", "A lot"]
  }$j$::jsonb),
  (mock_anx_id, 3, 1, 'exercise_ref', $j${
    "title_hi": "5-4-3-2-1 ग्राउंडिंग करो",
    "title_en": "Try 5-4-3-2-1 grounding",
    "exercise_key": "grounding_54321"
  }$j$::jsonb),
  (mock_anx_id, 4, 1, 'journal_prompt', $j${
    "title_hi": "एक गलती, एक सबक",
    "title_en": "One mistake, one lesson",
    "prompt_hi": "अपने पिछले मॉक की एक ग़लती चुनो। उसने तुम्हें क्या सिखाया — बिना ख़ुद को कोसे?",
    "prompt_en": "Pick one mistake from your last mock. What did it actually teach you — without beating yourself up over it?"
  }$j$::jsonb),
  (mock_anx_id, 5, 1, 'saathi_checkin', $j${
    "title_hi": "साथी के साथ आगे की सोचो",
    "title_en": "Think ahead with Saathi",
    "seed_message_hi": "अगला मॉक टेस्ट है और मुझे उससे पहले ही डर लगने लगा है।",
    "seed_message_en": "I have another mock test coming up and I'm already dreading it."
  }$j$::jsonb);
end;
$$;
