import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Award,
  Flame,
  MessagesSquare,
  PenLine,
  RefreshCw,
  Sparkles,
  Target,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { Badge } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { useLocale } from "@/hooks/use-locale";
import { useBadgeCase } from "@/hooks/use-engagement";
import { cn } from "@/lib/utils";

/**
 * The "Badges" panel from docs/design/reference-1's profile page (panel 7): a
 * grid of circular medallions, each with a two-line label beneath.
 *
 * ⚑ SHOWS LOCKED BADGES TOO, and that is the point of the card. It used to
 * render only what the user had already earned, which meant a three-badge
 * profile was three gold circles and no indication that anything else existed —
 * so the case could motivate nothing. The empty slots ARE the roadmap; the
 * earned ones are just the part that is already coloured in.
 *
 * The reference draws bespoke illustrated medallions. These are the app's own
 * lucide set on a gold plate — inventing illustration per milestone key is a
 * separate piece of work, and a consistent icon set reads better than a mix.
 */
const ICONS: Record<string, LucideIcon> = {
  first_evaluation: PenLine,
  answers_10: PenLine,
  answers_50: PenLine,
  first_test: Target,
  mcqs_100: Target,
  mcqs_250: Target,
  mcqs_1000: Target,
  streak_7: Flame,
  streak_30: Flame,
  streak_100: Flame,
  perfect_days_7: Sparkles,
  perfect_days_30: Sparkles,
  scoreboard_regular: Trophy,
  revision_50: RefreshCw,
  revision_500: RefreshCw,
  first_doubt: Sparkles,
  first_post: MessagesSquare,
};

function BadgeMedallion({ badge }: { badge: Badge }) {
  const locale = useLocale();
  const Icon = ICONS[badge.key] ?? Award;
  const earned = badge.earned_at !== null;

  return (
    <li className="flex flex-col items-center gap-2 text-center">
      <span
        className={cn(
          "flex size-16 shrink-0 items-center justify-center rounded-full",
          earned
            ? "bg-marigold/20 text-marigold-foreground ring-1 ring-marigold-foreground/25"
            : // Locked reads as an empty slot, not as a second kind of award:
              // no gold, a dashed rim, and a muted glyph.
              "border border-dashed border-border bg-muted/40 text-muted-foreground/60",
        )}
        title={badge.body_i18n[locale]}
      >
        <Icon className="size-7" aria-hidden />
      </span>
      {/* Wraps to two lines like the reference rather than truncating — a
          clipped badge name is not a badge. */}
      <span className={cn("text-xs font-medium leading-snug", !earned && "text-muted-foreground")}>
        {badge.title_i18n[locale]}
      </span>
    </li>
  );
}

/**
 * How many medallions to show before the "Show all" disclosure.
 *
 * The catalogue is 17 and the grid is 3-wide at 390px, so rendering everything
 * unconditionally is ~6 rows — roughly 700px of badge case on a phone, on a
 * page that already scrolls. 8 is under 3 rows there and under 2 at
 * lg:grid-cols-6, and because the API returns earned-first-then-nearest it is
 * always the 8 that carry information: what you have, and what you are closest
 * to. The rest stay one tap away rather than gone.
 */
const COLLAPSED_COUNT = 8;

export function BadgesCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isError, refetch } = useBadgeCase();
  const badges = data ?? [];
  const earnedCount = badges.filter((b) => b.earned_at !== null).length;
  const visible = showAll ? badges : badges.slice(0, COLLAPSED_COUNT);
  const hiddenCount = badges.length - visible.length;

  // The API returns locked badges sorted by how close they are, so the first
  // locked one with any progress at all IS the nearest. Showing a single "next
  // up" line beats a progress bar under every medallion, which would turn a
  // trophy case into a spreadsheet.
  const nextUp = badges.find((b) => b.earned_at === null && b.progress.current > 0);

  return (
    <SectionCard
      title={t("Profile.badgesTitle")}
      description={t("Profile.badgesDescription")}
      action={
        !isLoading && !isError && badges.length > 0 ? (
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {t("Profile.badgesEarnedOf", { earned: earnedCount, total: badges.length })}
          </span>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="size-16 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : isError ? (
        // A failed fetch is not an empty badge case — telling a user who has
        // earned badges that they have none is worse than saying "couldn't
        // load". This component shipped twice elsewhere in the app conflating
        // the two (see query-error-state.tsx).
        <QueryErrorState onRetry={() => void refetch()} />
      ) : (
        // No empty state any more: the catalogue is never empty, so a brand-new
        // user sees the full set of locked slots — which is a better first
        // impression than "no badges yet" and tells them what the app rewards.
        <div className="flex flex-col gap-4">
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {visible.map((badge) => (
              <BadgeMedallion key={badge.key} badge={badge} />
            ))}
          </ul>

          {nextUp && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t("Profile.badgesNextUp")}</span>{" "}
              {nextUp.title_i18n[locale]}{" "}
              <span className="tabular-nums">
                ({nextUp.progress.current} / {nextUp.progress.target})
              </span>
            </p>
          )}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="min-h-11 self-start text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("Profile.badgesShowAll", { count: hiddenCount })}
            </button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
