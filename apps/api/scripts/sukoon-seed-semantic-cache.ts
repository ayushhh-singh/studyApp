/**
 * `pnpm sukoon:seed-cache` — populate the Sukoon semantic FAQ cache (blueprint
 * F2 cost spine) with common, human-authored emotional-support responses so the
 * READ path (services/semantic-cache.ts, already wired into BOTH typed chat AND
 * Voice Mode) actually has reviewed rows to hit.
 *
 * WHY VOICE MOTIVATES THIS: voice turns arrive as SPEECH, transcribed — people
 * phrase things out loud far more loosely than they type ("yaar mera bilkul mann
 * nahi lag raha", not "I am feeling unmotivated"). The seed patterns below are
 * written in that spoken register, in all three languages (hi / en / hinglish),
 * so a spoken doubt cosine-matches a cached answer as readily as a typed one.
 * This is NOT a new caching mechanism — it reuses the SAME table
 * (sukoon_semantic_cache), the SAME embeddings provider (lib/embeddings.ts), and
 * the SAME normalisation (services/mentor/normalize.ts) the read path already
 * uses, so a seeded prompt embeds into the exact space the lookup queries.
 *
 * SAFETY: seeded responses are curator-authored, checked against the Sukoon
 * clinical-word rules, and deliberately cover ONLY everyday emotional patterns
 * (stress, sleep, comparison, low motivation, exam nerves). NO crisis-level
 * content is ever cached — the crisis engine runs on every transcript BEFORE the
 * cache is consulted and hands a real distress signal to a human helpline, never
 * to a canned line. Responses are speakable prose (no markdown/emoji) so TTS can
 * read them unchanged. `reviewed=true` is what makes a row eligible to serve;
 * these clear that bar by being hand-written and safety-reviewed here.
 *
 * IDEMPOTENT: insert-only. A pattern whose exact (lang, prompt) already exists
 * is skipped, so re-running only fills gaps — it never duplicates or deletes a
 * row (the DB is shared dev/prod; no broad-criteria writes). Embeds in one batch.
 *
 * Flags:
 *   --dry-run   Embed nothing, write nothing — just print what WOULD be inserted.
 */
import { embeddings } from "../src/lib/embeddings.js";
import { supabase } from "../src/lib/supabase.js";
import { logger } from "../src/lib/logger.js";
import { normalizeQuestion } from "../src/services/mentor/normalize.js";

type Lang = "hi" | "en" | "hinglish";

/** One emotional pattern, phrased for each language the way it's actually
 *  spoken, with a warm curator-authored reply. `{{name}}` is optional light
 *  personalisation the read path fills in (or drops cleanly). */
interface Pattern {
  id: string;
  variants: Record<Lang, { prompt: string; response: string }>;
}

