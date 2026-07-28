import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, UserRound } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Explicit "Explore as a guest" entry — the visible counterpart to the silent
 * auto-guest starter (which only fires on a cold landing visit). Creates an
 * anonymous session and drops into the dashboard. If anonymous sign-ins are
 * disabled or rate-limited, it degrades honestly: an inline note + a link to
 * sign in, rather than a dead button.
 */
export function GuestEntryButton({
  className,
  variant = "outline",
  size = "lg",
}: {
  className?: string;
  variant?: "outline" | "ghost" | "default";
  size?: "lg" | "default";
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { signInAnonymously } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function go() {
    setBusy(true);
    setFailed(false);
    try {
      await signInAnonymously();
      navigate(`/${locale}/dashboard`, { replace: true });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Button type="button" variant={variant} size={size} onClick={go} disabled={busy} className="gap-2">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <UserRound className="size-4" />}
        {t("Guest.exploreCta")}
      </Button>
      {failed ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("Guest.unavailable")}{" "}
          <Link to={`/${locale}/auth`} className="font-medium text-primary hover:underline">
            {t("Auth.signIn")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
