/**
 * F8 — the two check-ins as gentle, tappable entry points (on /sukoon/you).
 * Shows last-taken + a soft "time for a check-in?" note when a monthly
 * re-prompt is due. Framed as an invitation, never a demand.
 */
import { Link, useParams } from "react-router";
import { ClipboardCheck, Sparkles } from "lucide-react";
import type { SukoonCheckinType } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useCheckinStatus } from "@/sukoon/lib/use-sukoon-checkins";

const TYPES: SukoonCheckinType[] = ["who5", "stress_self_check"];

export function CheckinCard() {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const statusQuery = useCheckinStatus();

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const byType = new Map((statusQuery.data?.items ?? []).map((i) => [i.type, i]));

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-secondary" aria-hidden />
          {t("Sukoon.checkin.cardTitle")}
        </span>
      }
      description={t("Sukoon.checkin.cardSub")}
    >
      <div className="flex flex-col gap-2.5">
        {TYPES.map((type) => {
          const status = byType.get(type);
          const due = status?.due ?? true;
          return (
            <Link
              key={type}
              to={`${base}/checkin/${type}`}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors duration-300",
                due
                  ? "border-secondary/40 bg-secondary/5 hover:border-secondary/60"
                  : "border-border bg-card hover:border-secondary/40",
              )}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {t(`Sukoon.checkin.title.${type}`)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {status?.last_taken_at
                    ? t("Sukoon.checkin.lastTaken", { date: dateLabel(status.last_taken_at) })
                    : t("Sukoon.checkin.neverTaken")}
                </span>
              </div>
              {due ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-secondary/15 px-2.5 py-1 text-[11px] font-medium text-secondary">
                  <Sparkles className="size-3" aria-hidden />
                  {t("Sukoon.checkin.dueBadge")}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </SectionCard>
  );
}