const PATTERNS: Pattern[] = [
  {
    id: "exam_went_badly",
    variants: {
      en: {
        prompt: "my exam went really badly today, i think i messed it up",
        response:
          "That sinking feeling after a paper you wanted to go well is so heavy, {{name}}. One exam is a snapshot of one day, not a verdict on you or all the work you've put in. Let yourself feel disappointed for a bit — and when you're ready, we can look at just the next small step, not the whole mountain.",
      },
      hi: {
        prompt: "आज मेरा पेपर बहुत खराब गया, लगता है मैंने सब बिगाड़ दिया",
        response:
          "जिस पेपर से उम्मीदें हों, वो अच्छा न जाए तो मन बहुत भारी हो जाता है, {{name}}। एक परीक्षा सिर्फ़ एक दिन की झलक है, आपके पूरे मेहनत या आपकी काबिलियत का फैसला नहीं। थोड़ी देर उदास होना ठीक है — और जब तैयार हों, हम बस अगला छोटा कदम देखेंगे, पूरा पहाड़ नहीं।",
      },
      hinglish: {
        prompt: "yaar aaj mera exam bahut kharab gaya, lagta hai sab gadbad kar diya",
        response:
          "Jis paper se ummeed ho aur wo theek na jaye, to mann sach me bahut bhaari ho jaata hai, {{name}}. Ek exam sirf ek din ki jhalak hai, aapki saari mehnat ya aapki kaabiliyat ka faisla nahi. Thodi der dukhi hona bilkul theek hai — aur jab ready ho, hum bas agla chhota step dekhenge, pura pahaad nahi.",
      },
    },
  },
  {
    id: "cant_sleep",
    variants: {
      en: {
        prompt: "i can't sleep at night, my mind keeps racing about studies",
        response:
          "A mind that won't switch off at night is exhausting, especially when you know you need the rest. Your brain is just trying to sort through a busy day — it isn't a sign anything's wrong with you. A slow breath out, longer than the breath in, tells your body it's safe to rest. Want to try a short breathing exercise together?",
      },
      hi: {
        prompt: "रात को नींद नहीं आती, दिमाग में पढ़ाई के ख्याल घूमते रहते हैं",
        response:
          "रात को दिमाग शांत न हो तो बहुत थका देता है, ख़ासकर जब पता हो कि आराम ज़रूरी है। आपका दिमाग बस दिन भर की बातें समेटने की कोशिश कर रहा है — इसका मतलब आपमें कुछ गड़बड़ नहीं है। साँस को धीरे-धीरे, अंदर से ज़्यादा देर बाहर छोड़ना शरीर को बताता है कि अब आराम सुरक्षित है। एक छोटा साँस का अभ्यास साथ में करें?",
      },
      hinglish: {
        prompt: "raat ko neend nahi aati, dimaag me bas padhai ke khayal chalte rehte hain",
        response:
          "Raat ko dimaag shaant na ho to bahut thaka deta hai, khaaskar jab pata ho ki aaram zaroori hai. Aapka dimaag bas din bhar ki baatein sametne ki koshish kar raha hai — iska matlab aapme kuch gadbad nahi hai. Saans ko dheere-dheere, andar se zyada der bahar chhodna body ko batata hai ki ab aaram safe hai. Ek chhota saans ka abhyaas saath me karein?",
      },
    },
  },
  {
    id: "comparison",
    variants: {
      en: {
        prompt: "everyone around me seems ahead of me, i feel so behind",
        response:
          "Comparison is such a thief of peace, {{name}} — and it's rarely fair, because you're seeing everyone's highlights next to your own behind-the-scenes. Your timeline is yours alone. The only useful comparison is with where you were last month, and there's almost always quiet progress there you're not giving yourself credit for.",
      },
      hi: {
        prompt: "मेरे आसपास सब मुझसे आगे लगते हैं, मैं बहुत पीछे महसूस करता हूँ",
        response:
          "तुलना मन की शांति चुरा लेती है, {{name}} — और ये कभी सही होती भी नहीं, क्योंकि आप सबकी सबसे अच्छी झलक को अपनी अंदर की मेहनत के सामने रख रहे होते हैं। आपकी राह सिर्फ़ आपकी है। बस एक तुलना काम की है — पिछले महीने के अपने आप से, और वहाँ लगभग हमेशा कोई न कोई छोटी प्रगति होती है जिसका श्रेय आप ख़ुद को नहीं दे रहे।",
      },
      hinglish: {
        prompt: "sab log mujhse aage lagte hain, main bahut peeche feel karta hoon",
        response:
          "Comparison mann ki shaanti chura leta hai, {{name}} — aur ye kabhi fair hoti bhi nahi, kyunki aap sabki best jhalak ko apni andar ki mehnat ke saamne rakh rahe hote ho. Aapki raah sirf aapki hai. Bas ek comparison kaam ka hai — pichhle mahine ke apne aap se, aur wahan lagbhag hamesha koi chhoti progress hoti hai jiska credit aap khud ko nahi de rahe.",
      },
    },
  },
  {
    id: "no_motivation",
    variants: {
      en: {
        prompt: "i just don't feel like studying at all these days, no motivation",
        response:
          "When the motivation just isn't there, it usually means you're running low, not that you're lazy — those are very different things. You don't have to feel motivated to begin; sometimes the smallest start, even ten honest minutes, brings a little of it back. Be as kind to yourself as you'd be to a friend in the same spot.",
      },
      hi: {
        prompt: "आजकल पढ़ने का बिलकुल मन नहीं करता, कोई प्रेरणा ही नहीं",
        response:
          "जब मन बिलकुल न लगे, तो अक्सर इसका मतलब होता है कि आप थके हुए हैं, आलसी नहीं — ये दोनों बहुत अलग बातें हैं। शुरू करने के लिए प्रेरित महसूस करना ज़रूरी नहीं; कभी-कभी सबसे छोटी शुरुआत, बस दस ईमानदार मिनट, थोड़ा मन वापस ले आती है। अपने आप के साथ उतनी ही नरमी रखें जितनी किसी दोस्त के साथ रखते।",
      },
      hinglish: {
        prompt: "aajkal padhai me bilkul mann nahi lagta, koi motivation hi nahi hai",
        response:
          "Jab mann bilkul na lage, to aksar iska matlab hota hai ki aap thake hue ho, aalsi nahi — ye dono bahut alag baatein hain. Shuru karne ke liye motivated feel karna zaroori nahi; kabhi-kabhi sabse chhoti shuruaat, bas das imaandaar minute, thoda mann wapas le aati hai. Apne aap ke saath utni hi narmi rakhein jitni kisi dost ke saath rakhte.",
      },
    },
  },
  {
    id: "exam_nerves",
    variants: {
      en: {
        prompt: "my exam is coming up and i'm so nervous i feel like i'll panic",
        response:
          "Those nerves before a big exam are your body caring about something that matters to you — uncomfortable, but not dangerous. When it rises, come back to your breath and to what's actually in front of you right now, this one line, this one page. You've prepared through a lot of hard days to get here. Let's slow the breathing down together for a moment.",
      },
      hi: {
        prompt: "एग्जाम पास आ रहा है और मैं इतना घबरा रहा हूँ कि लगता है पैनिक हो जाऊँगा",
        response:
          "बड़े एग्जाम से पहले की घबराहट इस बात का निशान है कि ये आपके लिए मायने रखता है — असहज है, पर ख़तरनाक नहीं। जब ये बढ़े, अपनी साँस पर और जो अभी सामने है उसी पर लौट आएँ — बस यही एक लाइन, यही एक पन्ना। आप कई मुश्किल दिनों से तैयारी करते हुए यहाँ तक आए हैं। चलिए एक पल के लिए साथ में साँस धीमी करते हैं।",
      },
      hinglish: {
        prompt: "exam paas aa raha hai aur main itna nervous hoon ki lagta hai panic ho jaunga",
        response:
          "Bade exam se pehle ki ghabraahat is baat ka nishaan hai ki ye aapke liye maayne rakhta hai — asahaj hai, par khatarnaak nahi. Jab ye badhe, apni saans par aur jo abhi saamne hai usi par laut aaein — bas yahi ek line, yahi ek panna. Aap kai mushkil dino se taiyaari karte hue yahan tak aaye ho. Chaliye ek pal ke liye saath me saans dheemi karte hain.",
      },
    },
  },
  {
    id: "feeling_alone",
    variants: {
      en: {
        prompt: "i feel so alone in all this, like nobody really understands",
        response:
          "Feeling unseen in the middle of something this hard is a real ache, {{name}}, and I'm glad you said it out loud instead of carrying it silently. So many aspirants feel exactly this and assume they're the only one. You're not alone in it right now — I'm here, and this space is yours whenever the weight gets heavy.",
      },
      hi: {
        prompt: "मैं इस सब में बहुत अकेला महसूस करता हूँ, जैसे कोई सच में समझता ही नहीं",
        response:
          "इतनी मुश्किल राह के बीच किसी को न दिखना सच में तकलीफ़ देता है, {{name}}, और अच्छा हुआ आपने इसे चुपचाप ढोने के बजाय कह दिया। बहुत सारे अभ्यर्थी ठीक यही महसूस करते हैं और सोचते हैं कि बस वही अकेले हैं। इस पल आप अकेले नहीं हैं — मैं यहाँ हूँ, और जब भी बोझ भारी लगे, ये जगह आपकी है।",
      },
      hinglish: {
        prompt: "main is sab me bahut akela feel karta hoon, jaise koi sach me samajhta hi nahi",
        response:
          "Itni mushkil raah ke beech kisi ko na dikhna sach me takleef deta hai, {{name}}, aur achha hua aapne ise chupchaap dhone ke bajaye keh diya. Bahut saare aspirants theek yahi feel karte hain aur sochte hain ki bas wahi akele hain. Is pal aap akele nahi ho — main yahan hoon, aur jab bhi bojh bhaari lage, ye jagah aapki hai.",
      },
    },
  },
  {
    id: "burnout",
    variants: {
      en: {
        prompt: "i'm so tired all the time, i feel completely burnt out from studying",
        response:
          "That bone-deep tiredness is your mind and body asking for something, not failing you. Rest isn't time stolen from preparation — it's part of it; a worn-out mind can't hold much. Even a genuine short break, a walk, a proper meal, some real sleep, is doing important work. What would feel most restful for you right now?",
      },
      hi: {
        prompt: "मैं हर वक्त बहुत थका रहता हूँ, पढ़ते-पढ़ते बिलकुल बर्न आउट महसूस होता है",
        response:
          "ये गहरी थकान आपके मन और शरीर की कोई माँग है, आपकी कमी नहीं। आराम पढ़ाई से चुराया हुआ वक्त नहीं — वो उसी का हिस्सा है; थका हुआ दिमाग ज़्यादा नहीं थाम पाता। एक सच्चा छोटा ब्रेक भी — टहलना, ढंग का खाना, थोड़ी असली नींद — ज़रूरी काम कर रहा है। अभी आपको सबसे ज़्यादा किस चीज़ से आराम मिलेगा?",
      },
      hinglish: {
        prompt: "main har waqt bahut thaka rehta hoon, padhte-padhte bilkul burnout feel hota hai",
        response:
          "Ye gehri thakaan aapke mann aur body ki koi maang hai, aapki kami nahi. Aaram padhai se churaya hua waqt nahi — wo usi ka hissa hai; thaka hua dimaag zyada nahi thaam paata. Ek sachcha chhota break bhi — tehelna, dhang ka khaana, thodi asli neend — zaroori kaam kar raha hai. Abhi aapko sabse zyada kis cheez se aaram milega?",
      },
    },
  },
  {
    id: "procrastination_guilt",
    variants: {
      en: {
        prompt: "i wasted the whole day and did nothing, i feel so guilty about it",
        response:
          "That guilt is loud, but piling it on rarely turns tomorrow around — it usually just makes the next start feel heavier. One slow day doesn't erase your effort or decide anything. Let today be closed gently, without a lecture to yourself, and let the next honest hour be a fresh page. You're allowed to simply begin again.",
      },
      hi: {
        prompt: "मैंने पूरा दिन बर्बाद कर दिया, कुछ नहीं किया, बहुत गिल्ट हो रही है",
        response:
          "ये अपराधबोध ज़ोर से बोलता है, पर उसे और बढ़ाने से अगला दिन शायद ही सुधरता है — बस अगली शुरुआत और भारी लगने लगती है। एक धीमा दिन आपकी मेहनत नहीं मिटाता, न कुछ तय करता है। आज को बिना ख़ुद को डाँटे नरमी से बंद कर दें, और अगला ईमानदार घंटा एक नया पन्ना बन जाए। आप बस दोबारा शुरू कर सकते हैं, ये हक़ आपका है।",
      },
      hinglish: {
        prompt: "maine pura din waste kar diya, kuch nahi kiya, bahut guilt ho rahi hai",
        response:
          "Ye guilt zor se bolta hai, par use aur badhane se agla din shayad hi sudharta hai — bas agli shuruaat aur bhaari lagne lagti hai. Ek dheema din aapki mehnat nahi mitaata, na kuch tay karta hai. Aaj ko bina khud ko daante narmi se band kar dein, aur agla imaandaar ghanta ek naya panna ban jaye. Aap bas dobara shuru kar sakte ho, ye haq aapka hai.",
      },
    },
  },
  {
    id: "fear_disappointing_family",
    variants: {
      en: {
        prompt: "i'm scared of disappointing my parents if i don't clear this",
        response:
          "Carrying your family's hopes on top of your own is a real, quiet weight, {{name}}, and it usually comes from how much you love them. But your worth in their lives was never only about a result — you are more than any exam to the people who care for you. Do this for your own reasons too, at a pace you can actually sustain.",
      },
      hi: {
        prompt: "मुझे डर है कि अगर मैं ये नहीं निकाल पाया तो माता-पिता निराश हो जाएँगे",
        response:
          "अपने साथ-साथ परिवार की उम्मीदें उठाना एक असली, चुपचाप का बोझ है, {{name}}, और ये अक्सर आपके प्यार से ही आता है। पर उनकी ज़िंदगी में आपकी अहमियत कभी सिर्फ़ किसी नतीजे से नहीं रही — जो आपसे प्यार करते हैं उनके लिए आप किसी भी परीक्षा से बड़े हैं। ये अपने लिए भी करें, ऐसी रफ़्तार से जो सच में संभल सके।",
      },
      hinglish: {
        prompt: "mujhe dar hai ki agar main ye nahi nikaal paya to parents disappoint ho jayenge",
        response:
          "Apne saath-saath family ki ummeedein uthana ek asli, chupchaap ka bojh hai, {{name}}, aur ye aksar aapke pyaar se hi aata hai. Par unki zindagi me aapki ahmiyat kabhi sirf kisi result se nahi rahi — jo aapse pyaar karte hain unke liye aap kisi bhi exam se bade ho. Ye apne liye bhi karein, aisi raftaar se jo sach me sambhal sake.",
      },
    },
  },
  {
    id: "feeling_low",
    variants: {
      en: {
        prompt: "i just feel really low today, i don't even know why",
        response:
          "Some days the low settles in without a clear reason, and that's okay — it doesn't need one to be real, {{name}}. You don't have to fix it or explain it right now; just naming it, like you did, already lightens it a little. Be gentle with yourself today, keep things small, and let it pass at its own pace. I'm here with you.",
      },
      hi: {
        prompt: "आज बस बहुत उदास महसूस हो रहा है, पता भी नहीं क्यों",
        response:
          "कुछ दिन उदासी बिना किसी साफ़ वजह के आ बैठती है, और ये ठीक है — असली होने के लिए उसे कोई वजह चाहिए ही नहीं, {{name}}। अभी इसे ठीक करना या समझाना ज़रूरी नहीं; बस इसे नाम देना, जैसे आपने दिया, थोड़ा हल्का कर देता है। आज अपने साथ नरमी रखें, काम छोटे रखें, और इसे अपनी रफ़्तार से गुज़र जाने दें। मैं आपके साथ हूँ।",
      },
      hinglish: {
        prompt: "aaj bas bahut udaas feel ho raha hai, pata bhi nahi kyun",
        response:
          "Kuch din udaasi bina kisi saaf wajah ke aa baithti hai, aur ye theek hai — asli hone ke liye use koi wajah chahiye hi nahi, {{name}}. Abhi ise theek karna ya samjhaana zaroori nahi; bas ise naam dena, jaise aapne diya, thoda halka kar deta hai. Aaj apne saath narmi rakhein, kaam chhote rakhein, aur ise apni raftaar se guzar jaane dein. Main aapke saath hoon.",
      },
    },
  },
];

