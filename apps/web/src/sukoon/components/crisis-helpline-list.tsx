import { Phone } from "lucide-react";
import { SUKOON_HELPLINES, type SukoonHelpline } from "@neev/shared";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";

/**
 * The tap-to-call helpline directory, shared by the crisis takeover and the
 * inline card. Each row is a real `tel:` link (Tele-MANAS 14416 always first,
 * per the safety rules) so a tap dials on mobile. Bilingual name/note come from
 * the single SUKOON_HELPLINES source in @neev/shared.
 *
 * `emphasizeFirst` gives Tele-MANAS the primary visual treatment (the takeover uses  clinical-words-allow: UI styling sense, not clinical
 * it); `limit` trims the list (the compact inline card shows the top few).
 */
export function CrisisHelplineList({
  emphasizeFirst = false,
  limit,
  className,
}: {
  emphasizeFirst?: boolean;
  limit?: number;
  className?: string;
}) {
  const { language, t } = useSukoonLanguage();
  const helplines = limit ? SUKOON_HELPLINES.slice(0, limit) : SUKOON_HELPLINES;

  return (
    <ul className={cn("flex flex-col gap-2", className)} lang={language}>
      {helplines.map((h, i) => {
        const name = language === "hi" ? h.name_hi : h.name_en;
        const note = language === "hi" ? h.note_hi : h.note_en;
        const primary = emphasizeFirst && i === 0;
        return (
          <li key={h.id}>
            <a
              href={`tel:${h.tel}`}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                primary
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border-border bg-card hover:bg-accent",
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full",
                  primary ? "bg-primary-foreground/15" : "bg-primary/10 text-primary",
                )}
                aria-hidden
              >
                <Phone className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold leading-tight">{name}</span>
                {note && (
                  <span
                    className={cn(
                      "text-xs leading-tight",
                      primary ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {note}
                  </span>
                )}
              </span>
              <span className="ml-auto flex items-center gap-1.5 text-right">
                <span className="text-base font-bold tabular-nums tracking-tight">{h.phone}</span>
                <span className="sr-only">{t("Sukoon.crisis.callNow")}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Re-exported for callers that want the raw directory (e.g. a static resources page). */
export type { SukoonHelpline };
