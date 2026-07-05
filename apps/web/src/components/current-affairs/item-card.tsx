import { useTranslation } from "react-i18next";
import type { CurrentAffairsItem, Locale } from "@prayasup/shared";

export function CurrentAffairsItemCard({
  item,
  locale,
  onSelect,
}: {
  item: CurrentAffairsItem;
  locale: Locale;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
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
          {item.mcq_question_ids.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              {t("Learn.pyqCount", { count: item.mcq_question_ids.length })}
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-balance">{item.title_i18n[locale]}</p>
        {item.summary_i18n && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{item.summary_i18n[locale]}</p>
        )}
      </button>
    </li>
  );
}
