import { Phone, Compass, ExternalLink } from "lucide-react";
import { type SukoonSupportResource } from "@neev/shared";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";

/**
 * The "Find real support" resource list (the /sukoon/you/support page). A calm,
 * NON-urgent bridge — distinct from the crisis <CrisisHelplineList/>. Every row
 * is outbound only: a `tel:` call button and/or an external website link, so
 * Sukoon points the way but never books, brokers, or sits in the conversation
 * (SUKOON_CONTEXT: bridge, not broker). Each card avoids nesting the call and
 * visit actions inside one anchor, keeping both independently tappable.
 *
 * Data + bilingual name/note come from the single SUKOON_SUPPORT_RESOURCES
 * source in @neev/shared; copy here stays wellness-framed (no clinical words).
 */
export function SupportResourceList({
  resources,
  className,
}: {
  resources: readonly SukoonSupportResource[];
  className?: string;
}) {
  const { language, t } = useSukoonLanguage();

  return (
    <ul className={cn("flex flex-col gap-3", className)} lang={language}>
      {resources.map((r) => {
        const name = language === "hi" ? r.name_hi : r.name_en;
        const note = language === "hi" ? r.note_hi : r.note_en;
        const Icon = r.tel ? Phone : Compass;
        return (
          <li
            key={r.id}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                aria-hidden
              >
                <Icon className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <h3 className="text-sm font-semibold leading-tight text-foreground">{name}</h3>
                <p className="text-xs leading-snug text-muted-foreground">{note}</p>
              </div>
            </div>

            {(r.tel || r.url) && (
              <div className="flex flex-wrap items-center gap-2">
                {r.tel && (
                  <a
                    href={`tel:${r.tel}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Phone className="size-4" aria-hidden />
                    <span className="tabular-nums tracking-tight">{r.phone}</span>
                    <span className="sr-only">— {t("Sukoon.support.call")}</span>
                  </a>
                )}
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("Sukoon.support.visit")}
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
