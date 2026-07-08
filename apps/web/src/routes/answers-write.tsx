import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import type { Locale, SubmissionMode } from "@prayasup/shared";
import { MAX_CUSTOM_QUESTION_CHARS } from "@prayasup/shared";
import { Breadcrumbs } from "@/components/ui-x/breadcrumbs";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnswerEditor } from "@/components/answers/answer-editor";
import { WritingTimer } from "@/components/answers/writing-timer";
import { HandwrittenUpload, type AnswerPageImage } from "@/components/answers/handwritten-upload";
import { useQuestion } from "@/hooks/use-questions";
import { useCreateSubmission } from "@/hooks/use-answers";
import { useDraftAutosave, readDraft, clearDraft } from "@/hooks/use-draft-autosave";
import { useLocale } from "@/hooks/use-locale";
import { ApiError } from "@/lib/api";
import { prepareAnswerImage, uploadAnswerImage } from "@/lib/answer-images";

const INPUT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const handle = { titleKey: "Nav.answers" };

interface CustomDraft {
  question: string;
  answer: string;
}

/**
 * Every custom (non-catalogued) question shares the single localStorage key
 * `answers-draft:custom` — unlike a catalogued question, which gets its own
 * key per question_id. Persisting only the answer text under that shared key
 * meant returning to Write Room for an unrelated custom prompt silently
 * pre-filled its editor with a PREVIOUS custom prompt's stale answer, with no
 * indication anything was wrong (the question box started blank, looking like
 * a fresh session). Storing {question, answer} together and restoring both
 * makes a resumed draft visibly consistent — the user sees their old
 * question alongside its answer, not an orphaned answer under an empty box —
 * so a stale draft is obviously stale rather than silently misleading.
 */
function readCustomDraft(key: string): CustomDraft {
  const raw = readDraft(key);
  if (!raw) return { question: "", answer: "" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as CustomDraft).answer === "string") {
      const p = parsed as Partial<CustomDraft>;
      return { question: typeof p.question === "string" ? p.question : "", answer: p.answer ?? "" };
    }
  } catch {
    // Pre-existing plain-string draft from before this fix — treat as answer-only.
  }
  return { question: "", answer: raw };
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const questionId = searchParams.get("question") ?? undefined;

  const { data: question, isLoading: isQuestionLoading } = useQuestion(questionId);
  const draftKey = `answers-draft:${questionId ?? "custom"}`;

  const [language, setLanguage] = useState<Locale>(locale);
  const [mode, setMode] = useState<SubmissionMode>("typed");
  const [answerText, setAnswerText] = useState(() => (questionId ? readDraft(draftKey) : readCustomDraft(draftKey).answer));
  const [pages, setPages] = useState<AnswerPageImage[]>([]);
  const [customQuestionText, setCustomQuestionText] = useState(() => (questionId ? "" : readCustomDraft(draftKey).question));
  const [customWordLimit, setCustomWordLimit] = useState(150);
  const [customMarks, setCustomMarks] = useState(10);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const draftIdRef = useRef(crypto.randomUUID());

  // Catalogued questions keep the simple plain-string draft (their key is
  // already unique per question_id, so there's nothing to disambiguate);
  // custom questions serialize {question, answer} together — see
  // readCustomDraft's docstring above.
  useDraftAutosave(
    draftKey,
    questionId ? answerText : JSON.stringify({ question: customQuestionText, answer: answerText }),
  );

  const createSubmission = useCreateSubmission();

  const wordLimit = questionId ? (question?.word_limit ?? null) : customWordLimit;
  const hasQuestion = questionId ? true : customQuestionText.trim().length > 0;
  const canSubmit =
    hasQuestion &&
    (mode === "typed" ? answerText.trim().length > 0 : pages.length > 0) &&
    !createSubmission.isPending &&
    !isUploading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setUploadError(null);

    const questionFields = {
      question_id: questionId,
      custom_question_text: questionId ? undefined : customQuestionText.trim(),
      language,
      word_limit: questionId ? undefined : customWordLimit,
      marks: questionId ? undefined : customMarks,
    };

    if (mode === "typed") {
      createSubmission.mutate(
        { ...questionFields, mode: "typed", typed_text: answerText },
        {
          onSuccess: (submission) => {
            clearDraft(draftKey);
            navigate(`/${locale}/answers/evaluation/${submission.id}`);
          },
        },
      );
      return;
    }

    setIsUploading(true);
    try {
      // Each page's compress+upload is independent — paths are index-keyed, so
      // out-of-order completion is safe — running them in parallel keeps total
      // wait time close to the slowest single page instead of scaling linearly.
      const imagePaths = await Promise.all(
        pages.map(async (page, i) => {
          const prepared = await prepareAnswerImage(page.file, page.rotation);
          return uploadAnswerImage(prepared, draftIdRef.current, i);
        }),
      );
      createSubmission.mutate(
        { ...questionFields, mode: "handwritten", image_paths: imagePaths },
        {
          onSuccess: (submission) => {
            navigate(`/${locale}/answers/confirm/${submission.id}`);
          },
        },
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t("Answers.submitError"));
    } finally {
      setIsUploading(false);
    }
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
        <Tabs value={mode} onValueChange={(v) => setMode(v as SubmissionMode)}>
          <TabsList>
            <TabsTrigger value="typed">{t("Answers.tabTyped")}</TabsTrigger>
            <TabsTrigger value="handwritten">{t("Answers.tabHandwritten")}</TabsTrigger>
          </TabsList>
          <TabsContent value="typed" className="flex flex-col gap-3">
            <WritingTimer />
            <AnswerEditor value={answerText} onChange={setAnswerText} wordLimit={wordLimit} language={language} />
          </TabsContent>
          <TabsContent value="handwritten">
            <HandwrittenUpload pages={pages} onChange={setPages} disabled={isUploading || createSubmission.isPending} />
          </TabsContent>
        </Tabs>

        {(createSubmission.isError || uploadError) && (
          <p className="text-sm text-destructive">
            {uploadError ??
              (createSubmission.error instanceof ApiError ? createSubmission.error.message : t("Answers.submitError"))}
          </p>
        )}

        <Button type="button" size="lg" className="self-start" disabled={!canSubmit} onClick={handleSubmit}>
          {isUploading
            ? t("Answers.handwrittenUploading")
            : createSubmission.isPending
              ? t("Answers.submitting")
              : t("Answers.submitCta")}
        </Button>
      </SectionCard>
    </div>
  );
}
