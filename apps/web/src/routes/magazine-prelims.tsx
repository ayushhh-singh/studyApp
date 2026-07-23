import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { MapPin, Newspaper, Star } from "lucide-react";
import type { CurrentAffairsFactKind, Locale, MagazineFactEntry, MagazineItemBlock } from "@neev/shared";
import { useMagazinePrelims } from "@/hooks/use-magazine";
import { useLocale } from "@/hooks/use-locale";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { formatQuestionStem } from "@/lib/format-question-stem";
import { MagazineToolbar } from "@/components/magazine/magazine-toolbar";
import { MagazineIndexNav, type MagazineIndexEntry } from "@/components/magazine/magazine-index-nav";

/** "Why this made the cut" — a subtle marker on items that touch heavily-asked (high-weightage) syllabus. */
function WeightageChip() {
  const { t } = useTranslation();
  return (
    <span
      title={t("Magazine.editorsPick")}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-marigold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-marigold-foreground"
    >
      <Star className="size-3" aria-hidden /> {t("Magazine.weightageChip")}
    </span>
  );
}

const FACT_KIND_ICON: Record<CurrentAffairsFactKind, string> = {
  scheme: "🏛️",
  report_index: "📊",
  place: "📍",
  org: "🏢",
  species: "🌿",
  appointment: "👤",
  day_theme: "📅",
  misc: "🔖",
};

/** A boxed feature's single fact, reshaped into the same write-up shape ItemBlock renders — every card in the Prelims Compendium reads the same way, whether it's grouped by topic or by fact kind. */
function factEntryAsItemBlock(f: MagazineFactEntry): MagazineItemBlock {
  return {
    item_id: f.item_id,
    item_title_i18n: f.item_title_i18n,
    item_date: f.item_date,
    summary_i18n: f.item_summary_i18n,
    possible_question_i18n: null,
    facts: [{ fact_i18n: f.fact_i18n, kind: f.kind, extras: f.extras }],
    weightage_pct: 0,
    editors_pick: false,
  };
}

/**
 * A full PT365-style write-up: headline + context paragraph + every one of
 * the item's facts as bullets + the likely Prelims question angle, if any.
 * Used everywhere in the Prelims Compendium — topic sections, UP Special,
 * and the boxed features (one fact each) — so the whole edition reads
 * consistently, not a mix of rich write-ups and bare one-liners.
 */
