import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { Compass, Loader2 } from "lucide-react";
import type { TargetExamCode } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { ExamPickerList } from "@/components/ui-x/exam-picker-list";
import { Button } from "@/components/ui/button";
import { useProfile, useUpdateProfile } from "@/hooks/use-profile";
import { useExams } from "@/hooks/use-exams";
import { useLocale } from "@/hooks/use-locale";

/**
 * Lets a signed-in user change `target_exam` from their profile, with an
 * up-front confirmation explaining exactly what does and doesn't happen —
 * each exam keeps its own quiz/attempt history, streak, and analytics
 * (server-side already, see the parked-streak swap on `PATCH /profile` in
 * `services/profile.ts`), and the revision (SRS) deck is DELIBERATELY shared
 * across exams (migration 0106 §13) rather than a bug to apologize for.
 */
export function ExamSwitcherCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const { data: exams } = useExams();
  const updateProfile = useUpdateProfile();

  const [pendingExam, setPendingExam] = useState<TargetExamCode | null>(null);

  const currentExam = exams?.find((e) => e.exam_code === profile?.target_exam);
  const pendingExamRow = exams?.find((e) => e.exam_code === pendingExam);

  function handleSelect(code: TargetExamCode) {
    // Re-selecting the exam already active is a no-op, not a confirmation
    // dialog — there's nothing to confirm.
    if (code === profile?.target_exam) return;
    setPendingExam(code);
  }

  function confirmSwitch() {
    if (!pendingExam) return;
    updateProfile.mutate(
      { target_exam: pendingExam },
      {
        onSuccess: () => {
          // Most exam-scoped query keys (paper summaries, dashboard, tests,
          // mastery, current affairs, magazine, …) do NOT carry the exam code
          // — see lib/query-keys.ts — so a plain refetch of just the profile
          // query would leave every one of those cached under the PREVIOUS
          // exam's data, stale, until something unrelated happened to
          // refetch it. Clearing the whole cache is the only approach that's
          // provably safe against every current AND future un-scoped key
          // without auditing/enumerating each one by hand — deliberately
          // blunt, and deliberately scoped to ONLY this mutation (see
          // useUpdateProfile, which does not do this for e.g. a display-name
          // edit). TanStack Query refetches every currently-mounted query
          // right after a clear, so this reads as a brief reload, not a
          // blank app.
          queryClient.clear();
          setPendingExam(null);
        },
      },
    );
  }

  return (
    <>
      <SectionCard
        title={t("ExamSwitcher.title")}
        description={
          currentExam ? t("ExamSwitcher.currentExam", { exam: currentExam.display_name_i18n[locale] }) : undefined
        }
      >
        <ExamPickerList value={profile?.target_exam} onSelect={handleSelect} compact />
      </SectionCard>

      <Dialog.Root open={!!pendingExam} onOpenChange={(next) => !next && setPendingExam(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in">
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

            {updateProfile.isError && (
              <p role="alert" className="mt-3 rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral-foreground">
                {updateProfile.error instanceof Error ? updateProfile.error.message : t("ExamSwitcher.confirmError")}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPendingExam(null)} disabled={updateProfile.isPending}>
                {t("ExamSwitcher.confirmCancel")}
              </Button>
              <Button type="button" onClick={confirmSwitch} disabled={updateProfile.isPending} className="gap-2">
                {updateProfile.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t("ExamSwitcher.confirmSwitch")}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
