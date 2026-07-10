import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import type { CurrentAffairsFact, CurrentAffairsItem, Locale } from "@prayasup/shared";
import { Sheet, SheetContent } from "@/components/ui-x/sheet";
import { Skeleton } from "@/components/ui-x/skeleton";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { Button } from "@/components/ui/button";
import { useCurrentAffairsItem } from "@/hooks/use-current-affairs";
import { useAddCurrentAffairsFactToRevision } from "@/hooks/use-add-to-revision";
import { useSyllabusNode } from "@/hooks/use-syllabus-node";
import { Link } from "react-router";
import { RelevanceBadges } from "./relevance-badge";

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

/** One boxed prelims fact — visually distinct, with its kind badge, extras, and add-to-revision. */
function PrelimsFactRow({
  itemId,
  factIndex,
  fact,
  locale,
}: {
  itemId: string;
  factIndex: number;
  fact: CurrentAffairsFact;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const addFact = useAddCurrentAffairsFactToRevision();
  const extras = fact.extras ?? {};
  const extraLine = [extras.ministry, extras.publisher, extras.rank, extras.location].filter(Boolean).join(" · ");

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-marigold/30 bg-marigold/[0.06] px-3 py-2">
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-marigold/20 px-1.5 py-0.5 text-[10px] font-semibold text-marigold-foreground uppercase">
            {t(`CurrentAffairs.factKind.${fact.kind}`)}
          </span>
        </div>
        <span className="text-sm">{fact.fact_i18n[locale]}</span>
        {extraLine && <span className="text-xs text-muted-foreground">{extraLine}</span>}
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="shrink-0"
        disabled={addFact.isPending || addFact.isSuccess}
        onClick={() => addFact.mutate({ itemId, factIndex })}
      >
        {addFact.isSuccess ? t("Learn.addedToRevision") : t("Learn.addToRevision")}
      </Button>
    </li>
  );
}

type NodeSignificanceValue = NonNullable<CurrentAffairsItem["node_significance"]>[string];

/** A related syllabus node pill + its per-exam "why this matters" lines. */
function RelatedNode({
  nodeId,
  locale,
  significance,
}: {
  nodeId: string;
  locale: Locale;
  significance: NodeSignificanceValue | undefined;
}) {
  const { t } = useTranslation();
  const { data: node, isLoading } = useSyllabusNode(nodeId);
  if (isLoading || !node) return <span className="h-6 w-40 animate-pulse rounded-lg bg-muted" />;

  const prelims = significance?.prelims_i18n?.[locale]?.trim();
  const mains = significance?.mains_i18n?.[locale]?.trim();

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background px-3 py-2">
      <Link
        to={`/${locale}/learn/${node.paper_code}/${node.id}`}
        className="text-sm font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {node.title_i18n[locale]}
      </Link>
      {prelims && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-primary">{t("CurrentAffairs.nodeSignPrelims")}:</span> {prelims}
        </p>
      )}
      {mains && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-marigold-foreground">{t("CurrentAffairs.nodeSignMains")}:</span> {mains}
        </p>
      )}
    </div>
  );
}

