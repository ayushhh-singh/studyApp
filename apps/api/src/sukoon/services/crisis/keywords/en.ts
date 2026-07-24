import type { CrisisKeywordList } from "./types.js";

/**
 * English self-harm / severe-distress vocabulary, incl. common misspellings.
 * Reviewed safety surface — see keywords/types.ts for strong/weak/suppressor
 * semantics. Patterns are matched case-insensitively on word boundaries
 * (keywordDetector.ts), so single tokens ("die") never match inside another
 * word ("studied") and multi-word phrases match as a run.
 *
 * REVIEWER NOTE (SUKOON_CONTEXT): this list is meant to be read and edited by a
 * human. Add first-person INTENT phrases to `strong`; add lone ambiguous nouns
 * to `weak`; add benign/quotation/topical markers to `suppressors`.
 */
export const enKeywords: CrisisKeywordList = {
  strong: [
    // critical — explicit intent / method / plan
    { pattern: "kill myself", level: "critical" },
    { pattern: "kill my self", level: "critical" },
    { pattern: "killing myself", level: "critical" },
    { pattern: "gonna kill myself", level: "critical" },
    { pattern: "going to kill myself", level: "critical" },
    { pattern: "want to kill myself", level: "critical" },
    { pattern: "kil myself", level: "critical" }, // misspelling
    { pattern: "end my life", level: "critical" },
    { pattern: "ending my life", level: "critical" },
    { pattern: "end my own life", level: "critical" },
    { pattern: "take my life", level: "critical" },
    { pattern: "take my own life", level: "critical" },
    { pattern: "want to die", level: "critical" },
    { pattern: "wanna die", level: "critical" },
    { pattern: "i want to die", level: "critical" },
    { pattern: "i wanna die", level: "critical" },
    { pattern: "dont want to live", level: "critical" },
    { pattern: "don't want to live", level: "critical" },
    { pattern: "do not want to live", level: "critical" },
    { pattern: "cant live anymore", level: "critical" },
    { pattern: "can't live anymore", level: "critical" },
    { pattern: "end it all", level: "critical" },
    { pattern: "want to end it all", level: "critical" },
    { pattern: "hang myself", level: "critical" },
    { pattern: "hanging myself", level: "critical" },
    { pattern: "slit my wrist", level: "critical" },
    { pattern: "slit my wrists", level: "critical" },
    { pattern: "overdose on", level: "critical" },
    { pattern: "jump off", level: "critical" },
    { pattern: "jump in front of", level: "critical" },
    // high — ideation / passive death wish / self-injury (no explicit plan)
    { pattern: "better off dead", level: "high" },
    { pattern: "better of dead", level: "high" }, // misspelling
    { pattern: "no reason to live", level: "high" },
    { pattern: "nothing to live for", level: "high" },
    { pattern: "wish i was dead", level: "high" },
    { pattern: "wish i were dead", level: "high" },
    { pattern: "wish i wasnt here", level: "high" },
    { pattern: "wish i wasn't here", level: "high" },
    { pattern: "everyone better without me", level: "high" },
    { pattern: "world better without me", level: "high" },
    { pattern: "better off without me", level: "high" },
    { pattern: "want to disappear forever", level: "high" },
    { pattern: "hurt myself", level: "high" },
    { pattern: "harm myself", level: "high" },
    { pattern: "cut myself", level: "high" },
    { pattern: "cutting myself", level: "high" },
    { pattern: "self harm", level: "high" },
    { pattern: "self-harm", level: "high" },
    { pattern: "selfharm", level: "high" }, // misspelling / hashtag form
    // moderate — hopelessness / breakdown, no self-harm
    { pattern: "cant do this anymore", level: "moderate" },
    { pattern: "can't do this anymore", level: "moderate" },
    { pattern: "cant take it anymore", level: "moderate" },
    { pattern: "can't take it anymore", level: "moderate" },
    { pattern: "i give up", level: "moderate" },
    { pattern: "giving up on everything", level: "moderate" },
    { pattern: "no point anymore", level: "moderate" },
    { pattern: "no point in anything", level: "moderate" },
    { pattern: "completely hopeless", level: "moderate" },
    { pattern: "i feel worthless", level: "moderate" },
    { pattern: "i am worthless", level: "moderate" },
    { pattern: "i am a failure", level: "moderate" },
    { pattern: "breaking down", level: "moderate" },
    { pattern: "falling apart", level: "moderate" },
    { pattern: "cant cope", level: "moderate" },
    { pattern: "can't cope", level: "moderate" },
    { pattern: "my life is ruined", level: "moderate" },
    { pattern: "i ruined my life", level: "moderate" },
  ],
  weak: [
    { pattern: "suicide", level: "high" },
    { pattern: "suicidal", level: "high" },
    { pattern: "sucide", level: "high" }, // misspelling
    { pattern: "suiside", level: "high" }, // misspelling
    { pattern: "suicidle", level: "high" }, // misspelling
    // mild-distress lone tokens → low (soften tone). Suppressed only by explicit
    // "I'm fine" reassurance, not by topical markers.
    { pattern: "so stressed", level: "low" },
    { pattern: "very stressed", level: "low" },
    { pattern: "so anxious", level: "low" },
    { pattern: "panic attack", level: "low" },
    { pattern: "burnt out", level: "low" },
    { pattern: "burned out", level: "low" },
    { pattern: "overwhelmed", level: "low" },
    { pattern: "cant sleep", level: "low" },
    { pattern: "can't sleep", level: "low" },
  ],
  suppressors: [
    // joke / quotation
    "just kidding",
    "kidding",
    "as a joke",
    "its a joke",
    "it's a joke",
    "joking",
    "not serious",
    "sarcasm",
    "sarcastic",
    // explicit reassurance
    "im fine",
    "i'm fine",
    "i am fine",
    "im okay",
    "i'm okay",
    "im ok",
    "i'm ok",
    "i am okay",
    "dont worry",
    "don't worry",
    // topical / discussion-about (essays, news, awareness) — not first-person
    "prevention",
    "awareness",
    "essay",
    "assignment",
    "article",
    "news",
    "documentary",
    "statistics",
    "helpline poster",
    "movie",
    "film about",
  ],
};
