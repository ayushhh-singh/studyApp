import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { useLocale } from "@/hooks/use-locale";
import { useSubmitDrillResponses } from "@/hooks/use-micro-drill";
import { useDrillStream } from "@/hooks/use-drill-stream";
import { useDrillSessionStore } from "@/stores/drill-session-store";
import { DIMENSION_LABEL_KEYS } from "@/lib/rubric-labels";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "MicroDrill.title" };

/** Word count is a soft cap (shown, never enforced) — colored past ~15% over the target. */
const WORD_LIMIT_SOFT_MARGIN = 1.15;

function wordCount(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const session = useDrillSessionStore((s) => s.session);
  const setSession = useDrillSessionStore((s) => s.setSession);
  const submitResponses = useSubmitDrillResponses();
  const stream = useDrillStream(session?.id ?? "");

  const [responses, setResponses] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!session) return;
    setResponses(Object.fromEntries(session.items.map((i) => [i.question_id, i.response_text ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  function goToProfile() {
    setSession(null);
    navigate(`/${locale}/profile`);
  }

  if (!session) {
    return (
      <EmptyState
        icon={Sparkles}
        title={t("MicroDrill.noSessionTitle")}
        description={t("MicroDrill.noSessionDescription")}
        action={<Button onClick={goToProfile}>{t("MicroDrill.backToProfile")}</Button>}
        className="mx-auto mt-8 max-w-md"
      />
    );
  }

  // Rebind to a stable non-null local: TS can't narrow the store-derived
  // `session` inside the nested closures below.
  const activeSession = session;
  const allFilled = activeSession.items.every((item) => (responses[item.question_id] ?? "").trim().length > 0);
  const finalSession = stream.session;
  const isDone = finalSession?.status === "complete";

  function handleSubmit() {
    const payload = activeSession.items.map((item) => ({
      question_id: item.question_id,
      response_text: responses[item.question_id]?.trim() ?? "",
    }));
    submitResponses.mutate(
      { id: activeSession.id, responses: payload },
      {
        onSuccess: (updated) => {
          setSession(updated);
          setSubmitted(true);
          stream.start();
        },
      },
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">
            {session.drill_type === "intro" ? t("MicroDrill.typeIntro") : t("MicroDrill.typeConclusion")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("MicroDrill.focusDimension", { dimension: t(DIMENSION_LABEL_KEYS[session.dimension_key]) })}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={goToProfile}>
          {t("MicroDrill.exit")}
        </Button>
      </div>

      {!submitted && (
        <div className="flex flex-col gap-5">
          {session.items.map((item, i) => {
            const text = responses[item.question_id] ?? "";
            const count = wordCount(text);
            const overLimit = count > item.word_limit * WORD_LIMIT_SOFT_MARGIN;
            return (
              <div key={item.question_id} className="flex flex-col gap-2">
                <span className="text-sm font-semibold">{t("MicroDrill.itemLabel", { index: i + 1 })}</span>
                <p className="text-sm" lang={locale}>
                  {item.question_stem_i18n[locale]}
                </p>
                <textarea
                  className="min-h-28 w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={text}
                  onChange={(e) => setResponses((prev) => ({ ...prev, [item.question_id]: e.target.value }))}
                  placeholder={t("MicroDrill.responsePlaceholder")}
                />
                <span
                  className={cn(
                    "self-end text-xs",
                    overLimit ? "font-semibold text-coral-foreground" : "text-muted-foreground",
                  )}
                >
                  {t("MicroDrill.wordCount", { count, limit: item.word_limit })}
                </span>
              </div>
            );
          })}
          <Button type="button" disabled={!allFilled || submitResponses.isPending} onClick={handleSubmit} className="self-start">
            {submitResponses.isPending ? t("MicroDrill.submitting") : t("MicroDrill.submit")}
          </Button>
          {submitResponses.isError && <p className="text-sm text-destructive">{submitResponses.error.message}</p>}
        </div>
      )}

      {submitted && !isDone && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("MicroDrill.scoringStatus")}</p>
          {stream.error && <p className="text-sm text-destructive">{stream.error}</p>}
          <div className="flex flex-col gap-3">
            {session.items.map((item, i) => {
              const scored = stream.itemScores.find((s) => s.question_id === item.question_id);
              return (
                <div key={item.question_id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-display text-sm">
                    {scored ? Math.round(scored.score) : "…"}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("MicroDrill.itemLabel", { index: i + 1 })}
                    </span>
                    {scored && (
                      <p className="text-sm" lang={locale}>
                        {scored.justification_i18n[locale]}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isDone && finalSession && (
        <div className="flex flex-col items-center gap-4 border-t border-border py-4">
          <ScoreGauge value={finalSession.overall_pct} label={t("MicroDrill.overallScore")} />
          <div className="flex w-full flex-col gap-2">
            {finalSession.items.map((item, i) => (
              <div key={item.question_id} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("MicroDrill.itemLabel", { index: i + 1 })} · {item.score !== null ? `${item.score}/10` : "—"}
                </span>
                {item.justification_i18n && (
                  <p className="text-sm" lang={locale}>
                    {item.justification_i18n[locale]}
                  </p>
                )}
              </div>
            ))}
          </div>
          <Button type="button" onClick={goToProfile}>
            {t("MicroDrill.tryAnother")}
          </Button>
        </div>
      )}
    </div>
  );
}
