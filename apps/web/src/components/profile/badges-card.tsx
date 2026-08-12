import { useTranslation } from "react-i18next";
import { Award, Flame, PenLine, Sparkles, Target, Trophy, type LucideIcon } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { useLocale } from "@/hooks/use-locale";
import { useEarnedMilestones } from "@/hooks/use-engagement";

/**
 * The "Badges" panel from docs/design/reference-1's profile page (panel 7): a
 * grid of circular medallions, each with a two-line label beneath.
 *
 * The reference draws bespoke illustrated medallions. These are the app's own
 * lucide set on a gold plate — inventing illustration per milestone key is a
 * separate piece of work, and a consistent icon set reads better than a mix.
 */
const ICONS: Record<string, LucideIcon> = {
  first_evaluation: PenLine,
  answers_10: PenLine,
  first_test: Target,
  mcqs_100: Target,
  mcqs_250: Target,
  streak_7: Flame,
  streak_30: Flame,
  perfect_days_7: Sparkles,
  scoreboard_regular: Trophy,
};

export function BadgesCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isLoading, isError, refetch } = useEarnedMilestones();
  const badges = data ?? [];

  return (
    <SectionCard title={t("Profile.badgesTitle")} description={t("Profile.badgesDescription")}>
      {isLoading ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {[0, 1, 2].map((i) => (
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
      ) : badges.length === 0 ? (
        <EmptyState
          icon={Award}
          title={t("Profile.badgesEmptyTitle")}
          description={t("Profile.badgesEmptyDescription")}
        />
      ) : (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {badges.map((badge) => {
            const Icon = ICONS[badge.key] ?? Award;
            return (
              <li key={badge.id} className="flex flex-col items-center gap-2 text-center">
                <span
                  className="flex size-16 shrink-0 items-center justify-center rounded-full bg-marigold/20 text-marigold-foreground"
                  title={badge.body_i18n[locale]}
                >
                  <Icon className="size-7" aria-hidden />
                </span>
                {/* Wraps to two lines like the reference rather than
                    truncating — a clipped badge name is not a badge. */}
                <span className="text-xs font-medium leading-snug">{badge.title_i18n[locale]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
