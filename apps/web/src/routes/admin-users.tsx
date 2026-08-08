import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Search, ShieldCheck, ShieldOff, Sparkles, Lock, UserRound } from "lucide-react";
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
  useAdminUserSearch,
  useGrantAdmin,
  useGrantPro,
  useRevokeAdmin,
  useRevokePro,
} from "@/hooks/use-admin-users";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Nav.adminUsers" };

/**
 * Admin "Users" surface — search a specific account by email, then grant or
 * revoke Pro access or admin privilege. Mirrors the Review Queue's own
 * admin-gate pattern (same "Admin mode is off" empty state) since there is no
 * separate admin-routing layer in this app — every /admin/* page gates itself
 * at render time off GET /admin/status.
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

  const [emailInput, setEmailInput] = useState("");
  const [searchedEmail, setSearchedEmail] = useState("");

  const search = useAdminUserSearch(searchedEmail);
  const user = search.data ?? null;
  const grants = useAdminUserGrants(user?.id);

  const grantPro = useGrantPro();
  const revokePro = useRevokePro();
  const grantAdmin = useGrantAdmin();
  const revokeAdmin = useRevokeAdmin();
  const pending = grantPro.isPending || revokePro.isPending || grantAdmin.isPending || revokeAdmin.isPending;
  const actionError = (grantPro.error || revokePro.error || grantAdmin.error || revokeAdmin.error) as Error | null;

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setSearchedEmail(emailInput.trim());
  }

  function onTogglePro() {
    if (!user || pending) return;
    const email = user.email ?? user.id;
    if (user.plan === "pro") {
      if (!window.confirm(t("AdminUsers.confirmRevokePro", { email }))) return;
      revokePro.mutate(user.id);
    } else {
      if (!window.confirm(t("AdminUsers.confirmGrantPro", { email }))) return;
      grantPro.mutate(user.id);
    }
  }

  function onToggleAdmin() {
    if (!user || pending) return;
    const email = user.email ?? user.id;
    if (user.is_admin) {
      if (!window.confirm(t("AdminUsers.confirmRevokeAdmin", { email }))) return;
      revokeAdmin.mutate(user.id);
    } else {
      if (!window.confirm(t("AdminUsers.confirmGrantAdmin", { email }))) return;
      grantAdmin.mutate(user.id);
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
        <form onSubmit={onSearchSubmit} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <label htmlFor="admin-user-email" className="text-sm font-medium">
              {t("AdminUsers.emailLabel")}
            </label>
            <Input
              id="admin-user-email"
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder={t("AdminUsers.emailPlaceholder")}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={!emailInput.trim()}>
            <Search className="size-4" /> {t("AdminUsers.searchButton")}
          </Button>
        </form>
      </SectionCard>

      {actionError && (
        <div className="rounded-lg border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-coral-foreground">
          {actionError.message}
        </div>
      )}

      {searchedEmail &&
        (search.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : search.isError ? (
          <QueryErrorState onRetry={() => search.refetch()} />
        ) : !user ? (
          <EmptyState
            icon={UserRound}
            title={t("AdminUsers.notFoundTitle")}
            description={t("AdminUsers.notFoundDescription", { email: searchedEmail })}
          />
        ) : (
          <SectionCard className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{user.display_name || user.email || user.id}</p>
                <p className="text-sm text-muted-foreground">{user.email ?? t("AdminUsers.noEmail")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("AdminUsers.joined", { date: new Date(user.created_at).toLocaleDateString() })}
                  {user.is_anonymous ? ` · ${t("AdminUsers.guestBadge")}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold",
                    user.plan === "pro" ? "bg-tulsi/15 text-tulsi-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {user.plan === "pro" ? t("AdminUsers.planPro") : t("AdminUsers.planFree")}
                </span>
                {user.is_admin && (
                  <span className="rounded-full bg-marigold/15 px-2.5 py-1 text-xs font-semibold text-marigold-foreground">
                    {t("AdminUsers.adminBadge")}
                  </span>
                )}
              </div>
            </div>

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

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button
                type="button"
                onClick={onTogglePro}
                disabled={pending}
                variant={user.plan === "pro" ? "destructive" : "default"}
                className={user.plan === "pro" ? undefined : "bg-tulsi text-white hover:bg-tulsi/90"}
              >
                <Sparkles className="size-4" /> {user.plan === "pro" ? t("AdminUsers.revokePro") : t("AdminUsers.grantPro")}
              </Button>
              <Button
                type="button"
                onClick={onToggleAdmin}
                disabled={pending}
                variant={user.is_admin ? "destructive" : "outline"}
              >
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
          </SectionCard>
        ))}
    </div>
  );
}
