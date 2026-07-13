import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronRight, Layers, Share2 } from "lucide-react";
import type { ExamCode, Locale, MasteryNode } from "@neev/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useMastery } from "@/hooks/use-mastery";
import { getAccessToken } from "@/lib/auth";
import { MASTERY_COLOR, MASTERY_LEVELS, masteryLevelKey, masteryTileFill } from "@/lib/mastery";
import { squarify } from "@/lib/treemap";
import { cn } from "@/lib/utils";
import { Map as MapIcon } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL as string;
const BOX_W = 4;
const BOX_H = 3;

/**
 * A tile either DRILLS (has its own children with real PYQ weight — clicking
 * opens a new territory map scoped to its subtree) or NAVIGATES (a true leaf
 * — clicking goes straight to the node's own detail page). Previously every
 * tile was hardcoded to depth===1 and always navigated, so the map could
 * never surface topic/leaf-topic granularity even though the backend
 * (getMasteryMap) already returns the full-depth tree with real, distinct,
 * non-parent-copied pyq_count/mastery per node — this component just
 * silently discarded everything below depth 1.
 */
function Tile({
  rect,
  node,
  locale,
  paperCode,
  drillable,
  onDrill,
}: {
  rect: { x: number; y: number; w: number; h: number };
  node: MasteryNode;
  locale: Locale;
  paperCode: string;
  drillable: boolean;
  onDrill: (node: MasteryNode) => void;
}) {
  const { t } = useTranslation();
  const color = MASTERY_COLOR[node.mastery_level];
  // Hide the detail line on slivers so text never overflows a tiny tile.
  const wPct = (rect.w / BOX_W) * 100;
  const hPct = (rect.h / BOX_H) * 100;
  const roomy = hPct > 16 && wPct > 22;

  const label = `${node.title_i18n[locale]} — ${t(masteryLevelKey(node.mastery_level))}, ${node.weight_pct}%${
    drillable ? `, ${t("Learn.mapDrillHint")}` : ""
  }`;
  const sharedClassName = cn(
    "group absolute overflow-hidden rounded-md border-2 border-background p-2 text-left outline-none transition-transform focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
    node.is_priority && "conquest-pulse",
  );
  const sharedStyle = {
    left: `${(rect.x / BOX_W) * 100}%`,
    top: `${(rect.y / BOX_H) * 100}%`,
    width: `${wPct}%`,
    height: `${hPct}%`,
    background: masteryTileFill(node.mastery_level),
  };
  const content = (
    <div className="flex h-full flex-col justify-between gap-1">
      <div className="flex items-start justify-between gap-1">
        <span
          className={cn(
            "line-clamp-3 text-xs font-semibold leading-tight text-foreground",
            locale === "hi" && "leading-snug",
          )}
          lang={locale}
        >
          {node.title_i18n[locale]}
        </span>
        {/* Signals "there's more depth here" — without this, a drillable
            tile and a leaf tile were visually identical, so nothing hinted
            that tapping one goes deeper vs. straight to the topic page. */}
        {drillable && <Layers className="size-3 shrink-0 text-foreground/50" aria-hidden />}
      </div>
      {roomy && (
        <span className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color }}>
          <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate">{t(masteryLevelKey(node.mastery_level))}</span>
          <span className="ms-auto tabular-nums text-muted-foreground">{node.weight_pct}%</span>
        </span>
      )}
    </div>
  );

  if (drillable) {
    return (
      <button type="button" aria-label={label} className={sharedClassName} style={sharedStyle} onClick={() => onDrill(node)}>
        {content}
      </button>
    );
  }
  return (
    <Link to={`/${locale}/learn/${paperCode}/${node.id}`} aria-label={label} className={sharedClassName} style={sharedStyle}>
      {content}
    </Link>
  );
}

