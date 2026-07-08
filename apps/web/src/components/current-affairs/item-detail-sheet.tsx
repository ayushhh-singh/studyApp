import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import type { Locale } from "@prayasup/shared";
import { Sheet, SheetContent } from "@/components/ui-x/sheet";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { useCurrentAffairsItem } from "@/hooks/use-current-affairs";
import { useAddCurrentAffairsFactToRevision } from "@/hooks/use-add-to-revision";
import { LinkedSyllabusNode } from "./linked-syllabus-node";

function KeyFactRow({ itemId, factIndex, text }: { itemId: string; factIndex: number; text: string }) {
  const { t } = useTranslation();
  const addFact = useAddCurrentAffairsFactToRevision();

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
      <span className="flex-1 text-sm">{text}</span>
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

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
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
  const { data: item, isLoading, isError } = useCurrentAffairsItem(itemId ?? undefined);

  return (
    <Sheet open={itemId !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" title={item ? item.title_i18n[locale] : ""} className="w-full overflow-y-auto sm:w-[440px]">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError || !item ? (
          // Reachable now that this sheet can be opened directly by a URL/
          // citation id, not just a click from an already-loaded list row — an
          // item that's since been unpublished/removed previously left this
          // stuck on the skeleton forever (isLoading settles false on error,
          // but `!item` stayed true), rather than saying so.
          <p className="text-sm text-muted-foreground">{t("CurrentAffairs.itemNotFound")}</p>
        ) : (
          <div className="flex flex-col gap-5">
            {item.detail_i18n && (
              <>
                <DetailSection title={t("CurrentAffairs.whatHappened")}>
                  <p className="text-sm">{item.detail_i18n.what_happened_i18n[locale]}</p>
                </DetailSection>

                <DetailSection title={t("CurrentAffairs.whyItMatters")}>
                  <p className="text-sm">{item.detail_i18n.why_it_matters_i18n[locale]}</p>
                </DetailSection>

                {item.detail_i18n.key_facts_i18n[locale].length > 0 && (
                  <DetailSection title={t("CurrentAffairs.keyFacts")}>
                    <ul className="flex flex-col gap-1.5">
                      {item.detail_i18n.key_facts_i18n[locale].map((fact, index) => (
                        <KeyFactRow key={index} itemId={item.id} factIndex={index} text={fact} />
                      ))}
                    </ul>
                  </DetailSection>
                )}

                <DetailSection title={t("CurrentAffairs.questionAngle")}>
                  <p className="text-sm italic text-muted-foreground">
                    {item.detail_i18n.question_angle_i18n[locale]}
                  </p>
                </DetailSection>
              </>
            )}

            {item.syllabus_node_ids.length > 0 && (
              <DetailSection title={t("CurrentAffairs.relatedTopics")}>
                <div className="flex flex-wrap gap-1.5">
                  {item.syllabus_node_ids.map((nodeId) => (
                    <LinkedSyllabusNode key={nodeId} nodeId={nodeId} locale={locale} />
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
