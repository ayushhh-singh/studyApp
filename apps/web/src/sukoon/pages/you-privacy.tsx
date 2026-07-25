/**
 * Sukoon F12 — Privacy Center (/sukoon/you/privacy). Plain-language, bilingual:
 * what's stored, what the AI sees, consent view/withdraw, a full data export
 * (async job → signed download), and account deletion with a typed confirmation.
 */
import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  ShieldCheck,
  Download,
  FileJson,
  BookOpen,
  Trash2,
  RotateCcw,
  Info,
  Loader2,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { DeleteAccountDialog } from "@/sukoon/components/you/delete-account-dialog";
import {
  useSukoonPrivacySummary,
  useSukoonLatestExport,
  useRequestSukoonExport,
  useDeleteSukoonAccount,
  useCancelSukoonDeletion,
  useWithdrawSukoonConsent,
  fetchSukoonExportUrl,
} from "@/sukoon/lib/use-sukoon-privacy";
import type { SukoonExportArtifact } from "@neev/shared";

export function Component() {
  const { t, language } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";

  if (authLoading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <PageHeader title={t("Sukoon.privacy.title")} description={t("Sukoon.privacy.subtitle")} />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={t("Sukoon.privacy.title")} description={t("Sukoon.privacy.subtitle")} />
      {!session ? <SignInPrompt locale={locale} /> : <PrivacyBody base={base} language={language} />}
    </div>
  );
}

