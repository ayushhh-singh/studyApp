import { useTranslation } from "react-i18next";
import type { Exam, ExamPaper, ExamStageBlock } from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";

/**
 * An exam's full paper pattern, read from the LIVE registry rather than written
 * into prose — `docs/content-strategy.md` §5's rule ("don't hand-write a
 * number that drifts stale") applied to the highest-value fact on a hub page.
 *
 * The registry (`exams.paper_structure`, seeded by migration `0106`) was built
 * from each commission's own notification PDF, and it is the reason this table
 * can be trusted where the aggregators' equivalents cannot. Three things it
 * gets right that templated competitor tables routinely get wrong, all of them
 * called out in the schema's own comments and all rendered honestly here:
 *
 *  - `question_count: null` means NOT OFFICIALLY NOTIFIED, not "unknown to us".
 *    UPSC fixes its prelims papers' marks and duration and never their question
 *    count. We say so instead of quietly printing the number everyone repeats
 *    from past papers.
 *  - `negative_marking.fraction` is a fraction OF THAT QUESTION'S MARKS. UPPSC
 *    Prelims deducts ~0.44 in Paper I and ~0.67 in Paper II from the one and
 *    same "one-third" rule, because the papers carry different marks per
 *    question. Printing one absolute deduction gets one of the two wrong.
 *  - `unverified_notes` is rendered, always. The schema's instruction is
 *    "never leave a contested number here undisclosed", and a page whose entire
 *    pitch is accuracy cannot be the place that starts.
 *
 * ⚑ NOT VISIBLE TO A CRAWLER, deliberately and unavoidably. This fetches, and
 * `scripts/prerender.mjs` serves `dist/` off a static server with no API behind
 * it — so the build-time snapshot carries this section's loading state, not its
 * data. That is a stronger constraint than §5 stated (it framed the risk as
 * staleness; for fetched data it is total absence). The hub's crawlable
 * substance therefore lives in its static prose, and this table is here for
 * real readers, who are the ones who need it accurate.
 */
export function ExamPatternTable({ exam }: { exam: Exam }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const structure = exam.paper_structure;

  return (
    <div className="space-y-6">
      {structure.stages.map((stage) => (
        <StageBlock key={stage.stage} stage={stage} locale={locale} />
      ))}

      <footer className="space-y-2 rounded-xl border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        {structure.effective_from_year !== null && (
          <p>{t("Articles.hub.patternEffectiveFrom", { year: structure.effective_from_year })}</p>
        )}
        {/* §5.2 — a data-bound page states its own source ON the page, so a
            stale prerendered snapshot reads as honestly dated rather than
            wrong. Same rule the app already applies to provisional keys. */}
        {structure.sources.length > 0 && (
          <p>
            {t("Articles.hub.patternSource")}{" "}
            {structure.sources.map((src, i) => (
              <span key={src}>
                {i > 0 && ", "}
                {/^https?:\/\//.test(src) ? (
                  <a className="underline hover:text-foreground" href={src} target="_blank" rel="noreferrer">
                    {src}
                  </a>
                ) : (
                  src
                )}
              </span>
            ))}
          </p>
        )}
        {structure.unverified_notes.length > 0 && (
          <div className="text-marigold-foreground">
            <p className="font-semibold">{t("Articles.hub.patternUnverified")}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {structure.unverified_notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
      </footer>
    </div>
  );
}

function StageBlock({ stage, locale }: { stage: ExamStageBlock; locale: "en" | "hi" }) {
  const { t } = useTranslation();

  return (
    <section>
      <h3 className="text-sm font-bold tracking-tight">{t(`Articles.hub.stage_${stage.stage}`)}</h3>
      {/* A real <table> is the wrong shape at 390px — this app has shipped that
          bug before. Stacked cards with an inline stat grid carry the same
          information and cannot overflow. */}
      <div className="mt-3 space-y-2.5">
        {stage.papers.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            {stage.marks !== null
              ? t("Articles.hub.stageMarksOnly", { marks: stage.marks })
              : t("Articles.hub.stageNoPapers")}
          </p>
        ) : (
          stage.papers.map((paper) => <PaperRow key={`${paper.order}-${paper.name_i18n.en}`} paper={paper} locale={locale} />)
        )}
      </div>
    </section>
  );
}

