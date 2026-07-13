import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useNavigate } from "react-router";
import { AlertCircle, ChevronLeft, ChevronRight, Flag, Grid3x3, Languages, Loader2, X } from "lucide-react";
import type { AttemptAnswerRecord, AttemptSubmitResult, Locale, TestDetail } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { ExamYearChip } from "@/components/ui-x/exam-chip";
import { ReportQuestionSheet } from "@/components/questions/report-question-sheet";
import { CountdownTimer } from "./countdown-timer";
import { QuestionPalette, type QuestionStatus } from "./question-palette";
import { SubmitConfirmDialog } from "./submit-confirm-dialog";
import { LeaveConfirmDialog } from "./leave-confirm-dialog";
import { ComboFlame } from "./combo-flame";
import { GhostMarker } from "./ghost-marker";
import { useAttemptAnswers } from "@/hooks/use-attempt-answers";
import { useSubmitAttempt } from "@/hooks/use-attempt";
import { useCombo } from "@/hooks/use-combo";
import { cn } from "@/lib/utils";
import { formatQuestionStem } from "@/lib/format-question-stem";

interface AnswerState {
  chosen_option_key: string | null;
  time_spent_seconds: number;
}

function markedStorageKey(attemptId: string): string {
  return `neev-attempt-marked-${attemptId}`;
}

