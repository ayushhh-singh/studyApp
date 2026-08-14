import type { Locale, Plan } from "@neev/shared";

/**
 * Billing UI copy kept self-contained here (not in messages/*.json) so the
 * feature is one cohesive unit. Bilingual — Hindi is first-class, never a
 * machine gloss.
 */
type T = { en: string; hi: string };
export const pick = (locale: Locale, t: T): string => (locale === "hi" ? t.hi : t.en);

/** Whole days remaining until an ISO expiry (clamped at 0). */
export function daysUntil(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 3600 * 1000)));
}

/** Total months a plan covers (yearly → 12·N, else the month interval_count). */
export function planMonths(plan: Plan): number {
  return plan.interval === "year" ? 12 * plan.interval_count : plan.interval_count;
}

export const billingCopy = {
  // "Go Pro" was the title while Pro was the only paid tier. With Max on top it
  // named one of three, so the page's own h1 and its <title> both undersold the
  // ladder they were introducing.
  pricingTitle: { en: "Plans and pricing", hi: "प्लान और मूल्य" } as T,
  pricingSubtitle: {
    en: "Start free. Pro adds unlimited AI answer evaluation, every study note and mock tests. Max adds the scheduled test series on top. Pay securely with UPI.",
    hi: "मुफ़्त शुरू करें। प्रो में असीमित AI उत्तर मूल्यांकन, हर अध्ययन नोट और मॉक टेस्ट जुड़ते हैं। मैक्स इनके ऊपर निर्धारित टेस्ट सीरीज़ जोड़ता है। UPI से सुरक्षित भुगतान करें।",
  } as T,
  // One line under each tier heading. Without them the grouped ladder shows two
  // bare words ("Pro", "Max") above six price cards and never says what
  // separates them — the one question the page exists to answer.
  proTierNote: {
    en: "Everything you need day to day: unlimited answer evaluation, every study note, handwritten upload and full-length mock tests you can attempt whenever you like.",
    hi: "रोज़मर्रा की हर ज़रूरत: असीमित उत्तर मूल्यांकन, हर अध्ययन नोट, हस्तलिखित अपलोड और जब चाहें तब दिए जा सकने वाले पूर्ण-लंबाई मॉक टेस्ट।",
  } as T,
  maxTierNote: {
    en: "Everything in Pro, plus the scheduled test series — papers on a published calendar that open on their date and rank you against everyone who sat them in the same window.",
    hi: "प्रो का सब कुछ, और साथ में निर्धारित टेस्ट सीरीज़ — प्रकाशित कैलेंडर पर तय तारीख को खुलने वाले पेपर, जो आपको उसी अवधि में पेपर देने वाले सभी के मुक़ाबले रैंक देते हैं।",
  } as T,
  upiFirst: { en: "UPI · Cards · Netbanking · Wallets", hi: "UPI · कार्ड · नेटबैंकिंग · वॉलेट" } as T,
  upiNote: {
    en: "Pay in seconds with any UPI app — Google Pay, PhonePe, Paytm.",
    hi: "किसी भी UPI ऐप से पल भर में भुगतान करें — Google Pay, PhonePe, Paytm।",
  } as T,
  perYear: { en: "/year", hi: "/वर्ष" } as T,
  perMonth: { en: "/month", hi: "/माह" } as T,
  per3Months: { en: "/3 months", hi: "/3 माह" } as T,
  per6Months: { en: "/6 months", hi: "/6 माह" } as T,
  perMonthShort: { en: "/mo", hi: "/माह" } as T,
  bestValue: { en: "Best value", hi: "सर्वोत्तम मूल्य" } as T,
  // Deliberately "Compare plans", not the mockup's implied social proof: the
  // highlighted tier is flagged is_intro (best value per month), which is an
  // arithmetic fact, whereas "Most popular" would be a claim about what other
  // people bought that we have no data for.
  compareTitle: { en: "Compare plans", hi: "प्लान की तुलना" } as T,
  introPrice: { en: "Launch price", hi: "लॉन्च मूल्य" } as T,
  choosePlan: { en: "Choose this plan", hi: "यह प्लान चुनें" } as T,
  currentPlan: { en: "Your current plan", hi: "आपका वर्तमान प्लान" } as T,
  /** A LOWER tier than the one you are on — covered, but not "your plan". */
  includedInPlan: { en: "Included in your plan", hi: "आपके प्लान में शामिल" } as T,
  /** Shown on a HIGHER tier when the user already pays for a lower one. */
  proratedNote: {
    en: "Upgrading — you only pay the difference. Unused time on your current plan is credited at checkout. Pick the same or a longer billing period to use your full credit.",
    hi: "अपग्रेड — आप केवल अंतर का भुगतान करते हैं। आपके वर्तमान प्लान का शेष समय चेकआउट पर समायोजित हो जाता है। पूरा क्रेडिट उपयोग करने के लिए वही या उससे लंबी बिलिंग अवधि चुनें।",
  } as T,
  youArePro: { en: "You're on Pro", hi: "आप प्रो पर हैं" } as T,
  youAreMax: { en: "You're on Max", hi: "आप मैक्स पर हैं" } as T,
  proUntil: { en: "Pro until", hi: "प्रो इस तिथि तक" } as T,
  maxUntil: { en: "Max until", hi: "मैक्स इस तिथि तक" } as T,
  processing: { en: "Opening checkout…", hi: "चेकआउट खुल रहा है…" } as T,
  activating: { en: "Confirming your payment…", hi: "आपका भुगतान सत्यापित हो रहा है…" } as T,
  welcomePro: { en: "Welcome to Pro! 🎉", hi: "प्रो में आपका स्वागत है! 🎉" } as T,
  welcomeMax: { en: "Welcome to Max", hi: "मैक्स में आपका स्वागत है" } as T,
  paymentCancelled: { en: "Payment cancelled.", hi: "भुगतान रद्द किया गया।" } as T,
  paymentFailed: { en: "Couldn't start checkout. Please try again.", hi: "चेकआउट शुरू नहीं हो सका। कृपया पुनः प्रयास करें।" } as T,

  // Feature comparison rows (Free vs Pro)
  featPYQ: { en: "Full PYQ bank + explanations + weightage analytics", hi: "संपूर्ण PYQ बैंक + व्याख्याएँ + वेटेज विश्लेषण" } as T,
  featDaily: { en: "Daily 25-question quiz + current affairs + SRS + community", hi: "दैनिक 25-प्रश्न क्विज़ + करेंट अफेयर्स + SRS + समुदाय" } as T,
  featEval: { en: "AI answer evaluations", hi: "AI उत्तर मूल्यांकन" } as T,
  featEvalFree: { en: "3 total (trial)", hi: "कुल 3 (ट्रायल)" } as T,
  featEvalPro: { en: "Unlimited (60/mo fair-use)", hi: "असीमित (60/माह उचित-उपयोग)" } as T,
  featNotes: { en: "Study notes", hi: "अध्ययन नोट्स" } as T,
  featNotesFree: { en: "Top 5 topics/paper", hi: "प्रति पेपर शीर्ष 5 विषय" } as T,
  featNotesPro: { en: "All topics", hi: "सभी विषय" } as T,
  featMentor: { en: "AI mentor messages", hi: "AI मेंटर संदेश" } as T,
  featMentorFree: { en: "10/day", hi: "10/दिन" } as T,
  featMentorPro: { en: "100/day", hi: "100/दिन" } as T,
  featOcr: { en: "Handwritten answer upload (OCR)", hi: "हस्तलिखित उत्तर अपलोड (OCR)" } as T,
  featDrills: { en: "Micro-drills (intro/conclusion)", hi: "माइक्रो-ड्रिल (परिचय/निष्कर्ष)" } as T,
  // "…test series" on the Pro row and "Scheduled test series" on the Max row
  // read as the same product priced twice. The real distinction is WHEN you may
  // sit them, so the labels say that: any time vs on a published date.
  featMocks: { en: "Full-length mock tests, any time", hi: "पूर्ण-लंबाई मॉक टेस्ट, कभी भी" } as T,
  featAnalytics: { en: "Advanced analytics + improvement proof", hi: "उन्नत विश्लेषण + सुधार प्रमाण" } as T,
  featMagazine: { en: "Monthly magazine PDF download", hi: "मासिक पत्रिका PDF डाउनलोड" } as T,
  // NOT "all-India rank": a rank here is against everyone who sat that paper in
  // its ranked window, which for a STATE exam (UPPSC) is not an all-India
  // cohort. The claim was true only for the national exam.
  featSeries: { en: "Scheduled test series (dated calendar + rank)", hi: "निर्धारित टेस्ट सीरीज़ (तय कैलेंडर + रैंक)" } as T,
  featEvalMax: { en: "600/year (200/mo)", hi: "600/वर्ष (200/माह)" } as T,
  free: { en: "Free", hi: "मुफ़्त" } as T,
  pro: { en: "Pro", hi: "प्रो" } as T,
  max: { en: "Max", hi: "मैक्स" } as T,
  included: { en: "Included", hi: "शामिल" } as T,
  notIncluded: { en: "—", hi: "—" } as T,

  // Paywall
  upgradeToPro: { en: "Upgrade to Pro", hi: "प्रो में अपग्रेड करें" } as T,
  upgradeToMax: { en: "Upgrade to Max", hi: "मैक्स में अपग्रेड करें" } as T,
  maybeLater: { en: "Maybe later", hi: "बाद में" } as T,
  seePlans: { en: "See plans", hi: "प्लान देखें" } as T,
  paywallEvalTitle: { en: "You've used all 3 free evaluations", hi: "आपने तीनों मुफ़्त मूल्यांकन उपयोग कर लिए" } as T,
  paywallEvalBody: {
    en: "Upgrade to Pro for unlimited AI evaluation of your answers — typed or handwritten.",
    hi: "अपने उत्तरों के असीमित AI मूल्यांकन के लिए प्रो में अपग्रेड करें — टाइप किए या हस्तलिखित।",
  } as T,
  paywallOcrTitle: { en: "Handwritten upload is a Pro feature", hi: "हस्तलिखित अपलोड एक प्रो सुविधा है" } as T,
  paywallOcrBody: {
    en: "Snap a photo of your handwritten answer and get it transcribed and evaluated — with Pro.",
    hi: "अपने हस्तलिखित उत्तर की फ़ोटो लें और उसे ट्रांसक्राइब व मूल्यांकित कराएँ — प्रो के साथ।",
  } as T,
  paywallMocksTitle: { en: "Mock tests are a Pro feature", hi: "मॉक टेस्ट एक प्रो सुविधा है" } as T,
  paywallMocksBody: {
    en: "Attempt full-length UPPSC-pattern papers with cut-off comparison — with Pro.",
    hi: "कट-ऑफ तुलना के साथ पूर्ण-लंबाई UPPSC-पैटर्न पेपर हल करें — प्रो के साथ।",
  } as T,
  paywallDrillsTitle: { en: "Micro-drills are a Pro feature", hi: "माइक्रो-ड्रिल एक प्रो सुविधा है" } as T,
  paywallDrillsBody: {
    en: "Practise just the intro or conclusion of an answer, scored instantly — with Pro.",
    hi: "उत्तर का केवल परिचय या निष्कर्ष अभ्यास करें, तुरंत स्कोर पाएँ — प्रो के साथ।",
  } as T,
  paywallNotesTitle: { en: "This note is a Pro topic", hi: "यह नोट एक प्रो विषय है" } as T,
  paywallNotesBody: {
    en: "Free covers the 5 highest-weightage topics per paper. Unlock every note with Pro.",
    hi: "मुफ़्त में प्रति पेपर 5 सर्वाधिक-वेटेज विषय शामिल हैं। प्रो के साथ हर नोट अनलॉक करें।",
  } as T,
  paywallMagazineTitle: { en: "Magazine PDF download is a Pro feature", hi: "मैगज़ीन PDF डाउनलोड एक प्रो सुविधा है" } as T,
  paywallSeriesTitle: { en: "The test series is a Max feature", hi: "टेस्ट सीरीज़ एक मैक्स सुविधा है" } as T,
  paywallSeriesBody: {
    en: "Sit the full scheduled calendar — papers that open on a fixed date, ranked against everyone who took them in the same window.",
    hi: "संपूर्ण निर्धारित कैलेंडर दें — निश्चित तिथि पर खुलने वाले पेपर, उसी अवधि में देने वाले सभी के मुक़ाबले रैंक के साथ।",
  } as T,
  paywallMagazineBody: {
    en: "Read both monthly editions free online. Printing/downloading a clean PDF is a Pro feature.",
    hi: "दोनों मासिक संस्करण मुफ़्त ऑनलाइन पढ़ें। स्वच्छ PDF प्रिंट/डाउनलोड करना एक प्रो सुविधा है।",
  } as T,
  paywallGenericTitle: { en: "Unlock with Pro", hi: "प्रो के साथ अनलॉक करें" } as T,
  yourGains: { en: "Your proven gains", hi: "आपका सिद्ध सुधार" } as T,
  gainsAvg: { en: "On answers you rewrote, your score improved by", hi: "जिन उत्तरों को आपने दोबारा लिखा, उनका स्कोर बढ़ा" } as T,
  onAverage: { en: "on average", hi: "औसतन" } as T,

  // Trial (7-day full-Pro free trial)
  trialBadge: { en: "Free trial", hi: "मुफ़्त ट्रायल" } as T,
  trialActive: { en: "Pro trial active", hi: "प्रो ट्रायल सक्रिय" } as T,
  trialDaysLeft: { en: "days of Pro left", hi: "दिन की प्रो शेष" } as T,
  trialDayLeftOne: { en: "day of Pro left", hi: "दिन की प्रो शेष" } as T,
  trialLastDay: { en: "Last day of your Pro trial", hi: "आपके प्रो ट्रायल का अंतिम दिन" } as T,
  trialEnded: { en: "Your Pro trial has ended", hi: "आपका प्रो ट्रायल समाप्त हो गया" } as T,
  trialKeepPro: { en: "Keep Pro", hi: "प्रो जारी रखें" } as T,
  // Honest onboarding assurance — no card is collected, so NO auto-charge wording.
  trialWelcome: {
    en: "You've got 7 days of full Pro access — free, no card needed. It quietly turns into the Free plan after that.",
    hi: "आपको 7 दिन की संपूर्ण प्रो एक्सेस मिली है — मुफ़्त, बिना कार्ड। इसके बाद यह चुपचाप मुफ़्त प्लान में बदल जाती है।",
  } as T,
  trialWelcomeShort: {
    en: "7 days of full Pro, free — no card needed.",
    hi: "7 दिन की संपूर्ण प्रो, मुफ़्त — बिना कार्ड।",
  } as T,

  // Paywall — trial user hitting the tighter DAILY eval cap (distinct from free/paid).
  paywallEvalTrialTitle: { en: "That's today's 2 trial evaluations", hi: "आज के 2 ट्रायल मूल्यांकन पूरे हुए" } as T,
  paywallEvalTrialBody: {
    en: "Your 7-day Pro trial includes 2 detailed evaluations a day — they reset at midnight. Go Pro for up to 60 a month, plus everything else.",
    hi: "आपके 7-दिन प्रो ट्रायल में रोज़ 2 विस्तृत मूल्यांकन शामिल हैं — ये आधी रात रीसेट होते हैं। 60/माह तक और बाकी सब कुछ के लिए प्रो लें।",
  } as T,
  // Paywall — a PAID Pro user hitting the monthly fair-use cap (no upgrade CTA).
  paywallEvalProCapTitle: { en: "You've hit this month's fair-use cap", hi: "इस माह की उचित-उपयोग सीमा पूरी हुई" } as T,
  paywallEvalMaxUpsellTitle: { en: "Need more evaluations?", hi: "और मूल्यांकन चाहिए?" } as T,
  paywallEvalMaxUpsellBody: {
    en: "You've used this month's Pro allowance. Max raises it and adds the scheduled test series.",
    hi: "आपने इस माह का प्रो कोटा उपयोग कर लिया। मैक्स इसे बढ़ाता है और निर्धारित टेस्ट सीरीज़ जोड़ता है।",
  } as T,
  paywallEvalProCapBody: {
    en: "You've used all 60 evaluations included this month. Your allowance resets at the start of next month.",
    hi: "इस माह के सभी 60 मूल्यांकन उपयोग हो गए। आपकी सीमा अगले माह की शुरुआत में रीसेट होगी।",
  } as T,
  gotIt: { en: "Got it", hi: "समझ गए" } as T,

  // Guest (anonymous) signup prompt — shown instead of the Pro paywall when a
  // guest hits a gated feature. Framed as "create account + trial", not "pay".
  guestUnlockTitle: { en: "Create your free account", hi: "अपना निःशुल्क खाता बनाएँ" } as T,
  guestUnlockBody: {
    en: "AI answer evaluation, the mentor, handwritten upload and more need an account. Create one free — you'll also start your 7-day Pro trial, no card needed. Your progress so far comes with you.",
    hi: "AI उत्तर मूल्यांकन, मेंटर, हस्तलिखित अपलोड और बहुत कुछ के लिए खाता आवश्यक है। निःशुल्क खाता बनाएँ — साथ ही आपका 7-दिन का प्रो ट्रायल भी शुरू होगा, कार्ड की ज़रूरत नहीं। अब तक की आपकी प्रगति साथ रहेगी।",
  } as T,
  guestUnlockCta: { en: "Create free account", hi: "निःशुल्क खाता बनाएँ" } as T,
  guestKeepBrowsing: { en: "Keep browsing", hi: "ब्राउज़िंग जारी रखें" } as T,
  guestSignUpShort: { en: "Sign up to unlock", hi: "अनलॉक हेतु साइन अप" } as T,

  // Quota chip / notes lock
  evalsLeft: { en: "evaluations left", hi: "मूल्यांकन शेष" } as T,
  evalLeftOne: { en: "evaluation left", hi: "मूल्यांकन शेष" } as T,
  evalsLeftToday: { en: "left today", hi: "आज शेष" } as T,
  unlimited: { en: "Unlimited", hi: "असीमित" } as T,
  lockedNoteHeading: { en: "Unlock the full note", hi: "पूरा नोट अनलॉक करें" } as T,
  mentorLimitTitle: { en: "Daily mentor limit reached", hi: "दैनिक मेंटर सीमा पूरी हुई" } as T,
  mentorLimitBody: {
    en: "Come back tomorrow, or upgrade to Pro for 100 messages a day.",
    hi: "कल फिर आएँ, या 100 संदेश/दिन के लिए प्रो में अपग्रेड करें।",
  } as T,
};

/** The price suffix for a plan's billing period (/month, /3 months, /6 months, /year). */
export function planPeriodLabel(plan: Plan): T {
  if (plan.interval === "year") return billingCopy.perYear;
  if (plan.interval_count === 3) return billingCopy.per3Months;
  if (plan.interval_count === 6) return billingCopy.per6Months;
  return billingCopy.perMonth;
}
