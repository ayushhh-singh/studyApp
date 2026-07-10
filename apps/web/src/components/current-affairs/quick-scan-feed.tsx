import { useTranslation } from "react-i18next";
import type { CurrentAffairsItem, Locale } from "@prayasup/shared";

/**
 * Quick-scan mode (Prelims tab): a facts-only compact feed — every item's boxed
 * prelims facts, stripped of narrative, for fast revision. Tapping the item
 * title opens its full detail.
 */
export function QuickScanFeed({
  items,
  locale,
  onSelect,
}: {
  items: CurrentAffairsItem[];
  locale: Locale;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const withFacts = items.filter((i) => (i.prelims_facts?.length ?? 0) > 0);

  return (
    <div className="flex flex-col gap-3">
      {withFacts.map((item) => (
        <div key={item.id} className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className="text-left text-sm font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.title_i18n[locale]}
          </button>
          <ul className="flex flex-col gap-1">
            {item.prelims_facts!.map((fact, i) => {
              const extras = fact.extras ?? {};
              const extraLine = [extras.ministry, extras.publisher, extras.rank, extras.location]
                .filter(Boolean)
                .join(" · ");
              return (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-marigold/30 bg-marigold/[0.06] px-2.5 py-1.5 text-sm"
                >
                  <span className="mt-0.5 rounded bg-marigold/20 px-1 text-[9px] font-semibold text-marigold-foreground uppercase">
                    {t(`CurrentAffairs.factKind.${fact.kind}`)}
                  </span>
                  <span className="flex-1">
                    {fact.fact_i18n[locale]}
                    {extraLine && <span className="text-muted-foreground"> — {extraLine}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
