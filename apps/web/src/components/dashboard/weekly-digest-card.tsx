import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useWeeklyDigest } from "@/hooks/use-engagement";
import { useLocale } from "@/hooks/use-locale";

const API_URL = import.meta.env.VITE_API_URL as string;

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function WeeklyDigestCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isLoading } = useWeeklyDigest();
  const shareUrl = `${API_URL}/api/v1/share/weekly.png?locale=${locale}`;

  return (
    <SectionCard
      title={t("Digest.title")}
      action={
        <a
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Share2 className="size-3.5" aria-hidden />
          {t("Digest.share")}
        </a>
      }
    >
      {isLoading || !data ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat value={String(data.questions_attempted)} label={t("Digest.questions")} color="var(--primary)" />
          <Stat
            value={data.accuracy_pct !== null ? `${Math.round(data.accuracy_pct)}%` : "—"}
            label={t("Digest.accuracy")}
            color="var(--tulsi)"
          />
          <Stat value={String(data.answers_evaluated)} label={t("Digest.answers")} color="var(--marigold)" />
          <Stat value={String(data.streak_count)} label={t("Digest.streak")} color="var(--coral)" />
        </div>
      )}
    </SectionCard>
  );
}
