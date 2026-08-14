/**
 * A published test-series calendar, as DATA.
 *
 * docs/test-series-design.md §13.5: "A calendar is therefore a data file, not
 * code — one JSON per series, validated and loaded the way
 * ingest/seed/upsc-syllabus-seed.ts loads the syllabus. That keeps a calendar
 * change (a slipped exam date, a re-ordered sectional) out of a deploy."
 *
 * So the shapes below are a zod schema over a JSON file in `./calendars`, not a
 * TypeScript literal. A malformed calendar fails loudly at load with a path into
 * the offending entry, rather than half-building a series.
 *
 * ⚑ NODE TARGETS ARE `syllabus_nodes.path` PREFIXES, NOT TITLES. Paths are
 * stable slugs (`polity`, `polity/constitution`) that the ingest pipeline owns;
 * titles are bilingual display copy that a reviewer may reword at any time. A
 * calendar keyed on titles would silently retarget — or silently match nothing —
 * the first time someone tidies a heading.
 *
 * ⚑ AND THE TWO EXAMS' TREES ARE NOT THE SAME SHAPE, which is why there is one
 * calendar file per exam rather than one template with an exam parameter.
 * Measured on the live tree: UPPSC splits `economic-social-development/poverty-
 * inclusion` where UPSC has separate `poverty` and `inclusion`; UPPSC has
 * `general-science/science-technology` and UPSC has none; UPPSC's CSAT carries
 * `english-comprehension` and `basic-numeracy` where UPSC has neither, calling
 * its numeracy node `numeracy-data-interpretation`. A shared template would
 * quietly resolve to an empty pool on whichever exam it was not written for.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Bilingual copy. Both languages required — the same publish gate as everywhere else. */
const i18nSchema = z.object({ en: z.string().min(1), hi: z.string().min(1) });

/**
 * The §6.2 mix, as percentages of the paper.
 *
 * Percentages rather than counts so one entry shape works for a 50-question
 * sectional and a 150-question full-length. They are a TARGET, not a promise:
 * `buildSeries` backfills a slice that its pool cannot fill and records what it
 * actually achieved — see that module's header for why, and what today's real
 * supply does to the qgen share.
 */
const compositionSchema = z
  .object({
    pyq: z.number().int().min(0).max(100),
    ca: z.number().int().min(0).max(100),
    qgen: z.number().int().min(0).max(100),
  })
  .refine((c) => c.pyq + c.ca + c.qgen === 100, {
    message: "composition must sum to exactly 100",
  });

export const seriesEntrySchema = z.object({
  sequence_no: z.number().int().positive(),
  entry_kind: z.enum(["fundamental", "applied", "sectional", "full_length", "current_affairs", "state_special"]),
  /** The paper this entry's questions come from. `CURRENT_AFFAIRS` for a pure CA paper. */
  paper_code: z.string().min(1),
  /** IST calendar date the test opens (time of day comes from the series' `opens_time_ist`). */
  opens_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "opens_on must be YYYY-MM-DD"),
  /**
   * Days the window stays open. Both `closes_at` and `ranked_until` are derived
   * from it, which is what makes "postpone yes, prepone no" a data property:
   * lengthen this and a student gets longer, no code changes.
   */
  open_days: z.number().int().positive(),
  question_count: z.number().int().positive(),
  duration_minutes: z.number().int().positive(),
  composition: compositionSchema,
  /**
   * `syllabus_nodes.path` prefixes. Empty = the whole paper (a full-length).
   * A prefix matches itself and its descendants, so `polity` is the whole
   * section and `polity/constitution` is one depth-2 subtree.
   */
  node_targets: z.array(z.string().min(1)).default([]),
  syllabus_note_i18n: i18nSchema,
  sources_i18n: i18nSchema,
  /** [start, end] inclusive IST dates bounding the CA slice. Omit for no bound. */
  ca_window: z.tuple([z.string(), z.string()]).optional(),
});

export type SeriesEntrySpec = z.infer<typeof seriesEntrySchema>;

