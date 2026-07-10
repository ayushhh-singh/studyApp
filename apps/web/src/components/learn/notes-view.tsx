import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { BookmarkPlus, BookOpen, Check, GraduationCap, Layers, ListTree, Lock, Zap } from "lucide-react";
import type { Locale, NoteBody } from "@prayasup/shared";
import { hasChapter } from "@prayasup/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useNoteForNode, useAddNoteDeck, useAddNoteBlock } from "@/hooks/use-notes";
import { useRecordEvent } from "@/hooks/use-record-event";
import { usePaywallStore } from "@/stores/paywall-store";
import { billingCopy as bc, pick } from "@/lib/billing-copy";
import { cn } from "@/lib/utils";
import { NoteArticle, noteVisibleSections } from "./note-article";
import { ChapterView } from "./chapter-view";

/** A prose block that respects Devanagari reading rhythm (taller leading, comfortable measure). */
function Prose({ children, locale }: { children: string; locale: Locale }) {
  return (
    <p
      className={cn(
        "max-w-[64ch] whitespace-pre-line text-[15px] text-foreground/90",
        locale === "hi" ? "leading-[1.95]" : "leading-[1.75]",
      )}
    >
      {children}
    </p>
  );
}

function AddButton({
  added,
  pending,
  onClick,
  label,
}: {
  added: boolean;
  pending: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || added}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        added
          ? "border-tulsi/40 bg-tulsi/15 text-tulsi-foreground"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
      )}
    >
      {added ? <Check className="size-4" /> : <BookmarkPlus className="size-4" />}
    </button>
  );
}

// Study | Quick Revision tab labels — local (bilingual) to avoid editing the
// shared messages/*.json files (concurrent-edit races).
const TAB_COPY = {
  en: { study: "Study", quick: "Quick Revision" },
  hi: { study: "अध्ययन", quick: "त्वरित रिवीजन" },
} as const;

