/**
 * `pnpm mocks:build:mains [--exam <code>]` — assemble full-length Mains-pattern
 * mock tests from the published descriptive PYQ bank, one paper at a time in
 * each exam's own notified structure (`exams.paper_structure`). Idempotent
 * (keyed on slug); a re-run rebuilds each mock's membership with a fresh
 * balanced sample.
 */
import { buildMainsMocks } from "../services/mocks.js";
import { resolveMockBuildExams, MOCK_BUILD_FLAGS } from "./exams.js";
import { parseArgs } from "../ingest/_shared.js";

const args = parseArgs(process.argv.slice(2), MOCK_BUILD_FLAGS, "mocks:build:mains");

resolveMockBuildExams(args.exam, (m) => console.log(`mocks: ${m}`))
  .then((examCodes) => buildMainsMocks(examCodes, (m) => console.log(`mocks: ${m}`)))
  .then((results) => {
    for (const r of results) {
      console.log(`mocks: ${r.exam_code}/${r.paper_code} — ${r.skipped ? "skipped" : `${r.built} set(s)`}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nmocks:build:mains failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
