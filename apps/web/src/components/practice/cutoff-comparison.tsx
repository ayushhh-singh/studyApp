import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle } from "lucide-react";
import type { AttemptResultDetail, ExamCutoff, PaperMinimum } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { usePaperCatalog } from "@/hooks/use-paper-catalog";
import { useCutoffs } from "@/hooks/use-mocks";
import { isAwaitingData } from "@/lib/query-state";
import { cn } from "@/lib/utils";

/**
 * How a mock score stacks up against the exam's own pass marks.
 *
 * EVERY number here now comes from the exam registry (`exams.paper_structure`,
 * verified against commission notification PDFs in migration 0106) or from
 * `exam_cutoffs` — none is a literal. The previous version hardcoded the paper
 * codes `PRE_GS1`/`PRE_CSAT`, a 33% qualifying threshold, and a /200 scale in
 * three places, all three of which are provably wrong for another exam: MPPSC's
 * prelims papers are out of 300 with a 40%/30% floor that varies BY CATEGORY,
 * and UPSC's Paper-A/B are 25% *evaluation* gates, not qualifying gates.
 *
 * The registry's `minimum.role` is what makes that expressible, so it is
 * honoured rather than flattened into "qualifying":
 *   - `stage_gate`      — clear it to reach the next stage, marks never count.
 *   - `evaluation_gate` — miss it and your OTHER papers are never evaluated.
 *   - `merit_floor`     — the marks DO count, but there is also a minimum.
 * A `minimum` with `pct: null` and no per-category map means the threshold
 * provably exists but the Commission does not publish its value (UPPSC's General
 * Hindi) — that says so plainly instead of inventing a number.
 *
 * If the exam's registry row has no entry for this paper — every non-UPPSC exam
 * today, whose papers carry `paper_code: null` because no syllabus is ingested —
 * the mark scale is unknown, so the score equivalence is simply omitted. Nothing
 * is borrowed from UPPSC.
 */
