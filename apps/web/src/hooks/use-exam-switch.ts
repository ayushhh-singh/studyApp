import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TargetExamCode } from "@neev/shared";
import { useProfile, useUpdateProfile } from "@/hooks/use-profile";

/**
 * The ONE implementation of "change my target exam" — request, confirm, commit,
 * re-scope everything.
 *
 * There are now two entry points (the persistent top-bar switcher and the
 * Profile card) and there will be more. They must not each own a copy of this:
 * the commit step is not a plain mutation — it has to clear the query cache in
 * exactly the right way (below), and a second copy that forgot to would leave
 * that surface silently rendering the previous exam's content. This hook is why
 * the top-bar switcher could stop being a link to Profile without becoming the
 * "second half-built path that can disagree" its own docblock warned about.
 *
 * Confirmation is deliberately REQUIRED rather than optional-per-caller: an
 * exam switch changes what almost every screen contains, and a user who does it
 * by accident from a header chip has no obvious way to understand what just
 * happened to their dashboard. The dialog is what explains that history and
 * streaks are kept per-exam and the revision deck is shared.
 */
export function useExamSwitch() {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();

  const [pendingExam, setPendingExam] = useState<TargetExamCode | null>(null);

  /**
   * Ask to switch. Re-selecting the exam already active is a no-op rather than
   * a confirmation dialog — there is nothing to confirm. Returns whether a
   * confirmation was actually opened, so a caller that owns surrounding chrome
   * (the popover) knows whether to stay open or just close.
   */
  function requestSwitch(code: TargetExamCode): boolean {
    if (code === profile?.target_exam) return false;
    updateProfile.reset();
    setPendingExam(code);
    return true;
  }

  function cancel() {
    setPendingExam(null);
  }

  function confirm() {
    if (!pendingExam) return;
    updateProfile.mutate(
      { target_exam: pendingExam },
      {
        onSuccess: () => {
          // Most exam-scoped query keys (paper summaries, dashboard, tests,
          // mastery, current affairs, magazine, …) do NOT carry the exam code
          // — see lib/query-keys.ts — so a plain refetch of just the profile
          // query would leave every one of those cached under the PREVIOUS
          // exam's data, stale, until something unrelated happened to refetch
          // it. Clearing the whole cache is the only approach that's provably
          // safe against every current AND future un-scoped key without
          // auditing/enumerating each one by hand — deliberately blunt, and
          // deliberately scoped to ONLY this mutation (see useUpdateProfile,
          // which does not do this for e.g. a display-name edit). TanStack
          // Query refetches every currently-mounted query right after a clear,
          // so this reads as a brief reload, not a blank app.
          queryClient.clear();
          setPendingExam(null);
        },
      },
    );
  }

  return {
    /** The exam currently active, or undefined while the profile is loading. */
    currentExam: profile?.target_exam,
    /** The exam awaiting confirmation, or null when no dialog should be open. */
    pendingExam,
    requestSwitch,
    cancel,
    confirm,
    isPending: updateProfile.isPending,
    isError: updateProfile.isError,
    error: updateProfile.error,
  };
}

export type ExamSwitch = ReturnType<typeof useExamSwitch>;
