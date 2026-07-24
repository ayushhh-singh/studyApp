/**
 * Shared chrome for every F6 player page (breathing/grounding/pmr/meditation/
 * timer): resolves the :exerciseId route param against the exercises list,
 * and handles every non-happy-path state the same way everywhere — signed
 * out, loading, not found, locked (premium on a free tier) — so each player
 * only ever has to render its actual player once `exercise` resolves.
 */
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Lock, Wifi, AlertTriangle } from "lucide-react";
import type { SukoonExercise } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useExercises } from "@/sukoon/lib/use-sukoon-exercises";
import { useSukoonOnline } from "@/sukoon/lib/use-sukoon-online";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { SUKOON_TOOL_ICONS } from "@/sukoon/lib/tool-icons";

export function ToolPlayerFrame<T extends SukoonExercise["type"]>({
  type,
  children,
}: {
  type: T;
  children: (exercise: Extract<SukoonExercise, { type: T }>) => ReactNode;
}) {
  const { t, language } = useSukoonLanguage();
  const { exerciseId, locale } = useParams<{ exerciseId: string; locale?: string }>();
  const { session, loading: authLoading } = useAuth();
  const online = useSukoonOnline();
  const query = useExercises({ enabled: !!session });
  const base = locale ? `/${locale}/sukoon` : "";

  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  if (query.isLoading) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  // A genuine load failure (server error, since offline is handled below via
  // its own branch) must never be presented as "this exercise doesn't exist"
  // — that reads as a dead link rather than "try again", and query.data being
  // undefined on error would otherwise fall straight into the not-found path.
  if (query.isError && online) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <PageHeader title={t("Sukoon.toolsTitle")} />
        <EmptyState
          icon={AlertTriangle}
          title={t("Sukoon.tools.loadErrorTitle")}
          description={t("Sukoon.tools.loadErrorBody")}
          action={
            <Link to={`${base}/tools`} className="text-sm font-medium text-secondary hover:underline">
              {t("Sukoon.tools.backToTools")}
            </Link>
          }
        />
      </div>
    );
  }

  const exercise = query.data?.exercises.find((e) => e.id === exerciseId && e.type === type) as
    | Extract<SukoonExercise, { type: T }>
    | undefined;

  if (!exercise) {
    const Icon = SUKOON_TOOL_ICONS[type];
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <PageHeader title={t("Sukoon.toolsTitle")} />
        <EmptyState
          icon={online ? Icon : Wifi}
          title={online ? t("Sukoon.tools.notFoundTitle") : t("Sukoon.tools.offlineUnavailableTitle")}
          description={online ? t("Sukoon.tools.notFoundBody") : t("Sukoon.tools.offlineUnavailableBody")}
          action={
            <Link to={`${base}/tools`} className="text-sm font-medium text-secondary hover:underline">
              {t("Sukoon.tools.backToTools")}
            </Link>
          }
        />
      </div>
    );
  }

  if (exercise.locked) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6" lang={language}>
        <PageHeader
          title={language === "hi" ? exercise.title_hi : exercise.title_en}
          action={
            <Link to={`${base}/tools`} className="text-sm font-medium text-muted-foreground hover:text-foreground">
              {t("Sukoon.tools.backToTools")}
            </Link>
          }
        />
        <EmptyState
          icon={Lock}
          title={t("Sukoon.tools.lockedTitle")}
          description={t("Sukoon.tools.lockedBody")}
        />
      </div>
    );
  }

  return <>{children(exercise)}</>;
}
