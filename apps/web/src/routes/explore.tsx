import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  BookOpen,
  Brain,
  GraduationCap,
  MessagesSquare,
  Newspaper,
  PenLine,
  Sparkles,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { FeatureKey } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useLocale } from "@/hooks/use-locale";
import { useTourState } from "@/hooks/use-tour";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Explore.navTitle" };

const PILLAR_ICONS: Record<FeatureKey, LucideIcon> = {
  daily_quiz: Sparkles,
  study_chapter: BookOpen,
  answer_evaluation: PenLine,
  mentor_chat: MessagesSquare,
  mentor_teach_mode: GraduationCap,
  revision_srs: Brain,
  mock: Zap,
  time_attack: Zap,
  community: Users,
  scoreboard: Trophy,
  current_affairs: Newspaper,
  magazine: Newspaper,
};

function pillarLink(key: FeatureKey, locale: string): string {
  switch (key) {
    case "daily_quiz":
      return `/${locale}/practice?tab=daily`;
    case "study_chapter":
      return `/${locale}/learn`;
    case "answer_evaluation":
      return `/${locale}/answers`;
    case "mentor_chat":
      return `/${locale}/doubts`;
    case "mentor_teach_mode":
      return `/${locale}/doubts?teach=1`;
    case "revision_srs":
      return `/${locale}/revision`;
    case "mock":
      return `/${locale}/practice?tab=mock`;
    case "time_attack":
      return `/${locale}/practice/time-attack`;
    case "community":
      return `/${locale}/community`;
    case "scoreboard":
      return `/${locale}/scoreboard`;
    case "current_affairs":
      return `/${locale}/current-affairs`;
    case "magazine":
      return `/${locale}/magazine`;
  }
}

const PILLAR_ORDER: FeatureKey[] = [
  "daily_quiz",
  "study_chapter",
  "answer_evaluation",
  "mentor_chat",
  "mentor_teach_mode",
  "revision_srs",
  "mock",
  "time_attack",
  "community",
  "scoreboard",
  "current_affairs",
  "magazine",
];

/**
 * The permanent, always-findable discovery surface (layer 5) — one card per
 * pillar, sorted untried-first, with a live "not tried yet" badge computed
 * from feature_first_touch. Reachable from the nav at any time, unlike the
 * checklist (which auto-hides) or the coachmarks (which fire once). Clean
 * enough that a signed-out marketing variant is plausible later, though that
 * isn't built here.
 */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const tourQuery = useTourState();

  if (tourQuery.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("Explore.title")} description={t("Explore.description")} />
        <div className="grid gap-3 md:grid-cols-2">
          {PILLAR_ORDER.map((key) => (
            <SectionCard key={key}>
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-full" />
            </SectionCard>
          ))}
        </div>
      </div>
    );
  }

  const touch = tourQuery.data?.feature_first_touch;
  const pillars = [...PILLAR_ORDER].sort((a, b) => {
    const aTried = !!touch?.[a];
    const bTried = !!touch?.[b];
    if (aTried === bTried) return 0;
    return aTried ? 1 : -1;
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("Explore.title")} description={t("Explore.description")} />
      <div className="grid gap-3 md:grid-cols-2">
        {pillars.map((key) => {
          const Icon = PILLAR_ICONS[key];
          const tried = !!touch?.[key];
          return (
            <Link
              key={key}
              to={pillarLink(key, locale)}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t(`Explore.pillarTitle_${key}`)}</span>
                  {!tried && (
                    <span className={cn("rounded-full bg-marigold/15 px-2 py-0.5 text-xs font-semibold text-marigold-foreground")}>
                      {t("Explore.notTriedYet")}
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">{t(`Explore.pillarBody_${key}`)}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
