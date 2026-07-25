/**
 * `pnpm sukoon:embed-content` — compute ONE embedding per Sukoon content item
 * (F6 exercises + F7 journeys) into sukoon_content_embeddings (0101), so the
 * "For you" recommender (services/recommendations.ts) can cosine-match them to a
 * user's rolling emotional signal.
 *
 * WHY THIS IS OFFLINE + STATIC: content is operator-seeded (blueprint: "nothing
 * generates content at runtime that can be pre-generated"), so its embeddings are
 * computed ONCE here (or whenever content is added/edited) — never per request.
 * This is the SAME embeddings provider (lib/embeddings.ts) and cosine-ANN store
 * pattern the semantic cache + Saathi memory already use.
 *
 * WHAT GETS EMBEDDED: a rich BILINGUAL descriptor per item — its real title
 * (hi + en, pulled live from the DB) + a curator-authored "what this helps with"
 * blurb (hi + en) + its theme tags — so a Hindi OR English user signal matches
 * it well (cross-lingual, like every other Sukoon embedding). The theme tags
 * (emotions/factors/topics, drawn from the app's fixed F5 vocabularies) are ALSO
 * stored, and drive the honest reasoning line at read time.
 *
 * IDEMPOTENT + CHEAP: each row carries a source_hash of its exact embed input;
 * a re-run re-embeds ONLY items whose descriptor/title/tags changed (or are new),
 * never the whole library. Upsert is keyed on the STABLE (content_kind,
 * content_ref) = (kind, exercise.key | journey.slug), so a content re-seed that
 * changes uuids still updates the same embedding row. Never deletes.
 *
 * A content item with NO curator descriptor here is still embedded (from its
 * title + any DB description) but LOGGED loudly, so new content that needs a
 * descriptor/tags is easy to spot rather than silently under-served.
 *
 * Flags:
 *   --dry-run   Embed nothing, write nothing — just print the plan.
 *   --force     Re-embed every item even if its hash is unchanged.
 */
import { createHash } from "node:crypto";
import type { SukoonEmotionId, SukoonMoodFactorId } from "@neev/shared";
import { embeddings } from "../src/lib/embeddings.js";
import { supabase } from "../src/lib/supabase.js";
import { logger } from "../src/lib/logger.js";

/** Curator-authored descriptor + theme tags for one content item, keyed by its
 *  stable ref (exercise `key` / journey `slug`). Blurbs are bilingual, warm, and
 *  non-clinical (SUKOON_CONTEXT banned-word rules). Tags use the app's fixed F5
 *  emotion + mood-factor vocabularies; `topics` are free theme words. */
interface Descriptor {
  desc_en: string;
  desc_hi: string;
  emotions: SukoonEmotionId[];
  factors: SukoonMoodFactorId[];
  topics: string[];
}

