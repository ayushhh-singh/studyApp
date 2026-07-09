import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useWeeklyDigest } from "@/hooks/use-engagement";
import { useLocale } from "@/hooks/use-locale";
import { getAccessToken } from "@/lib/auth";

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
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(false);

  // Plain `<a href target="_blank">` can't work here — /share/weekly.png sits
  // behind requireAuth like every other /api/v1/* route, and a bare browser
  // navigation never carries the app's Authorization: Bearer header (no
  // cookie session exists in this app's auth model) — it opened a new tab
  // showing the raw 401 JSON body instead of the image. Same fix/pattern as
  // the Conquest Map's share button (components/learn/conquest-map.tsx) and
  // the profile export download (components/profile/settings-card.tsx).
  async function handleShare() {
    setSharing(true);
    setShareError(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(shareUrl, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      setShareError(true);
    } finally {
      setSharing(false);
    }
  }

  return (
    <SectionCard
      title={t("Digest.title")}
      action={
        <div className="flex items-center gap-2">
          {shareError && <span className="text-xs text-destructive">{t("Digest.shareError")}</span>}
          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Share2 className="size-3.5" aria-hidden />
            {t("Digest.share")}
          </button>
        </div>
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
