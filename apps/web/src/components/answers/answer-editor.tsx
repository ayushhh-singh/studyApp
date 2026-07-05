import { useTranslation } from "react-i18next";
import type { Locale } from "@prayasup/shared";
import { DictationButton } from "@/components/answers/dictation-button";
import { cn } from "@/lib/utils";

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function AnswerEditor({
  value,
  onChange,
  wordLimit,
  language,
}: {
  value: string;
  onChange: (value: string) => void;
  wordLimit: number | null;
  language: Locale;
}) {
  const { t } = useTranslation();
  const words = countWords(value);
  const ratio = wordLimit ? words / wordLimit : null;
  const countColor =
    ratio === null
      ? "text-muted-foreground"
      : ratio > 1
        ? "text-coral"
        : ratio >= 0.9
          ? "text-marigold"
          : "text-muted-foreground";

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        lang={language}
        dir="auto"
        rows={14}
        maxLength={20_000}
        placeholder={t("Answers.editorPlaceholder")}
        className="min-h-[280px] w-full resize-y rounded-lg border border-input bg-background p-4 text-base leading-[1.75] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("text-sm font-medium tabular-nums", countColor)}>
          {wordLimit
            ? t("Answers.wordCountOfLimit", { count: words, limit: wordLimit })
            : t("Answers.wordCount", { count: words })}
        </span>
        <DictationButton onFinal={(text) => onChange(value ? `${value} ${text}` : text)} />
      </div>
      {language === "hi" && (
        <p className="text-xs text-muted-foreground">
          {t("Answers.devanagariNote")}{" "}
          <a
            href="https://www.google.com/inputtools/try/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {t("Answers.devanagariNoteLink")}
          </a>
        </p>
      )}
    </div>
  );
}