const EXERCISE_DESCRIPTORS: Record<string, Descriptor> = {
  box_breathing: {
    desc_en: "A steady four-count breathing pattern to calm a racing mind and settle nerves before studying or an exam.",
    desc_hi: "एक स्थिर चार-गिनती वाली साँस, तेज़ चलते दिमाग को शांत करने और पढ़ाई या परीक्षा से पहले घबराहट कम करने के लिए।",
    emotions: ["anxious", "overwhelmed", "restless"],
    factors: ["studies"],
    topics: ["breath", "anxiety", "focus", "stress", "exam"],
  },
  breathing_478: {
    desc_en: "A slow 4-7-8 breath that lengthens the exhale to wind down, ease into rest, and quiet a mind that won't switch off at night.",
    desc_hi: "धीमी 4-7-8 साँस जो साँस छोड़ना लंबा करके शरीर को आराम की ओर ले जाती है — रात को न रुकने वाले दिमाग को शांत करने के लिए।",
    emotions: ["anxious", "restless", "exhausted"],
    factors: ["sleep"],
    topics: ["sleep", "breath", "calm", "rest", "night"],
  },
  breathing_bhramari: {
    desc_en: "A soothing humming breath that softens frustration and irritation and brings a gentle, quiet calm.",
    desc_hi: "एक सुकून देने वाली गुनगुनाती साँस जो चिढ़ और झुंझलाहट को नरम करती है और एक शांत ठहराव लाती है।",
    emotions: ["frustrated", "restless", "anxious"],
    factors: [],
    topics: ["breath", "calm", "stress"],
  },
  grounding_54321: {
    desc_en: "A 5-4-3-2-1 senses exercise for overwhelming moments and spiralling, panicky thoughts — it brings you back to the present, right here, right now.",
    desc_hi: "अभिभूत कर देने वाले पलों और घबराहट में घूमते ख्यालों के लिए 5-4-3-2-1 इंद्रियों वाला अभ्यास — यह आपको वापस इसी पल में, अभी यहीं ले आता है।",
    emotions: ["overwhelmed", "anxious", "sad", "lonely"],
    factors: [],
    topics: ["grounding", "panic", "anxiety", "present", "stress"],
  },
  pmr_full_body: {
    desc_en: "A full-body tense-and-release that lets go of the physical tension you carry when you're wound up or exhausted, and eases the body toward rest.",
    desc_hi: "पूरे शरीर को कसने और छोड़ने का अभ्यास, जो तनाव या थकान में जमा हुई शारीरिक जकड़न को छोड़ देता है और शरीर को आराम की ओर ले जाता है।",
    emotions: ["exhausted", "restless", "anxious"],
    factors: ["sleep", "health"],
    topics: ["rest", "sleep", "tension", "body"],
  },
  unguided_timer: {
    desc_en: "A quiet, unguided meditation timer for sitting in stillness and finding a little calm and focus at your own pace.",
    desc_hi: "एक शांत, बिना निर्देश वाला ध्यान टाइमर — ठहराव में बैठकर अपनी गति से थोड़ी शांति और एकाग्रता पाने के लिए।",
    emotions: ["calm", "restless"],
    factors: [],
    topics: ["calm", "focus", "meditation", "quiet"],
  },
  med_sleep_wind_down: {
    desc_en: "A gentle guided meditation for trouble sleeping — for the nights your mind keeps racing about studies and rest won't come.",
    desc_hi: "नींद न आने के लिए एक कोमल निर्देशित ध्यान — उन रातों के लिए जब दिमाग पढ़ाई के ख्यालों में उलझा रहता है और नींद नहीं आती।",
    emotions: ["restless", "anxious", "exhausted"],
    factors: ["sleep"],
    topics: ["sleep", "rest", "night", "calm"],
  },
  med_exam_morning_calm: {
    desc_en: "A short guided meditation for the morning of an exam — to steady exam-day nerves and walk in feeling grounded.",
    desc_hi: "परीक्षा की सुबह के लिए एक छोटा निर्देशित ध्यान — परीक्षा-दिन की घबराहट को शांत करके स्थिर मन से अंदर जाने के लिए।",
    emotions: ["anxious", "overwhelmed"],
    factors: ["studies"],
    topics: ["exam", "morning", "anxiety", "calm"],
  },
  med_easing_anxiety: {
    desc_en: "A guided meditation for anxiety and worry — to soften a tight, nervous, restless feeling and ease the pressure.",
    desc_hi: "चिंता और घबराहट के लिए एक निर्देशित ध्यान — जकड़ी हुई, बेचैन, नर्वस भावना को नरम करने और दबाव कम करने के लिए।",
    emotions: ["anxious", "overwhelmed", "restless"],
    factors: [],
    topics: ["anxiety", "calm", "worry", "stress"],
  },
  med_body_scan: {
    desc_en: "A body-scan meditation that moves attention gently through the body to release tension and restlessness and settle a tired body.",
    desc_hi: "एक बॉडी-स्कैन ध्यान जो ध्यान को कोमलता से पूरे शरीर में ले जाकर तनाव और बेचैनी छोड़ता है और थके शरीर को शांत करता है।",
    emotions: ["exhausted", "restless"],
    factors: ["health", "sleep"],
    topics: ["rest", "body", "calm", "tension"],
  },
  med_five_min_reset: {
    desc_en: "A five-minute reset for a short study break — to clear an overwhelmed, frazzled head and come back a little steadier.",
    desc_hi: "पढ़ाई के छोटे ब्रेक के लिए पाँच मिनट का रीसेट — अभिभूत, थके हुए दिमाग को हल्का करके थोड़ा स्थिर होकर लौटने के लिए।",
    emotions: ["overwhelmed", "frustrated"],
    factors: ["studies"],
    topics: ["focus", "reset", "stress"],
  },
  med_self_compassion: {
    desc_en: "A self-compassion meditation for the days you're hard on yourself — for guilt, self-criticism, and feeling behind everyone else.",
    desc_hi: "उन दिनों के लिए आत्म-करुणा ध्यान जब आप ख़ुद से सख़्त होते हैं — अपराधबोध, ख़ुद की आलोचना, और सबसे पीछे रह जाने की भावना के लिए।",
    emotions: ["sad", "lonely"],
    factors: ["comparison", "family"],
    topics: ["self_compassion", "comparison", "guilt"],
  },
  med_focus_before_study: {
    desc_en: "A short focusing meditation to settle a distracted, restless mind before you sit down to study.",
    desc_hi: "पढ़ाई के लिए बैठने से पहले एक छोटा एकाग्रता ध्यान, भटकते और बेचैन मन को स्थिर करने के लिए।",
    emotions: ["motivated", "restless"],
    factors: ["studies"],
    topics: ["focus", "study", "motivation"],
  },
  med_gratitude: {
    desc_en: "A gratitude meditation to shift a heavy, low mood toward a little warmth and perspective.",
    desc_hi: "एक कृतज्ञता ध्यान जो भारी, उदास मन को थोड़ी गर्माहट और नज़रिये की ओर मोड़ता है।",
    emotions: ["sad", "grateful", "hopeful"],
    factors: [],
    topics: ["gratitude", "calm", "perspective"],
  },
  med_breath_awareness: {
    desc_en: "A simple breath-awareness meditation for everyday calm and steadying the mind.",
    desc_hi: "रोज़मर्रा की शांति और मन को स्थिर करने के लिए एक सरल साँस-जागरूकता ध्यान।",
    emotions: ["calm", "anxious"],
    factors: [],
    topics: ["breath", "calm", "focus"],
  },
  med_after_result_calm: {
    desc_en: "A guided meditation for after a result — to sit with disappointment gently, without harshness, and find some calm after a setback.",
    desc_hi: "रिज़ल्ट के बाद के लिए एक निर्देशित ध्यान — निराशा के साथ बिना सख़्ती के नरमी से बैठने और किसी झटके के बाद थोड़ी शांति पाने के लिए।",
    emotions: ["sad", "frustrated", "hopeful"],
    factors: ["result", "family"],
    topics: ["result", "calm", "disappointment"],
  },
  breathing_coherent: {
    desc_en: "A slow, even coherent breath at about five to six breaths a minute to steady the whole system and find a balanced, settled calm.",
    desc_hi: "लगभग पाँच-छह साँस प्रति मिनट की धीमी, समान 'कोहेरेंट' साँस — पूरे तंत्र को स्थिर करने और संतुलित, ठहरी हुई शांति पाने के लिए।",
    emotions: ["anxious", "restless"],
    factors: [],
    topics: ["breath", "calm", "focus", "stress"],
  },
  breathing_extended_exhale: {
    desc_en: "A calming breath with a long, slow exhale that tells the nervous system it's safe to relax — good for anxiety and winding down before sleep.",
    desc_hi: "लंबी, धीमी साँस छोड़ने वाली शांति-श्वास जो तंत्रिका-तंत्र को बताती है कि अब आराम सुरक्षित है — चिंता के लिए और सोने से पहले शांत होने के लिए।",
    emotions: ["anxious", "overwhelmed", "restless"],
    factors: ["sleep"],
    topics: ["breath", "calm", "anxiety", "rest"],
  },
  grounding_exam_hall: {
    desc_en: "A quiet, invisible grounding you can do sitting right in the exam hall when panic starts to rise — to steady yourself and come back to the paper.",
    desc_hi: "एक शांत, किसी को न दिखने वाली ग्राउंडिंग जो आप परीक्षा हॉल में बैठे-बैठे कर सकते हैं जब घबराहट बढ़ने लगे — ख़ुद को स्थिर करके पेपर पर लौटने के लिए।",
    emotions: ["anxious", "overwhelmed", "restless"],
    factors: ["studies"],
    topics: ["exam", "panic", "grounding", "anxiety"],
  },
  reflect_reframe_thought: {
    desc_en: "A guided way to untangle and gently reframe an anxious or harsh thought — for spiralling, catastrophising, and being hard on yourself.",
    desc_hi: "किसी चिंतित या कठोर सोच को सुलझाने और नरमी से नए नज़रिये में ढालने का एक तरीक़ा — घूमते ख्यालों, बुरा-से-बुरा सोचने, और ख़ुद पर सख़्ती के लिए।",
    emotions: ["anxious", "frustrated", "sad"],
    factors: [],
    topics: ["thoughts", "worry", "reframe", "self_compassion"],
  },
  reflect_values_check: {
    desc_en: "A short reflection to reconnect with what actually matters to you and why you started — for lost motivation and direction.",
    desc_hi: "यह याद करने के लिए एक छोटा चिंतन कि आपके लिए सच में क्या मायने रखता है और आपने शुरुआत क्यों की थी — खोई हुई प्रेरणा और दिशा के लिए।",
    emotions: ["motivated", "hopeful", "lonely"],
    factors: ["studies", "family"],
    topics: ["motivation", "values", "meaning", "focus"],
  },
  reflect_worry_time: {
    desc_en: "A worry-time container: set aside a fixed time for worries so they stop leaking into the whole day — for overthinking and rumination.",
    desc_hi: "चिंता के लिए एक तय समय: चिंताओं को एक नियत समय दें ताकि वे पूरे दिन में न फैलें — ज़्यादा सोचने और बार-बार उन्हीं ख्यालों में उलझने के लिए।",
    emotions: ["anxious", "overwhelmed", "restless"],
    factors: [],
    topics: ["worry", "overthinking", "anxiety", "stress"],
  },
  pmr_desk_reset: {
    desc_en: "A quick two-minute release of the tension that builds in the shoulders, neck, and jaw during long study sessions at your desk.",
    desc_hi: "डेस्क पर लंबे अध्ययन-सत्रों में कंधों, गर्दन और जबड़े में जमा तनाव को छोड़ने के लिए दो मिनट का त्वरित अभ्यास।",
    emotions: ["exhausted", "restless", "frustrated"],
    factors: ["studies", "health"],
    topics: ["tension", "body", "focus", "reset"],
  },
  pmr_quick_reset: {
    desc_en: "A quick three-minute tense-and-release for the whole body when you're wound up but short on time.",
    desc_hi: "जब आप तनाव में हों पर समय कम हो, तब पूरे शरीर के लिए तीन मिनट का त्वरित कसाव-और-छूट अभ्यास।",
    emotions: ["exhausted", "restless"],
    factors: ["health"],
    topics: ["tension", "body", "rest", "reset"],
  },
  med_exam_eve_calm: {
    desc_en: "A guided meditation for the night before an exam — to settle racing nerves, quiet the what-ifs, and give yourself a chance at real rest.",
    desc_hi: "परीक्षा से एक रात पहले के लिए एक निर्देशित ध्यान — तेज़ चलती नसों को शांत करने, 'क्या होगा' के ख्यालों को थामने, और सच्चे आराम का मौक़ा देने के लिए।",
    emotions: ["anxious", "overwhelmed", "restless"],
    factors: ["studies", "sleep"],
    topics: ["exam", "night", "anxiety", "sleep", "calm"],
  },
  med_letting_go_comparison: {
    desc_en: "A guided meditation for when everyone seems ahead of you — to loosen the grip of comparison and come back to your own path.",
    desc_hi: "जब सब आपसे आगे लगें, तब के लिए एक निर्देशित ध्यान — तुलना की पकड़ को ढीला करके अपनी राह पर लौटने के लिए।",
    emotions: ["sad", "lonely", "frustrated"],
    factors: ["comparison", "friends"],
    topics: ["comparison", "self_compassion", "peace"],
  },
  med_overwhelm_syllabus: {
    desc_en: "A guided meditation for when the syllabus and workload feel like too much — to unclench, find one steady breath, and shrink the mountain back to a step.",
    desc_hi: "जब सिलेबस और काम का बोझ बहुत ज़्यादा लगे, तब के लिए एक निर्देशित ध्यान — जकड़न छोड़ने, एक स्थिर साँस पाने, और पहाड़ को वापस एक कदम में बदलने के लिए।",
    emotions: ["overwhelmed", "anxious", "exhausted"],
    factors: ["studies"],
    topics: ["overwhelm", "stress", "focus", "exam"],
  },
  med_after_setback: {
    desc_en: "A guided meditation for beginning again after a failure or setback — with self-compassion instead of blame, and a little hope for the next step.",
    desc_hi: "किसी असफलता या ठोकर के बाद फिर से शुरुआत के लिए एक निर्देशित ध्यान — दोष के बजाय आत्म-करुणा के साथ, और अगले कदम के लिए थोड़ी उम्मीद के साथ।",
    emotions: ["sad", "hopeful", "frustrated"],
    factors: ["result"],
    topics: ["setback", "result", "self_compassion", "hope"],
  },
  med_morning_intention: {
    desc_en: "A short morning meditation to start the day grounded — to set a calm intention and steady your focus before the studying begins.",
    desc_hi: "दिन की स्थिर शुरुआत के लिए एक छोटा सुबह का ध्यान — पढ़ाई शुरू होने से पहले एक शांत संकल्प लेने और ध्यान को स्थिर करने के लिए।",
    emotions: ["motivated", "hopeful", "calm"],
    factors: ["studies"],
    topics: ["morning", "focus", "motivation", "intention"],
  },
  med_racing_thoughts_night: {
    desc_en: "A guided meditation for a mind that won't switch off at night — to quiet racing, looping thoughts at bedtime so rest can come.",
    desc_hi: "रात को न रुकने वाले मन के लिए एक निर्देशित ध्यान — सोते समय तेज़, बार-बार घूमते ख्यालों को शांत करने के लिए ताकि नींद आ सके।",
    emotions: ["restless", "anxious", "exhausted"],
    factors: ["sleep"],
    topics: ["sleep", "night", "racing_thoughts", "calm"],
  },
  med_loving_kindness: {
    desc_en: "A loving-kindness (metta) meditation to soften self-criticism and loneliness with a little warmth — toward yourself first, then others.",
    desc_hi: "आत्म-आलोचना और अकेलेपन को थोड़ी गर्माहट से नरम करने के लिए एक मैत्री (मेत्ता) ध्यान — पहले ख़ुद के लिए, फिर दूसरों के लिए।",
    emotions: ["lonely", "sad", "grateful"],
    factors: ["friends", "family"],
    topics: ["self_compassion", "kindness", "connection"],
  },
  sound_deep_calm: {
    desc_en: "A deep, calming ambient soundscape to relax into — a quiet background for winding down or simply resting.",
    desc_hi: "एक गहरा, शांत करने वाला परिवेश-ध्वनि दृश्य जिसमें आराम से डूब सकें — शांत होने या बस विश्राम करने के लिए एक शांत पृष्ठभूमि।",
    emotions: ["calm", "restless", "anxious"],
    factors: [],
    topics: ["calm", "ambient", "rest", "focus"],
  },
  sound_morning_light: {
    desc_en: "A gentle, uplifting morning soundscape — a fresh, light backdrop to ease into the day.",
    desc_hi: "एक कोमल, मन को हल्का करने वाला सुबह का ध्वनि-दृश्य — दिन में सहजता से उतरने के लिए एक ताज़ा, हल्की पृष्ठभूमि।",
    emotions: ["calm", "hopeful", "motivated"],
    factors: [],
    topics: ["morning", "ambient", "focus", "calm"],
  },
  sound_ocean_drift: {
    desc_en: "Slow ocean waves to drift off to — an ambient soundscape for sleep and deep relaxation.",
    desc_hi: "जिनके साथ नींद में उतर सकें, ऐसी धीमी सागर-लहरें — नींद और गहरे विश्राम के लिए एक परिवेश-ध्वनि दृश्य।",
    emotions: ["calm", "restless", "exhausted"],
    factors: ["sleep"],
    topics: ["sleep", "ambient", "rest", "calm"],
  },
};

