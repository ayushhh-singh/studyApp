/**
 * F7 — "if profile exam_date is tomorrow, Sukoon Home and Saathi both surface
 * the Exam-Eve journey prominently." Renders nothing when there's no session,
 * no exam_date, the exam isn't imminent, or the journey isn't published yet
 * (fails closed/quiet — never a broken card).
 */
import { Link, useParams } from "react-router";
import { Sparkles } from "lucide-react";
import { SUKOON_EXAM_EVE_JOURNEY_SLUG } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonProfile } from "@/sukoon/lib/use-sukoon-profile";
import { useJourneys } from "@/sukoon/lib/use-sukoon-journeys";
import { daysUntil } from "@/sukoon/lib/days-until";

export function ExamEveJourneyCard({ className }: { className?: string }) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const { session } = useAuth();

  const profileQuery = useSukoonProfile({ enabled: !!session });
  const journeysQuery = useJourneys({ enabled: !!session });

  const days = daysUntil(profileQuery.data?.profile?.exam_date ?? null);
  const imminent = days !== null && days >= 0 && days <= 1;
  const journey = journeysQuery.data?.journeys.find((j) => j.slug === SUKOON_EXAM_EVE_JOURNEY_SLUG);

  if (!imminent || !journey || journey.locked) return null;

  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-2xl border border-secondary/40 bg-secondary/10 p-4", className)}>
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary/20 text-secondary" aria-hidden>
          <Sparkles className="size-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">{t("Sukoon.journeys.examEve.title")}</p>
          <p className="text-xs text-muted-foreground">{language === "hi" ? journey.title_hi : journey.title_en}</p>
        </div>
      </div>
      <Button size="sm" asChild>
        <Link to={`${base}/journeys/${journey.slug}`}>{t("Sukoon.journeys.examEve.cta")}</Link>
      </Button>
    </div>
  );
}
