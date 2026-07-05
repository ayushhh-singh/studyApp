import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ListChecks } from "lucide-react";
import type { AttemptTopicBreakdownItem, Locale } from "@prayasup/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { scoreBandColor } from "@/lib/score-band";

function TopicRow({ item, locale }: { item: AttemptTopicBreakdownItem; locale: Locale }) {
  const { t } = useTranslation();
  const title = item.title_i18n ? item.title_i18n[locale] : t("Practice.resultUnmappedTopic");
  const to = item.syllabus_node_id && item.paper_code ? `/${locale}/learn/${item.paper_code}/${item.syllabus_node_id}` : null;

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {to ? (
          <Link
            to={to}
            className="truncate text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {title}
          </Link>
        ) : (
          <span className="truncate text-sm font-medium text-muted-foreground">{title}</span>
        )}
        {item.is_weak && (
          <span className="shrink-0 rounded-full bg-coral/10 px-2 py-0.5 text-xs font-semibold text-coral">
            {t("Practice.resultWeak")}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{t("Practice.resultTopicAttempted", { attempted: item.attempted, correct: item.correct })}</span>
        {item.accuracy_pct !== null && (
          <span className="font-semibold tabular-nums" style={{ color: scoreBandColor(item.accuracy_pct) }}>
            {Math.round(item.accuracy_pct)}%
          </span>
        )}
      </div>
    </li>
  );
}

export function ResultTopicBreakdown({ items, locale }: { items: AttemptTopicBreakdownItem[]; locale: Locale }) {
  const { t } = useTranslation();

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title={t("Practice.resultNoTopicsTitle")}
        description={t("Practice.resultNoTopicsDescription")}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <TopicRow key={item.syllabus_node_id ?? "unmapped"} item={item} locale={locale} />
      ))}
    </ul>
  );
}
