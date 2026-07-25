/**
 * F7 — the daily step player: renders whichever of the 5 step types is next
 * (read | exercise_ref | journal_prompt | saathi_checkin | checkin_scale),
 * the day-locked countdown, or the journey-complete celebration + reflection
 * save. One query (`useJourneyToday`) drives every state; completing a step
 * writes the fresh state straight back into that query's cache.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Clock3, Milestone, Sparkles } from "lucide-react";
import type { SukoonExercise, SukoonJourneyStep } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import {
  useJourneyToday,
  useStartJourney,
  useCompleteJourneyStep,
  useSaveJourneyReflection,
} from "@/sukoon/lib/use-sukoon-journeys";
import { useExercises } from "@/sukoon/lib/use-sukoon-exercises";
import { toolPlayerPath } from "@/sukoon/lib/tool-icons";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { CompletionScreen } from "@/sukoon/components/tools/completion-screen";
import { SukoonFeedbackWidget } from "@/sukoon/components/sukoon-feedback-widget";

export function Component() {
  const { t, language } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  const { locale, journeySlug } = useParams<{ locale?: string; journeySlug: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const slug = journeySlug ?? "";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useJourneyToday(slug, { enabled: !!session });
  const startMut = useStartJourney();
  const completeMut = useCompleteJourneyStep(slug);
  const reflectionMut = useSaveJourneyReflection(slug);
  const exercisesQuery = useExercises({ enabled: !!session });

  // A return trip from an exercise/journal-entry step (blueprint F7: "opens
  // the actual exercise and returns on completion") lands back here carrying
  // `?completeStep=<id>` — completing is idempotent server-side, so firing it
  // unconditionally on arrival is safe even on a refresh/back-nav replay.
  const consumedRef = useRef<string | null>(null);
  useEffect(() => {
    const stepId = searchParams.get("completeStep");
    if (!stepId || consumedRef.current === stepId) return;
    consumedRef.current = stepId;
    completeMut.mutate({ stepId });
    const next = new URLSearchParams(searchParams);
    next.delete("completeStep");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  if (query.isLoading) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <PageHeader title={t("Sukoon.journeysTitleShort")} />
        <EmptyState
          icon={Milestone}
          title={t("Sukoon.journeys.notFoundTitle")}
          description={t("Sukoon.journeys.notFoundBody")}
          action={
            <Link to={`${base}/journeys`} className="text-sm font-medium text-secondary hover:underline">
              {t("Sukoon.journeys.backToJourneys")}
            </Link>
          }
        />
      </div>
    );
  }

  const { state, step, next_unlock_at, progress } = query.data;

  const backAction = (
    <Link to={`${base}/journeys/${slug}`} className="text-sm font-medium text-muted-foreground hover:text-foreground">
      {t("Sukoon.journeys.backToJourney")}
    </Link>
  );

  if (state === "not_started") {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6" lang={language}>
        <PageHeader title={t("Sukoon.journeysTitleShort")} action={backAction} />
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-secondary/15 text-secondary" aria-hidden>
            <Sparkles className="size-6" />
          </span>
          <p className="text-sm text-muted-foreground">{t("Sukoon.journeys.readyToBegin")}</p>
          <Button size="lg" onClick={() => startMut.mutate(slug)} disabled={startMut.isPending}>
            {t("Sukoon.journeys.start")}
          </Button>
        </div>
      </div>
    );
  }

  if (state === "day_locked") {
    const unlockLabel = next_unlock_at
      ? new Date(next_unlock_at).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : "";
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6" lang={language}>
        <PageHeader title={t("Sukoon.journeysTitleShort")} action={backAction} />
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-secondary/15 text-secondary" aria-hidden>
            <Clock3 className="size-6" />
          </span>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">{t("Sukoon.journeys.dayLockedTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("Sukoon.journeys.dayLockedBody", { date: unlockLabel })}</p>
          </div>
        </div>
      </div>
    );
  }

  if (state === "completed") {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6" lang={language}>
        <PageHeader title={t("Sukoon.journeysTitleShort")} action={backAction} />
        <CompletionScreen
          title={t("Sukoon.journeys.completeTitle")}
          description={t("Sukoon.journeys.completeBody")}
          onDone={() => navigate(`${base}/journeys`)}
          doneLabel={t("Sukoon.journeys.backToJourneys")}
        />
        <SukoonFeedbackWidget
          targetType="journey"
          targetId={slug}
          variant="full"
          prompt={t("Sukoon.feedback.journeyPrompt")}
          className="rounded-2xl border border-border bg-card p-4"
        />
        {progress?.reflection ? (
          <div className="rounded-2xl border border-secondary/40 bg-secondary/10 p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              {t("Sukoon.journeys.yourReflection")}
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{progress.reflection}</p>
          </div>
        ) : (
          <ReflectionForm onSave={(text) => reflectionMut.mutate(text)} saving={reflectionMut.isPending} />
        )}
        <Button
          variant="outline"
          onClick={() => startMut.mutate(slug)}
          disabled={startMut.isPending}
          className="self-start"
        >
          {t("Sukoon.journeys.takeAgain")}
        </Button>
      </div>
    );
  }

  if (state === "step" && step) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6" lang={language}>
        <PageHeader title={t("Sukoon.journeysTitleShort")} action={backAction} />
        <StepView
          key={step.id}
          step={step}
          slug={slug}
          base={base}
          onComplete={(response) => completeMut.mutate({ stepId: step.id, body: { response: response ?? null } })}
          completing={completeMut.isPending}
          exercises={exercisesQuery.data?.exercises ?? []}
          exercisesLoading={exercisesQuery.isLoading}
        />
      </div>
    );
  }

  return null;
}

function ReflectionForm({ onSave, saving }: { onSave: (text: string) => void; saving: boolean }) {
  const { t } = useSukoonLanguage();
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-medium text-foreground">{t("Sukoon.journeys.reflectionPrompt")}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("Sukoon.journeys.reflectionPlaceholder")}
        rows={4}
        className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button
        size="sm"
        className="self-start"
        disabled={!text.trim() || saving}
        onClick={() => onSave(text.trim())}
      >
        {t("Sukoon.journeys.saveReflection")}
      </Button>
    </div>
  );
}

function StepView({
  step,
  slug,
  base,
  onComplete,
  completing,
  exercises,
  exercisesLoading,
}: {
  step: SukoonJourneyStep;
  slug: string;
  base: string;
  onComplete: (response?: string | number | boolean) => void;
  completing: boolean;
  exercises: Pick<SukoonExercise, "id" | "key" | "type">[];
  exercisesLoading: boolean;
}) {
  const { t, language } = useSukoonLanguage();
  const title = language === "hi" ? step.title_hi : step.title_en;
  // Declared unconditionally (Rules of Hooks — this component has several
  // early `return`s below) even though only the checkin_scale branch uses it;
  // `key={step.id}` on the caller's <StepView> resets it on every new step.
  const [selected, setSelected] = useState<number | null>(null);

  if (step.type === "read") {
    const body = language === "hi" ? step.body_hi : step.body_en;
    return (
      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{body}</p>
        <Button onClick={() => onComplete()} disabled={completing} className="self-start">
          {t("Sukoon.journeys.continue")}
        </Button>
      </div>
    );
  }

  if (step.type === "exercise_ref") {
    const exercise = exercises.find((e) => e.key === step.exercise_key);
    const returnTo = `${base}/journeys/${slug}/day?completeStep=${step.id}`;
    return (
      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {exercise ? (
          <Button asChild size="lg" className="self-start">
            <Link to={`${base}/${toolPlayerPath(exercise.type, exercise.id)}?returnTo=${encodeURIComponent(returnTo)}`}>
              {t("Sukoon.journeys.startExercise")}
            </Link>
          </Button>
        ) : exercisesLoading ? (
          // The exercises catalog hasn't resolved yet (e.g. a fresh deep link
          // straight to this page) — show a loading state, not a false
          // "unavailable" that a user could dismiss via "mark done anyway"
          // before the real exercise ever had a chance to load.
          <div className="h-10 w-40 animate-pulse rounded-md bg-muted" aria-hidden />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("Sukoon.journeys.exerciseUnavailable")}</p>
            <Button variant="outline" onClick={() => onComplete()} disabled={completing} className="self-start">
              {t("Sukoon.journeys.markDoneAnyway")}
            </Button>
          </>
        )}
      </div>
    );
  }

  if (step.type === "journal_prompt") {
    const prompt = language === "hi" ? step.prompt_hi : step.prompt_en;
    return (
      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{prompt}</p>
        <Button asChild size="lg" className="self-start">
          <Link
            to={`${base}/journal/new`}
            state={{
              journeyPrompt: { text_hi: step.prompt_hi, text_en: step.prompt_en },
              returnTo: `${base}/journeys/${slug}/day?completeStep=${step.id}`,
            }}
          >
            {t("Sukoon.journeys.writeInJournal")}
          </Link>
        </Button>
      </div>
    );
  }

  if (step.type === "saathi_checkin") {
    const seed = language === "hi" ? step.seed_message_hi : step.seed_message_en;
    return (
      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm italic leading-relaxed text-muted-foreground">"{seed}"</p>
        <Button asChild size="lg" className="self-start" onClick={() => onComplete()}>
          <Link to={`${base}/saathi?seed=${encodeURIComponent(seed)}`}>{t("Sukoon.journeys.talkToSaathi")}</Link>
        </Button>
      </div>
    );
  }

  // checkin_scale
  const question = language === "hi" ? step.question_hi : step.question_en;
  const labels = language === "hi" ? step.scale_labels_hi : step.scale_labels_en;
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{question}</p>
      <div className="flex flex-col gap-2">
        {labels.map((label, i) => {
          const value = step.scale_min + i;
          const active = selected === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setSelected(value)}
              aria-pressed={active}
              className={
                "rounded-xl border px-4 py-2.5 text-left text-sm transition-colors duration-300 " +
                (active
                  ? "border-secondary bg-secondary/15 text-secondary"
                  : "border-border bg-background text-foreground hover:border-secondary/40")
              }
            >
              {label}
            </button>
          );
        })}
      </div>
      <Button
        onClick={() => selected !== null && onComplete(selected)}
        disabled={selected === null || completing}
        className="self-start"
      >
        {t("Sukoon.journeys.continue")}
      </Button>
    </div>
  );
}
