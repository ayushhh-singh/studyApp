/**
 * Sukoon F12 — About (/sukoon/you/about). Carries the Play-Store-ready,
 * bilingual "what Sukoon is / is not" disclaimer, crisis resources, and a link
 * to the Privacy Center. Copy here is deliberately wellness-framed — it never
 * presents Sukoon in clinical terms (SUKOON_CONTEXT; enforced by the
 * clinical-language CI guard).
 */
import { Link, useParams } from "react-router";
import { Heart, ShieldCheck, LifeBuoy } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { CrisisHelplineList } from "@/sukoon/components/crisis-helpline-list";

export function Component() {
  const { t } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const appVersion = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "beta";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={t("Sukoon.about.title")} description={t("Sukoon.about.subtitle")} />

      <SectionCard title={t("Sukoon.about.what.title")}>
        <div className="flex items-start gap-3">
          <Heart className="mt-0.5 size-5 shrink-0 text-secondary" aria-hidden />
          <p className="text-sm leading-relaxed text-muted-foreground">{t("Sukoon.about.what.body")}</p>
        </div>
      </SectionCard>

      {/* The Play-Store-ready disclaimer — plain, warm, no clinical framing. */}
      <SectionCard title={t("Sukoon.about.isnt.title")}>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("Sukoon.about.isnt.body")}</p>
        <p className="mt-3 rounded-xl bg-muted/60 p-3 text-sm leading-relaxed text-foreground">
          {t("Sukoon.about.disclaimer")}
        </p>
      </SectionCard>

      <SectionCard title={t("Sukoon.about.crisis.title")} description={t("Sukoon.about.crisis.body")}>
        <div className="flex items-start gap-3">
          <LifeBuoy className="mt-0.5 size-5 shrink-0 text-secondary" aria-hidden />
          <div className="min-w-0 flex-1">
            <CrisisHelplineList emphasizeFirst />
          </div>
        </div>
      </SectionCard>

      <Link
        to={`${base}/you/privacy`}
        className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors duration-300 hover:border-secondary/50"
      >
        <ShieldCheck className="size-4 text-secondary" aria-hidden />
        {t("Sukoon.about.privacyLink")}
      </Link>

      <p className="text-center text-xs text-muted-foreground">
        {t("Sukoon.about.version", { version: appVersion })}
      </p>
    </div>
  );
}