function fmtDate(iso: string | null, language: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function PrivacyBody({ base, language }: { base: string; language: string }) {
  const { t } = useSukoonLanguage();
  const summaryQuery = useSukoonPrivacySummary();
  const exportQuery = useSukoonLatestExport();
  const requestExport = useRequestSukoonExport();
  const deleteAccount = useDeleteSukoonAccount();
  const cancelDeletion = useCancelSukoonDeletion();
  const withdrawConsent = useWithdrawSukoonConsent();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const summary = summaryQuery.data;
  const job = exportQuery.data;

  if (summaryQuery.isLoading || !summary) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }

  const scheduled = summary.account.status === "scheduled_deletion";

  const openDownload = async (artifact: SukoonExportArtifact) => {
    if (!job || job.status !== "ready") return;
    const { url } = await fetchSukoonExportUrl(job.id, artifact);
    window.open(url, "_blank", "noopener");
  };

  return (
    <>
      {/* Scheduled-for-deletion banner + restore */}
      {scheduled ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">
                {t("Sukoon.privacy.scheduledTitle")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("Sukoon.privacy.scheduledBody", {
                  date: fmtDate(summary.account.purge_after, language),
                })}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <Button
              onClick={() => cancelDeletion.mutate()}
              disabled={cancelDeletion.isPending}
              className="gap-2"
            >
              <RotateCcw className="size-4" aria-hidden />
              {cancelDeletion.isPending
                ? t("Sukoon.privacy.restoring")
                : t("Sukoon.privacy.restore")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* What's stored */}
      <SectionCard title={t("Sukoon.privacy.stored.title")} description={t("Sukoon.privacy.stored.subtitle")}>
        <ul className="flex flex-col divide-y divide-border">
          {summary.data_counts.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
              <span className="text-sm text-foreground">{t(`Sukoon.privacy.stored.cat.${c.key}`)}</span>
              <span className="text-sm font-semibold tabular-nums text-muted-foreground">{c.count}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* What the AI sees */}
      <SectionCard title={t("Sukoon.privacy.aiSees.title")}>
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
          <p>{t("Sukoon.privacy.aiSees.body1")}</p>
          <p>{t("Sukoon.privacy.aiSees.body2")}</p>
          <p>{t("Sukoon.privacy.aiSees.body3")}</p>
        </div>
      </SectionCard>

      {/* Consent */}
      <SectionCard title={t("Sukoon.privacy.consent.title")} description={t("Sukoon.privacy.consent.subtitle")}>
        <div className="flex flex-col gap-3">
          {summary.consents.length > 0 ? (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <ShieldCheck className="size-4 text-secondary" aria-hidden />
              <span>
                {t("Sukoon.privacy.consent.on", { date: fmtDate(summary.consents[0].consented_at, language) })}
                {" · "}
                {summary.consent_current
                  ? t("Sukoon.privacy.consent.current")
                  : t("Sukoon.privacy.consent.outdated")}
              </span>
            </div>
          ) : null}
          {!scheduled ? (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("Sukoon.privacy.consent.withdrawNote")}
              </p>
              <div>
                <Button
                  variant="outline"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => withdrawConsent.mutate()}
                  disabled={withdrawConsent.isPending}
                >
                  {t("Sukoon.privacy.consent.withdraw")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </SectionCard>

      {/* Export */}
      <SectionCard title={t("Sukoon.privacy.export.title")} description={t("Sukoon.privacy.export.subtitle")}>
        <div className="flex flex-col gap-4">
          <p className="text-xs leading-relaxed text-muted-foreground">{t("Sukoon.privacy.export.note")}</p>

          {job && (job.status === "pending" || job.status === "processing") ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("Sukoon.privacy.export.processing")}
            </div>
          ) : job && job.status === "ready" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground">
                {t("Sukoon.privacy.export.ready", { count: job.entry_count ?? 0 })}
              </p>
              <div className="flex flex-wrap gap-2">
                {job.has_json ? (
                  <Button variant="outline" className="gap-2" onClick={() => void openDownload("json")}>
                    <FileJson className="size-4" aria-hidden />
                    {t("Sukoon.privacy.export.downloadData")}
                  </Button>
                ) : null}
                {job.has_journal ? (
                  <Button variant="outline" className="gap-2" onClick={() => void openDownload("journal")}>
                    <BookOpen className="size-4" aria-hidden />
                    {t("Sukoon.privacy.export.downloadJournal")}
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{t("Sukoon.privacy.export.expiresNote")}</p>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => requestExport.mutate()}
                  disabled={requestExport.isPending}
                >
                  {t("Sukoon.privacy.export.refresh")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {job && job.status === "failed" ? (
                <p className="text-sm text-destructive">{t("Sukoon.privacy.export.failed")}</p>
              ) : null}
              <div>
                <Button
                  className="gap-2"
                  onClick={() => requestExport.mutate()}
                  disabled={requestExport.isPending}
                >
                  <Download className="size-4" aria-hidden />
                  {requestExport.isPending
                    ? t("Sukoon.privacy.export.requesting")
                    : t("Sukoon.privacy.export.request")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Delete account (hidden once already scheduled) */}
      {!scheduled ? (
        <SectionCard title={t("Sukoon.privacy.delete.title")} description={t("Sukoon.privacy.delete.subtitle")}>
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("Sukoon.privacy.delete.scopeNote")}
            </p>
            <div>
              <Button variant="destructive" className="gap-2" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="size-4" aria-hidden />
                {t("Sukoon.privacy.delete.button")}
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {/* Recent privacy actions */}
      {summary.recent_actions.length > 0 ? (
        <SectionCard title={t("Sukoon.privacy.recent.title")}>
          <ul className="flex flex-col divide-y divide-border">
            {summary.recent_actions.map((a, i) => (
              <li key={`${a.action}-${i}`} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm text-foreground">{t(`Sukoon.privacy.recent.action.${a.action}`)}</span>
                <span className="text-xs text-muted-foreground">{fmtDate(a.created_at, language)}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {/* About link */}
      <Link
        to={`${base}/you/about`}
        className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors duration-300 hover:border-secondary/50"
      >
        <Info className="size-4 text-secondary" aria-hidden />
        {t("Sukoon.privacy.aboutLink")}
      </Link>

      <DeleteAccountDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        pending={deleteAccount.isPending}
        onConfirm={() =>
          deleteAccount.mutate(undefined, {
            onSuccess: () => setDeleteOpen(false),
          })
        }
      />
    </>
  );
}
