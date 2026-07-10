/**
 * Pure text heuristics for the mentor pipeline (no DB / no model deps, so they
 * can be unit-tested in isolation — see scripts/test-mentor-heuristics.ts).
 */

/**
 * Personal / profile-dependent doubts (about the student's OWN performance)
 * always go to the model and are never cached. Heuristic over both locales.
 *
 * It must reference the student's own state/performance. A bare "for me" ("explain
 * federalism for me") is a plain teaching request, NOT personal — it used to
 * trigger this (so those answers were needlessly never cached), and has been
 * dropped: personal now requires an actual performance/state context word.
 */
export function isPersonalQuery(content: string): boolean {
  const en =
    /\b(my (weak|strong|score|accuracy|marks|performance|streak|progress|mistakes?|prep|revision|answers?|topics?)|why do i\b|i keep\b|i always\b|i (often|usually) (get|make|miss)|i (struggle|fail)|help me improve|am i (ready|weak|behind|on track)|how am i doing|my exam)\b/i;
  const hi = /(मेरा|मेरी|मुझे|मैं)[\s\S]{0,24}(कमज़ोर|कमजोर|गलत|सुधार|स्कोर|प्रदर्शन|तैयारी|प्रगति|गलतिय|कैसे कर रह|अंक)/;
  return en.test(content) || hi.test(content);
}

/**
 * A comparison / analysis-shaped doubt earns `medium` reasoning effort; every
 * other normal doubt answers at `low` for a faster first token (Session 26.5
 * latency work). Deliberately simple + bilingual — compare / difference /
 * evaluate / critically and their Hindi equivalents.
 */
export function isAnalyticalQuery(content: string): boolean {
  const en =
    /\b(compare|comparison|contrast|differen(?:ce|tiate)|distinguish|versus|vs\.?|evaluate|critically|analy[sz]e|examine|relationship between|significance of|implications?|pros and cons|advantages and disadvantages)\b/i;
  const hi = /(तुलना|अंतर|फर्क|फ़र्क|मूल्यांकन|आलोचनात्मक|विश्लेषण|समीक्षा|के बीच संबंध|महत्त्व|महत्व|प्रभाव)/;
  return en.test(content) || hi.test(content);
}
