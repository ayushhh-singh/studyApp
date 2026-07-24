/**
 * F8 check-in flow — a calm single-screen form (all items visible, a top
 * progress bar counting answered/total), used for both WHO-5 and the Exam Stress
 * Self-Check. Item text + scale labels come from the shared constants
 * (SUKOON_CHECKIN_DEFS) — the same single-source pattern mood.tsx uses for the
 * emotion wheel / factor chips, so the approved copy lives in one place.
 *
 * SAFETY (SUKOON_CONTEXT): standing "self-reflection, not a medical assessment"
 * framing; on a low result, a GENTLE (never alarm) support card pointing to
 * journeys + the helpline — no label, no diagnosis, no score-as-verdict.
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, Check, HeartHandshake, LifeBuoy } from "lucide-react";
import { SUKOON_CHECKIN_DEFS, type SukoonCheckinType } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui-x/section-card";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSubmitCheckin } from "@/sukoon/lib/use-sukoon-checkins";

interface Result {
  score: number;
  low: boolean;
}

export function CheckinFlow({ type }: { type: SukoonCheckinType }) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const def = SUKOON_CHECKIN_DEFS[type];
  const submit = useSubmitCheckin();

  const [answers, setAnswers] = useState<(number | null)[]>(() => def.items.map(() => null));
  const [result, setResult] = useState<Result | null>(null);

  const answeredCount = answers.filter((a) => a != null).length;
  const total = def.items.length;
  const complete = answeredCount === total;

  const setAnswer = (i: number, v: number) =>
    setAnswers((cur) => cur.map((a, idx) => (idx === i ? v : a)));

  const handleSubmit = () => {
    if (!complete || submit.isPending) return;
    // Non-null asserted: `complete` guarantees every slot is filled.
    const filled = answers.map((a) => a as number);
    const body =
      type === "who5"
        ? ({ type: "who5", answers: filled } as const)
        : ({ type: "stress_self_check", answers: filled } as const);
    submit.mutate(body, {
      onSuccess: (res) => setResult({ score: res.checkin.score, low: res.low }),
    });
  };

  if (result) return <CheckinResult type={type} result={result} base={base} />;

  return (
    <div className="flex flex-col gap-5" lang={language}>
      {/* Standing self-reflection framing (never "assessment/diagnosis"). */}
      <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground">
        {t("Sukoon.checkin.framing")}
      </p>

      {/* Calm progress */}
      <div className="flex flex-col gap-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-secondary transition-all duration-500"
            style={{ width: `${(answeredCount / total) * 100}%` }}
          />
        </div>
        <p className="text-right text-xs text-muted-foreground">
          {t("Sukoon.checkin.progress", { done: answeredCount, total })}
        </p>
      </div>

      <p className="text-sm text-muted-foreground">{t("Sukoon.checkin.instruction")}</p>

      {def.items.map((item, i) => (
        <SectionCard key={item.id} title={language === "hi" ? item.text_hi : item.text_en}>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={language === "hi" ? item.text_hi : item.text_en}>
            {def.scale.map((opt) => {
              const active = answers[i] === opt.value;
              const label = language === "hi" ? opt.label_hi : opt.label_en;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={label}
                  title={label}
                  onClick={() => setAnswer(i, opt.value)}
                  className={cn(
                    "min-w-[2.75rem] flex-1 rounded-xl border px-2 py-2 text-center transition-colors duration-300",
                    active
                      ? "border-secondary bg-secondary/15 text-secondary"
                      : "border-border bg-card text-muted-foreground hover:border-secondary/40",
                  )}
                >
                  <span className="block text-sm font-semibold tabular-nums">{opt.value}</span>
                  <span className="mt-0.5 block text-[10px] leading-tight">{label}</span>
                </button>
              );
            })}
          </div>
        </SectionCard>
      ))}

      <Button onClick={handleSubmit} disabled={!complete || submit.isPending}>
        {submit.isPending ? t("Sukoon.checkin.submitting") : t("Sukoon.checkin.submit")}
      </Button>
      {submit.isError ? (
        <p className="text-center text-sm text-destructive">{t("Sukoon.checkin.error")}</p>
      ) : null}
    </div>
  );
}

function CheckinResult({
  type,
  result,
  base,
}: {
  type: SukoonCheckinType;
  result: Result;
  base: string;
}) {
  const { t, language } = useSukoonLanguage();
  // WHO-5: higher = better wellbeing. Stress: higher = more load. The label is a
  // gentle, non-diagnostic reflection band — never a verdict.
  const bandKey =
    type === "who5"
      ? result.low
        ? "who5Low"
        : "who5Ok"
      : result.low
        ? "stressHigh"
        : "stressOk";

  return (
    <div className="flex flex-col gap-5" lang={language}>
      <SectionCard title={t("Sukoon.checkin.resultTitle")}>
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-secondary/15">
            <Check className="size-7 text-secondary" aria-hidden />
          </div>
          <p className="text-sm leading-relaxed text-foreground">{t(`Sukoon.checkin.band.${bandKey}`)}</p>
          <p className="text-xs text-muted-foreground">{t("Sukoon.checkin.resultNote")}</p>
        </div>
      </SectionCard>

      {result.low ? (
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <HeartHandshake className="size-4 text-secondary" aria-hidden />
              {t("Sukoon.checkin.support.title")}
            </span>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-foreground">{t("Sukoon.checkin.support.body")}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link to={`${base}/journeys`}>
                  {t("Sukoon.checkin.support.exploreJourneys")}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a href="tel:14416">
                  <LifeBuoy className="size-3.5" aria-hidden />
                  {t("Sukoon.checkin.support.helpline")}
                </a>
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <Button variant="outline" asChild>
        <Link to={`${base}/you`}>{t("Sukoon.checkin.viewTrends")}</Link>
      </Button>
    </div>
  );
}