const JOURNEY_DESCRIPTORS: Record<string, Descriptor> = {
  exam_eve_panic: {
    desc_en: "A short guided journey for the night before an exam — when panic and racing nerves take over, it walks you step by step toward a calmer, steadier tomorrow.",
    desc_hi: "परीक्षा से एक रात पहले के लिए एक छोटी निर्देशित यात्रा — जब घबराहट और तेज़ नसें हावी हो जाएँ, यह कदम-दर-कदम एक शांत, स्थिर कल की ओर ले जाती है।",
    emotions: ["anxious", "overwhelmed", "restless"],
    factors: ["studies"],
    topics: ["exam", "panic", "anxiety", "night"],
  },
  mock_test_anxiety: {
    desc_en: "A guided journey for the sting of a bad mock score — for the self-doubt, comparison, and fear after mocks, helping you see a score as feedback, not a verdict.",
    desc_hi: "एक ख़राब मॉक स्कोर की चुभन के लिए एक निर्देशित यात्रा — मॉक के बाद के आत्म-संदेह, तुलना और डर के लिए, ताकि आप स्कोर को फ़ैसला नहीं बल्कि फ़ीडबैक की तरह देख सकें।",
    emotions: ["anxious", "frustrated", "sad"],
    factors: ["studies", "result", "comparison"],
    topics: ["exam", "result", "mock", "comparison", "confidence"],
  },
};

