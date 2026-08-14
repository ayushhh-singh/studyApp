import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, ShieldOff, Sparkles, Lock, TriangleAlert, UserRound } from "lucide-react";
import type { AdminUserListRow, AdminUserSummary } from "@neev/shared";
import { UserInsightsPanel } from "@/components/admin/user-insights-panel";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminStatus } from "@/hooks/use-review";
import {
  useAdminUserGrants,
  useAdminUserList,
  useGrantAdmin,
  useGrantPro,
  useRevokeAdmin,
  useRevokePro,
} from "@/hooks/use-admin-users";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { useLocale } from "@/hooks/use-locale";

export const handle = { titleKey: "Nav.adminUsers" };

/**
 * Admin "Users" surface — browse every account (paginated, newest first),
 * optionally narrowed by a debounced email/name filter (same 300ms-debounce
 * pattern as manage-card-list.tsx's SRS search), then grant or revoke Pro
 * access or admin privilege for whichever row is selected. Mirrors the
 * Review Queue's own admin-gate pattern (same "Admin mode is off" empty
 * state) since there is no separate admin-routing layer in this app — every
 * /admin/* page gates itself at render time off GET /admin/status.
 *
 * Every mutating action requires an explicit browser confirm() (this
 * codebase's established pattern for a serious-but-infrequent destructive
 * action — see micro-drills-card.tsx/my-notes.tsx) before firing, on top of
 * the server logging every grant/revoke to `admin_grants` regardless.
 */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: admin, isLoading: adminLoading } = useAdminStatus();
  const adminMode = admin?.admin_mode ?? false;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch]);

  const list = useAdminUserList(page, debouncedSearch);
  const items = list.data?.items ?? [];
  const totalPages = list.data?.pagination.total_pages ?? 1;
  const selectedUser = items.find((u) => u.id === selectedUserId) ?? null;

  // The list is fetched with `placeholderData: prev => prev`, so the pager
  // (and its `totalPages`) can briefly show a STALE, larger value from a
  // previous filter/page while a fresh result is in flight. Clicking "Next"
  // against that stale value — or the underlying user set simply shrinking —
  // can land on a page beyond the real result, which returns an empty page
  // with the pager itself hidden (it's only rendered in the non-empty
  // branch), stranding the admin with no visible way back to page 1.
  useEffect(() => {
    if (list.data && page > list.data.pagination.total_pages) setPage(list.data.pagination.total_pages);
  }, [list.data, page]);

  const grantPro = useGrantPro();
  const revokePro = useRevokePro();
  const grantAdmin = useGrantAdmin();
  const revokeAdmin = useRevokeAdmin();
  const pending = grantPro.isPending || revokePro.isPending || grantAdmin.isPending || revokeAdmin.isPending;
  const actionError = (grantPro.error || revokePro.error || grantAdmin.error || revokeAdmin.error) as Error | null;

  /**
   * Grant `tier`, or revoke when the user is already ON that tier. Revoke always
   * drops to free regardless of tier, so a Max user's "Revoke" and a Pro user's
   * do the same thing — the server records WHICH tier was taken away.
   */
  function onTogglePlan(tier: "pro" | "max", days: number | null) {
    if (!selectedUser || pending) return;
    const email = selectedUser.email ?? selectedUser.id;
    // Every confirm names the tier being acted on. These strings used to say
    // "Pro" unconditionally, so a Max grant, a Max revoke AND a Pro-over-Max
    // downgrade all asked the admin to confirm the wrong thing — and the two
    // grant buttons sit side by side, so the dialog is the only disambiguator.
    const RANK: Record<string, number> = { free: 0, pro: 1, max: 2 };
    const label = t(tier === "max" ? "AdminUsers.planMax" : "AdminUsers.planPro");
    if (selectedUser.plan === tier) {
      if (!window.confirm(t("AdminUsers.confirmRevokePro", { email, tier: label }))) return;
      revokePro.mutate(selectedUser.id);
    } else {
      // Granting a LOWER tier than the user holds is a downgrade wearing a
      // grant's clothing: it silently strips the test series and, with no
      // duration chosen, wipes the expiry a paid annual subscription set.
      const isDowngrade = (RANK[selectedUser.plan] ?? 0) > (RANK[tier] ?? 0);
      const message = isDowngrade
        ? t("AdminUsers.confirmDowngrade", {
            email,
            tier: label,
            from: t(selectedUser.plan === "max" ? "AdminUsers.planMax" : "AdminUsers.planPro"),
          })
        : days
          ? t("AdminUsers.confirmGrantProDays", {
              email,
              days,
              tier: label,
              date: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString(),
            })
          : t("AdminUsers.confirmGrantPro", { email, tier: label });
      if (!window.confirm(message)) return;
      grantPro.mutate({ userId: selectedUser.id, days, tier });
    }
  }

  function onToggleAdmin() {
    if (!selectedUser || pending) return;
    const email = selectedUser.email ?? selectedUser.id;
    if (selectedUser.is_admin) {
      if (!window.confirm(t("AdminUsers.confirmRevokeAdmin", { email }))) return;
      revokeAdmin.mutate(selectedUser.id);
    } else {
      if (!window.confirm(t("AdminUsers.confirmGrantAdmin", { email }))) return;
      grantAdmin.mutate(selectedUser.id);
    }
  }

  if (adminLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!adminMode) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("AdminUsers.title")} description={t("AdminUsers.description")} />
        <EmptyState icon={Lock} title={t("Review.disabledTitle")} description={t("Review.disabledDescription")} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("AdminUsers.title")} description={t("AdminUsers.description")} />

      <SectionCard>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-user-search" className="text-sm font-medium">
            {t("AdminUsers.searchLabel")}
          </label>
          <Input
            id="admin-user-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("AdminUsers.searchPlaceholder")}
            autoComplete="off"
          />
        </div>
      </SectionCard>

      {actionError && (
        <div className="rounded-lg border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-coral-foreground">
          {actionError.message}
        </div>
      )}

      <SectionCard className="flex flex-col gap-0 p-0">
        {list.isLoading && !list.data ? (
          <Skeleton className="m-4 h-72 w-auto" />
        ) : list.isError ? (
          <QueryErrorState className="m-4" onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={UserRound}
            title={t("AdminUsers.notFoundTitle")}
            description={debouncedSearch ? t("AdminUsers.notFoundDescription", { query: debouncedSearch }) : t("AdminUsers.noUsers")}
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {items.map((u) => {
                const active = u.id === selectedUserId;
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-expanded={active}
                      onClick={() => setSelectedUserId(active ? null : u.id)}
                      className={cn(
                        "flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        active && "bg-accent",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{u.display_name || u.email || u.id}</p>
                        <p className="truncate text-xs text-muted-foreground">{u.email ?? t("AdminUsers.noEmail")}</p>
                        <UserActivityMeta user={u} locale={locale} />
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {u.is_anonymous && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                            {t("AdminUsers.guestBadge")}
                          </span>
                        )}
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-semibold",
                            u.plan === "max"
                              ? "bg-primary/15 text-primary"
                              : u.plan === "pro"
                                ? "bg-tulsi/15 text-tulsi-foreground"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {u.plan === "max"
                            ? t("AdminUsers.planMax")
                            : u.plan === "pro"
                              ? t("AdminUsers.planPro")
                              : t("AdminUsers.planFree")}
                        </span>
                        {u.is_admin && (
                          <span className="rounded-full bg-marigold/15 px-2 py-0.5 text-xs font-semibold text-marigold-foreground">
                            {t("AdminUsers.adminBadge")}
                          </span>
                        )}
                      </div>
                    </button>
                    {/* Opens directly below the clicked row (accordion-style),
                        not in a separate section after the whole list. Insights
                        come BEFORE the grant controls: you read who someone is
                        before you change their access. */}
                    {active && (
                      <>
                        {/* Matches UserManagePanel's own chrome (border-t +
                            muted/30 + px-4) so the two read as one stacked
                            panel; the manage panel's own border-t then doubles
                            as the divider between insights and controls. */}
                        <div className="border-t border-border bg-muted/30 px-4 py-4">
                          <UserInsightsPanel userId={u.id} />
                        </div>
                        <UserManagePanel
                          user={u}
                          pending={pending}
                          onTogglePlan={onTogglePlan}
                          onToggleAdmin={onToggleAdmin}
                        />
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  {t("Learn.prevPage")}
                </Button>
                <span className="text-xs text-muted-foreground">{t("Learn.pageOf", { page, total: totalPages })}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("Learn.nextPage")}
                </Button>
              </div>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * The at-a-glance activity line under each row's email: when this account was
 * last actually active, and how much it has done.
 *
 * A NEVER-ACTIVE account says so explicitly rather than rendering an empty gap
 * — "signed up and never returned" is one of the most useful things this list
 * can tell a product owner, so it must be visible, not an absence. Counts are
 * hidden when zero to keep the line short for exactly those accounts.
 *
 * Numerals use `tabular-nums` so figures line up down the column while
 * scanning, per the display-numeral convention in the design system.
 */
function UserActivityMeta({ user, locale }: { user: AdminUserListRow; locale: string }) {
  const { t } = useTranslation();
  const lastActive = formatRelativeTime(user.last_active_at, locale);
  const parts: string[] = [
    lastActive ? t("AdminUsers.activeAgo", { ago: lastActive }) : t("AdminUsers.neverActive"),
  ];
  if (user.tests_taken > 0) parts.push(t("AdminUsers.testsCount", { count: user.tests_taken }));
  if (user.srs_reviews_count > 0) parts.push(t("AdminUsers.reviewsCount", { count: user.srs_reviews_count }));
  if (user.streak_count > 0) parts.push(t("AdminUsers.streakCount", { count: user.streak_count }));

  return (
    <p className="truncate text-xs tabular-nums text-muted-foreground/80">
      {parts.join(" · ")}
    </p>
  );
}

/**
 * The "manage this user" panel — badges, details, grant/revoke actions, and
 * the audit trail. Rendered inline directly below its row in the list
 * (accordion-style), never as a separate section after the whole list, so
 * clicking a name opens its controls right where you clicked.
 */
/** value="" means indefinite (the only option that can never be misread as the 7-day signup trial). */
const PRO_GRANT_DURATIONS = [
  { value: "", labelKey: "AdminUsers.durationIndefinite" },
  { value: "7", labelKey: "AdminUsers.duration7" },
  { value: "30", labelKey: "AdminUsers.duration30" },
  { value: "90", labelKey: "AdminUsers.duration90" },
  { value: "365", labelKey: "AdminUsers.duration365" },
] as const;

function UserManagePanel({
  user,
  pending,
  onTogglePlan,
  onToggleAdmin,
}: {
  user: AdminUserSummary;
  pending: boolean;
  onTogglePlan: (tier: "pro" | "max", days: number | null) => void;
  onToggleAdmin: () => void;
}) {
  const { t } = useTranslation();
  const grants = useAdminUserGrants(user.id);
  const [durationValue, setDurationValue] = useState("");
  const selectedDays = durationValue ? Number(durationValue) : null;
  // See adminGrantProBodySchema's doc comment: a time-limited grant to an
  // account that already used its real trial reads as trial-tier limits, not
  // full Pro — surfaced here rather than silently under-serving the admin's
  // intent.
  const showTrialWarning = user.plan === "free" && user.has_used_trial && selectedDays !== null;

  return (
    <div className="flex flex-col gap-5 border-t border-border bg-muted/30 px-4 py-5">
      {/* Deliberately does NOT repeat the name/email — the row directly above
          (this panel opens right below it, accordion-style) already shows
          both, and re-printing them here read as a confusing second row. */}
      <p className="text-xs text-muted-foreground">
        {t("AdminUsers.joined", { date: new Date(user.created_at).toLocaleDateString() })}
      </p>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{t("AdminUsers.planExpiry")}</dt>
          <dd>{user.plan_expires_at ? new Date(user.plan_expires_at).toLocaleString() : t("AdminUsers.noExpiry")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("AdminUsers.hasUsedTrial")}</dt>
          <dd>{user.has_used_trial ? t("AdminUsers.yes") : t("AdminUsers.no")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("AdminUsers.targetExam")}</dt>
          <dd className="uppercase">{user.target_exam}</dd>
        </div>
      </dl>

      {user.plan === "free" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`pro-duration-${user.id}`} className="text-xs font-medium text-muted-foreground">
            {t("AdminUsers.durationLabel")}
          </label>
          <select
            id={`pro-duration-${user.id}`}
            value={durationValue}
            onChange={(e) => setDurationValue(e.target.value)}
            className="h-9 w-fit rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {PRO_GRANT_DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {t(d.labelKey)}
              </option>
            ))}
          </select>
          {showTrialWarning && (
            <p className="flex items-start gap-1.5 text-xs text-marigold-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t("AdminUsers.trialWarning")}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          type="button"
          onClick={() => onTogglePlan("pro", user.plan === "pro" ? null : selectedDays)}
          disabled={pending}
          variant={user.plan === "pro" ? "destructive" : "default"}
          className={user.plan === "pro" ? undefined : "bg-tulsi text-white hover:bg-tulsi/90"}
        >
          <Sparkles className="size-4" /> {user.plan === "pro" ? t("AdminUsers.revokePro") : t("AdminUsers.grantPro")}
        </Button>
        <Button
          type="button"
          onClick={() => onTogglePlan("max", user.plan === "max" ? null : selectedDays)}
          disabled={pending}
          variant={user.plan === "max" ? "destructive" : "default"}
          className={user.plan === "max" ? undefined : "bg-primary text-primary-foreground hover:bg-primary/90"}
        >
          <Sparkles className="size-4" /> {user.plan === "max" ? t("AdminUsers.revokeMax") : t("AdminUsers.grantMax")}
        </Button>
        <Button type="button" onClick={onToggleAdmin} disabled={pending} variant={user.is_admin ? "destructive" : "outline"}>
          {user.is_admin ? <ShieldOff className="size-4" /> : <ShieldCheck className="size-4" />}
          {user.is_admin ? t("AdminUsers.revokeAdmin") : t("AdminUsers.grantAdmin")}
        </Button>
      </div>

      <div className="border-t border-border pt-4">
        <p className="mb-2 text-sm font-semibold">{t("AdminUsers.auditTitle")}</p>
        {grants.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : grants.isError ? (
          <QueryErrorState onRetry={() => grants.refetch()} />
        ) : !grants.data || grants.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("AdminUsers.auditEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {grants.data.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                <span className="font-medium text-foreground">{t(`AdminUsers.action.${g.action}`)}</span>
                <span>{t("AdminUsers.auditBy", { admin: g.admin_email ?? t("AdminUsers.unknownAdmin") })}</span>
                <span>· {new Date(g.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
