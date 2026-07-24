/**
 * Shared F4 journal UI atoms + helpers used by the list, editor, and entry
 * pages. Everything reads the Sukoon calm theme via semantic tokens (no hard
 * colors) and the sukoon-scoped `t` for copy. No banned clinical words.
 */
import { useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import type { SukoonJournalPrompt } from "@neev/shared";

/** Calm 1-5 mood scale (emoji is language-neutral; labels come from i18n). */
export const MOOD_EMOJI: Record<number, string> = {
  1: "😔",
  2: "🙁",
  3: "😐",
  4: "🙂",
  5: "😊",
};

export function useMoodLabel() {
  const { t } = useSukoonLanguage();
  return (m: number) => t(`Sukoon.journal.mood.${m}`);
}

/** Localized prompt text + category/phase label helpers. */
export function usePromptText() {
  const { language } = useSukoonLanguage();
  return (p: SukoonJournalPrompt) => (language === "hi" ? p.text_hi : p.text_en);
}
export function useCategoryLabel() {
  const { t } = useSukoonLanguage();
  return (c: string | null) => (c ? t(`Sukoon.journal.categories.${c}`) : "");
}

export function useEntryDate() {
  const { language } = useSukoonLanguage();
  return (iso: string) =>
    new Date(iso).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
}

/** The 1-5 mood selector. `value` null = not chosen; clicking the active one clears it. */
export function MoodPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const label = useMoodLabel();
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Mood">
      {[1, 2, 3, 4, 5].map((m) => {
        const active = value === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label(m)}
            onClick={() => onChange(active ? null : m)}
            className={cn(
              "flex min-h-11 flex-1 flex-col items-center gap-1 rounded-2xl border px-2 py-2 transition-colors duration-300",
              active
                ? "border-secondary bg-secondary/15 text-secondary"
                : "border-border bg-card text-muted-foreground hover:border-secondary/50",
            )}
          >
            <span className="text-xl" aria-hidden>
              {MOOD_EMOJI[m]}
            </span>
            <span className="text-[11px] font-medium leading-tight">{label(m)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A small read-only mood chip for cards/detail. */
export function MoodChip({ mood, className }: { mood: number; className?: string }) {
  const label = useMoodLabel();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-secondary/15 px-2 py-0.5 text-xs font-medium text-secondary",
        className,
      )}
    >
      <span aria-hidden>{MOOD_EMOJI[mood]}</span>
      {label(mood)}
    </span>
  );
}

export function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      #{tag}
    </span>
  );
}

/** Tag input: type + Enter (or comma) to add; ✕ to remove. Dedupes, trims. */
export function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const { t } = useSukoonLanguage();
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const v = raw.trim().replace(/,$/, "").trim();
    if (!v) return;
    if (tags.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setDraft("");
      return;
    }
    if (tags.length >= 12) return;
    onChange([...tags, v]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
        >
          #{tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((x) => x !== tag))}
            className="rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        placeholder={t("Sukoon.journal.tagsPlaceholder")}
        className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

/** Signed-out state — journaling needs a real account (per-user encrypted data). */
export function SignInPrompt({ locale }: { locale?: string }) {
  const { t, language } = useSukoonLanguage();
  const redirect = encodeURIComponent(
    typeof window !== "undefined" ? window.location.pathname + window.location.search : "",
  );
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-5 py-12 text-center"
      lang={language}
    >
      <span
        className="flex size-14 items-center justify-center rounded-full bg-secondary/15 text-secondary"
        aria-hidden
      >
        <Sparkles className="size-7" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-bold tracking-tight">{t("Sukoon.onboarding.signInTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("Sukoon.onboarding.signInSub")}
        </p>
      </div>
      {locale ? (
        <Button asChild>
          <Link to={`/${locale}/auth?redirect=${redirect}`}>
            {t("Sukoon.onboarding.signInCta")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
