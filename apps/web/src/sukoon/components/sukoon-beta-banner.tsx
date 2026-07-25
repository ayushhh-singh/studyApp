import { useState } from "react";
import { Link, useParams } from "react-router";
import { FlaskConical, X } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonBetaStatus } from "@/sukoon/lib/use-sukoon-beta";

const DISMISS_KEY = "sukoon-beta-banner-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Session 14 — a quiet "you're in the Sukoon beta" notice with a feedback
 * link, shown only while SUKOON_BETA_COHORT gating is actually on for this
 * user (never once the beta graduates to a full rollout). Dismissal is
 * permanent (localStorage) — same convention as the install prompt/night-mode
 * toggle — a beta notice doesn't need to nag on every visit once seen.
 */
export function SukoonBetaBanner() {
  const { t } = useSukoonLanguage();
  const { session } = useAuth();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const statusQuery = useSukoonBetaStatus({ enabled: !!session });
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed || !statusQuery.data?.gating_enabled || !statusQuery.data?.in_cohort) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private browsing — dismiss still works for this tab via state */
    }
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-secondary/30 bg-secondary/8 px-3.5 py-2.5 text-sm">
      <FlaskConical className="size-4 shrink-0 text-secondary" aria-hidden />
      <p className="min-w-0 flex-1 text-foreground">
        {t("Sukoon.beta.bannerText")}{" "}
        <Link to={`${base}/feedback`} className="font-semibold text-secondary underline-offset-2 hover:underline">
          {t("Sukoon.beta.bannerLink")}
        </Link>
      </p>
      <button
        type="button"
        aria-label={t("Sukoon.beta.bannerDismiss")}
        onClick={dismiss}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
