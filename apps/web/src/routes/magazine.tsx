import { useTranslation } from "react-i18next";
import { Link, useParams, useNavigate, useLocation } from "react-router";
import { ArrowLeft, Printer, Newspaper, MapPin, Languages } from "lucide-react";
import type { CurrentAffairsItem, Locale } from "@prayasup/shared";
import { useMagazine } from "@/hooks/use-magazine";
import { useLocale } from "@/hooks/use-locale";
import { switchLocale } from "@/lib/locale";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";

const CATEGORY_LABEL: Record<string, string> = {
  polity_governance: "Polity & Governance",
  economy: "Economy",
  schemes_welfare: "Schemes & Welfare",
  environment_ecology: "Environment & Ecology",
  science_tech: "Science & Technology",
  national: "National",
  international: "International",
  awards_sports_misc: "Awards, Sports & Misc",
  up_state_affairs: "Uttar Pradesh",
};

function Item({ item, locale }: { item: CurrentAffairsItem; locale: Locale }) {
  const facts = item.detail_i18n?.key_facts_i18n?.[locale] ?? [];
  return (
    <article className="mag-item flex flex-col gap-1.5 break-inside-avoid">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-snug">{item.title_i18n[locale]}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{item.date}</span>
      </div>
      {item.summary_i18n && (
        <p className={locale === "hi" ? "text-sm leading-[1.9]" : "text-sm leading-relaxed"}>
          {item.summary_i18n[locale]}
        </p>
      )}
      {facts.length > 0 && (
        <ul className="flex flex-col gap-0.5 ps-1">
          {facts.slice(0, 4).map((f, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-foreground/80">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
              <span className={locale === "hi" ? "leading-[1.9]" : ""}>{f}</span>
            </li>
          ))}
        </ul>
      )}
      {item.detail_i18n?.why_it_matters_i18n?.[locale] && (
        <p className="text-[13px] italic text-muted-foreground">
          {item.detail_i18n.why_it_matters_i18n[locale]}
        </p>
      )}
    </article>
  );
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { month = "" } = useParams<{ month: string }>();
  const { data: mag, isLoading, isError, refetch } = useMagazine(month);

  function toggleLang() {
    navigate(switchLocale(location.pathname, location.search, locale === "hi" ? "en" : "hi", location.hash), {
      replace: true,
    });
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <style>{`@media print {
        .mag-noprint { display: none !important; }
        .mag-page { max-width: none !important; padding: 0 !important; }
        .mag-section { break-inside: avoid; }
      }`}</style>

      {/* toolbar (hidden in print) */}
      <header className="mag-noprint sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link
          to={`/${locale}/magazine`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {t("Magazine.back")}
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLang}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Languages className="size-4" /> {locale === "hi" ? "EN" : "हिं"}
          </button>
          {/* Disabled until the article has actually loaded — printing while
              isLoading would print a page of gray skeleton bars instead of
              the article. */}
          <button
            type="button"
            onClick={() => window.print()}
            disabled={isLoading || isError || !mag}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <Printer className="size-4" /> {t("Magazine.print")}
          </button>
        </div>
      </header>

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
                {mag.title_i18n[locale]}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("Magazine.coverStats", { total: mag.total_items, up: mag.up_item_count })}
              </p>
            </div>

            {/* UP-specific lead section */}
            {mag.up_section.length > 0 && (
              <section className="mag-section mb-8">
                <h2 className="mb-3 flex items-center gap-2 border-b border-tulsi/40 pb-1.5 text-lg font-bold text-tulsi-foreground">
                  <MapPin className="size-5" /> {t("Magazine.upSection")}
                </h2>
                <div className="flex flex-col gap-4">
                  {mag.up_section.map((item) => (
                    <Item key={item.id} item={item} locale={locale} />
                  ))}
                </div>
              </section>
            )}

            {/* category sections */}
            {mag.sections.map((s) => (
              <section key={s.category} className="mag-section mb-8">
                <h2 className="mb-3 border-b border-border pb-1.5 text-lg font-bold">
                  {CATEGORY_LABEL[s.category] ?? s.category}
                </h2>
                <div className="flex flex-col gap-4">
                  {s.items.map((item) => (
                    <Item key={item.id} item={item} locale={locale} />
                  ))}
                </div>
              </section>
            ))}

            {/* MCQ appendix */}
            {mag.mcq_appendix.length > 0 && (
              <section className="mag-section">
                <h2 className="mb-3 border-b border-marigold/50 pb-1.5 text-lg font-bold text-marigold-foreground">
                  {t("Magazine.quizAppendix", { count: mag.mcq_appendix.length })}
                </h2>
                <ol className="flex flex-col gap-4">
                  {mag.mcq_appendix.map((q, i) => (
                    <li key={q.id} className="mag-item flex flex-col gap-1.5 break-inside-avoid">
                      <p className="text-sm font-medium">
                        {i + 1}. {q.stem_i18n[locale]}
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
