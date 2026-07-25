/**
 * F4 journal home — the list + filters + calendar heatmap + gentle streak chip +
 * export flow. Everything here is METADATA (no bodies): cards show date, mood,
 * tags, and the guided prompt (if any), never a text preview — the documented
 * consequence of encrypting bodies at rest.
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { CalendarDays, Download, NotebookPen, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { SectionCard } from "@/components/ui-x/section-card";
import { cn } from "@/lib/utils";
import { useTrackSukoonFeatureView } from "@/sukoon/lib/use-sukoon-analytics";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import {
  useJournalList,
  useJournalHeatmap,
  useJournalStreak,
  type JournalFilters,
} from "@/sukoon/lib/use-sukoon-journal";
import {
  MoodChip,
  SignInPrompt,
  TagBadge,
  useCategoryLabel,
  useEntryDate,
  usePromptText,
} from "@/sukoon/components/journal/journal-ui";
import { JournalExport } from "@/sukoon/components/journal/journal-export";
import type { SukoonJournalListItem, SukoonPromptCategory } from "@neev/shared";

const CATEGORIES: SukoonPromptCategory[] = [
  "reflection",
  "gratitude",
  "worry_dump",
  "mock_review",
  "result_feelings",
  "comparison",
  "parental",
  "self_compassion",
  "letter_future",
];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function Component() {
  const { t, language } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  useTrackSukoonFeatureView("journal");
  // :locale is present in integrated mode (/:locale/sukoon), absent in standalone.
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";

  const [filters, setFilters] = useState<JournalFilters>({ page: 1 });
  const [showFilters, setShowFilters] = useState(false);

  const listQuery = useJournalList(filters, { enabled: !!session });
  const streakQuery = useJournalStreak({ enabled: !!session });

  // Check `loading` BEFORE `session`: session is null until getSession()
  // resolves, and a DISABLED query's isPending never flips true->false (it
  // simply never fetches) — so `!session && !listQuery.isPending` never
  // becomes true while signed out, and the prompt below never renders.
  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  const data = listQuery.data;
  const hasFilters = !!(
    filters.tag ||
    filters.mood ||
    filters.category ||
    filters.from ||
    filters.to
  );
  const setFilter = (patch: Partial<JournalFilters>) =>
    setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const clearFilters = () => setFilters({ page: 1 });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5" lang={language}>
      <PageHeader
        title={t("Sukoon.journal.title")}
        description={t("Sukoon.journal.subtitle")}
        action={
          <div className="flex items-center gap-2">
            <JournalExport
              locale={locale}
              trigger={
                <Button variant="outline" size="sm">
                  <Download className="size-4" />
                  <span className="hidden sm:inline">{t("Sukoon.journal.export")}</span>
                </Button>
              }
            />
            <Button size="sm" asChild>
              <Link to={`${base}/journal/new`}>
                <Plus className="size-4" />
                {t("Sukoon.journal.new")}
              </Link>
            </Button>
          </div>
        }
      />

      {streakQuery.data ? <StreakChip streak={streakQuery.data.streak} /> : null}

      <JournalHeatmap onPickDay={(d) => setFilter({ from: d, to: d })} />

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
          className={cn(hasFilters && "text-secondary")}
        >
          <SlidersHorizontal className="size-4" />
          {t("Sukoon.journal.filters")}
        </Button>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t("Sukoon.journal.clearFilters")}
          </Button>
        ) : null}
      </div>

      {showFilters ? (
        <FilterBar filters={filters} allTags={data?.all_tags ?? []} onChange={setFilter} />
      ) : null}

      {listQuery.isPending ? (
        <ListSkeleton />
      ) : listQuery.isError ? (
        <EmptyState
          icon={NotebookPen}
          title={t("Sukoon.journal.listLoadErrorTitle")}
          description={t("Sukoon.journal.listLoadErrorDesc")}
          action={
            <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
              {t("Sukoon.pricing.retry")}
            </Button>
          }
        />
      ) : data && data.entries.length > 0 ? (
        <>
          <div className="space-y-2.5">
            {data.entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} base={base} />
            ))}
          </div>
          <Pagination
            page={data.page}
            total={data.total}
            pageSize={data.page_size}
            onPage={(p) => setFilters((f) => ({ ...f, page: p }))}
          />
        </>
      ) : hasFilters ? (
        <EmptyState
          icon={NotebookPen}
          title={t("Sukoon.journal.listEmptyFilteredTitle")}
          description={t("Sukoon.journal.listEmptyFilteredDesc")}
          action={
            <Button variant="outline" size="sm" onClick={clearFilters}>
              {t("Sukoon.journal.clearFilters")}
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={NotebookPen}
          title={t("Sukoon.journal.listEmptyTitle")}
          description={t("Sukoon.journal.listEmptyDesc")}
          action={
            <Button size="sm" asChild>
              <Link to={`${base}/journal/new`}>
                <Plus className="size-4" />
                {t("Sukoon.journal.new")}
              </Link>
            </Button>
          }
        />
      )}
    </div>
  );
}

function StreakChip({
  streak,
}: {
  streak: { current: number; active_today: boolean; skip_used: boolean };
}) {
  const { t } = useSukoonLanguage();
  if (streak.current === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        {t("Sukoon.journal.streakStart")}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-secondary/30 bg-secondary/10 px-4 py-3">
      <span className="text-2xl" aria-hidden>
        🌱
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {t("Sukoon.journal.streakCount", { days: streak.current })}
        </p>
        <p className="text-xs text-muted-foreground">
          {streak.active_today ? t("Sukoon.journal.streakToday") : t("Sukoon.journal.streakNudge")}
          {streak.skip_used ? ` · ${t("Sukoon.journal.streakSkip")}` : ""}
        </p>
      </div>
    </div>
  );
}

function JournalHeatmap({ onPickDay }: { onPickDay: (date: string) => void }) {
  const { t, language } = useSukoonLanguage();
  const [month, setMonth] = useState(currentMonth());
  const heatmapQuery = useJournalHeatmap(month);
  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of heatmapQuery.data?.days ?? []) m.set(d.date, d.count);
    return m;
  }, [heatmapQuery.data]);

  const [y, mo] = month.split("-").map(Number);
  const firstDow = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);

  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(y, mo - 1 + delta, 1));
    setMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const isFutureMonth = month >= currentMonth();
  const monthLabel = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(
    language === "hi" ? "hi-IN" : "en-IN",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4 text-secondary" />
          {monthLabel}
        </span>
      }
      action={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Sukoon.journal.heatmapPrevMonth")}
            onClick={() => shiftMonth(-1)}
          >
            ‹
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Sukoon.journal.heatmapNextMonth")}
            disabled={isFutureMonth}
            onClick={() => shiftMonth(1)}
          >
            ›
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((date, i) => {
          if (!date) return <div key={`b${i}`} />;
          const count = byDate.get(date) ?? 0;
          const intensity = count === 0 ? 0 : count === 1 ? 45 : count === 2 ? 70 : 100;
          const day = Number(date.slice(-2));
          return (
            <button
              key={date}
              type="button"
              disabled={count === 0}
              onClick={() => onPickDay(date)}
              title={`${date} · ${count}`}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md text-[11px] transition-colors",
                count === 0
                  ? "bg-muted/60 text-muted-foreground"
                  : "font-semibold text-secondary-foreground hover:ring-2 hover:ring-ring",
              )}
              style={
                count > 0
                  ? {
                      backgroundColor: `color-mix(in srgb, var(--secondary) ${intensity}%, var(--muted))`,
                    }
                  : undefined
              }
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
        <span>{t("Sukoon.journal.heatmapLess")}</span>
        {[0, 45, 70, 100].map((n) => (
          <span
            key={n}
            className="size-3 rounded-sm"
            style={{
              backgroundColor: `color-mix(in srgb, var(--secondary) ${n}%, var(--muted))`,
            }}
          />
        ))}
        <span>{t("Sukoon.journal.heatmapMore")}</span>
      </div>
    </SectionCard>
  );
}

function FilterBar({
  filters,
  allTags,
  onChange,
}: {
  filters: JournalFilters;
  allTags: string[];
  onChange: (patch: Partial<JournalFilters>) => void;
}) {
  const { t } = useSukoonLanguage();
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          {t("Sukoon.journal.filterCategory")}
          <select
            value={filters.category ?? ""}
            onChange={(e) => onChange({ category: e.target.value || undefined })}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">{t("Sukoon.journal.allCategories")}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`Sukoon.journal.categories.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          {t("Sukoon.journal.filterMood")}
          <select
            value={filters.mood ?? ""}
            onChange={(e) => onChange({ mood: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">{t("Sukoon.journal.anyMood")}</option>
            {[1, 2, 3, 4, 5].map((m) => (
              <option key={m} value={m}>
                {t(`Sukoon.journal.mood.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          {t("Sukoon.journal.filterFrom")}
          <input
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => onChange({ from: e.target.value || undefined })}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          {t("Sukoon.journal.filterTo")}
          <input
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => onChange({ to: e.target.value || undefined })}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
      </div>
      {allTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((tag) => {
            const active = filters.tag === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onChange({ tag: active ? undefined : tag })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-secondary bg-secondary/15 text-secondary"
                    : "border-border bg-background text-muted-foreground hover:border-secondary/40",
                )}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function EntryCard({ entry, base }: { entry: SukoonJournalListItem; base: string }) {
  const { t } = useSukoonLanguage();
  const entryDate = useEntryDate();
  const promptText = usePromptText();
  const categoryLabel = useCategoryLabel();
  return (
    <Link
      to={`${base}/journal/${entry.id}`}
      className="block rounded-2xl border border-border bg-card p-4 transition-colors duration-300 hover:border-secondary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{entryDate(entry.created_at)}</span>
        <div className="flex items-center gap-1.5">
          {entry.has_reflection ? (
            <span className="text-xs text-secondary" title={t("Sukoon.journal.reflectionBadge")}>
              ✨
            </span>
          ) : null}
          {entry.mood != null ? <MoodChip mood={entry.mood} /> : null}
        </div>
      </div>
      {entry.prompt ? (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {promptText(entry.prompt)}
        </p>
      ) : entry.mood != null && entry.tags.length === 0 ? (
        <p className="mt-2 text-sm italic text-muted-foreground">
          {t("Sukoon.journal.moodOnlyEntry")}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {entry.prompt?.category ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-secondary">
            {categoryLabel(entry.prompt.category)}
          </span>
        ) : null}
        {entry.tags.map((tag) => (
          <TagBadge key={tag} tag={tag} />
        ))}
      </div>
    </Link>
  );
}

function Pagination({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const { t } = useSukoonLanguage();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-1">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t("Sukoon.journal.prev")}
      </Button>
      <span className="text-xs text-muted-foreground">
        {t("Sukoon.journal.pageOf", { current: page, total: totalPages })}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        {t("Sukoon.journal.next")}
      </Button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
      ))}
    </div>
  );
}
