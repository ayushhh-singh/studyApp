import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "radix-ui";
import { Compass, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExams } from "@/hooks/use-exams";
import { useLocale } from "@/hooks/use-locale";
import type { ExamSwitch } from "@/hooks/use-exam-switch";

/**
 * The confirmation shown before `target_exam` actually changes, explaining
 * exactly what does and doesn't carry over — each exam keeps its own quiz and
 * attempt history, streak and analytics (server-side already: see the parked-
 * streak swap on `PATCH /profile` in `services/profile.ts`), while the revision
 * (SRS) deck is DELIBERATELY shared across exams (migration 0106 §13) rather
 * than a bug to apologise for.
 *
 * Rendered by every switcher entry point from the same {@link useExamSwitch}
 * state, so the explanation and the commit path cannot drift between them.
 *
 * Focus return is handled explicitly rather than left to Radix. Measured: BOTH
 * entry points stranded keyboard users on `<body>` when the dialog closed, so
 * the next Tab restarted from the top of the document — the popover path
 * because its opener is unmounted by then, and the Profile card path even
 * though its opener survives. `state.focusOpener()` restores the element that
 * asked for the switch when it is still connected; `returnFocusTo` is the
 * fallback for the popover, whose opener never is.
 */
export function ExamSwitchDialog({
  state,
  returnFocusTo,
}: {
  state: ExamSwitch;
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: exams } = useExams();

  const pendingExamRow = exams?.find((e) => e.exam_code === state.pendingExam);

  return (
    <Dialog.Root open={!!state.pendingExam} onOpenChange={(next) => !next && state.cancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            if (state.focusOpener()) {
              event.preventDefault();
              return;
            }
            const fallback = returnFocusTo?.current;
            if (!fallback) return;
            event.preventDefault();
            fallback.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in"
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Compass className="size-4" aria-hidden />
            </span>
            <Dialog.Title className="text-base font-semibold">
              {t("ExamSwitcher.confirmTitle", { exam: pendingExamRow?.display_name_i18n[locale] ?? "" })}
            </Dialog.Title>
          </div>
          <Dialog.Description asChild>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t("ExamSwitcher.confirmSafe")}</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>{t("ExamSwitcher.confirmHistory")}</li>
                <li>{t("ExamSwitcher.confirmStreak")}</li>
                <li>{t("ExamSwitcher.confirmSrsShared")}</li>
              </ul>
            </div>
          </Dialog.Description>

          {state.isError && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral-foreground"
            >
              {state.error instanceof Error ? state.error.message : t("ExamSwitcher.confirmError")}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={state.cancel} disabled={state.isPending}>
              {t("ExamSwitcher.confirmCancel")}
            </Button>
            <Button type="button" onClick={state.confirm} disabled={state.isPending} className="gap-2">
              {state.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("ExamSwitcher.confirmSwitch")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
