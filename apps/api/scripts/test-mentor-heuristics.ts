/**
 * Unit tests for the mentor's pure text heuristics (Session 26.5) — run with
 *   pnpm --filter api test:mentor
 * No DB / model deps, so this runs offline with no env. Exits non-zero on any
 * failed assertion.
 */
import assert from "node:assert/strict";
import { isPersonalQuery, isAnalyticalQuery } from "../src/services/mentor/heuristics.js";

let passed = 0;
function check(label: string, actual: boolean, expected: boolean): void {
  assert.equal(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  passed++;
}

// --- isPersonalQuery: "for me" must NOT be personal; real state words must be ---
check('EN "explain federalism for me" → NOT personal', isPersonalQuery("explain federalism for me"), false);
check('EN "why do I keep getting polity wrong" → personal', isPersonalQuery("why do I keep getting polity wrong"), true);
// Hindi pair
check('HI "मुझे संघवाद समझाओ" (for me) → NOT personal', isPersonalQuery("मुझे संघवाद समझाओ"), false);
check(
  'HI "मेरी तैयारी कमजोर क्यों है" → personal',
  isPersonalQuery("पॉलिटी में मेरी तैयारी कमजोर क्यों है"),
  true,
);
// A few more guards
check('EN "what is my weak topic" → personal', isPersonalQuery("what is my weak topic"), true);
check('EN "what is federalism" → NOT personal', isPersonalQuery("what is federalism"), false);
check('EN "am I ready for prelims" → personal', isPersonalQuery("am I ready for prelims"), true);

// --- isAnalyticalQuery: comparison/analysis → medium effort ---
check('EN "compare federalism and unitary" → analytical', isAnalyticalQuery("compare federalism and unitary systems"), true);
check('EN "difference between IPC and CrPC" → analytical', isAnalyticalQuery("difference between IPC and CrPC"), true);
check('EN "critically evaluate the NEP" → analytical', isAnalyticalQuery("critically evaluate the NEP"), true);
check('EN "what is Article 370" → NOT analytical', isAnalyticalQuery("what is Article 370"), false);
check('HI "संघवाद और एकात्मकता में अंतर" → analytical', isAnalyticalQuery("संघवाद और एकात्मक व्यवस्था में अंतर"), true);
check('HI "अनुच्छेद 370 क्या है" → NOT analytical', isAnalyticalQuery("अनुच्छेद 370 क्या है"), false);

console.log(`✓ mentor heuristics: ${passed}/${passed} assertions passed`);
