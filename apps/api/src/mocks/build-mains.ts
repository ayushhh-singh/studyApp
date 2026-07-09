/**
 * `pnpm mocks:build:mains` — assemble full-length UPPSC-Mains-pattern mock
 * tests (one per GS paper, 20 questions/200 marks/3h) from the published
 * descriptive PYQ bank. Idempotent (keyed on slug); a re-run rebuilds each
 * mock's membership with a fresh balanced sample.
 */
import { buildMainsMocks } from "../services/mocks.js";

buildMainsMocks((m) => console.log(`mocks: ${m}`))
  .then((results) => {
    for (const r of results) {
      console.log(`mocks: ${r.paper_code} — ${r.skipped ? "skipped" : `${r.built} set(s)`}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nmocks:build:mains failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
