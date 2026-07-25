/**
 * A gentle, dismissible invitation to a personalized guided meditation, shown
 * AFTER a Saathi conversation or a mood check-in (the two `source`s). It never
 * presumes the person's state — it's an offer, not a consequence — and links to
 * the meditation setup screen seeded with the right source so the meditation
 * gently addresses what was just shared.
 */
import { Link, useParams } from "react-router";
import { Sparkles, X } from "lucide-react";
import type { SukoonMeditationSource } from "@neev/shared";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";

export function MeditationOfferCard({
  source,
  onDismiss,
}: {
  source: Extract<SukoonMeditationSource, "chat" | "mood">;
  onDismiss?: () => void;
}) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";

  return (
    <div
      lang={language}
      className="sukoon-rise relative flex items-start gap-3 rounded-2xl border border-secondary/25 bg-secondary/10 px-4 py-3.5"
    >
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary/20">
        <Sparkles className="size-4 text-secondary" aria-hidden />
      </div>
      <div className="flex-1">
        <p className="text-sm leading-relaxed text-foreground/85">
          {t(`Sukoon.meditate.offer.${source}`)}
        </p>
        <Link
          to={`${base}/meditate?source=${source}`}
          className="mt-1.5 inline-block text-sm font-medium text-secondary hover:underline"
        >
          {t("Sukoon.meditate.offerCta")}
        </Link>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("Sukoon.meditate.offerDismiss")}
          className="shrink-0 rounded-full p-1 text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
