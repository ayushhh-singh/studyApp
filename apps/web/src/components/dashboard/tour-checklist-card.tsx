import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Layers,
  MessagesSquare,
  Newspaper,
  PenLine,
  Sparkles,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { Locale, TourChecklistItem, TourStatePayload } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { ProgressRing } from "@/components/ui-x/progress-ring";
import { useLocale } from "@/hooks/use-locale";
import { useTourState, useUpdateTourState } from "@/hooks/use-tour";
import { cn } from "@/lib/utils";

const ICONS: Record<TourChecklistItem["key"], typeof Sparkles> = {
  daily_quiz: Sparkles,
  study_chapter: BookOpen,
  mentor_chat: MessagesSquare,
  answer_evaluation: PenLine,
  revision_srs: Layers,
  mock_or_time_attack: Zap,
  scoreboard: Trophy,
  community: Users,
  magazine: Newspaper,
};

function itemLink(key: TourChecklistItem["key"], locale: Locale, payload: TourStatePayload): string {
  switch (key) {
    case "daily_quiz":
      return `/${locale}/practice?tab=daily`;
    case "study_chapter":
      return payload.suggested_chapter_node
        ? `/${locale}/learn/${payload.suggested_chapter_node.paper_code}/${payload.suggested_chapter_node.node_id}`
        : `/${locale}/learn`;
    case "mentor_chat":
      return `/${locale}/doubts`;
    case "answer_evaluation":
      return `/${locale}/answers`;
    case "revision_srs":
      return `/${locale}/revision`;
    case "mock_or_time_attack":
      return `/${locale}/practice?tab=mock`;
    case "scoreboard":
      return `/${locale}/scoreboard`;
    case "community":
      return `/${locale}/community`;
    case "magazine":
      return `/${locale}/magazine`;
  }
}

function ChecklistRow({ item, to }: { item: TourChecklistItem; to: string }) {
  const { t } = useTranslation();
  const Icon = ICONS[item.key];
  return (
    <Link
      to={to}
      className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          item.done ? "bg-tulsi/15 text-tulsi" : "bg-primary/10 text-primary",
        )}
      >
        {item.done ? <CheckCircle2 className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      </span>
      <span className={cn("flex-1 text-sm", item.done && "text-muted-foreground line-through")}>
        {t(`Explore.checklistItem_${item.key}`)}
      </span>
      {!item.done && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </Link>
  );
}

/**
 * The 5-layer tour's two-stage Dashboard checklist (layer 3). Stage 1 ("Get
 * Started") replaces itself with Stage 2 ("Explore Neev") the instant it
 * completes — never both at once, since show_checklist/active_stage collapse
 * to a single card server-side (services/tour.ts). Auto-hides on full
 * completion, 14 days, or a one-tap dismiss (bring-it-back lives in Settings).
 */
export function TourChecklistCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const tourQuery = useTourState();
  const updateTour = useUpdateTourState();
  const payload = tourQuery.data;

  if (!payload || !payload.show_checklist || payload.active_stage === null) return null;

  const stage = payload.active_stage === 1 ? payload.stage1 : payload.stage2;
  const titleKey = payload.active_stage === 1 ? "Explore.checklistStage1Title" : "Explore.checklistStage2Title";
  const subtitleKey = payload.active_stage === 1 ? "Explore.checklistStage1Subtitle" : "Explore.checklistStage2Subtitle";

  return (
    <SectionCard className="border-primary/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <ProgressRing value={stage.completed} max={stage.total}>
            {stage.completed}/{stage.total}
          </ProgressRing>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-base font-semibold">{t(titleKey)}</h2>
            <p className="text-sm text-muted-foreground">{t(subtitleKey)}</p>
          </div>
        </div>
        <button
          type="button"
          aria-label={t("Explore.checklistDismiss")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => updateTour.mutate({ dismissed: true })}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        {stage.items.map((item) => (
          <ChecklistRow key={item.key} item={item} to={itemLink(item.key, locale, payload)} />
        ))}
      </div>
    </SectionCard>
  );
}
