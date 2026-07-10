import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { MapPin, Newspaper } from "lucide-react";
import type { CurrentAffairsFactKind, Locale, MagazineFactEntry } from "@prayasup/shared";
import { useMagazinePrelims } from "@/hooks/use-magazine";
import { useLocale } from "@/hooks/use-locale";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { formatQuestionStem } from "@/lib/format-question-stem";
import { MagazineToolbar } from "@/components/magazine/magazine-toolbar";

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

function FactRow({ fact, locale, showItemTitle }: { fact: MagazineFactEntry; locale: Locale; showItemTitle: boolean }) {
  const extras = fact.extras ?? {};
  const extraLine = [extras.ministry, extras.publisher, extras.rank, extras.location].filter(Boolean).join(" · ");
  return (
    <li className="mag-item flex flex-col gap-0.5 break-inside-avoid rounded-lg border border-marigold/25 bg-marigold/[0.05] px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className={locale === "hi" ? "text-sm leading-[1.9]" : "text-sm leading-relaxed"}>
          {fact.fact_i18n[locale]}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{fact.item_date}</span>
      </div>
      {extraLine && <span className="text-[11px] text-muted-foreground">{extraLine}</span>}
      {showItemTitle && <span className="text-[11px] italic text-muted-foreground">{fact.item_title_i18n[locale]}</span>}
    </li>
  );
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { month = "" } = useParams<{ month: string }>();
  const { data: mag, isLoading, isError, refetch } = useMagazinePrelims(month);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <style>{`@media print {
        .mag-noprint { display: none !important; }
        .mag-page { max-width: none !important; padding: 0 !important; }
        .mag-section { break-inside: avoid; }
      }`}</style>

      <MagazineToolbar backTo={`/${locale}/magazine/${month}`} canPrint={!isLoading && !isError && !!mag} />

      <main className="mag-page mx-auto max-w-3xl px-4 py-8 sm:px-6">
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

            {/* index / TOC */}
            <nav className="mag-noprint mb-8 rounded-xl border border-border bg-card p-4">
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t("Magazine.indexToc")}
              </h2>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                {mag.up_special.length > 0 && (
                  <li>
                    <a href="#up-special" className="text-tulsi-foreground hover:underline">
                      {t("Magazine.upSection")}
                    </a>
                  </li>
                )}
                {mag.boxed_features.map((b) => (
                  <li key={b.kind}>
                    <a href={`#box-${b.kind}`} className="text-marigold-foreground hover:underline">
                      {t(`Magazine.boxedFeature.${b.kind}`)}
                    </a>
                  </li>
                ))}
                {mag.topic_sections.map((s) => (
                  <li key={s.category}>
                    <a href={`#topic-${s.category}`} className="text-primary hover:underline">
                      {t(`CurrentAffairs.category.${s.category}`)}
                    </a>
                  </li>
                ))}
                {mag.workbook.length > 0 && (
                  <li>
                    <a href="#workbook" className="text-foreground hover:underline">
                      {t("Magazine.workbookAppendix", { count: mag.workbook.length })}
                    </a>
                  </li>
                )}
              </ul>
            </nav>

            {/* UP SPECIAL — first-class lead section */}
            {mag.up_special.length > 0 && (
              <section id="up-special" className="mag-section mb-8">
                <h2 className="mb-3 flex items-center gap-2 border-b border-tulsi/40 pb-1.5 text-lg font-bold text-tulsi-foreground">
                  <MapPin className="size-5" /> {t("Magazine.upSection")}
                </h2>
                <ul className="flex flex-col gap-2">
                  {mag.up_special.map((f, i) => (
                    <FactRow key={i} fact={f} locale={locale} showItemTitle />
                  ))}
                </ul>
              </section>
            )}

            {/* Boxed features by fact kind — Schemes of the Month, Reports & Indices, ... */}
            {mag.boxed_features.map((b) => (
              <section id={`box-${b.kind}`} key={b.kind} className="mag-section mb-8">
                <h2 className="mb-3 flex items-center gap-2 border-b border-marigold/50 pb-1.5 text-lg font-bold text-marigold-foreground">
                  <span aria-hidden>{FACT_KIND_ICON[b.kind]}</span> {t(`Magazine.boxedFeature.${b.kind}`)}
                </h2>
                <ul className="flex flex-col gap-2">
                  {b.facts.map((f, i) => (
                    <FactRow key={i} fact={f} locale={locale} showItemTitle />
                  ))}
                </ul>
              </section>
            ))}

            {/* Topic-wise sections (fixed taxonomy) */}
            {mag.topic_sections.map((s) => (
              <section id={`topic-${s.category}`} key={s.category} className="mag-section mb-8">
                <h2 className="mb-3 border-b border-border pb-1.5 text-lg font-bold">
                  {t(`CurrentAffairs.category.${s.category}`)}
                </h2>
                <ul className="flex flex-col gap-2">
                  {s.facts.map((f, i) => (
                    <FactRow key={i} fact={f} locale={locale} showItemTitle={false} />
                  ))}
                </ul>
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
  );
}
