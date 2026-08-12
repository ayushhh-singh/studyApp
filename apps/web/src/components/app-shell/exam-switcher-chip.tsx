import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover } from "radix-ui";
import type { TargetExamCode } from "@neev/shared";
import { ExamPickerList } from "@/components/ui-x/exam-picker-list";
import { ExamSwitchDialog } from "@/components/ui-x/exam-switch-dialog";
import { useLocale } from "@/hooks/use-locale";
import { useProfile } from "@/hooks/use-profile";
import { useExams } from "@/hooks/use-exams";
import { useExamSwitch } from "@/hooks/use-exam-switch";
import { shortExamName } from "@/lib/exam-label";
import { cn } from "@/lib/utils";

/**
 * The persistent exam switcher in the top bar — which exam you are preparing
 * for, always visible, on every viewport, and changeable in place.
 *
 * Placement was a product decision, not an inference: exam scope changes what
 * nearly every screen contains (papers, mocks, boards, current affairs,
 * chapters), so it belongs where it can be read at a glance rather than behind
 * the avatar menu.
 *
 * It is NOT a second implementation of switching. The picker is the same
 * `ExamPickerList` onboarding and Profile use (live exams selectable, the rest
 * shown with their real launch scope and a "coming soon" badge), and the commit
 * path is the shared `useExamSwitch` + `ExamSwitchDialog` — so this and the
 * Profile card cannot drift apart in what they allow, what they warn about, or
 * what they invalidate. Until this was true, the chip deliberately just linked
 * to Profile.
 *
 * Renders nothing until the exam registry resolves, and nothing at all if only
 * one exam is selectable — a switcher with nothing to switch to is noise, and
 * that is the state every user was in before `upsc` went live.
 */
export function ExamSwitcherChip({ className }: { className?: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: profile } = useProfile();
  const { data: exams } = useExams();
  const examSwitch = useExamSwitch();
  const [open, setOpen] = useState(false);

  const selectable = exams?.filter((e) => e.is_live) ?? [];
  const current = exams?.find((e) => e.exam_code === profile?.target_exam);
  if (!current || selectable.length < 2) return null;
  const name = shortExamName(current, locale, profile?.target_exam);

  function handleSelect(code: TargetExamCode) {
    // Close the popover either way. On a real switch the confirmation dialog
    // takes over (it is rendered OUTSIDE the popover, so it survives the
    // close, and stacking a modal dialog inside an open popover would leave
    // two competing focus traps); on a re-select of the current exam there is
    // nothing to confirm and closing IS the acknowledgement.
    setOpen(false);
    examSwitch.requestSwitch(code);
  }

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            title={t("TopBar.examSwitcherHint")}
            className={cn(
              "inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-border bg-secondary px-2 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-secondary/70 sm:px-2.5",
              className,
            )}
          >
            {/* The visible label is the LATIN code in both locales, and the
                chevron is desktop-only. Both are width decisions, measured:
                this row also carries the page title and six icon controls, and
                the title has a documented ~8-character floor at 320px (see
                TopBar). The Hindi short name is 10 Devanagari characters
                ("यूपीपीएससी") against 5 in Latin — rendering it here pushed the
                Hindi title down to ~4 characters. Latin-in-both-locales for a
                compact abbreviation is this app's own established convention
                (hooks/use-paper-catalog.ts's `latinLabel`, lib/exam-label.ts's
                `stateFocusCode`).

                The full localized name goes to screen readers instead, along
                with the fact that this is a switcher — shortExamName() rather
                than the registry's formal "UPPSC (UP PCS)", which is a picker
                label. */}
            <span className="sr-only">{t("TopBar.examSwitcherLabel", { exam: name })}</span>
            <span aria-hidden>{current.exam_code.toUpperCase()}</span>
            <ChevronDown className="hidden size-3 opacity-70 sm:block" aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            collisionPadding={12}
            // Width tracks the viewport below `sm` because a coming-soon exam
            // carries its real launch scope (a summary plus covered/not-covered
            // lists), which is genuinely a paragraph, not a menu row — a
            // menu-width popover would set it in a ~4-word column at 390px.
            // Capped in height and scrollable for the same reason: the list
            // grows with the registry and must never run off a phone screen.
            className="z-50 flex max-h-[min(70vh,32rem)] w-[calc(100vw-1.5rem)] max-w-sm flex-col overflow-hidden rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            <p className="mb-2 px-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("ExamSwitcher.title")}
            </p>
            <div className="-mx-1 overflow-y-auto px-1 py-0.5">
              <ExamPickerList value={profile?.target_exam} onSelect={handleSelect} compact />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <ExamSwitchDialog state={examSwitch} />
    </>
  );
}