export function CurrentAffairsDetailSheet({
  itemId,
  locale,
  onOpenChange,
}: {
  itemId: string | null;
  locale: Locale;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: item, isLoading, isError, refetch } = useCurrentAffairsItem(itemId ?? undefined);

  const brief = item?.mains_brief ?? null;
  const legacy = item?.detail_i18n ?? null;
  // "Why in news" prefers the new mains brief, falls back to the legacy blob.
  const whyInNews = brief?.why_in_news_i18n[locale] || legacy?.what_happened_i18n[locale] || "";
  const prelimsFacts = item?.prelims_facts ?? null;

  return (
    <Sheet open={itemId !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        title={item ? item.title_i18n[locale] : ""}
        className="w-full overflow-y-auto sm:w-[460px]"
      >
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError ? (
          <QueryErrorState onRetry={() => refetch()} />
        ) : !item ? (
          <p className="text-sm text-muted-foreground">{t("CurrentAffairs.itemNotFound")}</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <RelevanceBadges
                prelims={item.prelims_relevance}
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
              {item.category && (
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                  {t(`CurrentAffairs.category.${item.category}`)}
                </span>
              )}
            </div>

            {item.summary_i18n && <p className="text-sm">{item.summary_i18n[locale]}</p>}

            {whyInNews && (
              <DetailSection title={t("CurrentAffairs.whyInNews")}>
                <p className="text-sm">{whyInNews}</p>
              </DetailSection>
            )}

            {/* Prelims box — the visually-distinct, scannable facts to memorize. */}
            {prelimsFacts && prelimsFacts.length > 0 && (
              <DetailSection title={t("CurrentAffairs.prelimsBox")}>
                <ul className="flex flex-col gap-1.5">
                  {prelimsFacts.map((fact, i) => (
                    <PrelimsFactRow key={i} itemId={item.id} factIndex={i} fact={fact} locale={locale} />
                  ))}
                </ul>
              </DetailSection>
            )}

            {/* Legacy flat key-facts (un-backfilled items only). */}
            {!prelimsFacts && legacy && legacy.key_facts_i18n[locale].length > 0 && (
              <DetailSection title={t("CurrentAffairs.prelimsBox")}>
                <ul className="flex flex-col gap-1.5">
                  {legacy.key_facts_i18n[locale].map((fact, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-marigold/30 bg-marigold/[0.06] px-3 py-2 text-sm"
                    >
                      {fact}
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}

            {brief && (
              <>
                {brief.background_i18n[locale]?.trim() && (
                  <DetailSection title={t("CurrentAffairs.background")}>
                    <p className="text-sm">{brief.background_i18n[locale]}</p>
                  </DetailSection>
                )}
                {brief.significance_i18n[locale].length > 0 && (
                  <DetailSection title={t("CurrentAffairs.significance")}>
                    <BulletList items={brief.significance_i18n[locale]} />
                  </DetailSection>
                )}
                {brief.challenges_i18n[locale].length > 0 && (
                  <DetailSection title={t("CurrentAffairs.challenges")}>
                    <BulletList items={brief.challenges_i18n[locale]} />
                  </DetailSection>
                )}
                {brief.way_forward_i18n[locale].length > 0 && (
                  <DetailSection title={t("CurrentAffairs.wayForward")}>
                    <BulletList items={brief.way_forward_i18n[locale]} />
                  </DetailSection>
                )}
                {brief.keywords_i18n[locale].length > 0 && (
                  <DetailSection title={t("CurrentAffairs.valueKeywords")}>
                    <div className="flex flex-wrap gap-1.5">
                      {brief.keywords_i18n[locale].map((kw, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </DetailSection>
                )}
                {brief.case_examples_i18n[locale].length > 0 && (
                  <DetailSection title={t("CurrentAffairs.caseExamples")}>
                    <BulletList items={brief.case_examples_i18n[locale]} />
                  </DetailSection>
                )}
              </>
            )}

            {/* Possible questions — prelims stem and/or mains directive question. */}
            {(item.possible_questions?.prelims_i18n?.[locale]?.trim() ||
              item.possible_questions?.mains_i18n?.[locale]?.trim() ||
              legacy?.question_angle_i18n[locale]) && (
              <DetailSection title={t("CurrentAffairs.possibleQuestions")}>
                <div className="flex flex-col gap-2">
                  {item.possible_questions?.prelims_i18n?.[locale]?.trim() && (
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <span className="text-[10px] font-bold text-primary uppercase">
                        {t("CurrentAffairs.prelimsQuestion")}
                      </span>
                      <p className="text-sm">{item.possible_questions.prelims_i18n[locale]}</p>
                    </div>
                  )}
                  {item.possible_questions?.mains_i18n?.[locale]?.trim() && (
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <span className="text-[10px] font-bold text-marigold-foreground uppercase">
                        {t("CurrentAffairs.mainsQuestion")}
                      </span>
                      <p className="text-sm">{item.possible_questions.mains_i18n[locale]}</p>
                    </div>
                  )}
                  {!item.possible_questions && legacy?.question_angle_i18n[locale] && (
                    <p className="text-sm italic text-muted-foreground">{legacy.question_angle_i18n[locale]}</p>
                  )}
                </div>
              </DetailSection>
            )}

            {item.syllabus_node_ids.length > 0 && (
              <DetailSection title={t("CurrentAffairs.relatedTopics")}>
                <div className="flex flex-col gap-1.5">
                  {item.syllabus_node_ids.map((nodeId) => (
                    <RelatedNode
                      key={nodeId}
                      nodeId={nodeId}
                      locale={locale}
                      significance={item.node_significance?.[nodeId]}
                    />
                  ))}
                </div>
              </DetailSection>
            )}

            {item.source_urls && item.source_urls.length > 0 && (
              <DetailSection title={t("CurrentAffairs.sourceLink")}>
                <ul className="flex flex-col gap-1">
                  {item.source_urls.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <ExternalLink className="size-3" aria-hidden />
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
