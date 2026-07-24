/**
 * F4 single journal entry view — the decrypted body (rendered as markdown-lite),
 * mood/tags/prompt/date, the on-request AI Reflection (✨, streamed), and
 * edit / delete-with-confirm. The reflection is gated by the tier allowance
 * (free: 3 lifetime, plus+: daily) surfaced from the API.
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Pencil, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui-x/markdown";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import {
  useJournalEntry,
  useDeleteJournalEntry,
  useReflectionUsage,
  useReflectionStream,
} from "@/sukoon/lib/use-sukoon-journal";
import {
  MoodChip,
  SignInPrompt,
  TagBadge,
  useEntryDate,
  usePromptText,
} from "@/sukoon/components/journal/journal-ui";
import type { SukoonJournalEntry } from "@neev/shared";

export function Component() {
  const { t, language } = useSukoonLanguage();
  const { locale, entryId } = useParams<{ locale?: string; entryId?: string }>();
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const base = locale ? `/${locale}/sukoon` : "";
  const promptText = usePromptText();
  const entryDate = useEntryDate();

  const entryQuery = useJournalEntry(entryId, { enabled: !!session });
  const deleteMut = useDeleteJournalEntry();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Check `loading` BEFORE `session` — see journal.tsx's identical comment.
  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  if (entryQuery.isPending) {
    return (
      <div className="mx-auto max-w-2xl space-y-3" lang={language}>
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }
  if (entryQuery.isError || !entryQuery.data) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center" lang={language}>
        <p className="text-sm text-muted-foreground">{t("Sukoon.journal.listEmptyTitle")}</p>
        <Button variant="outline" size="sm" className="mt-4" asChild>
          <Link to={`${base}/journal`}>{t("Sukoon.journal.back")}</Link>
        </Button>
      </div>
    );
  }

  const entry = entryQuery.data.entry;

  const onDelete = async () => {
    if (!entryId) return;
    try {
      await deleteMut.mutateAsync(entryId);
      navigate(`${base}/journal`, { replace: true });
    } catch {
      /* surfaced by isError */
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5" lang={language}>
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`${base}/journal`}>
            <ArrowLeft className="size-4" />
            {t("Sukoon.journal.back")}
          </Link>
        </Button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`${base}/journal/${entryId}/edit`}>
              <Pencil className="size-4" />
              {t("Sukoon.journal.edit")}
            </Link>
          </Button>
          <Sheet open={confirmOpen} onOpenChange={setConfirmOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="size-4" />
                {t("Sukoon.journal.delete")}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" title={t("Sukoon.journal.deleteTitle")}>
              <p className="mb-4 text-sm text-muted-foreground">{t("Sukoon.journal.deleteBody")}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setConfirmOpen(false)}
                >
                  {t("Sukoon.journal.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={deleteMut.isPending}
                  onClick={onDelete}
                >
                  {t("Sukoon.journal.deleteConfirm")}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Meta line */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{entryDate(entry.created_at)}</span>
        {entry.mood != null ? <MoodChip mood={entry.mood} /> : null}
      </div>

      {/* Prompt context */}
      {entry.prompt ? (
        <div className="rounded-2xl border border-secondary/40 bg-secondary/10 p-3 text-sm leading-relaxed text-foreground">
          {promptText(entry.prompt)}
        </div>
      ) : null}

      {/* Body */}
      {entry.body ? (
        <Markdown content={entry.body} className="text-[15px] leading-[1.9]" />
      ) : (
        <p className="text-sm italic text-muted-foreground">{t("Sukoon.journal.emptyBody")}</p>
      )}

      {/* Tags */}
      {entry.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>
      ) : null}

      {/* AI reflection */}
      <ReflectionPanel entry={entry} />
    </div>
  );
}

function ReflectionPanel({ entry }: { entry: SukoonJournalEntry }) {
  const { t } = useSukoonLanguage();
  const usageQuery = useReflectionUsage({ enabled: true });
  const { text, status, error, run } = useReflectionStream();

  const hasBody = !!entry.body && entry.body.trim().length > 0;
  const usage = usageQuery.data ?? null;
  const remaining = usage?.remaining ?? 0;
  const spent = usage != null && remaining <= 0;
  const streaming = status === "streaming";

  // Prefer the live-streamed text while running/just-finished; else the persisted one.
  const shown = status === "streaming" || status === "done" ? text : (entry.reflection ?? "");
  const hasReflection = shown.trim().length > 0;

  return (
    <div className="rounded-2xl border border-border bg-accent/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-secondary" />
          <span className="text-sm font-semibold">{t("Sukoon.journal.reflectionTitle")}</span>
        </div>
        {usage && usage.tier === "free" ? (
          <span className="text-xs text-muted-foreground">
            {t("Sukoon.journal.reflectLeft", { n: remaining })}
          </span>
        ) : null}
      </div>

      {hasReflection ? (
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-[1.9] text-foreground">
          {shown}
          {streaming ? <span className="ml-0.5 animate-pulse">▍</span> : null}
        </p>
      ) : null}

      {status === "error" ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : null}

      <div className="mt-3">
        {!hasBody ? (
          <p className="text-xs text-muted-foreground">{t("Sukoon.journal.reflectNeedsBody")}</p>
        ) : spent && !hasReflection ? (
          <p className="text-xs text-muted-foreground">
            {usage?.scope === "lifetime"
              ? t("Sukoon.journal.reflectFreeSpent")
              : t("Sukoon.journal.reflectDailySpent")}
          </p>
        ) : (
          <Button
            variant={hasReflection ? "outline" : "default"}
            size="sm"
            disabled={streaming || spent}
            onClick={() => run(entry.id)}
          >
            <Sparkles className="size-4" />
            {streaming
              ? t("Sukoon.journal.reflecting")
              : hasReflection
                ? t("Sukoon.journal.reflectAgain")
                : t("Sukoon.journal.reflect")}
          </Button>
        )}
      </div>

      {hasReflection ? (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {t("Sukoon.journal.reflectionDisclaimer")}
        </p>
      ) : null}
    </div>
  );
}
