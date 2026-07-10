/**
 * `pnpm ca:compile --month YYYY-MM` — assemble a month's PUBLISHED current
 * affairs into both magazine editions (Prelims Compendium + Mains Analysis)
 * and print a summary.
 *
 * Both editions are computed on demand (no table, except the reviewed Deep
 * Dives) by services/magazine.ts and served at GET /magazine/:month/{prelims,
 * mains} → rendered at the print-styled routes /:locale/magazine/:month/
 * {prelims,mains}. This CLI is a smoke-test / ops entry point; with no
 * --month it lists every compilable month.
 */
import { compileMainsEdition, compilePrelimsEdition, listMagazineMonths } from "../services/magazine.js";

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
    for (const m of months) {
      console.log(
        `  ${m.month}  ${m.title_i18n.en}  (${m.prelims_item_count} prelims, ${m.mains_item_count} mains, ${m.deep_dive_count} deep dives)`,
      );
    }
    console.log("\nRun: pnpm ca:compile --month <YYYY-MM>");
    return;
  }

  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("--month must be YYYY-MM");

  const [prelims, mains] = await Promise.all([compilePrelimsEdition(month), compileMainsEdition(month)]);

  if (!prelims) {
    console.log(`No prelims-life published current affairs for ${month}.`);
  } else {
    console.log(`\n📰  Prelims Compendium — ${prelims.title_i18n.en} / ${prelims.title_i18n.hi}`);
    console.log(`    ${prelims.total_items} items · ${prelims.total_facts} facts · ${prelims.workbook.length} workbook MCQs`);
    console.log(`    UP Special (lead section): ${prelims.up_special.length} write-up(s)`);
    for (const s of prelims.topic_sections) console.log(`    topic ${s.category}: ${s.items.length} write-up(s)`);
    for (const b of prelims.boxed_features) console.log(`    boxed ${b.kind}: ${b.facts.length} fact(s)`);
    console.log(`    Rendered at: /<locale>/magazine/${month}/prelims  (print-to-PDF ready)`);
  }

  if (!mains) {
    console.log(`\nNo mains-life published current affairs for ${month}.`);
  } else {
    console.log(`\n📰  Mains Analysis — ${mains.title_i18n.en} / ${mains.title_i18n.hi}`);
    console.log(
      `    ${mains.total_issues} issues · ${mains.deep_dives.length} published deep dives · ${mains.model_questions.length} model questions`,
    );
    for (const s of mains.gs_sections) console.log(`    ${s.paper}: ${s.items.length} issue brief(s)`);
    console.log(`    Rendered at: /<locale>/magazine/${month}/mains  (print-to-PDF ready)`);
    console.log(`\n    Deep dives: run \`pnpm ca:deepdive --month ${month} --run\` then approve in the admin Review Queue's Magazine tab.`);
  }
}

main().catch((err) => {
  console.error("\nca:compile failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
