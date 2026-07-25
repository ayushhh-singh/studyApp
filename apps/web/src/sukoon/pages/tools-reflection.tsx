/**
 * F6 reflection player: a self-guided thinking tool (thought-reframing, a
 * values check-in, a worry-time container). The user steps through a short
 * sequence of prompt cards at their own pace — some offer an optional text box
 * or a tap-to-pick chip set. Anything typed or picked lives ONLY in local
 * component state: nothing is saved, nothing is sent to an AI (self-guided, not
 * AI-diagnostic — mirrors grounding's ephemeral per-step notes).
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { SukoonExercise, SukoonReflectionStep } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useExerciseSession } from "@/sukoon/lib/use-exercise-session";
import { useToolReturnTo } from "@/sukoon/lib/use-tool-return-to";
import { ToolPlayerFrame } from "@/sukoon/components/tools/tool-player-frame";
import { CompletionScreen } from "@/sukoon/components/tools/completion-screen";

type Lang = "hi" | "en";

function stepPrompt(step: SukoonReflectionStep, language: Lang): string {
  return language === "hi" ? step.prompt_hi : step.prompt_en;
}
function stepHelper(step: SukoonReflectionStep, language: Lang): string | null {
  return (language === "hi" ? step.helper_hi : step.helper_en) ?? null;
}
function stepPlaceholder(step: SukoonReflectionStep, language: Lang): string {
  return (language === "hi" ? step.placeholder_hi : step.placeholder_en) ?? "";
}

function ReflectionPlayer({ exercise }: { exercise: Extract<SukoonExercise, { type: "reflection" }> }) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const { intro_hi, intro_en, steps, closing_hi, closing_en } = exercise.config;

  const [started, setStarted] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  // Ephemeral, local-only — never posted or persisted (see the file note).
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [done, setDone] = useState(false);
  const session = useExerciseSession(exercise.id);
  const { returnTo, finish } = useToolReturnTo();

  const start = () => {
    session.start();
    setStarted(true);
    setStepIdx(0);
    setDone(false);
  };

  const reset = () => {
    setStarted(false);
    setStepIdx(0);
    setNotes({});
    setPicks({});
    setDone(false);
  };

  const next = () => {
    if (stepIdx >= steps.length - 1) {
      session.complete();
      setDone(true);
      return;
    }
    setStepIdx((i) => i + 1);
  };
  const back = () => setStepIdx((i) => Math.max(0, i - 1));

  const toggleChip = (chipId: string) =>
    setPicks((cur) => {
      const current = cur[stepIdx] ?? [];
      const nextPicks = current.includes(chipId)
        ? current.filter((c) => c !== chipId)
        : [...current, chipId];
      return { ...cur, [stepIdx]: nextPicks };
    });

  if (done) {
    return (
      <div className="mx-auto max-w-lg">
        <CompletionScreen
          title={t("Sukoon.tools.reflection.doneTitle")}
          description={language === "hi" ? closing_hi : closing_en}
          onRestart={start}
          restartLabel={t("Sukoon.tools.doAgain")}
          onDone={returnTo ? finish : reset}
          doneLabel={returnTo ? t("Sukoon.tools.backToJourney") : t("Sukoon.tools.backToTools")}
        />
      </div>
    );
  }

  const step = steps[stepIdx];
  const isLast = stepIdx >= steps.length - 1;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6" lang={language}>
      <PageHeader
        title={language === "hi" ? exercise.title_hi : exercise.title_en}
        action={
          <Link to={`${base}/tools`} className="text-sm font-medium text-muted-foreground hover:text-foreground">
            {t("Sukoon.tools.backToTools")}
          </Link>
        }
      />

      {!started ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">{language === "hi" ? intro_hi : intro_en}</p>
          <p className="text-xs text-muted-foreground/80">{t("Sukoon.tools.reflection.privacyNote")}</p>
          <Button onClick={start} size="lg">
            {t("Sukoon.tools.start")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-center gap-1.5" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={
                  "h-1.5 flex-1 rounded-full transition-colors duration-300 " +
                  (i <= stepIdx ? "bg-secondary" : "bg-muted")
                }
              />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            {t("Sukoon.onboarding.stepProgress", { current: stepIdx + 1, total: steps.length })}
          </p>

          {step ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
              <p className="text-base leading-relaxed text-foreground">{stepPrompt(step, language)}</p>
              {stepHelper(step, language) ? (
                <p className="text-sm leading-relaxed text-muted-foreground">{stepHelper(step, language)}</p>
              ) : null}

              {step.input === "short" ? (
                <input
                  value={notes[stepIdx] ?? ""}
                  onChange={(e) => setNotes((cur) => ({ ...cur, [stepIdx]: e.target.value }))}
                  placeholder={stepPlaceholder(step, language)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : null}

              {step.input === "long" ? (
                <textarea
                  value={notes[stepIdx] ?? ""}
                  onChange={(e) => setNotes((cur) => ({ ...cur, [stepIdx]: e.target.value }))}
                  placeholder={stepPlaceholder(step, language)}
                  rows={4}
                  className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : null}

              {step.input === "chips" && step.chips ? (
                <div className="flex flex-wrap gap-2">
                  {step.chips.map((chip) => {
                    const active = (picks[stepIdx] ?? []).includes(chip.id);
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => toggleChip(chip.id)}
                        aria-pressed={active}
                        className={
                          "min-h-11 rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-300 " +
                          (active
                            ? "border-secondary bg-secondary/15 text-secondary"
                            : "border-border bg-background text-muted-foreground hover:border-secondary/40")
                        }
                      >
                        {language === "hi" ? chip.label_hi : chip.label_en}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            {stepIdx > 0 ? (
              <Button onClick={back} size="lg" variant="outline" className="shrink-0">
                {t("Sukoon.tools.reflection.back")}
              </Button>
            ) : null}
            <Button onClick={next} size="lg" className="flex-1">
              {isLast ? t("Sukoon.tools.reflection.finish") : t("Sukoon.tools.reflection.next")}
            </Button>
          </div>

          {step && step.input !== "none" ? (
            <p className="text-center text-xs text-muted-foreground/80">{t("Sukoon.tools.reflection.optionalNote")}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function Component() {
  return <ToolPlayerFrame type="reflection">{(exercise) => <ReflectionPlayer exercise={exercise} />}</ToolPlayerFrame>;
}
