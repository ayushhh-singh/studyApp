import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import type { ImprovementProofItem } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandColor } from "@/lib/score-band";
import { formatQuestionStem } from "@/lib/format-question-stem";

function ProofRow({ item }: { item: ImprovementProofItem }) {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <p className="line-clamp-2 text-sm font-medium whitespace-pre-line" lang={locale}>
        {formatQuestionStem(item.question_stem_i18n[locale])}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-display" style={{ color: scoreBandColor(item.before_pct) }}>
          {Math.round(item.before_pct)}%
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="font-display" style={{ color: scoreBandColor(item.after_pct) }}>
          {Math.round(item.after_pct)}%
        </span>
        <span className="ml-auto rounded-full bg-tulsi/15 px-2 py-0.5 text-xs font-bold text-tulsi-foreground">
          +{Math.round(item.delta_pct)}%
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("Profile.improvementDates", { before: item.before_date, after: item.after_date })}
      </p>
    </div>
  );
}

export function ImprovementProofCard({
  items,
  avgDeltaPct,
  isLoading,
}: {
  items: ImprovementProofItem[] | undefined;
  avgDeltaPct: number | null | undefined;
  isLoading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <SectionCard
      title={t("Profile.improvementTitle")}
      description={
        avgDeltaPct !== null && avgDeltaPct !== undefined
          ? t("Profile.improvementHeadline", { pct: Math.round(avgDeltaPct) })
          : undefined
      }
    >
      {isLoading || !items ? (
        <Skeleton className="h-24 w-full" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={t("Profile.improvementEmptyTitle")}
          description={t("Profile.improvementEmptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <ProofRow key={`${item.before_submission_id}-${item.after_submission_id}`} item={item} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
