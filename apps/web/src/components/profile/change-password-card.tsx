import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2 } from "lucide-react";
import { checkPasswordStrength } from "@prayasup/shared";
import { useAuth } from "@/providers/auth-provider";
import { SectionCard } from "@/components/ui-x/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Change-password control — new password twice + the shared min-strength check. */
export function ChangePasswordCard() {
  const { t } = useTranslation();
  const { updatePassword } = useAuth();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset() {
    setOpen(false);
    setPassword("");
    setConfirm("");
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const strength = checkPasswordStrength(password);
    if (!strength.ok) {
      setError(t(strength.reason === "too_short" ? "Auth.passwordTooShort" : "Auth.passwordTooCommon"));
      return;
    }
    if (password !== confirm) {
      setError(t("Auth.resetMismatch"));
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setSuccess(true);
      setOpen(false);
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Auth.genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard>
      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden />
              {t("Profile.changePasswordTitle")}
            </span>
            <span className="text-xs text-muted-foreground">{t("Profile.changePasswordHint")}</span>
          </div>
          {!open && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSuccess(false);
                setOpen(true);
              }}
            >
              {t("Profile.changePasswordButton")}
            </Button>
          )}
        </div>

        {success && !open && (
          <p role="status" className="text-sm text-tulsi-foreground">
            {t("Profile.changePasswordSuccess")}
          </p>
        )}

        {open && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-1">
            {error && (
              <p role="alert" className="rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral-foreground">
                {error}
              </p>
            )}
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">{t("Profile.changePasswordNewLabel")}</span>
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span className="mt-1.5 block text-xs text-muted-foreground">{t("Auth.passwordHint")}</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">{t("Profile.changePasswordConfirmLabel")}</span>
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy || !password || !confirm} className="gap-2">
                {busy && <Loader2 className="size-4 animate-spin" />}
                {t("Profile.changePasswordSubmit")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>
                {t("Profile.changePasswordCancel")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </SectionCard>
  );
}