export function NotesView({ nodeId, paperCode, locale }: { nodeId: string; paperCode: string; locale: Locale }) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: note, isLoading, isError } = useNoteForNode(nodeId);
  const addDeck = useAddNoteDeck();
  const addBlock = useAddNoteBlock();
  const recordEvent = useRecordEvent();
  const [quick, setQuick] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [deckDone, setDeckDone] = useState(false);

  // Reading-progress signal (feeds analytics + the dashboard "continue" card).
  useEffect(() => {
    if (note) recordEvent.mutate({ name: "note_read", props: { node_id: nodeId, note_id: note.id } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  const body: NoteBody | null = useMemo(() => (note ? note.content_i18n[locale] : null), [note, locale]);

  // Derived from the single shared addBlock mutation's own variables (not a
  // second isPending flag per button) — previously every "add to revision"
  // button in this note (overview, up_angle, every key fact) all read the same
  // addBlock.isPending, so clicking fact #1 disabled fact #2/#3's buttons too,
  // even though they were never clicked and nothing was happening to them.
  const pendingBlockKey =
    addBlock.isPending && addBlock.variables
      ? addBlock.variables.body.block === "key_fact"
        ? `fact:${addBlock.variables.body.index}`
        : `sec:${addBlock.variables.body.block}`
      : null;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <ListRowSkeleton />
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }

  if (isError || !note || !body) {
    return (
      <EmptyState
        icon={BookOpen}
        title={t("Notes.emptyTitle")}
        description={t("Notes.emptyDescription")}
      />
    );
  }

  const hasStudyChapter = hasChapter(note.study_content_i18n) && note.chapter_version > 0;
  const studyTab = searchParams.get("study") === "quick" ? "quick" : "study";
  const tabCopy = TAB_COPY[locale];

  function setStudyTab(next: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "quick") params.set("study", "quick");
        else params.delete("study");
        return params;
      },
      { replace: true },
    );
  }

  // Free users get the top-5 notes per paper in full; any other note comes back
  // `locked` (content trimmed to the overview / first chapter section). Show
  // that preview, then an upgrade gate — first-block preview + upgrade.
  if (note.locked) {
    // A locked note that still carries a (server-trimmed) chapter shows the
    // first section, then the upgrade gate; otherwise the plain overview preview.
    if (hasStudyChapter) {
      return (
        <div className="flex flex-col gap-4">
          <ChapterView note={note} paperCode={paperCode} nodeId={nodeId} locale={locale} />
          <UpgradeGate locale={locale} />
        </div>
      );
    }
    return <LockedNote overview={body.overview} locale={locale} />;
  }

  function markAdded(key: string) {
    setAdded((prev) => new Set(prev).add(key));
  }

  function addFact(index: number, fact: string) {
    if (!note) return;
    // Pull each language's fact by index independently (arrays can differ in
    // length after editing); fall back to the displayed text for the active
    // locale so the card is never empty on the side the user is reading.
    const hiFact = note.content_i18n.hi.key_facts[index]?.fact ?? (locale === "hi" ? fact : "");
    const enFact = note.content_i18n.en.key_facts[index]?.fact ?? (locale === "en" ? fact : "");
    addBlock.mutate(
      {
        noteId: note.id,
        body: {
          block: "key_fact",
          index,
          front_i18n: { hi: hiFact, en: enFact },
          back_i18n: { hi: t("Notes.factCardBack"), en: t("Notes.factCardBack") },
        },
      },
      { onSuccess: () => markAdded(`fact:${index}`) },
    );
  }

  function addSection(block: "overview" | "up_angle" | "pyq_analysis", label: string) {
    if (!note) return;
    addBlock.mutate(
      {
        noteId: note.id,
        body: {
          block,
          index: 0,
          front_i18n: { hi: label, en: label },
          back_i18n: { hi: note.content_i18n.hi[block], en: note.content_i18n.en[block] },
        },
      },
      { onSuccess: () => markAdded(`sec:${block}`) },
    );
  }

  // TOC entries (aside) — the article itself recomputes the same visible set.
  const visible = noteVisibleSections(t, body, quick);

  // The compact digest layer (unchanged) — the Quick Revision tab when a Study
  // chapter exists, or the whole note when it doesn't.
  const digestLayer = (
    <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
      {/* sticky mini-TOC (desktop) + toolbar */}
      <aside className="lg:sticky lg:top-20 lg:h-fit lg:w-52 lg:shrink-0">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={quick ? "default" : "outline"}
              onClick={() => setQuick((q) => !q)}
              className={quick ? "bg-marigold text-marigold-foreground hover:bg-marigold/90" : ""}
            >
              <Zap className="size-4" /> {t("Notes.quickMode")}
            </Button>
          </div>
          <nav aria-label={t("Notes.toc")} className="hidden lg:block">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ListTree className="size-3.5" /> {t("Notes.toc")}
            </p>
            <ul className="flex flex-col gap-0.5 border-s border-border">
              {visible.map((s) => (
                <li key={s.key}>
                  <a
                    href={`#note-${s.key}`}
                    className="-ms-px block border-s-2 border-transparent py-1 ps-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {note.srs_candidates.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={addDeck.isPending || deckDone}
              onClick={() =>
                addDeck.mutate(note.id, {
                  onSuccess: () => setDeckDone(true),
                })
              }
              className="justify-start"
            >
              {deckDone ? <Check className="size-4 text-tulsi-foreground" /> : <Layers className="size-4" />}{" "}
              {deckDone
                ? t("Notes.deckAdded", { count: addDeck.data?.added ?? note.srs_candidates.length })
                : t("Notes.addDeck", { count: note.srs_candidates.length })}
            </Button>
          )}
          {/* Previously a failed "add to revision" (overview/up_angle/any key
              fact/the whole deck) just silently returned the button to its
              normal enabled state with no feedback — indistinguishable from
              never having clicked it. */}
          {(addBlock.isError || addDeck.isError) && (
            <p className="text-xs text-coral">{t("Notes.addToRevisionFailed")}</p>
          )}
        </div>
      </aside>

      <NoteArticle
        body={body}
        sources={note.sources}
        locale={locale}
        quick={quick}
        practiceLink={`/${locale}/learn/${paperCode}/${nodeId}?tab=pyqs`}
        renderSectionAdd={(block) => (
          <AddButton
            added={added.has(`sec:${block}`)}
            pending={pendingBlockKey === `sec:${block}`}
            onClick={() => addSection(block, block === "overview" ? t("Notes.overview") : t("Notes.upAngle"))}
            label={t("Notes.addToRevision")}
          />
        )}
        renderFactAdd={(i, fact) => (
          <AddButton
            added={added.has(`fact:${i}`)}
            pending={pendingBlockKey === `fact:${i}`}
            onClick={() => addFact(i, fact)}
            label={t("Notes.addToRevision")}
          />
        )}
      />
    </div>
  );

  // Digest-only note (no Study chapter): render exactly as before — no tabs.
  if (!hasStudyChapter) return digestLayer;

  // Study | Quick Revision split. Study default; choice persisted in ?study=quick.
  return (
    <Tabs value={studyTab} onValueChange={setStudyTab}>
      <TabsList className="max-w-sm">
        <TabsTrigger value="study">
          <GraduationCap className="size-4" aria-hidden /> {tabCopy.study}
        </TabsTrigger>
        <TabsTrigger value="quick">
          <Zap className="size-4" aria-hidden /> {tabCopy.quick}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="study">
        <ChapterView note={note} paperCode={paperCode} nodeId={nodeId} locale={locale} />
      </TabsContent>
      <TabsContent value="quick">{digestLayer}</TabsContent>
    </Tabs>
  );
}

/** The upgrade call-to-action box, shared by the overview-preview gate and the trimmed-chapter gate. */
function UpgradeGate({ locale }: { locale: Locale }) {
  const openPaywall = usePaywallStore((s) => s.openPaywall);
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Lock className="size-5" aria-hidden />
      </span>
      <div>
        <h3 className="text-base font-semibold">{pick(locale, bc.lockedNoteHeading)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{pick(locale, bc.paywallNotesBody)}</p>
      </div>
      <Button onClick={() => openPaywall("all_notes")}>{pick(locale, bc.upgradeToPro)}</Button>
    </div>
  );
}

/** Free-tier gate for a note outside the top-5-per-paper allowance. */
function LockedNote({ overview, locale }: { overview: string; locale: Locale }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Overview preview, fading into the gate. */}
      <div className="relative max-h-56 overflow-hidden">
        <Prose locale={locale}>{overview}</Prose>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
      </div>
      <UpgradeGate locale={locale} />
    </div>
  );
}
