import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Lightbulb, Newspaper } from "lucide-react";
import type { Locale, MagazineDeepDive, MagazineIssueBrief, MagazineModelQuestion } from "@prayasup/shared";
import { useMagazineMains } from "@/hooks/use-magazine";
import { useLocale } from "@/hooks/use-locale";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { formatQuestionStem } from "@/lib/format-question-stem";
import { MagazineToolbar } from "@/components/magazine/magazine-toolbar";
import { RelevanceBadges } from "@/components/current-affairs/relevance-badge";
import { LinkedSyllabusNode } from "@/components/current-affairs/linked-syllabus-node";

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex list-disc flex-col gap-0.5 ps-4 text-[13px]">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function SyllabusChips({ nodeIds, locale }: { nodeIds: string[]; locale: Locale }) {
  if (nodeIds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {nodeIds.map((id) => (
        <LinkedSyllabusNode key={id} nodeId={id} locale={locale} />
      ))}
    </div>
  );
}

function IssueBriefCard({ item, locale }: { item: MagazineIssueBrief; locale: Locale }) {
  const { t } = useTranslation();
  const b = item.brief;
  return (
    <article className="mag-item flex flex-col gap-2 break-inside-avoid rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <RelevanceBadges
          prelims={null}
          mains={item.mains_relevance}
          labels={{
            prelimsShort: t("CurrentAffairs.prelimsShort"),
            mainsShort: t("CurrentAffairs.mainsShort"),
            prelimsTitle: t("CurrentAffairs.prelimsRelevanceTitle"),
            mainsTitle: t("CurrentAffairs.mainsRelevanceTitle"),
          }}
        />
        {item.is_up_specific && (
          <span className="rounded-full bg-tulsi/15 px-2 py-0.5 font-semibold text-tulsi-foreground">
            {t("CurrentAffairs.upSpecific")}
          </span>
        )}
        <span className="text-muted-foreground">{item.date}</span>
      </div>
      <h3 className="text-base font-bold leading-snug">{item.title_i18n[locale]}</h3>
      <p className={locale === "hi" ? "text-sm leading-[1.9]" : "text-sm leading-relaxed"}>
        {b.why_in_news_i18n[locale]}
      </p>
      {b.background_i18n[locale]?.trim() && (
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("CurrentAffairs.background")}
          </span>
          <p className="text-[13px]">{b.background_i18n[locale]}</p>
        </div>
      )}
      {b.significance_i18n[locale].length > 0 && (
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("CurrentAffairs.significance")}
          </span>
          <BulletList items={b.significance_i18n[locale]} />
        </div>
      )}
      {b.challenges_i18n[locale].length > 0 && (
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("CurrentAffairs.challenges")}
          </span>
          <BulletList items={b.challenges_i18n[locale]} />
        </div>
      )}
      {b.way_forward_i18n[locale].length > 0 && (
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("CurrentAffairs.wayForward")}
          </span>
          <BulletList items={b.way_forward_i18n[locale]} />
        </div>
      )}
      {b.keywords_i18n[locale].length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {b.keywords_i18n[locale].map((kw, i) => (
            <span key={i} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {kw}
            </span>
          ))}
        </div>
      )}
      {b.case_examples_i18n[locale].length > 0 && (
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("CurrentAffairs.caseExamples")}
          </span>
          <BulletList items={b.case_examples_i18n[locale]} />
        </div>
      )}
      {item.possible_questions?.mains_i18n?.[locale]?.trim() && (
        <div className="rounded-lg border border-marigold/30 bg-marigold/[0.06] px-3 py-2">
          <span className="text-[10px] font-bold text-marigold-foreground uppercase">
            {t("CurrentAffairs.mainsQuestion")}
          </span>
          <p className="text-[13px]">{item.possible_questions.mains_i18n[locale]}</p>
        </div>
      )}
      <SyllabusChips nodeIds={item.syllabus_node_ids} locale={locale} />
    </article>
  );
}

