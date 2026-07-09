import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Grid3x3, Languages, X } from "lucide-react";
import type { AnswerSessionDetail, AnswerSessionSubmission, Locale, SubmissionMode } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnswerEditor } from "@/components/answers/answer-editor";
import { HandwrittenUpload, type AnswerPageImage } from "@/components/answers/handwritten-upload";
import { SubmissionStatusChip } from "@/components/answers/submission-status-chip";
import { CountdownTimer } from "@/components/practice/countdown-timer";
import { useCreateSubmission } from "@/hooks/use-answers";
import { useFinishAnswerSession } from "@/hooks/use-answer-sessions";
import { useDraftAutosave, readDraft, clearDraft } from "@/hooks/use-draft-autosave";
import { ApiError } from "@/lib/api";
import { prepareAnswerImage, uploadAnswerImage } from "@/lib/answer-images";
import { usePaywallStore, toPaywallFeature } from "@/stores/paywall-store";
import { formatQuestionStem } from "@/lib/format-question-stem";
import { cn } from "@/lib/utils";

function sessionDraftKey(sessionId: string, questionId: string): string {
  return `answer-session-draft:${sessionId}:${questionId}`;
}

export function AnswerSessionPlayer({
  detail,
  locale,
  onFinished,
  onExit,
}: {
  detail: AnswerSessionDetail;
  locale: Locale;
  onFinished: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const { session, test } = detail;
  const [submissions, setSubmissions] = useState(detail.submissions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayLocale, setDisplayLocale] = useState<Locale>(locale);
  const [mode, setMode] = useState<SubmissionMode>("typed");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const draftIdRef = useRef(crypto.randomUUID());

  const question = test.questions[currentIndex];
  const draftKey = sessionDraftKey(session.id, question.id);
  const [answerText, setAnswerText] = useState(() => readDraft(draftKey));
  const [pages, setPages] = useState<AnswerPageImage[]>([]);
  useDraftAutosave(draftKey, answerText);

  // Switching questions must reset the editor from THAT question's own draft
  // — otherwise the previous question's in-memory text would bleed into a
  // freshly-opened one.
  useEffect(() => {
    setAnswerText(readDraft(draftKey));
    setPages([]);
    setMode("typed");
    setUploadError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const createSubmission = useCreateSubmission();
  const finishSession = useFinishAnswerSession();
  const openPaywall = usePaywallStore((s) => s.openPaywall);

  const submitted = submissions[question.id];
  const attemptedCount = Object.keys(submissions).length;
  const unattemptedCount = test.questions.length - attemptedCount;

  const deadline = session.duration_minutes
    ? new Date(session.started_at).getTime() + session.duration_minutes * 60_000
    : null;

  function goTo(index: number) {
    if (index < 0 || index >= test.questions.length) return;
    setCurrentIndex(index);
    setPaletteOpen(false);
  }

  function handleFinish() {
    finishSession.mutate(session.id, { onSuccess: () => onFinished() });
  }

  async function handleSubmitAnswer() {
    setUploadError(null);
    const shared = { question_id: question.id, language: displayLocale, answer_session_id: session.id };
    const onSuccess = (result: { id: string; status: AnswerSessionSubmission["status"] }) => {
      clearDraft(draftKey);
      setSubmissions((prev) => ({
        ...prev,
        [question.id]: { submission_id: result.id, status: result.status, mode, overall_score: null, max_score: null },
      }));
    };
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 402) openPaywall(toPaywallFeature(err.feature));
      else if (err instanceof ApiError) setUploadError(err.message);
    };

    if (mode === "typed") {
      createSubmission.mutate({ ...shared, mode: "typed", typed_text: answerText }, { onSuccess, onError });
      return;
    }

    setIsUploading(true);
    try {
      const imagePaths = await Promise.all(
        pages.map(async (page, i) => {
          const prepared = await prepareAnswerImage(page.file, page.rotation);
          return uploadAnswerImage(prepared, `${draftIdRef.current}-${currentIndex}`, i);
        }),
      );
      createSubmission.mutate({ ...shared, mode: "handwritten", image_paths: imagePaths }, { onSuccess, onError });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t("Answers.submitError"));
    } finally {
      setIsUploading(false);
    }
  }

  const canSubmit =
    !submitted &&
    (mode === "typed" ? answerText.trim().length > 0 : pages.length > 0) &&
    !createSubmission.isPending &&
    !isUploading;

  const paletteEl = (
    <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-4">
      {test.questions.map((q, index) => {
        const s = submissions[q.id];
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => goTo(index)}
            aria-current={index === currentIndex}
            aria-label={t("Answers.sessionGoToQuestion", { number: index + 1 })}
            className={cn(
              "flex h-9 items-center justify-center rounded-md border text-sm font-medium transition-colors",
              index === currentIndex
                ? "border-primary ring-2 ring-ring"
                : s
                  ? "border-tulsi bg-tulsi/15 text-tulsi-foreground"
                  : "border-border bg-background hover:bg-accent",
            )}
          >
            {index + 1}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={onExit} aria-label={t("Practice.exit")}>
          <X aria-hidden />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{test.title_i18n[displayLocale]}</span>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setDisplayLocale((l) => (l === "en" ? "hi" : "en"))}
            aria-label={t("Practice.toggleLanguage")}
          >
            <Languages aria-hidden />
          </Button>
          {deadline && <CountdownTimer deadline={deadline} onExpire={handleFinish} />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("Practice.questionOf", { current: currentIndex + 1, total: test.questions.length })}</span>
            <div className="flex items-center gap-2">
              {question.marks != null && <span>{t("Answers.marks", { count: question.marks })}</span>}
              {question.word_limit != null && <span>{t("Answers.wordLimit", { count: question.word_limit })}</span>}
            </div>
          </div>

          <p
            className={cn("text-base whitespace-pre-line", displayLocale === "hi" && "leading-[1.75]")}
            lang={displayLocale}
          >
            {formatQuestionStem(question.stem_i18n[displayLocale])}
          </p>

          {submitted ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-4">
              <SubmissionStatusChip status={submitted.status} />
              <p className="text-sm text-muted-foreground">{t("Answers.sessionAlreadySubmitted")}</p>
            </div>
          ) : (
            <Tabs value={mode} onValueChange={(v) => setMode(v as SubmissionMode)}>
              <TabsList>
                <TabsTrigger value="typed">{t("Answers.tabTyped")}</TabsTrigger>
                <TabsTrigger value="handwritten">{t("Answers.tabHandwritten")}</TabsTrigger>
              </TabsList>
              <TabsContent value="typed">
                <AnswerEditor
                  value={answerText}
                  onChange={setAnswerText}
                  wordLimit={question.word_limit}
                  language={displayLocale}
                />
              </TabsContent>
              <TabsContent value="handwritten">
                <HandwrittenUpload
                  pages={pages}
                  onChange={setPages}
                  disabled={isUploading || createSubmission.isPending}
                />
              </TabsContent>
            </Tabs>
          )}

          {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0}>
              <ChevronLeft aria-hidden />
              {t("Practice.previous")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => goTo(currentIndex + 1)}
              disabled={currentIndex === test.questions.length - 1}
            >
              {t("Practice.next")}
              <ChevronRight aria-hidden />
            </Button>
            <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" className="lg:hidden">
                  <Grid3x3 aria-hidden />
                  {t("Practice.palette")}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" title={t("Practice.palette")}>
                {paletteEl}
              </SheetContent>
            </Sheet>
            {!submitted && (
              <Button type="button" onClick={handleSubmitAnswer} disabled={!canSubmit}>
                {isUploading || createSubmission.isPending ? t("Answers.submitting") : t("Answers.sessionSubmitAnswer")}
              </Button>
            )}
            <Button type="button" variant="outline" className="ms-auto" onClick={() => setFinishOpen(true)}>
              {t("Answers.sessionFinish")}
            </Button>
          </div>
        </div>

        <aside className="hidden w-64 shrink-0 overflow-y-auto border-s border-border p-4 lg:block">{paletteEl}</aside>
      </div>

      <Dialog.Root open={finishOpen} onOpenChange={(next) => !finishSession.isPending && setFinishOpen(next)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in">
            <Dialog.Title className="text-base font-semibold">{t("Answers.sessionFinishConfirmTitle")}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              {unattemptedCount > 0
                ? t("Answers.sessionFinishConfirmUnattempted", { count: unattemptedCount })
                : t("Answers.sessionFinishConfirmAllAttempted")}
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" disabled={finishSession.isPending}>
                  {t("Practice.submitConfirmCancel")}
                </Button>
              </Dialog.Close>
              <Button type="button" onClick={handleFinish} disabled={finishSession.isPending}>
                {finishSession.isPending ? t("Answers.submitting") : t("Answers.sessionFinishConfirmCta")}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