function loadMarked(attemptId: string): Set<string> {
  try {
    const raw = localStorage.getItem(markedStorageKey(attemptId));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveMarked(attemptId: string, marked: Set<string>): void {
  try {
    localStorage.setItem(markedStorageKey(attemptId), JSON.stringify([...marked]));
  } catch {
    // best-effort only — marks are a client-side convenience, not graded state
  }
}

export function TestPlayer({
  test,
  attemptId,
  startedAt,
  initialAnswers,
  onSubmitted,
  locale,
  instantFeedback = false,
  answerKey,
  autoAdvance = false,
  onExit,
  bigTimer = false,
  onComboBest,
  ghost,
}: {
  test: TestDetail;
  attemptId: string;
  startedAt: string;
  initialAnswers: AttemptAnswerRecord[];
  onSubmitted: (result: AttemptSubmitResult) => void;
  locale: Locale;
  /** Instant-feedback game mode (Time Attack, Ghost Battle): reveal correctness live + track a combo. */
  instantFeedback?: boolean;
  /** question_id -> correct_option_key. Required for instantFeedback to reveal. */
  answerKey?: Record<string, string>;
  /** Auto-advance to the next question shortly after an answer is revealed. */
  autoAdvance?: boolean;
  /** Override the exit (X) target; defaults to the Practice list. */
  onExit?: () => void;
  /** Render a prominent "big timer" (Time Attack). */
  bigTimer?: boolean;
  /** Reports the run's best combo as it grows (for the Time Attack end screen). */
  onComboBest?: (best: number) => void;
  /** Ghost Battle: past-you's cumulative per-question seconds, for the live marker. */
  ghost?: { cumulativeSeconds: number[] };
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reveal = instantFeedback && !!answerKey;
  const { combo, best, register } = useCombo();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [displayLocale, setDisplayLocale] = useState<Locale>(locale);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() => {
    const map: Record<string, AnswerState> = {};
    for (const a of initialAnswers) {
      map[a.question_id] = { chosen_option_key: a.chosen_option_key, time_spent_seconds: a.time_spent_seconds ?? 0 };
    }
    return map;
  });
  const [marked, setMarked] = useState<Set<string>>(() => loadMarked(attemptId));
  const [submitOpen, setSubmitOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const activeSinceRef = useRef(Date.now());
  // Synchronous re-entrancy lock: handleSubmit awaits flushNow() before it
  // ever calls submitAttempt.mutate(), so submitAttempt.isPending is false
  // during that whole window — a second trigger (the countdown expiring right
  // as the user clicks Confirm) could otherwise start a second concurrent
  // submit. A ref is set synchronously at the top of handleSubmit, closing
  // that gap; submitAttempt.isPending isn't enough on its own.
  const submittingRef = useRef(false);
  // Set once the attempt has actually been submitted (right before the
  // onSubmitted navigation fires), so the leave-guard below stops blocking
  // that specific navigation.
  const submittedRef = useRef(false);

  const { saveAnswer, flushNow, status: autosaveStatus } = useAttemptAnswers(attemptId);
  const submitAttempt = useSubmitAttempt();

  // Guard against silently abandoning an unsubmitted attempt — covers the
  // header X button (it calls navigate()/onExit(), which IS an in-app
  // navigation and so is intercepted here too), browser back/forward, and any
  // other in-app navigation attempt while this route is mounted.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !submittedRef.current && currentLocation.pathname !== nextLocation.pathname,
  );

  const question = test.questions[currentIndex];

  function flushTimeFor(questionId: string) {
    const now = Date.now();
    const delta = Math.round((now - activeSinceRef.current) / 1000);
    activeSinceRef.current = now;
    if (delta <= 0) return;
    setAnswers((prev) => {
      const existing = prev[questionId] ?? { chosen_option_key: null, time_spent_seconds: 0 };
      const next = { ...existing, time_spent_seconds: existing.time_spent_seconds + delta };
      saveAnswer({ question_id: questionId, ...next });
      return { ...prev, [questionId]: next };
    });
  }

  function goTo(index: number) {
    if (index < 0 || index >= test.questions.length) return;
    flushTimeFor(question.id);
    setCurrentIndex(index);
    setPaletteOpen(false);
  }

  function selectOption(optionKey: string) {
    // Instant-feedback modes lock a question once answered (you can't re-pick to
    // fish for the right one) and reveal correctness immediately.
    if (reveal && revealed.has(question.id)) return;
    const existing = answers[question.id] ?? { chosen_option_key: null, time_spent_seconds: 0 };
    const next = { ...existing, chosen_option_key: optionKey };
    setAnswers((prev) => ({ ...prev, [question.id]: next }));
    saveAnswer({ question_id: question.id, ...next });
    if (reveal) {
      flushTimeFor(question.id);
      setRevealed((prev) => new Set(prev).add(question.id));
      register(answerKey![question.id] === optionKey);
      if (autoAdvance && currentIndex < test.questions.length - 1) {
        const nextIndex = currentIndex + 1;
        window.setTimeout(() => setCurrentIndex(nextIndex), 750);
      }
    }
  }

  function toggleMark() {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(question.id)) next.delete(question.id);
      else next.add(question.id);
      saveMarked(attemptId, next);
      return next;
    });
  }

  async function handleSubmit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitError(null);
    flushTimeFor(question.id);
    try {
      // Wait for the answer queue to actually reach the server first — firing
      // submit immediately after the last option pick would otherwise race
      // the autosave POST and could grade the final question as unanswered.
      // flushNow() now genuinely waits for the request to land (even if
      // another autosave flush was already in flight) and rejects if it
      // truly failed, rather than resolving early.
      await flushNow();
    } catch {
      submittingRef.current = false;
      setSubmitError(t("Practice.submitSyncFailed"));
      return;
    }
    submitAttempt.mutate(attemptId, {
      onSuccess: (result) => {
        submittedRef.current = true;
        localStorage.removeItem(markedStorageKey(attemptId));
        onSubmitted(result);
      },
      onError: () => {
        submittingRef.current = false;
        setSubmitError(t("Practice.submitFailed"));
      },
    });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Don't let shortcuts reach the player while the submit dialog or the
      // mobile palette sheet is open on top of it.
      if (submitOpen || paletteOpen) return;
      if (event.key === "ArrowRight") goTo(currentIndex + 1);
      else if (event.key === "ArrowLeft") goTo(currentIndex - 1);
      else if (event.key.toLowerCase() === "m") toggleMark();
      else {
        const optionIndex = ["1", "2", "3", "4"].indexOf(event.key);
        if (optionIndex >= 0 && question.options_i18n?.[optionIndex]) {
          selectOption(question.options_i18n[optionIndex].key);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Re-subscribed on every relevant state change so the handler always
    // closes over the current question/answers/marked/dialog snapshot.
  }, [currentIndex, question, answers, marked, submitOpen, paletteOpen]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    onComboBest?.(best);
  }, [best, onComboBest]);

  // Answered and marked are independent, not mutually exclusive — a real
  // usage pattern is answering a question and ALSO marking it to double
  // check later. The old if/else chain let "marked" win outright, silently
  // dropping the "answered" signal (palette color, Check icon, and
  // aria-label) the moment a question was also marked.
  const statuses: QuestionStatus[] = test.questions.map((q) => {
    const isAnswered = !!answers[q.id]?.chosen_option_key;
    const isMarked = marked.has(q.id);
    if (isAnswered && isMarked) return "answered_marked";
    if (isMarked) return "marked";
    if (isAnswered) return "answered";
    return "unanswered";
  });
  const unansweredCount = test.questions.filter((q) => !answers[q.id]?.chosen_option_key).length;

  const deadline = test.duration_minutes ? new Date(startedAt).getTime() + test.duration_minutes * 60_000 : null;

  const paletteEl = (
    <QuestionPalette count={test.questions.length} currentIndex={currentIndex} statuses={statuses} onSelect={goTo} />
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => (onExit ? onExit() : navigate(`/${locale}/practice`))}
          aria-label={t("Practice.exit")}
        >
          <X aria-hidden />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{test.title_i18n[displayLocale]}</span>
        <div className="flex shrink-0 items-center gap-2">
          {autosaveStatus !== "idle" && (
            <span
              className={cn(
                "hidden items-center gap-1 text-xs sm:flex",
                // text-coral-foreground, not text-coral: the raw --coral token on a
                // light background is ~3.7:1, under the 4.5:1 needed for this small
                // text — the -foreground pairing is the higher-contrast variant.
                autosaveStatus === "error" ? "text-coral-foreground" : "text-muted-foreground",
              )}
              role="status"
            >
              {autosaveStatus === "error" ? (
                <>
                  <AlertCircle className="size-3.5" aria-hidden /> {t("Practice.syncError")}
                </>
              ) : (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("Practice.saving")}
                </>
              )}
            </span>
          )}
          {ghost && (
            <GhostMarker
              startedAt={startedAt}
              cumulativeSeconds={ghost.cumulativeSeconds}
              total={test.questions.length}
              yourIndex={currentIndex}
            />
          )}
          <ComboFlame combo={combo} />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setDisplayLocale((l) => (l === "en" ? "hi" : "en"))}
            aria-label={t("Practice.toggleLanguage")}
          >
            <Languages aria-hidden />
          </Button>
          {deadline && <CountdownTimer deadline={deadline} onExpire={handleSubmit} size={bigTimer ? "lg" : "sm"} />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("Practice.questionOf", { current: currentIndex + 1, total: test.questions.length })}</span>
            <div className="flex items-center gap-2">
              <ExamYearChip
                examCode={question.exam_code}
                examLabel={question.exam_label_i18n}
                year={question.year}
                outOfSyllabus={question.out_of_syllabus}
              />
              {question.marks != null && <span>{t("Learn.marks", { count: question.marks })}</span>}
              <ReportQuestionSheet questionId={question.id} />
            </div>
          </div>

          <p
            className={cn("text-base whitespace-pre-line", displayLocale === "hi" && "leading-[1.75]")}
            lang={displayLocale}
          >
            {formatQuestionStem(question.stem_i18n[displayLocale])}
          </p>

          <div className="flex flex-col gap-2">
            {question.options_i18n?.map((option) => {
              const selected = answers[question.id]?.chosen_option_key === option.key;
              const isRevealed = reveal && revealed.has(question.id);
              const isCorrectOpt = isRevealed && option.key === answerKey![question.id];
              const isWrongChosen = isRevealed && selected && !isCorrectOpt;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => selectOption(option.key)}
                  aria-pressed={selected}
                  disabled={isRevealed}
                  className={cn(
                    "flex min-h-11 items-start gap-2 rounded-lg border px-3 py-2.5 text-start text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                    isCorrectOpt
                      ? "border-tulsi bg-tulsi/15"
                      : isWrongChosen
                        ? "border-coral bg-coral/15"
                        : selected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background hover:bg-accent",
                  )}
                >
                  <span className="font-semibold">{option.key}.</span>
                  <span lang={displayLocale} className={cn(displayLocale === "hi" && "leading-[1.75]")}>
                    {option.text_i18n[displayLocale]}
                  </span>
                  {/* Correctness is conveyed by border/background color alone visually —
                      mirror it as text for screen readers once the answer is revealed. */}
                  {isCorrectOpt && <span className="sr-only"> — {t("Practice.resultsCorrect")}</span>}
                  {isWrongChosen && <span className="sr-only"> — {t("Practice.resultsIncorrect")}</span>}
                </button>
              );
            })}
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => goTo(currentIndex - 1)}
              disabled={currentIndex === 0}
            >
              <ChevronLeft aria-hidden />
              {t("Practice.previous")}
            </Button>
            <Button
              type="button"
              variant={marked.has(question.id) ? "default" : "outline"}
              aria-pressed={marked.has(question.id)}
              onClick={toggleMark}
            >
              <Flag aria-hidden />
              {marked.has(question.id) ? t("Practice.unmark") : t("Practice.mark")}
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
            <Button type="button" onClick={() => setSubmitOpen(true)} className="ms-auto">
              {t("Practice.submitTest")}
            </Button>
          </div>
        </div>

        <aside className="hidden w-64 shrink-0 overflow-y-auto border-s border-border p-4 lg:block">{paletteEl}</aside>
      </div>

      <SubmitConfirmDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        unansweredCount={unansweredCount}
        isSubmitting={submitAttempt.isPending}
        onConfirm={handleSubmit}
        error={submitError}
      />

      <LeaveConfirmDialog
        open={blocker.state === "blocked"}
        onConfirm={() => blocker.state === "blocked" && blocker.proceed()}
        onCancel={() => blocker.state === "blocked" && blocker.reset()}
      />
    </div>
  );
}
