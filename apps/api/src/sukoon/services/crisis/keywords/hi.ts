import type { CrisisKeywordList } from "./types.js";

/**
 * Devanagari Hindi self-harm / severe-distress vocabulary. Because Hindi glues
 * inflections onto stems and users don't type reliable word boundaries, these
 * patterns are matched as plain substrings (keywordDetector.ts) — so authored
 * phrases are kept long enough to avoid false matches inside unrelated words
 * (never a bare "मर"). Includes spelling variants (ख़ुदकुशी / खुदकुशी).
 *
 * REVIEWER NOTE (SUKOON_CONTEXT): human-reviewed list. Strong = first-person
 * intent (never suppressed); a lone noun like "आत्महत्या" is WEAK (could be a
 * news/essay mention) and suppressed by the topical/joke markers below.
 */
export const hiKeywords: CrisisKeywordList = {
  strong: [
    // critical — first-person intent
    { pattern: "मरना चाहता", level: "critical" },
    { pattern: "मरना चाहती", level: "critical" },
    { pattern: "मर जाना चाहता", level: "critical" },
    { pattern: "मर जाना चाहती", level: "critical" },
    { pattern: "जीना नहीं चाहता", level: "critical" },
    { pattern: "जीना नहीं चाहती", level: "critical" },
    { pattern: "जीना नही चाहता", level: "critical" },
    { pattern: "जीने का मन नहीं", level: "critical" },
    { pattern: "जीने की इच्छा नहीं", level: "critical" },
    { pattern: "अब जीना नहीं", level: "critical" },
    { pattern: "जान दे दूँगा", level: "critical" },
    { pattern: "जान दे दूंगा", level: "critical" },
    { pattern: "जान दे दूँगी", level: "critical" },
    { pattern: "जान दे दूंगी", level: "critical" },
    { pattern: "जान देना चाहता", level: "critical" },
    { pattern: "अपनी जान ले", level: "critical" },
    { pattern: "आत्महत्या कर", level: "critical" },
    { pattern: "आत्महत्या करूँगा", level: "critical" },
    { pattern: "आत्महत्या करूंगा", level: "critical" },
    { pattern: "ख़ुदकुशी कर", level: "critical" },
    { pattern: "खुदकुशी कर", level: "critical" },
    { pattern: "खुद को मार", level: "critical" },
    { pattern: "खुद को ख़त्म कर", level: "critical" },
    { pattern: "खुद को खत्म कर", level: "critical" },
    { pattern: "सब ख़त्म कर दूँ", level: "critical" },
    { pattern: "सब खत्म कर दूं", level: "critical" },
    { pattern: "ज़िंदगी ख़त्म कर", level: "critical" },
    { pattern: "जिंदगी खत्म कर", level: "critical" },
    { pattern: "फांसी लगा", level: "critical" },
    { pattern: "फाँसी लगा", level: "critical" },
    { pattern: "नींद की गोलियां खा", level: "critical" },
    { pattern: "नींद की गोली खा", level: "critical" },
    // high — passive death wish / self-injury
    { pattern: "मरने का मन", level: "high" },
    { pattern: "मर जाऊं", level: "high" },
    { pattern: "काश मर जाऊं", level: "high" },
    { pattern: "खुद को नुकसान", level: "high" },
    { pattern: "खुद को चोट", level: "high" },
    { pattern: "मेरे बिना सब बेहतर", level: "high" },
    { pattern: "किसी को फ़र्क नहीं पड़ेगा", level: "high" },
    { pattern: "किसी को फर्क नहीं पड़ेगा", level: "high" },
    { pattern: "मर जाऊं तो अच्छा", level: "high" },
    // moderate — hopelessness / breakdown
    { pattern: "टूट गया हूँ", level: "moderate" },
    { pattern: "टूट गई हूँ", level: "moderate" },
    { pattern: "टूट चुका हूँ", level: "moderate" },
    { pattern: "बहुत अकेला", level: "moderate" },
    { pattern: "बहुत अकेली", level: "moderate" },
    { pattern: "कोई उम्मीद नहीं", level: "moderate" },
    { pattern: "उम्मीद ख़त्म", level: "moderate" },
    { pattern: "बेकार हूँ", level: "moderate" },
    { pattern: "किसी काम का नहीं", level: "moderate" },
    { pattern: "किसी काम की नहीं", level: "moderate" },
    { pattern: "हार गया हूँ", level: "moderate" },
    { pattern: "हार गई हूँ", level: "moderate" },
    { pattern: "अब और नहीं सहा जाता", level: "moderate" },
    { pattern: "बर्दाश्त नहीं हो रहा", level: "moderate" },
    { pattern: "घुट रहा हूँ", level: "moderate" },
    { pattern: "ज़िंदगी बेकार", level: "moderate" },
    { pattern: "जिंदगी बेकार", level: "moderate" },
    { pattern: "सब बर्बाद हो गया", level: "moderate" },
    { pattern: "करियर ख़त्म", level: "moderate" },
  ],
  weak: [
    { pattern: "आत्महत्या", level: "high" },
    { pattern: "ख़ुदकुशी", level: "high" },
    { pattern: "खुदकुशी", level: "high" },
    { pattern: "सुसाइड", level: "high" },
    // mild distress → low (never suppressed by topical markers; see detector)
    { pattern: "बहुत तनाव", level: "low" },
    { pattern: "बहुत चिंता", level: "low" },
    { pattern: "घबराहट हो रही", level: "low" },
    { pattern: "डर लग रहा", level: "low" },
    { pattern: "नींद नहीं आ रही", level: "low" },
    { pattern: "बहुत थक गया", level: "low" },
    { pattern: "बहुत थक गई", level: "low" },
    { pattern: "बहुत परेशान", level: "low" },
  ],
  suppressors: [
    // joke / quotation
    "मज़ाक",
    "मजाक",
    "मज़ाक़",
    "हँसी मज़ाक",
    // "don't (say/make) …"
    "मत करो",
    "मत कर",
    "मत बोल",
    "मत कहो",
    "मत लिखो",
    // explicit reassurance
    "ठीक हूँ",
    "ठीक हूं",
    "मैं ठीक",
    "सब ठीक",
    "बिलकुल ठीक",
    // topical / discussion-about
    "रोकथाम",
    "निबंध",
    "समाचार",
    "खबर",
    "ख़बर",
    "अखबार",
    "अख़बार",
    "जागरूकता",
    "पोस्टर",
    "सेमिनार",
  ],
};
