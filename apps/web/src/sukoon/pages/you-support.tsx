/**
 * Sukoon — Find real support (/sukoon/you/support). A calm, NON-urgent bridge
 * to ongoing support from a real, trained person: free helplines you can reach
 * directly, and a find-a-professional directory maintained by another org.
 *
 * This is deliberately separate from the crisis takeover/helpline surfaces
 * (which handle right-now moments). Sukoon only points the way — every resource
 * is an outbound link or a tel: call, never an in-app form or booking. Copy is
 * wellness-framed and never clinical (SUKOON_CONTEXT; enforced by the           clinical-words-allow
 * clinical-language CI guard).                                                  clinical-words-allow
 */
import { Phone, LifeBuoy, Compass } from "lucide-react";
import { SUKOON_SUPPORT_RESOURCES } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useTrackSukoonFeatureView } from "@/sukoon/lib/use-sukoon-analytics";
import { SupportResourceList } from "@/sukoon/components/support-resource-list";
import { NotTherapyFooter } from "@/sukoon/components/not-therapy-footer";

export function Component() {
  const { t } = useSukoonLanguage();
  useTrackSukoonFeatureView("support");

  const helplines = SUKOON_SUPPORT_RESOURCES.filter((r) => r.group === "helpline");
  const directory = SUKOON_SUPPORT_RESOURCES.filter((r) => r.group === "directory");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={t("Sukoon.support.title")} description={t("Sukoon.support.subtitle")} />

      {/* Urgent path stays one tap away — this page is for the calm, ongoing kind. */}
      <a
        href="tel:14416"
        className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
          <Phone className="size-4" />
        </span>
        <span className="leading-snug">{t("Sukoon.support.urgent")}</span>
      </a>

      <p className="text-sm leading-relaxed text-muted-foreground">{t("Sukoon.support.intro")}</p>

      <SectionCard title={t("Sukoon.support.helplinesTitle")} description={t("Sukoon.support.helplinesBody")}>
        <div className="flex items-start gap-3">
          <LifeBuoy className="mt-1 hidden size-5 shrink-0 text-secondary sm:block" aria-hidden />
          <div className="min-w-0 flex-1">
            <SupportResourceList resources={helplines} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("Sukoon.support.directoryTitle")} description={t("Sukoon.support.directoryBody")}>
        <div className="flex items-start gap-3">
          <Compass className="mt-1 hidden size-5 shrink-0 text-secondary sm:block" aria-hidden />
          <div className="min-w-0 flex-1">
            <SupportResourceList resources={directory} />
          </div>
        </div>
      </SectionCard>

      <p className="rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
        {t("Sukoon.support.runByOthers")}
      </p>

      <NotTherapyFooter />
    </div>
  );
}