function PaperRow({ paper, locale }: { paper: ExamPaper; locale: "en" | "hi" }) {
  const { t } = useTranslation();

  /**
   * ⚑ A PAPER THAT DOES NOT COUNT FOR MERIT IS NOT NECESSARILY "QUALIFYING",
   * and the old badge said it was. It keyed off `!counts_for_merit` alone, so
   * UPSC's Prelims General Studies paper — the SCREENING paper, whose score is
   * exactly what decides who advances, and the most competitive thing at that
   * stage — was labelled "Qualifying only". That is the precise misconception
   * the exam-structure article sets out to correct, sitting two sections above
   * the table contradicting it.
   *
   * The registry already distinguishes them: a screening paper carries no
   * `minimum`, a qualifying one carries a `minimum.role`. Read that instead.
   */
  const badge = !paper.counts_for_merit
    ? paper.minimum
      ? t("Articles.hub.qualifyingOnly")
      : t("Articles.hub.screeningOnly")
    : null;

  const stats: { label: string; value: string }[] = [
    { label: t("Articles.hub.colMarks"), value: String(paper.marks) },
    {
      label: t("Articles.hub.colDuration"),
      value:
        paper.duration_minutes === null
          ? t("Articles.hub.notNotified")
          : t("Articles.hub.minutes", { value: paper.duration_minutes }),
    },
    {
      label: t("Articles.hub.colQuestions"),
      // null is NOT zero and NOT unknown-to-us — see this file's header.
      value: paper.question_count === null ? t("Articles.hub.notNotified") : String(paper.question_count),
    },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {paper.official_label && (
          <span className="text-xs font-semibold text-muted-foreground">{paper.official_label}</span>
        )}
        <h4 className="text-sm font-semibold">{paper.name_i18n[locale]}</h4>
        {badge && (
          <span className="rounded-full border border-marigold-foreground/25 px-2 py-0.5 text-[11px] font-semibold text-marigold-foreground">
            {badge}
          </span>
        )}
      </div>

      {/* ⚑ THE THRESHOLD, AND WHAT FAILING IT COSTS. `minimum.role` is the field
          migration 0106 added precisely because "qualifying" describes three
          arrangements that behave completely differently, and every competitor
          table flattens them to one word. Rendering the role rather than the
          bare percentage is the whole value: a stage gate ends this attempt, an
          evaluation gate means your OTHER papers are never even marked, and a
          merit floor is different again. This block was missing entirely — the
          seeded thresholds were invisible on both hub pages. */}
      {paper.minimum && (
        <p className="mt-2 text-xs leading-relaxed text-marigold-foreground">
          {/* ⚑ `pct` IS NULLABLE AND BEING NULL IS NORMAL, not an error — every
              MPPSC paper carries its thresholds in `pct_by_category` instead,
              and UPPSC's General Hindi records a merit floor whose percentage
              is not in the notification at all. Interpolating it unguarded
              rendered the literal sentence "Must score at least % ..." on the
              live UPPSC hub. Say the role without a number instead. */}
          {paper.minimum.pct !== null
            ? t(`Articles.hub.minimumRole_${paper.minimum.role}`, { pct: paper.minimum.pct })
            : t(`Articles.hub.minimumRoleNoPct_${paper.minimum.role}`)}
        </p>
      )}
      {/* Per-category thresholds where a commission sets them (MPPSC's 40/30).
          A single number would be wrong for most candidates reading it. */}
      {paper.minimum?.pct_by_category && (
        <p className="mt-1 text-xs text-muted-foreground">
          {Object.entries(paper.minimum.pct_by_category)
            .map(([cat, pct]) => `${cat}: ${pct}%`)
            .join(" · ")}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      {paper.negative_marking && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {/* Expressed as a fraction of THIS paper's marks-per-question, which
              is the only formulation that is right for both UPPSC prelims
              papers at once. */}
          {t("Articles.hub.negativeMarking", {
            fraction: formatFraction(paper.negative_marking.fraction),
            perQuestion:
              paper.marks_per_question !== null
                ? t("Articles.hub.negativeMarkingAbsolute", {
                    value: round2(paper.negative_marking.fraction * paper.marks_per_question),
                  })
                : "",
          })}
        </p>
      )}
    </div>
  );
}

/** 0.3333… -> "1/3" for the handful of fractions a commission actually uses; otherwise a percentage. */
function formatFraction(fraction: number): string {
  for (const denominator of [3, 4, 2]) {
    if (Math.abs(fraction - 1 / denominator) < 0.005) return `1/${denominator}`;
  }
  return `${round2(fraction * 100)}%`;
}

/** Guards against IEEE-754 noise reaching the page — this repo has shipped "40.61999999999999" before. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
