import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Info, HelpCircle, Mail, ChevronRight } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { useLocale } from "@/hooks/use-locale";
import { SUPPORT_EMAIL } from "@/components/marketing/footer";

/**
 * Profile → "Help & about". The About/FAQ/Contact surfaces are public pages
 * (their own header + footer), but a signed-in user shouldn't have to log out
 * to find them — this is where every app puts this, and it's exactly where it
 * was missing. Content issues still route through in-app "Report this question"
 * (see the contact row's hint), email is for account/billing/general.
 */
export function HelpAboutCard() {
  const { t } = useTranslation();
  const locale = useLocale();

  const rowClass =
    "flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <SectionCard>
      <div className="flex flex-col gap-3">
        <Link to={`/${locale}/about`} className={rowClass}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Info className="size-4.5" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">{t("Profile.helpAbout")}</span>
            <span className="text-xs text-muted-foreground">{t("Profile.helpAboutHint")}</span>
          </span>
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>

        <Link to={`/${locale}/faq`} className={rowClass}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tulsi/15 text-tulsi-foreground">
            <HelpCircle className="size-4.5" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">{t("Profile.helpFaq")}</span>
            <span className="text-xs text-muted-foreground">{t("Profile.helpFaqHint")}</span>
          </span>
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>

        <a href={`mailto:${SUPPORT_EMAIL}`} className={rowClass}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-marigold/15 text-marigold-foreground">
            <Mail className="size-4.5" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">{t("Profile.helpContact")}</span>
            <span className="text-xs text-muted-foreground">{t("Profile.helpContactHint")}</span>
          </span>
          <span className="ml-auto shrink-0 text-xs font-medium text-primary">{SUPPORT_EMAIL}</span>
        </a>
      </div>
    </SectionCard>
  );
}
