import type {
  CurrentAffairsItem,
  Magazine,
  MagazineMcq,
  MagazineMonthSummary,
  MagazineSection,
  CurrentAffairsCategory,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

const CA_COLUMNS =
  "id, date, category, is_up_specific, title_i18n, summary_i18n, detail_i18n, source_urls, syllabus_node_ids, mcq_question_ids";

/** Stable category display order for the magazine's non-UP sections. */
const CATEGORY_ORDER: CurrentAffairsCategory[] = [
  "polity_governance",
  "economy",
  "schemes_welfare",
  "environment_ecology",
  "science_tech",
  "national",
  "international",
  "awards_sports_misc",
  "up_state_affairs",
];

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_HI = [
  "जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून",
  "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर",
];

function monthLabel(month: string): { hi: string; en: string } {
  const [y, m] = month.split("-").map(Number);
  const idx = Math.max(0, Math.min(11, (m || 1) - 1));
  return { en: `${MONTHS_EN[idx]} ${y}`, hi: `${MONTHS_HI[idx]} ${y}` };
}

/** First day of `month` and first day of the following month, as YYYY-MM-DD. */
function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { start, end };
}

/** GET /magazine — months that have any published CA, newest first. */
export async function listMagazineMonths(): Promise<MagazineMonthSummary[]> {
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select("date")
    .eq("is_published", true);
  if (error) throw new HttpError(500, `magazine months query failed: ${error.message}`);
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { date: string }[]) {
    const month = (r.date ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, item_count]) => ({ month, title_i18n: monthLabel(month), item_count }));
}

/** GET /magazine/:month — the compiled monthly document, or null if the month is empty. */
export async function compileMagazine(month: string): Promise<Magazine | null> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select(CA_COLUMNS)
    .eq("is_published", true)
    .gte("date", start)
    .lt("date", end)
    .order("date", { ascending: false });
  if (error) throw new HttpError(500, `magazine query failed: ${error.message}`);

  const items = (data ?? []) as unknown as CurrentAffairsItem[];
  if (items.length === 0) return null;

  const upSection = items.filter((i) => i.is_up_specific);
  const rest = items.filter((i) => !i.is_up_specific);

  const byCategory = new Map<CurrentAffairsCategory, CurrentAffairsItem[]>();
  for (const item of rest) {
    const cat = (item.category ?? "national") as CurrentAffairsCategory;
    const arr = byCategory.get(cat) ?? [];
    arr.push(item);
    byCategory.set(cat, arr);
  }
  const sections: MagazineSection[] = CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    items: byCategory.get(category) ?? [],
  }));

  // Quiz appendix — the month's linked (CA-generated, unpublished) MCQs.
  const mcqIds = [...new Set(items.flatMap((i) => i.mcq_question_ids ?? []))];
  const mcqAppendix = await loadMcqs(mcqIds);

  return {
    month,
    title_i18n: monthLabel(month),
    total_items: items.length,
    up_item_count: upSection.length,
    up_section: upSection,
    sections,
    mcq_appendix: mcqAppendix,
  };
}

async function loadMcqs(ids: string[]): Promise<MagazineMcq[]> {
  if (ids.length === 0) return [];
  // CA MCQs are permanently is_published=false, so fetch by id without a publish filter.
  const { data, error } = await supabase()
    .from("questions")
    .select("id, stem_i18n, options_i18n, correct_option_key, explanation_i18n")
    .in("id", ids)
    .eq("type", "mcq");
  if (error) throw new HttpError(500, `magazine mcq query failed: ${error.message}`);
  return ((data ?? []) as unknown as MagazineMcq[]).map((q) => ({
    id: q.id,
    stem_i18n: q.stem_i18n,
    options_i18n: q.options_i18n ?? [],
    correct_option_key: q.correct_option_key ?? null,
    explanation_i18n: q.explanation_i18n ?? null,
  }));
}
