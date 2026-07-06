/**
 * `pnpm ca:compile --month YYYY-MM` — assemble a month's PUBLISHED current
 * affairs into the structured bilingual magazine document and print a summary.
 *
 * The magazine is computed on demand (no table) by services/magazine.ts and
 * served at GET /magazine/:month → rendered at the print-styled route
 * /:locale/magazine/:month. This CLI is a smoke-test / ops entry point; with
 * no --month it lists every compilable month.
 */
import { compileMagazine, listMagazineMonths } from "../services/magazine.js";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}

async function main(): Promise<void> {
  const month = arg("month");

  if (!month) {
    const months = await listMagazineMonths();
    console.log("ca:compile — compilable months:\n");
    if (months.length === 0) {
      console.log("  (no published current affairs yet — run pnpm ca:run first)");
      return;
    }
    for (const m of months) console.log(`  ${m.month}  ${m.title_i18n.en}  (${m.item_count} items)`);
    console.log("\nRun: pnpm ca:compile --month <YYYY-MM>");
    return;
  }

  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("--month must be YYYY-MM");

  const mag = await compileMagazine(month);
  if (!mag) {
    console.log(`No published current affairs for ${month}.`);
    return;
  }

  console.log(`\n📰  ${mag.title_i18n.en} / ${mag.title_i18n.hi}`);
  console.log(`    ${mag.total_items} items · ${mag.up_item_count} UP-specific · ${mag.mcq_appendix.length} quiz MCQs\n`);
  console.log(`  UP-Specific (lead section): ${mag.up_section.length} item(s)`);
  for (const s of mag.sections) console.log(`  ${s.category}: ${s.items.length} item(s)`);
  console.log(`\n  Rendered at: /<locale>/magazine/${month}  (print-to-PDF ready)`);
}

main().catch((err) => {
  console.error("\nca:compile failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
