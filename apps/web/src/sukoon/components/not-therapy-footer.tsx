import { LifeBuoy } from "lucide-react";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { cn } from "@/lib/utils";

/**
 * The persistent "wellness companion, not a substitute for professional mental
 * health care" footer required on EVERY Sukoon surface (SUKOON_CONTEXT hard
 * safety rules — never the words therapy/treatment/etc., always this disclaimer
 * with the Tele-MANAS 14416 helpline). One canonical, bilingual component reused
 * across the module: rendered once per page from the app shell, and again on the
 * onboarding flow (which runs outside the shell chrome).
 *
 * `Sukoon.disclaimer` already carries the crisis helpline number, so the same
 * copy serves both the routine footer and the consent screen's standing notice.
 */
export function NotTherapyFooter({ className }: { className?: string }) {
  const { t, language } = useSukoonLanguage();
  return (
    <p
      lang={language}
      className={cn(
        "flex items-start justify-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <LifeBuoy className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{t("Sukoon.disclaimer")}</span>
    </p>
  );
}
