import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Share2 } from "lucide-react";
import type { ExamCode, Locale, MasteryNode } from "@prayasup/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useMastery } from "@/hooks/use-mastery";
import { MASTERY_COLOR, MASTERY_LEVELS, masteryLevelKey, masteryTileFill } from "@/lib/mastery";
import { squarify } from "@/lib/treemap";
import { cn } from "@/lib/utils";
import { Map as MapIcon } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL as string;
const BOX_W = 4;
const BOX_H = 3;

function Tile({ rect, node, locale, paperCode }: {
  rect: { x: number; y: number; w: number; h: number };
  node: MasteryNode;
  locale: Locale;
  paperCode: string;
}) {
  const { t } = useTranslation();
  const color = MASTERY_COLOR[node.mastery_level];
  // Hide the detail line on slivers so text never overflows a tiny tile.
  const wPct = (rect.w / BOX_W) * 100;
  const hPct = (rect.h / BOX_H) * 100;
  const roomy = hPct > 16 && wPct > 22;

  return (
    <Link
      to={`/${locale}/learn/${paperCode}/${node.id}`}
      aria-label={`${node.title_i18n[locale]} — ${t(masteryLevelKey(node.mastery_level))}, ${node.weight_pct}%`}
      className={cn(
        "group absolute overflow-hidden rounded-md border-2 border-background p-2 outline-none transition-transform focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
        node.is_priority && "conquest-pulse",
      )}
      style={{
        left: `${(rect.x / BOX_W) * 100}%`,
        top: `${(rect.y / BOX_H) * 100}%`,
        width: `${wPct}%`,
        height: `${hPct}%`,
        background: masteryTileFill(node.mastery_level),
      }}
    >
      <div className="flex h-full flex-col justify-between gap-1">
        <span
          className={cn(
            "line-clamp-3 text-xs font-semibold leading-tight text-foreground",
            locale === "hi" && "leading-snug",
          )}
          lang={locale}
        >
          {node.title_i18n[locale]}
        </span>
        {roomy && (
          <span className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color }}>
            <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate">{t(masteryLevelKey(node.mastery_level))}</span>
            <span className="ms-auto tabular-nums text-muted-foreground">{node.weight_pct}%</span>
          </span>
        )}
      </div>
    </Link>
  );
}

export function ConquestMap({ paperCode, locale, exam }: { paperCode: string; locale: Locale; exam?: ExamCode }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useMastery(paperCode, exam);

  const sections = useMemo(
    () => (data?.nodes ?? []).filter((n) => n.depth === 1 && n.pyq_count > 0),
    [data],
  );
  const rects = useMemo(
    () => squarify(sections.map((s) => ({ ...s, value: s.pyq_count })), BOX_W, BOX_H),
    [sections],
  );

  if (isLoading) return <Skeleton className="aspect-[4/3] w-full rounded-xl" />;
  if (isError || sections.length === 0) {
    return (
      <EmptyState icon={MapIcon} title={t("Learn.mapEmptyTitle")} description={t("Learn.mapEmptyDescription")} />
    );
  }

  const shareUrl = `${API_URL}/api/v1/share/mastery.png?paper=${paperCode}&locale=${locale}`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("Learn.mapIntro")}</p>
      <div className="relative aspect-[4/3] w-full">
        {rects.map((r) => (
          <Tile key={r.item.id} rect={r} node={r.item} locale={locale} paperCode={paperCode} />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {MASTERY_LEVELS.map((level) => (
            <span key={level} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block size-2.5 rounded-full" style={{ background: MASTERY_COLOR[level] }} />
              {t(masteryLevelKey(level))}
            </span>
          ))}
        </div>
        <a
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Share2 className="size-3.5" aria-hidden />
          {t("Learn.shareMap")}
        </a>
      </div>
    </div>
  );
}