export function CutoffComparison({ result }: { result: AttemptResultDetail }) {
  const { t } = useTranslation();
  const paperCode = result.test?.paper_code ?? null;
  const { byCode, label, isLoading: catalogLoading, isError: catalogError } = usePaperCatalog();
  const paper = paperCode ? (byCode.get(paperCode) ?? null) : null;
  const cutoffsQuery = useCutoffs(paperCode);
  const cutoffs = cutoffsQuery.data;
  const scorePct = result.score_pct ?? 0;
  const paperName = label(paperCode);

  // The paper's own mark scale. `null` when the registry doesn't know this paper
  // — never defaulted, since a wrong scale silently produces a wrong "your mark".
  const outOf = paper?.marks ?? null;
  // Negative marking can push a raw score below 0; clamp the displayed equivalent.
  const yourMark = outOf === null ? null : Math.max(0, Math.round((scorePct / 100) * outOf));

  const minimum = paper?.minimum ?? null;
  // Memoised so the category list below doesn't recompute on every render (a
  // fresh `[]` literal would change identity each time).
  const rowsAll = useMemo(() => cutoffs ?? [], [cutoffs]);

  // The API returns every category's cut-offs; the old code filtered to
  // "general" and silently dropped the rest — which for an exam that publishes
  // no general row at all rendered an empty list with no explanation. The
  // categories present in the data drive the selector, defaulting to general so
  // the first render is exactly the list shown before.
  const categories = useMemo(
    () =>
      [...new Set(rowsAll.map((c) => c.category))].sort((a, b) =>
        a === "general" ? -1 : b === "general" ? 1 : a.localeCompare(b),
      ),
    [rowsAll],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const category = picked && categories.includes(picked) ? picked : (categories[0] ?? null);
  const rows = rowsAll.filter((c) => c.category === category).sort((a, b) => b.year - a.year);

  // Prefer the paper's own scale; fall back to the cut-off rows' own `out_of`
  // when the registry doesn't know this paper.
  const scale = outOf ?? rows[0]?.out_of ?? null;
  const yourEquivalent = yourMark ?? (scale === null ? null : Math.max(0, Math.round((scorePct / 100) * scale)));

  // NOTHING TO SHOW — but "nothing" has three very different causes, and the
  // first two must not look like the third.
  //
  // CSAT is the case that made this matter: `exam_cutoffs` has zero PRE_CSAT
  // rows, so its whole card hangs on the registry's `minimum`. Rendering
  // `null` while `GET /exams` was still in flight (or had failed) made the
  // card silently vanish with no error and no fallback — while GS-I looked
  // fine, because it falls back to `rows[0].out_of`. See lib/query-state.ts.
  //
  // The cut-offs query is only "awaiting" when it has a paper to ask about;
  // with `paperCode` null it is disabled on purpose and stays pending forever.
  const awaiting = catalogLoading || (!!paperCode && isAwaitingData(cutoffsQuery));
  if (!minimum && rowsAll.length === 0) {
    if (awaiting) {
      return (
        <SectionCard title={t("Practice.cutoffTitle")}>
          <Skeleton className="h-16 w-full" />
        </SectionCard>
      );
    }
    // Genuinely failed to load — say so rather than disappear. (No paper code
    // means this attempt has no pass-mark concept at all: still `null`.)
    if (catalogError && paperCode) {
      return (
        <SectionCard title={t("Practice.cutoffTitle")}>
          <p className="text-sm text-muted-foreground">{t("Practice.cutoffUnavailable")}</p>
        </SectionCard>
      );
    }
    return null;
  }

  const description =
    rows.length === 0 || yourEquivalent === null || scale === null
      ? undefined
      : category === "general"
        ? t("Practice.cutoffDescription", { your: yourEquivalent, outOf: scale })
        : t("Practice.cutoffDescriptionCategory", {
            your: yourEquivalent,
            outOf: scale,
            category: (category ?? "").toUpperCase(),
          });

  return (
    <SectionCard title={t("Practice.cutoffTitle")} description={description}>
      <div className="flex flex-col gap-4">
        {minimum && (
          <MinimumCard
            minimum={minimum}
            paperName={paperName}
            outOf={outOf}
            scorePct={scorePct}
            yourMark={yourMark}
          />
        )}
        {rows.length > 0 && (
          <CutoffYears
            rows={rows}
            categories={categories}
            category={category}
            onPickCategory={setPicked}
            scorePct={scorePct}
          />
        )}
      </div>
    </SectionCard>
  );
}

/** Copy set for each `minimum.role` — the distinction a boolean can't carry. */
const ROLE_COPY: Record<PaperMinimum["role"], { cleared: string; missed: string; hint: string }> = {
  stage_gate: {
    cleared: "Practice.cutoffQualified",
    missed: "Practice.cutoffNotQualified",
    hint: "Practice.cutoffGateHint",
  },
  evaluation_gate: {
    cleared: "Practice.cutoffEvalGateCleared",
    missed: "Practice.cutoffEvalGateMissed",
    hint: "Practice.cutoffEvalGateHint",
  },
  merit_floor: {
    cleared: "Practice.cutoffMinimumCleared",
    missed: "Practice.cutoffMinimumMissed",
    hint: "Practice.cutoffMeritFloorHint",
  },
};

function MinimumCard({
  minimum,
  paperName,
  outOf,
  scorePct,
  yourMark,
}: {
  minimum: PaperMinimum;
  paperName: string;
  outOf: number | null;
  scorePct: number;
  yourMark: number | null;
}) {
  const { t } = useTranslation();
  const copy = ROLE_COPY[minimum.role];
  const byCategory = Object.entries(minimum.pct_by_category ?? {});

  // Category-specific thresholds: we do not know (and never ask for) the user's
  // category, so claiming a single pass/fail would be a guess. Every category's
  // own line is shown with its own verdict instead.
  if (minimum.pct === null && byCategory.length > 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <span className="text-sm font-medium">{t("Practice.cutoffByCategoryTitle")}</span>
        {yourMark !== null && outOf !== null && (
          <span className="text-xs text-muted-foreground">
            {t("Practice.cutoffYourScore", { your: yourMark, outOf })}
          </span>
        )}
        <ul className="flex flex-col gap-1.5">
          {byCategory
            .sort((a, b) => b[1] - a[1])
            .map(([category, pct]) => {
              const cleared = scorePct >= pct;
              return (
                <li key={category} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Verdict ok={cleared} small />
                    <span className="font-medium uppercase">{category}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {t("Practice.cutoffByCategoryRow", {
                      pct,
                      mark: outOf === null ? "—" : Math.round((pct / 100) * outOf),
                      outOf: outOf ?? "—",
                    })}
                  </span>
                </li>
              );
            })}
        </ul>
      </div>
    );
  }

  // "A minimum exists, but its value is not officially published." Stated, never
  // guessed — and with no pass/fail verdict, because none can be computed.
  if (minimum.pct === null) {
    return (
      <div className="rounded-lg border border-border p-3">
        <span className="text-sm text-muted-foreground">
          {t("Practice.cutoffMinimumUnknown", { paper: paperName })}
        </span>
      </div>
    );
  }

  const pct = minimum.pct;
  const cleared = scorePct >= pct;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <Verdict ok={cleared} />
      <div className="flex flex-col">
        <span className="text-sm font-medium">{t(cleared ? copy.cleared : copy.missed, { paper: paperName })}</span>
        {outOf !== null && yourMark !== null && (
          <span className="text-xs text-muted-foreground">
            {t(copy.hint, { paper: paperName, pct, mark: Math.round((pct / 100) * outOf), outOf, your: yourMark })}
          </span>
        )}
      </div>
    </div>
  );
}

function CutoffYears({
  rows,
  categories,
  category,
  onPickCategory,
  scorePct,
}: {
  rows: ExamCutoff[];
  categories: string[];
  category: string | null;
  onPickCategory: (category: string) => void;
  scorePct: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      {categories.length > 1 && (
        <div
          role="group"
          aria-label={t("Practice.cutoffCategory")}
          className="flex flex-wrap items-center gap-1 self-start rounded-lg border border-border p-0.5"
        >
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={c === category}
              onClick={() => onPickCategory(c)}
              className={cn(
                "min-h-8 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                c === category ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c === "general" ? t("Practice.cutoffCategoryGeneral") : c.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((c) => (
          <li
            key={`${c.year}-${c.category}`}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <Verdict ok={scorePct >= (c.cutoff / c.out_of) * 100} small />
              <span className="text-sm font-medium">
                {c.year}
                {!c.is_official && (
                  <span className="ml-1 text-[10px] font-semibold uppercase text-marigold-foreground">
                    {t("Practice.cutoffProvisional")}
                  </span>
                )}
              </span>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {t("Practice.cutoffRow", { cutoff: c.cutoff, out_of: c.out_of })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Verdict({ ok, small }: { ok: boolean; small?: boolean }) {
  const cls = small ? "size-4" : "size-5";
  return ok ? (
    <CheckCircle2 className={cn(cls, "shrink-0 text-tulsi")} aria-hidden />
  ) : (
    <XCircle className={cn(cls, "shrink-0 text-coral")} aria-hidden />
  );
}
