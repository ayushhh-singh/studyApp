import { AlertDialog } from "radix-ui";
import { HeartHandshake, ChevronDown } from "lucide-react";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { CrisisHelplineList } from "@/sukoon/components/crisis-helpline-list";
import { cn } from "@/lib/utils";

/**
 * <CrisisTakeover/> — the full-screen, blocking escalation for high/critical
 * crisis levels (blueprint F3). Built on radix AlertDialog (per the "compose a
 * shadcn primitive, never hand-roll" rule): AlertDialog does not close on Esc or
 * an overlay click, so the user MUST tap "acknowledge" to continue — there is no
 * dismiss-by-accident path. Calm, non-alarming design (no scary red) with
 * tap-to-call helplines (Tele-MANAS 14416 first), a grounding step, and an
 * acknowledge-to-continue flow.
 *
 * Controlled: the caller owns `open` and provides `onAcknowledge` (which resumes
 * whatever was paused). The AI never "handles" the crisis — this hands off to
 * humans.
 */
export function CrisisTakeover({
  open,
  onAcknowledge,
}: {
  open: boolean;
  onAcknowledge: () => void;
}) {
  const { t, language } = useSukoonLanguage();

  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <AlertDialog.Content
          lang={language}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="fixed inset-0 z-[100] flex flex-col items-center overflow-y-auto px-5 py-8 outline-none data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
        >
          <div className="flex w-full max-w-md flex-col gap-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
                <HeartHandshake className="size-7" />
              </span>
              <AlertDialog.Title className="text-2xl font-semibold leading-snug text-foreground">
                {t("Sukoon.crisis.takeoverTitle")}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm leading-relaxed text-muted-foreground">
                {t("Sukoon.crisis.takeoverBody")}
              </AlertDialog.Description>
            </div>

            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("Sukoon.crisis.helplinesTitle")}
              </h2>
              <CrisisHelplineList emphasizeFirst />
            </section>

            {/* Grounding-in-this-moment, collapsed behind a native <details> so it
                works with zero JS state and stays keyboard-accessible. */}
            <details className="group rounded-xl border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("Sukoon.crisis.groundingToggle")}
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                <p className="text-foreground">{t("Sukoon.crisis.groundingTitle")}</p>
                <p>{t("Sukoon.crisis.groundingIntro")}</p>
                <ol className="ml-4 flex list-decimal flex-col gap-1.5">
                  <li>{t("Sukoon.crisis.groundingStep1")}</li>
                  <li>{t("Sukoon.crisis.groundingStep2")}</li>
                  <li>{t("Sukoon.crisis.groundingStep3")}</li>
                  <li className="text-foreground">{t("Sukoon.crisis.groundingStep4")}</li>
                </ol>
              </div>
            </details>

            <div className="flex flex-col items-center gap-2">
              <AlertDialog.Action
                onClick={onAcknowledge}
                className={cn(
                  "inline-flex h-11 w-full items-center justify-center rounded-xl border border-border bg-secondary px-4 text-sm font-semibold text-secondary-foreground",
                  "transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {t("Sukoon.crisis.acknowledge")}
              </AlertDialog.Action>
              <p className="text-center text-xs text-muted-foreground">
                {t("Sukoon.crisis.acknowledgeNote")}
              </p>
            </div>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
