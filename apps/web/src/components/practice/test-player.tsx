import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, Flag, Grid3x3, Languages, X } from "lucide-react";
import type { AttemptAnswerRecord, AttemptSubmitResult, Locale, TestDetail } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { ExamYearChip } from "@/components/ui-x/exam-chip";
import { CountdownTimer } from "./countdown-timer";
import { QuestionPalette, type QuestionStatus } from "./question-palette";
import { SubmitConfirmDialog } from "./submit-confirm-dialog";
import { useAttemptAnswers } from "@/hooks/use-attempt-answers";
import { useSubmitAttempt } from "@/hooks/use-attempt";
import { cn } from "@/lib/utils";

interface AnswerState {
  chosen_option_key: string | null;
  time_spent_seconds: number;
}

function markedStorageKey(attemptId: string): string {
  return `prayasup-attempt-marked-${attemptId}`;
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
}: {
  test: TestDetail;
  attemptId: string;
  startedAt: string;
  initialAnswers: AttemptAnswerRecord[];
  onSubmitted: (result: AttemptSubmitResult) => void;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
  const activeSinceRef = useRef(Date.now());

  const { saveAnswer, flushNow } = useAttemptAnswers(attemptId);
  const submitAttempt = useSubmitAttempt();

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
    const existing = answers[question.id] ?? { chosen_option_key: null, time_spent_seconds: 0 };
    const next = { ...existing, chosen_option_key: optionKey };
    setAnswers((prev) => ({ ...prev, [question.id]: next }));
    saveAnswer({ question_id: question.id, ...next });
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
    flushTimeFor(question.id);
    // Wait for the answer queue to actually reach the server first — firing
    // submit immediately after the last option pick would otherwise race the
    // autosave POST and could grade the final question as unanswered.
    await flushNow();
    submitAttempt.mutate(attemptId, {
      onSuccess: (result) => {
        localStorage.removeItem(markedStorageKey(attemptId));
        onSubmitted(result);
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

  const statuses: QuestionStatus[] = test.questions.map((q) =>
    marked.has(q.id) ? "marked" : answers[q.id]?.chosen_option_key ? "answered" : "unanswered",
  );
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
          onClick={() => navigate(`/${locale}/practice`)}
          aria-label={t("Practice.exit")}
        >
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
          {deadline && <CountdownTimer deadline={deadline} onExpire={handleSubmit} />}
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
            </div>
          </div>

          <p className={cn("text-base", displayLocale === "hi" && "leading-[1.75]")} lang={displayLocale}>
            {question.stem_i18n[displayLocale]}
          </p>

          <div className="flex flex-col gap-2">
            {question.options_i18n?.map((option) => {
              const selected = answers[question.id]?.chosen_option_key === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => selectOption(option.key)}
                  aria-pressed={selected}
                  className={cn(
                    "flex min-h-11 items-start gap-2 rounded-lg border px-3 py-2.5 text-start text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-accent",
                  )}
                >
                  <span className="font-semibold">{option.key}.</span>
                  <span lang={displayLocale} className={cn(displayLocale === "hi" && "leading-[1.75]")}>
                    {option.text_i18n[displayLocale]}
                  </span>
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
            <Button type="button" variant={marked.has(question.id) ? "default" : "outline"} onClick={toggleMark}>
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
      />
    </div>
  );
}