function ItemBlock({ item, locale }: { item: MagazineItemBlock; locale: Locale }) {
  const { t } = useTranslation();
  const proseLeading = locale === "hi" ? "leading-[1.9]" : "leading-relaxed";
  return (
    <article className="mag-item flex flex-col gap-2 break-inside-avoid rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold leading-snug">{item.item_title_i18n[locale]}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {item.editors_pick && <WeightageChip />}
          <span className="text-[11px] text-muted-foreground">{item.item_date}</span>
        </div>
      </div>
      {item.summary_i18n?.[locale] && (
        <p className={`text-sm text-foreground/90 ${proseLeading}`}>{item.summary_i18n[locale]}</p>
      )}
      {item.facts.length > 0 && (
        <ul className="flex flex-col gap-1.5 ps-1">
          {item.facts.map((f, i) => {
            const extras = f.extras ?? {};
            const extraLine = [extras.ministry, extras.publisher, extras.rank, extras.location].filter(Boolean).join(" · ");
            return (
              <li key={i} className="flex gap-2 text-[13px]">
                <span aria-hidden className="shrink-0">
                  {FACT_KIND_ICON[f.kind]}
                </span>
                <span className={proseLeading}>
                  {f.fact_i18n[locale]}
                  {extraLine && <span className="text-muted-foreground"> — {extraLine}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {item.possible_question_i18n?.[locale]?.trim() && (
        <div className="rounded-lg border border-primary/25 bg-primary/[0.05] px-3 py-2">
          <span className="text-[10px] font-bold text-primary uppercase">{t("CurrentAffairs.prelimsQuestion")}</span>
          <p className="text-[13px]">{item.possible_question_i18n[locale]}</p>
        </div>
      )}
    </article>
  );
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { month = "" } = useParams<{ month: string }>();
  const { data: mag, isLoading, isError, refetch } = useMagazinePrelims(month);

  const indexEntries: MagazineIndexEntry[] = mag
    ? [
        ...(mag.up_special.length > 0 ? [{ id: "up-special", label: t("Magazine.upSection") }] : []),
        ...mag.boxed_features.map((b) => ({ id: `box-${b.kind}`, label: t(`Magazine.boxedFeature.${b.kind}`) })),
        ...mag.topic_sections.map((s) => ({ id: `topic-${s.category}`, label: t(`CurrentAffairs.category.${s.category}`) })),
        ...(mag.workbook.length > 0
          ? [{ id: "workbook", label: t("Magazine.workbookAppendix", { count: mag.workbook.length }) }]
          : []),
      ]
    : [];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <style>{`@media print {
        .mag-noprint { display: none !important; }
        .mag-shell { max-width: none !important; padding: 0 !important; gap: 0 !important; }
        .mag-page { max-width: none !important; padding: 0 !important; }
        .mag-section { break-inside: avoid; }
      }`}</style>

      <MagazineToolbar backTo={`/${locale}/magazine/${month}`} canPrint={!isLoading && !isError && !!mag} />

      <div className="mag-shell mx-auto flex max-w-6xl justify-center gap-8 px-4 py-8 sm:px-6">
        {mag && indexEntries.length > 0 && <MagazineIndexNav entries={indexEntries} />}
        <main className="mag-page w-full min-w-0 max-w-3xl">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : isError ? (
          <QueryErrorState onRetry={() => refetch()} />
        ) : !mag ? (
          <EmptyState icon={Newspaper} title={t("Magazine.emptyTitle")} description={t("Magazine.emptyDescription")} />
        ) : (
          <>
            {/* cover */}
            <div className="mb-8 flex flex-col items-center gap-1 border-b-2 border-primary pb-6 text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                {t("Magazine.masthead")}
              </span>
              <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                {t("Magazine.prelimsEditionTitle")}
              </h1>
              <p className="text-lg font-semibold text-foreground/80">{mag.title_i18n[locale]}</p>
              <p className="text-sm text-muted-foreground">
                {t("Magazine.prelimsCoverStats", { items: mag.total_items, facts: mag.total_facts })}
              </p>
            </div>

            {/* UP SPECIAL — first-class lead section, full write-ups */}
            {mag.up_special.length > 0 && (
              <section id="up-special" className="mag-section mb-8">
                <h2 className="mb-3 flex items-center gap-2 border-b border-tulsi/40 pb-1.5 text-lg font-bold text-tulsi-foreground">
                  <MapPin className="size-5" /> {t("Magazine.upSection")}
                </h2>
                <div className="flex flex-col gap-3">
                  {mag.up_special.map((item) => (
                    <ItemBlock key={item.item_id} item={item} locale={locale} />
                  ))}
                </div>
              </section>
            )}

            {/* Boxed features by fact kind — Schemes of the Month, Reports & Indices, ... */}
            {mag.boxed_features.map((b) => (
              <section id={`box-${b.kind}`} key={b.kind} className="mag-section mb-8">
                <h2 className="mb-3 flex items-center gap-2 border-b border-marigold/50 pb-1.5 text-lg font-bold text-marigold-foreground">
                  <span aria-hidden>{FACT_KIND_ICON[b.kind]}</span> {t(`Magazine.boxedFeature.${b.kind}`)}
                </h2>
                <div className="flex flex-col gap-3">
                  {b.facts.map((f, i) => (
                    <ItemBlock key={`${f.item_id}-${i}`} item={factEntryAsItemBlock(f)} locale={locale} />
                  ))}
                </div>
              </section>
            ))}

            {/* Topic-wise sections (fixed taxonomy) — full write-ups, not bare fact lines */}
            {mag.topic_sections.map((s) => (
              <section id={`topic-${s.category}`} key={s.category} className="mag-section mb-8">
                <h2 className="mb-3 border-b border-border pb-1.5 text-lg font-bold">
                  {t(`CurrentAffairs.category.${s.category}`)}
                </h2>
                <div className="flex flex-col gap-3">
                  {s.items.map((item) => (
                    <ItemBlock key={item.item_id} item={item} locale={locale} />
                  ))}
                </div>
              </section>
            ))}

            {/* Workbook appendix */}
            {mag.workbook.length > 0 && (
              <section id="workbook" className="mag-section">
                <h2 className="mb-3 border-b border-primary/40 pb-1.5 text-lg font-bold text-primary">
                  {t("Magazine.workbookAppendix", { count: mag.workbook.length })}
                </h2>
                <ol className="flex flex-col gap-4">
                  {mag.workbook.map((q, i) => (
                    <li key={q.id} className="mag-item flex flex-col gap-1.5 break-inside-avoid">
                      <p className="text-sm font-medium whitespace-pre-line">
                        {i + 1}. {formatQuestionStem(q.stem_i18n[locale])}
                      </p>
                      <ul className="flex flex-col gap-0.5 ps-3 text-[13px]">
                        {q.options_i18n.map((o) => (
                          <li
                            key={o.key}
                            className={o.key === q.correct_option_key ? "font-semibold text-tulsi-foreground" : ""}
                          >
                            ({o.key}) {o.text_i18n[locale]}
                            {o.key === q.correct_option_key ? " ✓" : ""}
                          </li>
                        ))}
                      </ul>
                      {q.explanation_i18n && (
                        <p className="text-[13px] italic text-muted-foreground">{q.explanation_i18n[locale]}</p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <footer className="mt-10 border-t border-border pt-4 text-center text-xs text-muted-foreground">
              {t("Magazine.footer")}
            </footer>
          </>
        )}
        </main>
      </div>
    </div>
  );
}