export function ConquestMap({ paperCode, locale, exam }: { paperCode: string; locale: Locale; exam?: ExamCode }) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useMastery(paperCode, exam);

  // The drill path: [] = top-level (paper's direct sections). Each entry is
  // the node whose subtree is currently being shown.
  const [path, setPath] = useState<MasteryNode[]>([]);
  useEffect(() => setPath([]), [paperCode]);

  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(false);

  const rootId = useMemo(() => data?.nodes.find((n) => n.depth === 0)?.id ?? null, [data]);
  const rootTitle = useMemo(() => data?.nodes.find((n) => n.depth === 0)?.title_i18n[locale], [data, locale]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, MasteryNode[]>();
    for (const n of data?.nodes ?? []) {
      if (!n.parent_id) continue;
      const list = map.get(n.parent_id) ?? [];
      list.push(n);
      map.set(n.parent_id, list);
    }
    return map;
  }, [data]);

  const current = path[path.length - 1] ?? null;
  const currentParentId = current?.id ?? rootId;
  const allChildren = currentParentId ? (childrenOf.get(currentParentId) ?? []) : [];
  const sections = useMemo(() => allChildren.filter((n) => n.pyq_count > 0), [allChildren]);
  const rects = useMemo(() => squarify(sections.map((s) => ({ ...s, value: s.pyq_count })), BOX_W, BOX_H), [sections]);

  if (isLoading) return <Skeleton className="aspect-[4/3] w-full rounded-xl" />;
  if (isError) return <QueryErrorState onRetry={() => refetch()} />;

  // A drilled-into node with children in the tree but none carrying real
  // PYQ weight (e.g. every question is tagged directly to the section
  // itself, not a sub-topic) would otherwise render a blank box with no way
  // forward — offer the topic's own detail page instead of a dead end.
  if (path.length > 0 && sections.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumb path={path} rootTitle={rootTitle} locale={locale} onJump={setPath} />
        <EmptyState
          icon={MapIcon}
          title={t("Learn.mapNoSubtopicsTitle")}
          description={t("Learn.mapNoSubtopicsDescription")}
          action={
            <Link
              to={`/${locale}/learn/${paperCode}/${current!.id}`}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
            >
              {t("Learn.mapViewTopic")}
            </Link>
          }
        />
      </div>
    );
  }

  if (path.length === 0 && sections.length === 0) {
    return <EmptyState icon={MapIcon} title={t("Learn.mapEmptyTitle")} description={t("Learn.mapEmptyDescription")} />;
  }

  // The share endpoint always renders the paper's top-level territories (it
  // has no concept of the client-only drill path) — deliberate, not a bug:
  // a shared card is meant to summarize the whole paper, not whatever
  // sub-topic the sharer happened to be looking at.
  const shareUrl = `${API_URL}/api/v1/share/mastery.png?paper=${paperCode}&locale=${locale}`;

  // Plain `<a href target="_blank">` can't work here — /share/mastery.png sits
  // behind requireAuth like every other /api/v1/* route, and a bare browser
  // navigation never carries the app's Authorization: Bearer header (no
  // cookie session exists in this app's auth model). Clicking it used to open
  // a new tab showing the raw 401 JSON body instead of the image. Fetching
  // the PNG with the same bearer token every other authenticated call uses,
  // then opening it as a blob URL, is the same pattern already established
  // by the profile export download (components/profile/settings-card.tsx).
  async function handleShare() {
    setSharing(true);
    setShareError(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(shareUrl, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      // Revoke on a delay rather than immediately — the new tab needs time to
      // actually load the blob URL before it's freed.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      setShareError(true);
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {path.length > 0 ? (
        <Breadcrumb path={path} rootTitle={rootTitle} locale={locale} onJump={setPath} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("Learn.mapIntro")}</p>
      )}
      <div className="relative aspect-[4/3] w-full">
        {rects.map((r) => (
          <Tile
            key={r.item.id}
            rect={r}
            node={r.item}
            locale={locale}
            paperCode={paperCode}
            drillable={(childrenOf.get(r.item.id) ?? []).some((c) => c.pyq_count > 0)}
            onDrill={(node) => setPath((p) => [...p, node])}
          />
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
        <div className="flex items-center gap-2">
          {shareError && <span className="text-xs text-destructive">{t("Learn.shareMapError")}</span>}
          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Share2 className="size-3.5" aria-hidden />
            {t("Learn.shareMap")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Breadcrumb({
  path,
  rootTitle,
  locale,
  onJump,
}: {
  path: MasteryNode[];
  rootTitle: string | undefined;
  locale: Locale;
  onJump: (path: MasteryNode[]) => void;
}) {
  return (
    <nav aria-label="Conquest Map breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
      <button
        type="button"
        onClick={() => onJump([])}
        className="rounded px-1.5 py-0.5 font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {rootTitle}
      </button>
      {path.map((node, i) => (
        <span key={node.id} className="flex items-center gap-1">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <button
            type="button"
            onClick={() => onJump(path.slice(0, i + 1))}
            aria-current={i === path.length - 1 ? "location" : undefined}
            className={cn(
              "rounded px-1.5 py-0.5 font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              i === path.length - 1 ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {node.title_i18n[locale]}
          </button>
        </span>
      ))}
    </nav>
  );
}
