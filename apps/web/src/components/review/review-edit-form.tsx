import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Difficulty, QuestionOption, ReviewEditBody, ReviewQuestion } from "@prayasup/shared";
import { Button } from "@/components/ui/button";

const FIELD = "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const LABEL = "text-xs font-semibold tracking-wide text-muted-foreground uppercase";
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/**
 * Inline edit-then-approve editor. Emits the full editable payload; the server
 * PATCH updates the provided fields and (with approve) publishes iff the
 * bilingual gate now passes.
 */
export function ReviewEditForm({
  question: q,
  onSubmit,
  onCancel,
  pending,
}: {
  question: ReviewQuestion;
  onSubmit: (body: ReviewEditBody, approve: boolean) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [stemEn, setStemEn] = useState(q.stem_i18n.en);
  const [stemHi, setStemHi] = useState(q.stem_i18n.hi);
  const [options, setOptions] = useState<QuestionOption[]>(q.options_i18n ?? []);
  const [correctKey, setCorrectKey] = useState(q.correct_option_key ?? "");
  const [explEn, setExplEn] = useState(q.explanation_i18n?.en ?? "");
  const [explHi, setExplHi] = useState(q.explanation_i18n?.hi ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(q.difficulty);
  const [marks, setMarks] = useState(q.marks ?? 0);
  const [wordLimit, setWordLimit] = useState(q.word_limit ?? 0);

  function setOpt(i: number, lang: "en" | "hi", value: string) {
    setOptions((prev) => prev.map((o, j) => (j === i ? { ...o, text_i18n: { ...o.text_i18n, [lang]: value } } : o)));
  }

  function build(): ReviewEditBody {
    const body: ReviewEditBody = {
      stem_i18n: { en: stemEn, hi: stemHi },
      difficulty,
    };
    if (q.type === "mcq") {
      body.options_i18n = options;
      body.correct_option_key = correctKey || null;
      body.explanation_i18n = { en: explEn, hi: explHi };
    } else {
      body.marks = marks || null;
      body.word_limit = wordLimit || null;
    }
    return body;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Review.stemEn")}</span>
          <textarea className={FIELD} rows={3} value={stemEn} onChange={(e) => setStemEn(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Review.stemHi")}</span>
          <textarea className={FIELD} rows={3} value={stemHi} onChange={(e) => setStemHi(e.target.value)} lang="hi" />
        </label>
      </div>

      {q.type === "mcq" && (
        <div className="flex flex-col gap-2">
          <span className={LABEL}>{t("Review.options")}</span>
          {options.map((o, i) => (
            <div key={o.key} className="flex items-start gap-2">
              <label className="flex items-center gap-1 pt-2 text-sm font-semibold">
                <input
                  type="radio"
                  name="correct"
                  checked={correctKey === o.key}
                  onChange={() => setCorrectKey(o.key)}
                  aria-label={t("Review.markCorrect", { key: o.key })}
                />
                {o.key}
              </label>
              <input className={FIELD} value={o.text_i18n.en} onChange={(e) => setOpt(i, "en", e.target.value)} placeholder="EN" />
              <input className={FIELD} value={o.text_i18n.hi} onChange={(e) => setOpt(i, "hi", e.target.value)} placeholder="HI" lang="hi" />
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t("Review.explanationEn")}</span>
              <textarea className={FIELD} rows={2} value={explEn} onChange={(e) => setExplEn(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t("Review.explanationHi")}</span>
              <textarea className={FIELD} rows={2} value={explHi} onChange={(e) => setExplHi(e.target.value)} lang="hi" />
            </label>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Review.difficultyLabel")}</span>
          <select className={FIELD} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {t(`Review.difficulty.${d}`)}
              </option>
            ))}
          </select>
        </label>
        {q.type === "descriptive" && (
          <>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t("Review.marksLabel")}</span>
              <input className={FIELD} type="number" value={marks} onChange={(e) => setMarks(Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t("Review.wordLimitLabel")}</span>
              <input className={FIELD} type="number" value={wordLimit} onChange={(e) => setWordLimit(Number(e.target.value))} />
            </label>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() => onSubmit(build(), true)}
          className="bg-tulsi text-white hover:bg-tulsi/90"
        >
          {t("Review.saveApprove")}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => onSubmit(build(), false)}>
          {t("Review.saveDraft")}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          {t("Review.cancel")}
        </Button>
      </div>
    </div>
  );
}