interface Args {
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  return { dryRun: argv.includes("--dry-run") };
}

const LANGS: Lang[] = ["hi", "en", "hinglish"];

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));

  // Flatten to one row per (pattern, language).
  const rows = PATTERNS.flatMap((p) =>
    LANGS.map((lang) => ({
      id: p.id,
      lang,
      prompt: p.variants[lang].prompt,
      response: p.variants[lang].response,
    })),
  );

  // Skip any (lang, prompt) already present — insert-only, never a duplicate or
  // a delete (shared dev/prod DB). Scope the existence check to just THIS seed's
  // own prompts via `.in(...)` rather than scanning the whole table: the cache
  // grows via the future F2 write/admin path, and an unranged select would
  // silently truncate at PostgREST's 1000-row cap (a repeat offender in this
  // repo) and then re-insert duplicates of any existing row past that cap.
  const seedPrompts = [...new Set(rows.map((r) => r.prompt))];
  const { data: existing, error: existingErr } = await supabase()
    .from("sukoon_semantic_cache")
    .select("lang, prompt")
    .in("prompt", seedPrompts);
  if (existingErr) {
    logger.error({ err: existingErr.message }, "sukoon seed-cache: couldn't read existing rows");
    process.exitCode = 1;
    return;
  }
  const seen = new Set((existing ?? []).map((r) => `${r.lang}::${r.prompt}`));
  const toInsert = rows.filter((r) => !seen.has(`${r.lang}::${r.prompt}`));

  logger.info(
    { patterns: PATTERNS.length, candidateRows: rows.length, alreadyPresent: rows.length - toInsert.length, toInsert: toInsert.length },
    "sukoon seed-cache: plan",
  );

  if (toInsert.length === 0) {
    logger.info("sukoon seed-cache: nothing to do — cache already seeded.");
    return;
  }

  if (dryRun) {
    for (const r of toInsert) {
      // eslint-disable-next-line no-console
      console.log(`[dry-run] would insert ${r.lang} :: ${r.id} :: "${r.prompt}"`);
    }
    logger.info({ wouldInsert: toInsert.length }, "sukoon seed-cache: dry run (no embeds, no writes)");
    return;
  }

  // Embed the SAME normalised prompt the read path queries with, in one batch.
  const provider = embeddings();
  const vectors = await provider.embed(toInsert.map((r) => normalizeQuestion(r.prompt)));
  if (vectors.length !== toInsert.length) {
    logger.error(
      { expected: toInsert.length, got: vectors.length },
      "sukoon seed-cache: embedding count mismatch — refusing to insert null-embedding rows",
    );
    process.exitCode = 1;
    return;
  }

  const payload = toInsert.map((r, i) => ({
    prompt: r.prompt,
    response: r.response,
    lang: r.lang,
    embedding: vectors[i],
    reviewed: true, // curator-authored + safety-checked here (see file header).
  }));

  const { error: insertErr } = await supabase().from("sukoon_semantic_cache").insert(payload);
  if (insertErr) {
    logger.error({ err: insertErr.message }, "sukoon seed-cache: insert failed");
    process.exitCode = 1;
    return;
  }

  logger.info({ inserted: payload.length }, "sukoon seed-cache: done");
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, "sukoon seed-cache: fatal");
  process.exit(1);
});
