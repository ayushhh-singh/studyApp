import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Languages, X } from "lucide-react";
import type { Locale, SrsQueueCard, SrsRating } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { formatSrsInterval } from "@/lib/srs-format";
import { useSrsReviewQueue } from "@/hooks/use-srs-review-queue";
import { SessionSummary } from "./session-summary";

const RATING_CONFIG: Record<SrsRating, { labelKey: string; className: string }> = {
  1: { labelKey: "Revision.again", className: "border-coral/40 bg-coral/10 text-coral-foreground hover:bg-coral/20" },
  2: {
    labelKey: "Revision.hard",
    className: "border-marigold/40 bg-marigold/10 text-marigold-foreground hover:bg-marigold/20",
  },
  3: { labelKey: "Revision.good", className: "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20" },
  4: { labelKey: "Revision.easy", className: "border-tulsi/40 bg-tulsi/10 text-tulsi-foreground hover:bg-tulsi/20" },
};

export function ReviewPlayer({ cards, locale, onExit }: { cards: SrsQueueCard[]; locale: Locale; onExit: () => void }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { saveReview, flushNow } = useSrsReviewQueue();

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [displayLocale, setDisplayLocale] = useState<Locale>(locale);
  const [ratings, setRatings] = useState<Partial<Record<SrsRating, number>>>({});

  const card = cards[index];
  const done = index >= cards.length;

  function rate(rating: SrsRating) {
    if (!card) return;
    saveReview({ card_id: card.id, rating });
    setRatings((r) => ({ ...r, [rating]: (r[rating] ?? 0) + 1 }));
    setRevealed(false);
    setIndex((i) => i + 1);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (done) return;
      if (!revealed && (e.code === "Space" || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4")) {
        rate(Number(e.key) as SrsRating);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, done, card]);

  useEffect(() => {
    return () => {
      void flushNow();
    };
  }, [flushNow]);

  if (done) {
    return <SessionSummary ratings={ratings} total={cards.length} onDone={onExit} />;
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={onExit} aria-label={t("Revision.exit")}>
          <X aria-hidden />
        </Button>
        <span className="text-sm font-semibold text-muted-foreground tabular-nums">
          {t("Revision.cardOf", { current: index + 1, total: cards.length })}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setDisplayLocale((l) => (l === "en" ? "hi" : "en"))}
          aria-label={t("Revision.toggleLanguage")}
        >
          <Languages aria-hidden />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={card.id}
            initial={reduceMotion ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
            transition={{ duration: 0.2 }}
            className="flex w-full max-w-lg flex-col gap-4"
          >
            <button
              type="button"
              onClick={() => !revealed && setRevealed(true)}
              className="flex min-h-64 w-full flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card p-6 text-center shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-lg leading-relaxed font-medium text-card-foreground" data-locale={displayLocale}>
                {card.front_i18n[displayLocale] || card.front_i18n.en || card.front_i18n.hi}
              </p>
              <AnimatePresence>
                {revealed && (
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="w-full overflow-hidden border-t border-border pt-4"
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground" data-locale={displayLocale}>
                      {card.back_i18n[displayLocale] || card.back_i18n.en || card.back_i18n.hi}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
              {!revealed && <span className="text-xs text-muted-foreground">{t("Revision.tapToReveal")}</span>}
            </button>

            {revealed ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([1, 2, 3, 4] as SrsRating[]).map((rating) => {
                  const config = RATING_CONFIG[rating];
                  const preview = card.preview[rating];
                  return (
                    <button
                      key={rating}
                      type="button"
                      onClick={() => rate(rating)}
                      className={`flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${config.className}`}
                    >
                      <span>{t(config.labelKey)}</span>
                      <span className="text-xs font-normal opacity-80 tabular-nums">
                        {formatSrsInterval(preview.due_at)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Button size="lg" className="w-full" onClick={() => setRevealed(true)}>
                {t("Revision.reveal")}
              </Button>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
