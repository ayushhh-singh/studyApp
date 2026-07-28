import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";

/**
 * Persistent, honest guest notice + conversion CTA shown at the top of every
 * app-shell page while browsing as a guest. States the same-device limitation
 * plainly (progress lives on this device) and offers the one-tap path to a real
 * account + 7-day trial that carries the progress forward.
 */
export function GuestBanner() {
  const { isGuest } = useAuth();
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();

  if (!isGuest) return null;

  const goSignup = () => {
    const redirect = `${location.pathname}${location.search}`;
    navigate(`/${locale}/auth?redirect=${encodeURIComponent(redirect)}`);
  };

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-sm leading-relaxed text-foreground">{t("Guest.bannerText")}</p>
      </div>
      <Button size="sm" className="shrink-0 self-start sm:self-auto" onClick={goSignup}>
        {t("Guest.createAccountCta")}
      </Button>
    </div>
  );
}
