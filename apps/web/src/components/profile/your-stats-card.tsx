import { useTranslation } from "react-i18next";
import { Brain, CalendarDays, Flame, Snowflake, type LucideIcon } from "lucide-react";
import type { Profile } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";

/**
 * "Your Stats" from docs/design/reference-1's profile page (panel 7): a card of
 * divided rows, each a small icon, a label, and the figure right-aligned.
 *
 * Every row comes from the profile the page already fetches — no extra request.
 * The reference's own rows (Courses Enrolled / Notes Saved / Flashcards
 * Revised) are its mock catalogue's vocabulary; these are the equivalents this
 * profile actually carries, and rows whose value is absent are dropped rather
 * than printed as a zero, which would read as a real score of nothing.
 */
function StatRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
}) {
  return (
    <li className="flex min-h-11 items-center gap-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {/* font-display is Inter 800 tabular — figures in a column must line up,
          and Poppins (the heading face) has no tabular figures at all. */}
      <span className="shrink-0 font-display text-lg tabular-nums">{value}</span>
    </li>
  );
}

export function YourStatsCard({ profile, isLoading }: { profile: Profile | undefined; isLoading: boolean }) {
  const { t } = useTranslation();

  if (isLoading && !profile) {
    return (
      <SectionCard title={t("Profile.yourStatsTitle")}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </SectionCard>
    );
  }
  if (!profile) return null;

  return (
    <SectionCard title={t("Profile.yourStatsTitle")}>
      <ul className="flex flex-col divide-y divide-border">
        <StatRow
          icon={Flame}
          label={t("Profile.statStreak")}
          value={t("Profile.statDays", { count: profile.streak_count })}
        />
        <StatRow icon={Snowflake} label={t("Profile.statFreezes")} value={profile.streak_freezes} />
        {profile.days_to_exam !== null && (
          <StatRow
            icon={CalendarDays}
            label={t("Profile.statDaysToExam")}
            value={t("Profile.statDays", { count: profile.days_to_exam })}
          />
        )}
        {profile.target_exam_year !== null && (
          <StatRow icon={Brain} label={t("Profile.statTargetYear")} value={profile.target_exam_year} />
        )}
      </ul>
    </SectionCard>
  );
}
