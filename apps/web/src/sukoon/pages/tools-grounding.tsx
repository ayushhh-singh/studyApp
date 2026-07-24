/**
 * F6 interactive 5-4-3-2-1 grounding: the user taps through senses
 * (see/touch/hear/smell/taste), with an optional one-line note per step.
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Eye, Hand, Ear, Flower2, Utensils, type LucideIcon } from "lucide-react";
import type { SukoonExercise } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useExerciseSession } from "@/sukoon/lib/use-exercise-session";
import { useToolReturnTo } from "@/sukoon/lib/use-tool-return-to";
import { ToolPlayerFrame } from "@/sukoon/components/tools/tool-player-frame";
import { CompletionScreen } from "@/sukoon/components/tools/completion-screen";

const SENSE_ICONS: Record<string, LucideIcon> = {
  see: Eye,
  touch: Hand,
  hear: Ear,
  smell: Flower2,
  taste: Utensils,
};

function GroundingPlayer({ exercise }: { exercise: Extract<SukoonExercise, { type: "grounding" }> }) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const { steps, allow_text_input } = exercise.config;

  const [started, setStarted] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [done, setDone] = useState(false);
  const session = useExerciseSession(exercise.id);
  const { returnTo, finish } = useToolReturnTo();

  const start = () => {
    session.start();
    setStarted(true);
    setStepIdx(0);
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

  if (done) {
    return (
      <div className="mx-auto max-w-lg">
        <CompletionScreen
          title={t("Sukoon.tools.grounding.doneTitle")}
          description={t("Sukoon.tools.grounding.doneBody")}
          onRestart={start}
          restartLabel={t("Sukoon.tools.doAgain")}
          onDone={
            returnTo
              ? finish
              : () => {
                  setStarted(false);
                  setNotes({});
                }
          }
          doneLabel={returnTo ? t("Sukoon.tools.backToJourney") : t("Sukoon.tools.backToTools")}
        />
      </div>
    );
  }

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
          <p className="text-sm text-muted-foreground">{t("Sukoon.tools.grounding.intro")}</p>
          <Button onClick={start} size="lg">
            {t("Sukoon.tools.start")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-center gap-1.5">
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

          {steps[stepIdx] ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-secondary/15 text-secondary">
                {(() => {
                  const Icon = SENSE_ICONS[steps[stepIdx].sense] ?? Eye;
                  return <Icon className="size-7" aria-hidden />;
                })()}
              </span>
              <span className="text-3xl font-bold text-secondary">{steps[stepIdx].count}</span>
              <p className="text-base leading-relaxed text-foreground">
                {language === "hi" ? steps[stepIdx].prompt_hi : steps[stepIdx].prompt_en}
              </p>
              {allow_text_input ? (
                <input
                  value={notes[stepIdx] ?? ""}
                  onChange={(e) => setNotes((cur) => ({ ...cur, [stepIdx]: e.target.value }))}
                  placeholder={t("Sukoon.tools.grounding.notePlaceholder")}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : null}
            </div>
          ) : null}

          <Button onClick={next} size="lg">
            {stepIdx >= steps.length - 1 ? t("Sukoon.tools.grounding.finish") : t("Sukoon.tools.grounding.next")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function Component() {
  return <ToolPlayerFrame type="grounding">{(exercise) => <GroundingPlayer exercise={exercise} />}</ToolPlayerFrame>;
}
