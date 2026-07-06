/**
 * `pnpm mocks:build` — assemble the full-length UPPSC-Prelims-pattern mock test
 * series from the published+approved MCQ bank. Idempotent (keyed on slug); a
 * re-run rebuilds each mock's membership with a fresh balanced sample.
 */
import { buildMocks } from "../services/mocks.js";

buildMocks((m) => console.log(`mocks: ${m}`))
  .then((results) => {
    for (const r of results) {
      console.log(`mocks: ${r.paper_code} — ${r.skipped ? "skipped" : `${r.built} set(s)`}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nmocks:build failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
