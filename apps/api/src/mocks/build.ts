/**
 * `pnpm mocks:build [--exam <code>]` — assemble the full-length Prelims mock
 * test series from the published+approved MCQ bank, in each exam's own notified
 * pattern (`exams.paper_structure`). Idempotent (keyed on slug); a re-run
 * rebuilds each mock's membership with a fresh balanced sample.
 */
import { buildMocks } from "../services/mocks.js";
import { resolveMockBuildExams, MOCK_BUILD_FLAGS } from "./exams.js";
import { parseArgs } from "../ingest/_shared.js";

const args = parseArgs(process.argv.slice(2), MOCK_BUILD_FLAGS, "mocks:build");

resolveMockBuildExams(args.exam, (m) => console.log(`mocks: ${m}`))
  .then((examCodes) => buildMocks(examCodes, (m) => console.log(`mocks: ${m}`)))
  .then((results) => {
    for (const r of results) {
      console.log(`mocks: ${r.exam_code}/${r.paper_code} — ${r.skipped ? "skipped" : `${r.built} set(s)`}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nmocks:build failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
