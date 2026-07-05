/**
 * Verifies that every expected table exists in the linked Supabase project by
 * selecting a HEAD count from each, using the service-role key.
 *
 *   pnpm --filter api verify:schema
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from apps/api/.env (loaded via
 * node's --env-file in the npm script).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/api/.env",
  );
  process.exit(1);
}

const EXPECTED_TABLES = [
  "users_profile",
  "syllabus_nodes",
  "questions",
  "tests",
  "test_questions",
  "attempts",
  "attempt_answers",
  "answer_submissions",
  "evaluations",
  "current_affairs_items",
  "srs_cards",
  "srs_reviews",
  "study_plans",
  "doubt_threads",
  "doubt_messages",
  "embeddings",
  "events",
  "exam_calendar",
] as const;

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

let failures = 0;

for (const table of EXPECTED_TABLES) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) {
    failures += 1;
    console.error(`✗ ${table.padEnd(22)} ${error.message}`);
  } else {
    console.log(`✓ ${table.padEnd(22)} rows=${count ?? 0}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} table(s) failed verification.`);
  process.exit(1);
}

console.log(`\nAll ${EXPECTED_TABLES.length} tables verified.`);
