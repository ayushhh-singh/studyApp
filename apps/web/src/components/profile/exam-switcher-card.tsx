import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/ui-x/section-card";
import { ExamPickerList } from "@/components/ui-x/exam-picker-list";
import { ExamSwitchDialog } from "@/components/ui-x/exam-switch-dialog";
import { useProfile } from "@/hooks/use-profile";
import { useExams } from "@/hooks/use-exams";
import { useExamSwitch } from "@/hooks/use-exam-switch";
import { useLocale } from "@/hooks/use-locale";

/**
 * Lets a signed-in user change `target_exam` from their profile.
 *
 * The picker, the confirmation and the commit path are all shared with the
 * persistent top-bar switcher (`ExamSwitcherChip`) — see `useExamSwitch`. This
 * card remains the full-page home for the choice (reachable with no header
 * chrome, and where the launch-scope detail has room to breathe); the header
 * chip is the same thing one tap away from anywhere.
 */
export function ExamSwitcherCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: profile } = useProfile();
  const { data: exams } = useExams();
  const examSwitch = useExamSwitch();

  const currentExam = exams?.find((e) => e.exam_code === profile?.target_exam);

  return (
    <>
      <SectionCard
        title={t("ExamSwitcher.title")}
        description={
          currentExam
            ? t("ExamSwitcher.currentExam", { exam: currentExam.display_name_i18n[locale] })
            : undefined
        }
      >
        <ExamPickerList value={profile?.target_exam} onSelect={examSwitch.requestSwitch} compact />
      </SectionCard>

      <ExamSwitchDialog state={examSwitch} />
    </>
  );
}
