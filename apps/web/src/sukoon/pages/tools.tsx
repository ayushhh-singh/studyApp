/**
 * F6 — the Exercise Library hub: type-filtered grid of breathing/grounding/
 * PMR/timer/meditation tools, each linking into its own player.
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Sparkles, Wind } from "lucide-react";
import type { SukoonExerciseType } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useTrackSukoonFeatureView } from "@/sukoon/lib/use-sukoon-analytics";
import { useExercises } from "@/sukoon/lib/use-sukoon-exercises";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { ExerciseCard } from "@/sukoon/components/tools/exercise-card";
import { OfflineIndicator } from "@/sukoon/components/tools/offline-indicator";

const FILTERS: (SukoonExerciseType | "all")[] = ["all", "breathing", "grounding", "reflection", "pmr", "meditation", "timer"];

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors duration-300 " +
        (active
          ? "border-secondary bg-secondary/15 text-secondary"
          : "border-border bg-card text-muted-foreground hover:border-secondary/40")
      }
    >
      {children}
    </button>
  );
}

export function Component() {
  const { t } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  useTrackSukoonFeatureView("tools");
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  const query = useExercises({ enabled: !!session });

  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  const exercises = (query.data?.exercises ?? []).filter((e) => filter === "all" || e.type === filter);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={t("Sukoon.toolsTitle")} description={t("Sukoon.toolsSub")} />
      <OfflineIndicator />

      {/* Personalized guided meditation — a made-for-you meditation on how the
          day's been, distinct from the fixed library below. */}
      <Link
        to={`${base}/meditate`}
        className="sukoon-rise flex items-center gap-3 rounded-2xl border border-secondary/25 bg-secondary/10 px-4 py-3.5 transition-colors hover:border-secondary/50"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary/20">
          <Sparkles className="size-5 text-secondary" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t("Sukoon.meditate.discoverTitle")}</p>
          <p className="truncate text-xs text-muted-foreground">{t("Sukoon.meditate.discoverSub")}</p>
        </div>
      </Link>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {t(`Sukoon.tools.filter.${f}`)}
          </FilterChip>
        ))}
      </div>

      {query.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={Wind}
          title={t("Sukoon.tools.loadErrorTitle")}
          description={t("Sukoon.tools.loadErrorBody")}
        />
      ) : exercises.length === 0 ? (
        <EmptyState icon={Wind} title={t("Sukoon.tools.emptyTitle")} description={t("Sukoon.tools.emptyBody")} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {exercises.map((exercise) => (
            <ExerciseCard key={exercise.id} exercise={exercise} base={base} />
          ))}
        </div>
      )}
    </div>
  );
}
