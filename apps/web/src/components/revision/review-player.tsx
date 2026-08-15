import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Languages, X } from "lucide-react";
import type { Locale, SrsQueueCard, SrsRating } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { formatSrsInterval } from "@/lib/srs-format";
import { useSrsReviewQueue } from "@/hooks/use-srs-review-queue";
import { CardMeta } from "./card-meta";
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
  // Guards against rating the same card twice from a single tap/press: the
  // keydown listener below re-subscribes with a fresh `card` closure inside a
  // useEffect, which runs a tick AFTER the state update commits — so OS
  // keyboard auto-repeat (holding a rating key) can fire a second event against
  // the still-attached, stale-closure listener before that resubscription
  // happens, double-rating the same card and skipping the next one. A ref is
  // synchronous (unlike the `revealed` state check), so it closes this gap.
  const lastRatedIdRef = useRef<string | null>(null);

  function rate(rating: SrsRating) {
    if (!card || lastRatedIdRef.current === card.id) return;
    lastRatedIdRef.current = card.id;
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
      // flushNow() can reject on a genuine send failure; the queue's own
      // retry-on-error scheduling already covers recovery, so swallow here.
      flushNow().catch(() => {});
    };
  }, [flushNow]);

  if (done) {
    return <SessionSummary ratings={ratings} total={cards.length} onDone={onExit} />;
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
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
        </div>
        {/* Glanceable progress. The "N of M" above is the precise reading; this is
            the one you can take in without reading — worth having in a session you
            work through head-down. aria-hidden because the counter already says it. */}
        <div className="h-1 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
          <div
            className="h-full rounded-full bg-action transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${(index / cards.length) * 100}%` }}
          />
        </div>
      </header>

      {/* ⚑ Scrolling content, PINNED footer. An explanation can run to several
          hundred words, and when the card itself scrolled, the context strip and
          the "read the chapter" escape hatch fell below the fold — invisible at
          exactly the moment a learner has just failed a hard card and needs them.
          (DOM assertions could not see this; a 390px screenshot did.) So only the
          question and answer scroll; the context and the ratings never leave the
          screen. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={card.id}
            initial={reduceMotion ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
            transition={{ duration: 0.2 }}
            // my-auto centres a short card without clipping a tall one the way
            // justify-center does inside a scroll container.
            className="my-auto flex w-full max-w-lg flex-col self-center"
          >
            {/* The reveal control and the revealed content are SIBLINGS, never
                nested: the revealed side contains a real link, and an <a> inside a
                <button> is invalid HTML whose click the button swallows. */}
            <div className="flex min-h-64 w-full flex-col rounded-2xl border border-border bg-card shadow-sm">
              {revealed ? (
                <div className="flex flex-1 flex-col gap-4 p-6">
                  <p className="text-lg leading-relaxed font-medium text-card-foreground" data-locale={displayLocale}>
                    {card.front_i18n[displayLocale] || card.front_i18n.en || card.front_i18n.hi}
                  </p>
                  <motion.p
                    initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    // text-foreground, not muted: this is the thing being learned.
                    // Muted read weaker than the prompt above it, which made the
                    // answer look like a footnote to the question.
                    className="border-t border-border pt-4 text-sm leading-relaxed whitespace-pre-line text-foreground"
                    data-locale={displayLocale}
                  >
                    {card.back_i18n[displayLocale] || card.back_i18n.en || card.back_i18n.hi}
                  </motion.p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <p className="text-lg leading-relaxed font-medium text-card-foreground" data-locale={displayLocale}>
                    {card.front_i18n[displayLocale] || card.front_i18n.en || card.front_i18n.hi}
                  </p>
                  <span className="text-xs text-muted-foreground">{t("Revision.tapToReveal")}</span>
                </button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
          {revealed && (
            <CardMeta
              source={card.source}
              weightage={card.weightage}
              provenance={card.provenance}
              lapses={card.fsrs_state.lapses}
              displayLocale={displayLocale}
            />
          )}
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
                    className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${config.className}`}
                  >
                    <span>{t(config.labelKey)}</span>
                    {/* Digits are language-neutral, so this needs no separate hi/en copy. */}
                    <span className="sr-only"> ({rating})</span>
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
              <span className="sr-only"> — {t("Revision.tapToReveal")}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
