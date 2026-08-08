import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, ShieldOff, Sparkles, Lock, UserRound } from "lucide-react";
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

  const grants = useAdminUserGrants(selectedUser?.id);

  const grantPro = useGrantPro();
  const revokePro = useRevokePro();
  const grantAdmin = useGrantAdmin();
  const revokeAdmin = useRevokeAdmin();
  const pending = grantPro.isPending || revokePro.isPending || grantAdmin.isPending || revokeAdmin.isPending;
  const actionError = (grantPro.error || revokePro.error || grantAdmin.error || revokeAdmin.error) as Error | null;

  function onTogglePro() {
    if (!selectedUser || pending) return;
    const email = selectedUser.email ?? selectedUser.id;
    if (selectedUser.plan === "pro") {
      if (!window.confirm(t("AdminUsers.confirmRevokePro", { email }))) return;
      revokePro.mutate(selectedUser.id);
    } else {
      if (!window.confirm(t("AdminUsers.confirmGrantPro", { email }))) return;
      grantPro.mutate(selectedUser.id);
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
                      onClick={() => setSelectedUserId(active ? null : u.id)}
                      className={cn(
                        "flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        active && "bg-accent",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{u.display_name || u.email || u.id}</p>
                        <p className="truncate text-xs text-muted-foreground">{u.email ?? t("AdminUsers.noEmail")}</p>
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
                            u.plan === "pro" ? "bg-tulsi/15 text-tulsi-foreground" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {u.plan === "pro" ? t("AdminUsers.planPro") : t("AdminUsers.planFree")}
                        </span>
                        {u.is_admin && (
                          <span className="rounded-full bg-marigold/15 px-2 py-0.5 text-xs font-semibold text-marigold-foreground">
                            {t("AdminUsers.adminBadge")}
                          </span>
                        )}
                      </div>
                    </button>
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

      {selectedUser && (
        <SectionCard className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{selectedUser.display_name || selectedUser.email || selectedUser.id}</p>
              <p className="text-sm text-muted-foreground">{selectedUser.email ?? t("AdminUsers.noEmail")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("AdminUsers.joined", { date: new Date(selectedUser.created_at).toLocaleDateString() })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold",
                  selectedUser.plan === "pro" ? "bg-tulsi/15 text-tulsi-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {selectedUser.plan === "pro" ? t("AdminUsers.planPro") : t("AdminUsers.planFree")}
              </span>
              {selectedUser.is_admin && (
                <span className="rounded-full bg-marigold/15 px-2.5 py-1 text-xs font-semibold text-marigold-foreground">
                  {t("AdminUsers.adminBadge")}
                </span>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("AdminUsers.planExpiry")}</dt>
              <dd>
                {selectedUser.plan_expires_at
                  ? new Date(selectedUser.plan_expires_at).toLocaleString()
                  : t("AdminUsers.noExpiry")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("AdminUsers.hasUsedTrial")}</dt>
              <dd>{selectedUser.has_used_trial ? t("AdminUsers.yes") : t("AdminUsers.no")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("AdminUsers.targetExam")}</dt>
              <dd className="uppercase">{selectedUser.target_exam}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              type="button"
              onClick={onTogglePro}
              disabled={pending}
              variant={selectedUser.plan === "pro" ? "destructive" : "default"}
              className={selectedUser.plan === "pro" ? undefined : "bg-tulsi text-white hover:bg-tulsi/90"}
            >
              <Sparkles className="size-4" />{" "}
              {selectedUser.plan === "pro" ? t("AdminUsers.revokePro") : t("AdminUsers.grantPro")}
            </Button>
            <Button
              type="button"
              onClick={onToggleAdmin}
              disabled={pending}
              variant={selectedUser.is_admin ? "destructive" : "outline"}
            >
              {selectedUser.is_admin ? <ShieldOff className="size-4" /> : <ShieldCheck className="size-4" />}
              {selectedUser.is_admin ? t("AdminUsers.revokeAdmin") : t("AdminUsers.grantAdmin")}
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
        </SectionCard>
      )}
    </div>
  );
}