export const seriesCalendarSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, "slug must be lowercase kebab-case"),
    exam_code: z.string().min(1),
    stage: z.enum(["prelims", "mains"]),
    /** Null = the whole stage. Set for a GS-only or CSAT-only product (§5.1). */
    paper_scope: z.string().nullable().default(null),
    title_i18n: i18nSchema,
    description_i18n: i18nSchema,
    target_exam_year: z.number().int().positive(),
    /** "HH:MM" IST. Whole hours, because institutes advertise whole hours (§7.2). */
    opens_time_ist: z.string().regex(/^\d{2}:\d{2}$/),
    entries: z.array(seriesEntrySchema).min(1),
  })
  .superRefine((cal, ctx) => {
    // A duplicate or gapped sequence would make the DB's unique(series_id,
    // sequence_no) reject the build halfway through, after some tests were
    // already written. Catch it before anything is persisted.
    const seen = new Set<number>();
    for (const e of cal.entries) {
      if (seen.has(e.sequence_no)) {
        ctx.addIssue({ code: "custom", message: `duplicate sequence_no ${e.sequence_no}` });
      }
      seen.add(e.sequence_no);
    }
    const sorted = [...cal.entries].sort((a, b) => a.sequence_no - b.sequence_no);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].sequence_no !== i + 1) {
        ctx.addIssue({ code: "custom", message: `sequence_no must run 1..N with no gaps; found ${sorted[i].sequence_no} at position ${i + 1}` });
        break;
      }
    }
    // Dates must run forward. A calendar that goes backwards is a typo, and it
    // would publish a "next test" that already opened.
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].opens_on < sorted[i - 1].opens_on) {
        ctx.addIssue({
          code: "custom",
          message: `entry ${sorted[i].sequence_no} opens ${sorted[i].opens_on}, before entry ${sorted[i - 1].sequence_no}'s ${sorted[i - 1].opens_on}`,
        });
      }
    }
  });

export type SeriesCalendar = z.infer<typeof seriesCalendarSchema>;

/**
 * Resolved from `import.meta.dirname`, never `process.cwd()` — a CLI must behave
 * the same run from the repo root, from inside apps/api, in CI, or in the API
 * Docker image (CLAUDE.md's portable-paths rule).
 */
const CALENDAR_DIR = path.join(import.meta.dirname, "calendars");

export function listCalendarSlugs(): string[] {
  return readdirSync(CALENDAR_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadCalendar(slug: string): SeriesCalendar {
  const file = path.join(CALENDAR_DIR, `${slug}.json`);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`no calendar file for slug "${slug}" — available: ${listCalendarSlugs().join(", ") || "(none)"}`);
  }
  const parsed = seriesCalendarSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`calendar ${slug}.json is invalid:\n${issues}`);
  }
  if (parsed.data.slug !== slug) {
    throw new Error(`calendar ${slug}.json declares slug "${parsed.data.slug}" — the filename and the slug must match`);
  }
  return parsed.data;
}

/**
 * IST wall-clock date+time -> UTC instant.
 *
 * IST is UTC+05:30 with no daylight saving, so the offset is a constant and this
 * needs no timezone library. Written as an explicit offset string rather than
 * via `Date` arithmetic so the intent is readable and cannot drift with the
 * machine's own zone — the same reasoning `lib/ist.ts` uses.
 */
export function istToUtc(dateIso: string, timeHHMM: string): Date {
  return new Date(`${dateIso}T${timeHHMM}:00+05:30`);
}

/** The end of the `open_days`-th day, 23:59 IST — the market's 7-day validity window (§13). */
export function windowClose(opensOn: string, openDays: number): Date {
  const start = new Date(`${opensOn}T00:00:00+05:30`);
  const end = new Date(start.getTime() + (openDays - 1) * 24 * 60 * 60 * 1000);
  const y = end.getUTCFullYear();
  // Re-render in IST to get the right calendar day before stamping 23:59.
  const istDay = new Date(end.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  void y;
  return new Date(`${istDay}T23:59:00+05:30`);
}
