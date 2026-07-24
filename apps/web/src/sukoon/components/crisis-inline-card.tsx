import { LifeBuoy } from "lucide-react";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { CrisisHelplineList } from "@/sukoon/components/crisis-helpline-list";
import { cn } from "@/lib/utils";

/**
 * <CrisisInlineCard/> — the NON-blocking escalation for the `moderate` level
 * (blueprint F3). Woven into a future chat reply (or shown standalone): a calm
 * resource card with the top helplines, no takeover. Unlike the takeover it does
 * not interrupt — the conversation continues, with these lines offered gently.
 */
export function CrisisInlineCard({ className }: { className?: string }) {
  const { t, language } = useSukoonLanguage();
  return (
    <section
      lang={language}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
          <LifeBuoy className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">{t("Sukoon.crisis.inlineTitle")}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("Sukoon.crisis.inlineBody")}</p>
        </div>
      </div>
      <CrisisHelplineList limit={3} />
    </section>
  );
}
