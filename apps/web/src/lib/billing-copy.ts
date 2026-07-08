import type { Locale } from "@prayasup/shared";

/**
 * Billing UI copy kept self-contained here (not in messages/*.json) so the
 * feature is one cohesive unit. Bilingual — Hindi is first-class, never a
 * machine gloss.
 */
type T = { en: string; hi: string };
export const pick = (locale: Locale, t: T): string => (locale === "hi" ? t.hi : t.en);

export const billingCopy = {
  pricingTitle: { en: "Go Pro", hi: "प्रो बनें" } as T,
  pricingSubtitle: {
    en: "Unlimited AI answer evaluation, all study notes, mock tests, and more. Pay securely with UPI.",
    hi: "असीमित AI उत्तर मूल्यांकन, सभी नोट्स, मॉक टेस्ट और बहुत कुछ। UPI से सुरक्षित भुगतान करें।",
  } as T,
  upiFirst: { en: "UPI · Cards · Netbanking · Wallets", hi: "UPI · कार्ड · नेटबैंकिंग · वॉलेट" } as T,
  upiNote: {
    en: "Pay in seconds with any UPI app — Google Pay, PhonePe, Paytm.",
    hi: "किसी भी UPI ऐप से पल भर में भुगतान करें — Google Pay, PhonePe, Paytm।",
  } as T,
  perYear: { en: "/year", hi: "/वर्ष" } as T,
  perMonth: { en: "/month", hi: "/माह" } as T,
  bestValue: { en: "Best value", hi: "सर्वोत्तम मूल्य" } as T,
  introPrice: { en: "Launch price", hi: "लॉन्च मूल्य" } as T,
  choosePlan: { en: "Choose this plan", hi: "यह प्लान चुनें" } as T,
  currentPlan: { en: "Your current plan", hi: "आपका वर्तमान प्लान" } as T,
  youArePro: { en: "You're on Pro", hi: "आप प्रो पर हैं" } as T,
  proUntil: { en: "Pro until", hi: "प्रो इस तिथि तक" } as T,
  processing: { en: "Opening checkout…", hi: "चेकआउट खुल रहा है…" } as T,
  activating: { en: "Confirming your payment…", hi: "आपका भुगतान सत्यापित हो रहा है…" } as T,
  welcomePro: { en: "Welcome to Pro! 🎉", hi: "प्रो में आपका स्वागत है! 🎉" } as T,
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
  featMocks: { en: "Full-length mock test series", hi: "पूर्ण-लंबाई मॉक टेस्ट श्रृंखला" } as T,
  featAnalytics: { en: "Advanced analytics + improvement proof", hi: "उन्नत विश्लेषण + सुधार प्रमाण" } as T,
  featMagazine: { en: "Monthly magazine PDF download", hi: "मासिक पत्रिका PDF डाउनलोड" } as T,
  free: { en: "Free", hi: "मुफ़्त" } as T,
  pro: { en: "Pro", hi: "प्रो" } as T,
  included: { en: "Included", hi: "शामिल" } as T,
  notIncluded: { en: "—", hi: "—" } as T,

  // Paywall
  upgradeToPro: { en: "Upgrade to Pro", hi: "प्रो में अपग्रेड करें" } as T,
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
  paywallGenericTitle: { en: "Unlock with Pro", hi: "प्रो के साथ अनलॉक करें" } as T,
  yourGains: { en: "Your proven gains", hi: "आपका सिद्ध सुधार" } as T,
  gainsAvg: { en: "On answers you rewrote, your score improved by", hi: "जिन उत्तरों को आपने दोबारा लिखा, उनका स्कोर बढ़ा" } as T,
  onAverage: { en: "on average", hi: "औसतन" } as T,

  // Quota chip / notes lock
  evalsLeft: { en: "evaluations left", hi: "मूल्यांकन शेष" } as T,
  evalLeftOne: { en: "evaluation left", hi: "मूल्यांकन शेष" } as T,
  unlimited: { en: "Unlimited", hi: "असीमित" } as T,
  lockedNoteHeading: { en: "Unlock the full note", hi: "पूरा नोट अनलॉक करें" } as T,
  mentorLimitTitle: { en: "Daily mentor limit reached", hi: "दैनिक मेंटर सीमा पूरी हुई" } as T,
  mentorLimitBody: {
    en: "Come back tomorrow, or upgrade to Pro for 100 messages a day.",
    hi: "कल फिर आएँ, या 100 संदेश/दिन के लिए प्रो में अपग्रेड करें।",
  } as T,
};
