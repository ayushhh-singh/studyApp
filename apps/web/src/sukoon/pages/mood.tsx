/**
 * F5 mood check-in — the 10-second flow: emoji mood scale (required) -> an
 * optional emotion wheel -> optional factors -> an optional one-liner. Today's
 * PRIMARY entry (the first check-in of the IST day) is loaded pre-filled and
 * editable in place; "Check in again" starts a fresh EXTRA entry for the same
 * day (both are stored — a later dip is a real, separate signal).
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Pencil, Trash2 } from "lucide-react";
import { SUKOON_EMOTIONS, SUKOON_MOOD_FACTORS } from "@neev/shared";
import type { SukoonEmotionId, SukoonMoodEntry, SukoonMoodFactorId } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useTrackSukoonFeatureView } from "@/sukoon/lib/use-sukoon-analytics";
import {
  useMoodToday,
  useCreateMoodEntry,
  useUpdateMoodEntry,
  useDeleteMoodEntry,
} from "@/sukoon/lib/use-sukoon-mood";
import { MoodPicker, MoodChip, SignInPrompt } from "@/sukoon/components/journal/journal-ui";

function ChoiceChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition-colors duration-300",
        active
          ? "border-secondary bg-secondary/15 text-secondary"
          : "border-border bg-card text-muted-foreground hover:border-secondary/40",
      )}
    >
      {children}
    </button>
  );
}

export function Component() {
  const { t, language } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  useTrackSukoonFeatureView("mood");
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";

  const todayQuery = useMoodToday({ enabled: !!session });
  const createMut = useCreateMoodEntry();
  const updateMut = useUpdateMoodEntry();
  const deleteMut = useDeleteMoodEntry();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [emotions, setEmotions] = useState<SukoonEmotionId[]>([]);
  const [factors, setFactors] = useState<SukoonMoodFactorId[]>([]);
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const loadEntry = (entry: SukoonMoodEntry) => {
    setEditingId(entry.id);
    setScore(entry.score);
    setEmotions(entry.emotions);
    setFactors(entry.factors);
    setNote(entry.note ?? "");
    setExpanded(entry.emotions.length > 0 || entry.factors.length > 0 || !!entry.note);
    setJustSaved(false);
  };

  // Hydrate once from today's primary entry, if one already exists.
  useEffect(() => {
    if (hydrated || !todayQuery.data) return;
    if (todayQuery.data.primary) loadEntry(todayQuery.data.primary);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, todayQuery.data]);

  // Check `loading` BEFORE `session` — session starts null until the initial
  // getSession() resolves, and a disabled query's isPending never flips (it
  // simply never fetches), so gating on the query instead of auth's own
  // `loading` either never shows the prompt (signed-out) or flashes it at a
  // signed-in user on first paint. Matches routes/require-auth.tsx's pattern.
  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  const resetForNew = () => {
    setEditingId(null);
    setScore(null);
    setEmotions([]);
    setFactors([]);
    setNote("");
    setExpanded(false);
    setJustSaved(false);
  };

  const toggleEmotion = (id: SukoonEmotionId) =>
    setEmotions((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));
  const toggleFactor = (id: SukoonMoodFactorId) =>
    setFactors((cur) => (cur.includes(id) ? cur.filter((f) => f !== id) : [...cur, id]));

  const isSaving = createMut.isPending || updateMut.isPending;
  const canSave = score != null && !isSaving;

  const handleSave = () => {
    if (score == null || isSaving) return;
    const body = { score, emotions, factors, note: note.trim() || undefined };
    if (editingId) {
      updateMut.mutate({ id: editingId, body }, { onSuccess: () => setJustSaved(true) });
    } else {
      createMut.mutate(body, {
        onSuccess: (res) => {
          setEditingId(res.entry.id);
          setJustSaved(true);
        },
      });
    }
  };

  const entryTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(language === "hi" ? "hi-IN" : "en-IN", {
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5" lang={language}>
      <PageHeader
        title={t("Sukoon.mood.title")}
        description={t("Sukoon.mood.subtitle")}
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link to={`${base}/you`}>{t("Sukoon.mood.viewTrends")}</Link>
          </Button>
        }
      />

      {/* Non-blocking: the form below still works without today's data (a new
          entry doesn't need it) — this only warns that an EXISTING entry for
          today couldn't be checked, so a save might create a duplicate rather
          than editing it in place. */}
      {todayQuery.isError ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          {t("Sukoon.mood.todayLoadError")}{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => void todayQuery.refetch()}>
            {t("Sukoon.pricing.retry")}
          </button>
        </p>
      ) : null}

      <SectionCard title={t("Sukoon.mood.scoreLabel")}>
        {/* MoodPicker toggles OFF (onChange(null)) when its active option is
            tapped again — correct for journal's optional mood tag, but score
            here is REQUIRED, so a re-tap must be a no-op, not a silent clear. */}
        <MoodPicker value={score} onChange={(v) => v != null && setScore(v)} />
      </SectionCard>

      {!expanded ? (
        <Button variant="outline" onClick={() => setExpanded(true)} className="self-start">
          {t("Sukoon.mood.addMoreDetail")}
        </Button>
      ) : (
        <>
          <SectionCard
            title={t("Sukoon.mood.emotionsLabel")}
            description={t("Sukoon.mood.emotionsSub")}
          >
            <div className="flex flex-wrap gap-2">
              {SUKOON_EMOTIONS.map((e) => (
                <ChoiceChip key={e.id} active={emotions.includes(e.id)} onClick={() => toggleEmotion(e.id)}>
                  {language === "hi" ? e.label_hi : e.label_en}
                </ChoiceChip>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={t("Sukoon.mood.factorsLabel")} description={t("Sukoon.mood.factorsSub")}>
            <div className="flex flex-wrap gap-2">
              {SUKOON_MOOD_FACTORS.map((f) => (
                <ChoiceChip key={f.id} active={factors.includes(f.id)} onClick={() => toggleFactor(f.id)}>
                  {language === "hi" ? f.label_hi : f.label_en}
                </ChoiceChip>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={t("Sukoon.mood.noteLabel")}>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 280))}
              placeholder={t("Sukoon.mood.notePlaceholder")}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </SectionCard>
        </>
      )}

      <Button onClick={handleSave} disabled={!canSave}>
        {isSaving
          ? t("Sukoon.mood.saving")
          : editingId
            ? t("Sukoon.mood.update")
            : t("Sukoon.mood.save")}
      </Button>

      {justSaved ? (
        <p className="text-center text-sm text-secondary">{t("Sukoon.mood.savedNote")}</p>
      ) : null}

      {editingId ? (
        <div className="flex items-center justify-center gap-4">
          <Button variant="ghost" size="sm" onClick={resetForNew}>
            {t("Sukoon.mood.checkInAgain")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              deleteMut.mutate(editingId);
              resetForNew();
            }}
          >
            {t("Sukoon.mood.delete")}
          </Button>
        </div>
      ) : null}

      {todayQuery.data && todayQuery.data.extra.length > 0 ? (
        <SectionCard title={t("Sukoon.mood.todayOtherCheckIns")}>
          <div className="space-y-2">
            {todayQuery.data.extra.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <MoodChip mood={entry.score} />
                  <span className="text-xs text-muted-foreground">{entryTime(entry.created_at)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Sukoon.mood.edit")}
                    onClick={() => loadEntry(entry)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Sukoon.mood.delete")}
                    onClick={() => {
                      deleteMut.mutate(entry.id);
                      if (editingId === entry.id) resetForNew();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {todayQuery.data?.next_reminder_at ? (
        <p className="text-center text-xs text-muted-foreground">
          {t("Sukoon.mood.nextReminder", { time: entryTime(todayQuery.data.next_reminder_at) })}
        </p>
      ) : null}
    </div>
  );
}
