import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, ClipboardList, Flame, Layers } from "lucide-react";
import type { AdminUserAttempt } from "@neev/shared";
import { StatCard } from "@/components/ui-x/stat-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { PaginationControls } from "@/components/ui-x/pagination-controls";
import { useAdminUserAttempts, useAdminUserStats } from "@/hooks/use-admin-users";
import { useLocale } from "@/hooks/use-locale";
import type { Locale } from "@/lib/locale";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { formatScoreValue } from "@/lib/format-score";
import { isAwaitingData } from "@/lib/query-state";

/**
 * The per-user drill-down: how engaged this account is, and its full test
 * history with ranks where a rank exists.
 *
 * Split across TWO queries because only one half paginates — a page turn in the
 * history must not re-fetch the engagement snapshot, and a single composite
 * response would make `?page=` ambiguous about which list it advances.
 *
 * Rendered inside the already-expanded accordion row, above the grant/revoke
 * controls: you read who someone is before you change their access.
 */
export function UserInsightsPanel({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const stats = useAdminUserStats(userId);
  const attempts = useAdminUserAttempts(userId, page);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">{t("AdminUsers.engagementTitle")}</h3>
        {isAwaitingData(stats) ? (
          <Skeleton className="h-24 w-auto" />
        ) : stats.isError ? (
          <QueryErrorState onRetry={() => stats.refetch()} />
        ) : stats.data ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={Activity}
              label={t("AdminUsers.statLastActive")}
              value={formatRelativeTime(stats.data.user.last_active_at, locale) ?? t("AdminUsers.neverActive")}
              /* The streak engine's last STUDY day, deliberately shown next to the
                 broader last-active above it: a wide gap between the two is the
                 signal ("opens the app daily, completes nothing"). */
              hint={
                stats.data.streak.last_active_date
                  ? t("AdminUsers.statLastStudyDay", { date: stats.data.streak.last_active_date })
                  : undefined
              }
            />
            <StatCard
              icon={ClipboardList}
              label={t("AdminUsers.statTests")}
              value={stats.data.user.tests_taken}
              hint={t("AdminUsers.statTestsHint")}
            />
            <StatCard
              icon={Flame}
              label={t("AdminUsers.statStreak")}
              value={stats.data.streak.streak_count}
              hint={
                stats.data.streak.streak_freezes > 0
                  ? t("AdminUsers.statFreezes", { count: stats.data.streak.streak_freezes })
                  : undefined
              }
            />
            <StatCard
              icon={Layers}
              label={t("AdminUsers.statSrsCards")}
              value={stats.data.srs.total_cards}
              hint={t("AdminUsers.statSrsHint", {
                due: stats.data.srs.due_today,
                /* retention_pct is null with no review history in the 30-day
                   window — render an em dash, never "0%", which would read as
                   "this user forgets everything" rather than "no data yet". */
                retention: stats.data.srs.retention_pct === null ? "—" : `${Math.round(stats.data.srs.retention_pct)}%`,
              })}
            />
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">{t("AdminUsers.historyTitle")}</h3>
        {isAwaitingData(attempts) ? (
          <Skeleton className="h-40 w-auto" />
        ) : attempts.isError ? (
          <QueryErrorState onRetry={() => attempts.refetch()} />
        ) : (attempts.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t("AdminUsers.historyEmptyTitle")}
            description={t("AdminUsers.historyEmptyDescription")}
          />
        ) : (
          <>
            {/* Stacked rows, not a <table>: this codebase's established call for
                data that has to survive 390px (see the dashboard/result review
                lists). A table here would overflow horizontally on the phone
                these admins actually carry. */}
            <ul className="flex flex-col gap-2">
              {attempts.data?.items.map((a) => (
                <AttemptRow key={a.id} attempt={a} locale={locale} />
              ))}
            </ul>
            <PaginationControls
              page={page}
              totalPages={attempts.data?.pagination.total_pages ?? 1}
              onPageChange={setPage}
              /* Reuses the user-facing attempt-history copy rather than adding a
                 fourth label set: same semantics (time-ordered attempts), and its
                 Hindi already agrees in gender with प्रयास. */
              labels={{
                previous: t("Practice.historyPrev"),
                next: t("Practice.historyNext"),
                pageOf: t("Practice.historyPageOf", { page, total: attempts.data?.pagination.total_pages ?? 1 }),
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}

function AttemptRow({ attempt, locale }: { attempt: AdminUserAttempt; locale: Locale }) {
  const { t } = useTranslation();
  // Direct `[locale]` indexing is this app's convention for a *_i18n field
  // (attempt-history-list.tsx does the same) — there is no shared picker helper.
  const title = attempt.test_title_i18n?.[locale] ?? null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title || attempt.paper_code || t("AdminUsers.untitledTest")}</p>
        <p className="truncate text-xs tabular-nums text-muted-foreground">
          {new Date(attempt.submitted_at).toLocaleDateString(locale)}
          {attempt.test_kind ? ` · ${attempt.test_kind.replace(/_/g, " ")}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* formatScoreValue, not raw interpolation: UPPSC's one-third negative
            marking makes these sums fractional, so a raw value renders as
            199.50000000000054. */}
        <span className="text-sm font-semibold tabular-nums">
          {attempt.score === null || attempt.total === null
            ? "—"
            : `${formatScoreValue(attempt.score)}/${formatScoreValue(attempt.total)}`}
        </span>
        {/* A null rank is the NORMAL case (only published mock/sectional first
            attempts are ranked), so it renders as an explicit "not ranked" chip
            rather than a blank that reads as a load failure. */}
        {attempt.user_rank !== null && attempt.cohort_size !== null ? (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
            {t("AdminUsers.rankOf", { rank: attempt.user_rank, cohort: attempt.cohort_size })}
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {t("AdminUsers.notRanked")}
          </span>
        )}
      </div>
    </li>
  );
}
