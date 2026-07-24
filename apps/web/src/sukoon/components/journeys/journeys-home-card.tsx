/** F7 — Sukoon Home's persistent entry point into the journeys catalog (the
 *  exam-eve card is conditional/urgent; this one is always there). */
import { Link, useParams } from "react-router";
import { Milestone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui-x/section-card";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";

export function JourneysHomeCard() {
  const { t } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";

  return (
    <SectionCard title={t("Sukoon.journeys.homeCardTitle")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-full bg-secondary/15 text-secondary" aria-hidden>
            <Milestone className="size-5" />
          </span>
          <p className="text-sm text-muted-foreground">{t("Sukoon.journeys.homeCardBody")}</p>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link to={`${base}/journeys`}>{t("Sukoon.journeys.homeCardCta")}</Link>
        </Button>
      </div>
    </SectionCard>
  );
}