interface ContentItem {
  content_kind: "exercise" | "journey";
  content_id: string;
  content_ref: string;
  title_hi: string;
  title_en: string;
  /** Any existing DB description (journeys carry one); folded into the embed text. */
  db_desc_en: string;
  db_desc_hi: string;
  descriptor: Descriptor | null;
}

/** The exact text embedded for one item — rich + bilingual so a hi/en signal
 *  both match. Kept deterministic so source_hash is stable across runs. */
function embedInput(item: ContentItem): string {
  const d = item.descriptor;
  const tagText = d ? [...d.emotions, ...d.factors, ...d.topics].join(", ") : "";
  return [
    item.title_en,
    item.title_hi,
    d?.desc_en ?? item.db_desc_en,
    d?.desc_hi ?? item.db_desc_hi,
    tagText ? `themes: ${tagText}` : "",
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(". ");
}

function sourceHash(item: ContentItem): string {
  const d = item.descriptor;
  return createHash("sha256")
    .update(
      JSON.stringify({
        input: embedInput(item),
        emotions: d?.emotions ?? [],
        factors: d?.factors ?? [],
        topics: d?.topics ?? [],
      }),
    )
    .digest("hex");
}

interface Args {
  dryRun: boolean;
  force: boolean;
}
function parseArgs(argv: string[]): Args {
  return { dryRun: argv.includes("--dry-run"), force: argv.includes("--force") };
}

async function loadContentItems(): Promise<ContentItem[]> {
  const [exRes, jrRes] = await Promise.all([
    supabase().from("sukoon_exercises").select("id, key, title_hi, title_en"),
    supabase()
      .from("sukoon_journeys")
      .select("id, slug, title_hi, title_en, description_hi, description_en")
      .eq("published", true),
  ]);
  if (exRes.error) throw new Error(`load exercises failed: ${exRes.error.message}`);
  if (jrRes.error) throw new Error(`load journeys failed: ${jrRes.error.message}`);

  const items: ContentItem[] = [];
  for (const r of (exRes.data as { id: string; key: string | null; title_hi: string; title_en: string }[] | null) ?? []) {
    if (!r.key) {
      logger.warn({ id: r.id }, "sukoon embed-content: exercise has no seed key — skipped (no stable ref)");
      continue;
    }
    items.push({
      content_kind: "exercise",
      content_id: r.id,
      content_ref: r.key,
      title_hi: r.title_hi,
      title_en: r.title_en,
      db_desc_en: "",
      db_desc_hi: "",
      descriptor: EXERCISE_DESCRIPTORS[r.key] ?? null,
    });
  }
  for (const r of (jrRes.data as
    | { id: string; slug: string; title_hi: string; title_en: string; description_hi: string; description_en: string }[]
    | null) ?? []) {
    items.push({
      content_kind: "journey",
      content_id: r.id,
      content_ref: r.slug,
      title_hi: r.title_hi,
      title_en: r.title_en,
      db_desc_en: r.description_en ?? "",
      db_desc_hi: r.description_hi ?? "",
      descriptor: JOURNEY_DESCRIPTORS[r.slug] ?? null,
    });
  }
  return items;
}

async function main(): Promise<void> {
  const { dryRun, force } = parseArgs(process.argv.slice(2));
  const items = await loadContentItems();

  const missingDescriptor = items.filter((i) => !i.descriptor);
  if (missingDescriptor.length) {
    logger.warn(
      { refs: missingDescriptor.map((i) => `${i.content_kind}:${i.content_ref}`) },
      "sukoon embed-content: these items have NO curator descriptor — embedding from title only; add one to EXERCISE_DESCRIPTORS/JOURNEY_DESCRIPTORS for better recommendations",
    );
  }

  // Existing rows (by ref) so we only re-embed changed/new content. Scoped
  // .in(...) rather than an unranged scan — small table, but keeps the habit.
  const refs = items.map((i) => i.content_ref);
  const { data: existing, error: existingErr } = await supabase()
    .from("sukoon_content_embeddings")
    .select("content_kind, content_ref, source_hash, content_id")
    .in("content_ref", refs);
  if (existingErr) {
    logger.error({ err: existingErr.message }, "sukoon embed-content: couldn't read existing rows");
    process.exitCode = 1;
    return;
  }
  const existingByKey = new Map(
    ((existing as { content_kind: string; content_ref: string; source_hash: string; content_id: string }[] | null) ?? []).map(
      (r) => [`${r.content_kind}:${r.content_ref}`, r],
    ),
  );

  const toEmbed = items.filter((i) => {
    if (force) return true;
    const prior = existingByKey.get(`${i.content_kind}:${i.content_ref}`);
    // Re-embed when new, when the hash changed, or when content_id drifted
    // (content was re-seeded and needs its current uuid stored for the read join).
    return !prior || prior.source_hash !== sourceHash(i) || prior.content_id !== i.content_id;
  });

  logger.info(
    { total: items.length, exercises: items.filter((i) => i.content_kind === "exercise").length, journeys: items.filter((i) => i.content_kind === "journey").length, toEmbed: toEmbed.length, unchanged: items.length - toEmbed.length },
    "sukoon embed-content: plan",
  );

  if (toEmbed.length === 0) {
    logger.info("sukoon embed-content: nothing to do — all content embeddings up to date.");
    return;
  }

  if (dryRun) {
    for (const i of toEmbed) {
      // eslint-disable-next-line no-console
      console.log(`[dry-run] would embed ${i.content_kind}:${i.content_ref} — "${embedInput(i).slice(0, 90)}..."`);
    }
    logger.info({ wouldEmbed: toEmbed.length }, "sukoon embed-content: dry run (no embeds, no writes)");
    return;
  }

  const vectors = await embeddings().embed(toEmbed.map((i) => embedInput(i)));
  if (vectors.length !== toEmbed.length) {
    logger.error(
      { expected: toEmbed.length, got: vectors.length },
      "sukoon embed-content: embedding count mismatch — refusing to write partial rows",
    );
    process.exitCode = 1;
    return;
  }

  const payload = toEmbed.map((i, idx) => ({
    content_kind: i.content_kind,
    content_id: i.content_id,
    content_ref: i.content_ref,
    emotions: i.descriptor?.emotions ?? [],
    factors: i.descriptor?.factors ?? [],
    topics: i.descriptor?.topics ?? [],
    source_hash: sourceHash(i),
    embedding: vectors[idx],
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertErr } = await supabase()
    .from("sukoon_content_embeddings")
    .upsert(payload, { onConflict: "content_kind,content_ref" });
  if (upsertErr) {
    logger.error({ err: upsertErr.message }, "sukoon embed-content: upsert failed");
    process.exitCode = 1;
    return;
  }

  logger.info({ embedded: payload.length }, "sukoon embed-content: done");
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, "sukoon embed-content: fatal");
  process.exit(1);
});