function DeepDiveCard({ dive, locale, index }: { dive: MagazineDeepDive; locale: Locale; index: number }) {
  const { t } = useTranslation();
  return (
    <article className="mag-item flex flex-col gap-3 break-inside-avoid rounded-2xl border-2 border-primary/30 bg-primary/[0.03] p-5">
      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
        <Lightbulb className="size-4" /> {t("Magazine.deepDiveLabel", { rank: index + 1 })}
      </div>
      <h3 className="font-display text-xl font-bold leading-snug">{dive.title_i18n[locale]}</h3>
      <p className={locale === "hi" ? "text-sm leading-[1.9] italic" : "text-sm leading-relaxed italic"}>
        {dive.intro_i18n[locale]}
      </p>
      <div className="flex flex-col gap-3">
        {dive.synthesis_i18n[locale].map((para, i) => (
          <p key={i} className={locale === "hi" ? "text-sm leading-[1.9]" : "text-sm leading-relaxed"}>
            {para}
          </p>
        ))}
      </div>
      {dive.significance_i18n[locale].length > 0 && (
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("CurrentAffairs.significance")}
          </span>
          <BulletList items={dive.significance_i18n[locale]} />
        </div>
      )}
      {dive.challenges_i18n[locale].length > 0 && (
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("CurrentAffairs.challenges")}
          </span>
          <BulletList items={dive.challenges_i18n[locale]} />
        </div>
      )}
      {dive.way_forward_i18n[locale].length > 0 && (
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("CurrentAffairs.wayForward")}
          </span>
          <BulletList items={dive.way_forward_i18n[locale]} />
        </div>
      )}
      {dive.keywords_i18n[locale].length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dive.keywords_i18n[locale].map((kw, i) => (
            <span key={i} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {kw}
            </span>
          ))}
        </div>
      )}
      {dive.case_examples_i18n[locale].length > 0 && (
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("CurrentAffairs.caseExamples")}
          </span>
          <BulletList items={dive.case_examples_i18n[locale]} />
        </div>
      )}
      <SyllabusChips nodeIds={dive.syllabus_node_ids} locale={locale} />
    </article>
  );
}

function ModelQuestionCard({ q, locale }: { q: MagazineModelQuestion; locale: Locale }) {
  const { t } = useTranslation();
  return (
    <li className="mag-item flex flex-col gap-1.5 break-inside-avoid rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-medium whitespace-pre-line">{formatQuestionStem(q.stem_i18n[locale])}</p>
      <p className="text-[11px] text-muted-foreground">
        {q.marks != null && t("Magazine.modelQMarks", { marks: q.marks })}
        {q.word_limit != null && ` · ${t("Magazine.modelQWords", { words: q.word_limit })}`}
      </p>
      {q.marking_points_i18n[locale].length > 0 && (
        <div>
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("Magazine.markingPoints")}
          </span>
          <BulletList items={q.marking_points_i18n[locale]} />
        </div>
      )}
    </li>
  );
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { month = "" } = useParams<{ month: string }>();
  const { data: mag, isLoading, isError, refetch } = useMagazineMains(month);

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
            <div className="mb-8 flex flex-col items-center gap-1 border-b-2 border-marigold pb-6 text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-marigold-foreground">
                {t("Magazine.masthead")}
              </span>
              <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                {t("Magazine.mainsEditionTitle")}
              </h1>
              <p className="text-lg font-semibold text-foreground/80">{mag.title_i18n[locale]}</p>
              <p className="text-sm text-muted-foreground">
                {t("Magazine.mainsCoverStats", { issues: mag.total_issues, deepDives: mag.deep_dives.length })}
              </p>
            </div>

            <nav className="mag-noprint mb-8 rounded-xl border border-border bg-card p-4">
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t("Magazine.indexToc")}
              </h2>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                {mag.deep_dives.length > 0 && (
                  <li>
                    <a href="#deep-dives" className="text-primary hover:underline">
                      {t("Magazine.deepDivesSection")}
                    </a>
                  </li>
                )}
                {mag.gs_sections.map((s) => (
                  <li key={s.paper}>
                    <a href={`#gs-${s.paper}`} className="text-foreground hover:underline">
                      {s.paper}
                    </a>
                  </li>
                ))}
                {mag.model_questions.length > 0 && (
                  <li>
                    <a href="#model-questions" className="text-marigold-foreground hover:underline">
                      {t("Magazine.modelQuestionsSection")}
                    </a>
                  </li>
                )}
              </ul>
            </nav>

            {mag.deep_dives.length > 0 && (
              <section id="deep-dives" className="mag-section mb-10">
                <h2 className="mb-3 border-b border-primary/40 pb-1.5 text-lg font-bold text-primary">
                  {t("Magazine.deepDivesSection")}
                </h2>
                <div className="flex flex-col gap-5">
                  {mag.deep_dives.map((d, i) => (
                    <DeepDiveCard key={d.id} dive={d} locale={locale} index={i} />
                  ))}
                </div>
              </section>
            )}

            {mag.gs_sections.map((s) => (
              <section id={`gs-${s.paper}`} key={s.paper} className="mag-section mb-8">
                <h2 className="mb-3 border-b border-border pb-1.5 text-lg font-bold">{s.paper}</h2>
                <div className="flex flex-col gap-4">
                  {s.items.map((item) => (
                    <IssueBriefCard key={item.item_id} item={item} locale={locale} />
                  ))}
                </div>
              </section>
            ))}

            {mag.model_questions.length > 0 && (
              <section id="model-questions" className="mag-section">
                <h2 className="mb-3 border-b border-marigold/50 pb-1.5 text-lg font-bold text-marigold-foreground">
                  {t("Magazine.modelQuestionsSection")} ({mag.model_questions.length})
                </h2>
                <ol className="flex flex-col gap-3">
                  {mag.model_questions.map((q) => (
                    <ModelQuestionCard key={q.id} q={q} locale={locale} />
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
