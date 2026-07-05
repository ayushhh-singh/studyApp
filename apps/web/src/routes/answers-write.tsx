import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import type { Locale } from "@prayasup/shared";
import { MAX_CUSTOM_QUESTION_CHARS } from "@prayasup/shared";
import { Breadcrumbs } from "@/components/ui-x/breadcrumbs";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { AnswerEditor } from "@/components/answers/answer-editor";
import { WritingTimer } from "@/components/answers/writing-timer";
import { useQuestion } from "@/hooks/use-questions";
import { useCreateSubmission } from "@/hooks/use-answers";
import { useDraftAutosave, readDraft, clearDraft } from "@/hooks/use-draft-autosave";
import { useLocale } from "@/hooks/use-locale";
import { ApiError } from "@/lib/api";

const INPUT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const handle = { titleKey: "Nav.answers" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const questionId = searchParams.get("question") ?? undefined;

  const { data: question, isLoading: isQuestionLoading } = useQuestion(questionId);
  const draftKey = `answers-draft:${questionId ?? "custom"}`;

  const [language, setLanguage] = useState<Locale>(locale);
  const [answerText, setAnswerText] = useState(() => readDraft(draftKey));
  const [customQuestionText, setCustomQuestionText] = useState("");
  const [customWordLimit, setCustomWordLimit] = useState(150);
  const [customMarks, setCustomMarks] = useState(10);

  useDraftAutosave(draftKey, answerText);

  const createSubmission = useCreateSubmission();

  const wordLimit = questionId ? (question?.word_limit ?? null) : customWordLimit;
  const canSubmit =
    answerText.trim().length > 0 && (questionId ? true : customQuestionText.trim().length > 0) && !createSubmission.isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    createSubmission.mutate(
      {
        question_id: questionId,
        custom_question_text: questionId ? undefined : customQuestionText.trim(),
        typed_text: answerText,
        language,
        word_limit: questionId ? undefined : customWordLimit,
        marks: questionId ? undefined : customMarks,
      },
      {
        onSuccess: (submission) => {
          clearDraft(draftKey);
          navigate(`/${locale}/answers/evaluation/${submission.id}`);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[{ label: t("Nav.answers"), to: `/${locale}/answers` }, { label: t("Answers.writeRoomBreadcrumb") }]}
      />
      <PageHeader title={t("Answers.writeRoomTitle")} description={t("Answers.writeRoomDescription")} />

      <SectionCard>
        {questionId ? (
          isQuestionLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : question ? (
            <div className="flex flex-col gap-2">
              <p className="text-base leading-[1.75]" lang={locale}>
                {question.stem_i18n[locale]}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{question.paper_code}</span>
                {question.marks !== null && <span>{t("Answers.marks", { count: question.marks })}</span>}
                {question.word_limit !== null && (
                  <span>{t("Answers.wordLimit", { count: question.word_limit })}</span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-destructive">{t("Answers.writeRoomQuestionNotFound")}</p>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("Answers.customQuestionLabel")}
              <textarea
                value={customQuestionText}
                onChange={(e) => setCustomQuestionText(e.target.value.slice(0, MAX_CUSTOM_QUESTION_CHARS))}
                rows={3}
                placeholder={t("Answers.customQuestionPlaceholder")}
                className="w-full resize-y rounded-lg border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="text-xs text-muted-foreground">
                {customQuestionText.length}/{MAX_CUSTOM_QUESTION_CHARS}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t("Answers.customMarksLabel")}
                <input
                  type="number"
                  min={1}
                  max={100}
                  className={INPUT_CLASS}
                  value={customMarks}
                  onChange={(e) => setCustomMarks(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t("Answers.customWordLimitLabel")}
                <input
                  type="number"
                  min={1}
                  max={2000}
                  className={INPUT_CLASS}
                  value={customWordLimit}
                  onChange={(e) => setCustomWordLimit(Math.min(2000, Math.max(1, Number(e.target.value) || 1)))}
                />
              </label>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        action={
          <div className="flex overflow-hidden rounded-full border border-border text-xs">
            <button
              type="button"
              onClick={() => setLanguage("hi")}
              className={`px-2.5 py-1 font-medium ${language === "hi" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              हिन्दी
            </button>
            <button
              type="button"
              onClick={() => setLanguage("en")}
              className={`px-2.5 py-1 font-medium ${language === "en" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              English
            </button>
          </div>
        }
      >
        <WritingTimer />
        <AnswerEditor value={answerText} onChange={setAnswerText} wordLimit={wordLimit} language={language} />

        {createSubmission.isError && (
          <p className="text-sm text-destructive">
            {createSubmission.error instanceof ApiError
              ? createSubmission.error.message
              : t("Answers.submitError")}
          </p>
        )}

        <Button type="button" size="lg" className="self-start" disabled={!canSubmit} onClick={handleSubmit}>
          {createSubmission.isPending ? t("Answers.submitting") : t("Answers.submitCta")}
        </Button>
      </SectionCard>
    </div>
  );
}
