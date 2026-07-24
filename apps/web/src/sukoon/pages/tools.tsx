/**
 * F6 — the Exercise Library hub: type-filtered grid of breathing/grounding/
 * PMR/timer/meditation tools, each linking into its own player.
 */
import { useState } from "react";
import { useParams } from "react-router";
import { Wind } from "lucide-react";
import type { SukoonExerciseType } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useExercises } from "@/sukoon/lib/use-sukoon-exercises";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { ExerciseCard } from "@/sukoon/components/tools/exercise-card";
import { OfflineIndicator } from "@/sukoon/components/tools/offline-indicator";

const FILTERS: (SukoonExerciseType | "all")[] = ["all", "breathing", "grounding", "pmr", "meditation", "timer"];

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
