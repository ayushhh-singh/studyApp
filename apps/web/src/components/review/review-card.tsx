import { useTranslation } from "react-i18next";
import { Check, X, AlertTriangle, ShieldQuestion } from "lucide-react";
import type { Difficulty, ReviewQuestion } from "@neev/shared";
import { formatQuestionStem } from "@/lib/format-question-stem";
import { cn } from "@/lib/utils";

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  easy: "bg-tulsi/15 text-tulsi-foreground",
  medium: "bg-marigold/15 text-marigold-foreground",
  hard: "bg-coral/15 text-coral-foreground",
};

function Bilingual({ en, hi }: { en?: string; hi?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {en && <p className="text-sm leading-relaxed whitespace-pre-line">{en}</p>}
      {hi && <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/80" lang="hi">{hi}</p>}
    </div>
  );
}

export function ReviewCard({ question: q }: { question: ReviewQuestion }) {
  const { t } = useTranslation();
  const meta = q.generation_meta;
  const critic = meta?.critic;
  const verify = meta?.verify_result;

  return (
    <div className="flex flex-col gap-4">
      {/* meta chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip className="bg-primary/10 text-primary">{q.paper_code}</Chip>
        <Chip className="bg-muted text-muted-foreground uppercase">{q.type}</Chip>
        <Chip className={DIFFICULTY_STYLE[q.difficulty]}>{t(`Review.difficulty.${q.difficulty}`)}</Chip>
        {q.syllabus_title_i18n && (
          <span className="text-xs text-muted-foreground">{q.syllabus_title_i18n.en}</span>
        )}
        <span className="ml-auto">
          {q.publish_gate_ok ? (
            <Chip className="bg-tulsi/15 text-tulsi-foreground">
              <Check className="size-3" /> {t("Review.willPublish")}
            </Chip>
          ) : (
            <Chip className="bg-coral/15 text-coral-foreground">
              <AlertTriangle className="size-3" /> {t("Review.wontPublish")}
            </Chip>
          )}
        </span>
      </div>

      {/* stem */}
      <div>
        <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("Review.question")}</p>
        <Bilingual en={formatQuestionStem(q.stem_i18n.en)} hi={formatQuestionStem(q.stem_i18n.hi)} />
      </div>

      {/* MCQ options */}
      {q.type === "mcq" && q.options_i18n && (
        <ul className="flex flex-col gap-1.5">
          {q.options_i18n.map((o) => {
            const correct = o.key === q.correct_option_key;
            return (
              <li
                key={o.key}
                className={cn(
                  "flex gap-2 rounded-lg border px-3 py-2 text-sm",
                  correct ? "border-tulsi/50 bg-tulsi/10" : "border-border",
                )}
              >
                <span className={cn("font-semibold", correct && "text-tulsi-foreground")}>{o.key}.</span>
                <span className="flex flex-col gap-0.5">
                  <span>{o.text_i18n.en}</span>
                  <span className="text-foreground/75" lang="hi">{o.text_i18n.hi}</span>
                </span>
                {correct && (
                  <Check className="ml-auto size-4 shrink-0 text-tulsi" aria-label={t("Review.correctAnswer")} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* MCQ explanation */}
      {q.type === "mcq" && q.explanation_i18n && (
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("Review.explanation")}
          </p>
          <Bilingual en={q.explanation_i18n.en} hi={q.explanation_i18n.hi} />
        </div>
      )}

      {/* descriptive marks/word-limit + marking points */}
      {q.type === "descriptive" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {q.marks != null && <Chip className="bg-muted text-muted-foreground">{t("Review.marks", { n: q.marks })}</Chip>}
            {q.word_limit != null && (
              <Chip className="bg-muted text-muted-foreground">{t("Review.wordLimit", { n: q.word_limit })}</Chip>
            )}
          </div>
          {meta?.marking_points_i18n && (
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t("Review.markingPoints")}
              </p>
              <ul className="list-disc pl-5 text-sm">
                {meta.marking_points_i18n.en.map((p, i) => (
                  <li key={i}>
                    {p}
                    {meta.marking_points_i18n?.hi[i] && (
                      <span className="block text-foreground/70" lang="hi">{meta.marking_points_i18n.hi[i]}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* pipeline signals: blind verify + critic */}
      {(verify || critic) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {verify && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <ShieldQuestion className="size-3.5" /> {t("Review.blindVerify")}
              </p>
              <p className="flex items-center gap-2 text-sm">
                {verify.matches_key ? (
                  <Check className="size-4 text-tulsi" />
                ) : (
                  <X className="size-4 text-coral" />
                )}
                {t("Review.verifyPicked", { key: verify.chosen_key ?? "—" })}
                {verify.confidence != null && (
                  <span className="text-muted-foreground">({Math.round(verify.confidence * 100)}%)</span>
                )}
              </p>
            </div>
          )}
          {critic && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t("Review.criticNotes")}
              </p>
              <p className="text-sm text-foreground/85">{critic.notes}</p>
              {critic.factual_red_flags.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-coral-foreground">
                  {critic.factual_red_flags.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* similar existing questions */}
      {q.similar.length > 0 && (
        <div className="rounded-lg border border-marigold/40 bg-marigold/5 p-3">
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-marigold-foreground uppercase">
            {t("Review.similarHits")}
          </p>
          <ul className="flex flex-col gap-1.5">
            {q.similar.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <Chip className="bg-marigold/20 text-marigold-foreground">{Math.round(s.similarity * 100)}%</Chip>
                <span className="text-muted-foreground whitespace-pre-line">{formatQuestionStem(s.stem_i18n.en)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
