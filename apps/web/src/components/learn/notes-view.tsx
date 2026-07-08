import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  BookmarkPlus,
  BookOpen,
  Check,
  ExternalLink,
  Layers,
  ListTree,
  Lock,
  MapPin,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { Locale, NoteBody } from "@prayasup/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { useNoteForNode, useAddNoteDeck, useAddNoteBlock } from "@/hooks/use-notes";
import { useRecordEvent } from "@/hooks/use-record-event";
import { usePaywallStore } from "@/stores/paywall-store";
import { billingCopy as bc, pick } from "@/lib/billing-copy";
import { cn } from "@/lib/utils";

type BlockKey = "overview" | "key_facts" | "up_angle" | "pyq_analysis" | "mnemonics" | "quick_revision" | "further_reading";

interface Section {
  key: BlockKey;
  label: string;
  icon: typeof BookOpen;
}

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

export function NotesView({ nodeId, paperCode, locale }: { nodeId: string; paperCode: string; locale: Locale }) {
  const { t } = useTranslation();
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

  // Free users get the top-5 notes per paper in full; any other note comes back
  // `locked` (content trimmed to the overview). Show that preview, then an
  // upgrade gate — first-block preview + upgrade, per the paywall spec.
  if (note.locked) {
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

  const sections = (
    [
      { key: "overview", label: t("Notes.overview"), icon: BookOpen },
      { key: "key_facts", label: t("Notes.keyFacts"), icon: Sparkles },
      { key: "up_angle", label: t("Notes.upAngle"), icon: MapPin },
      { key: "pyq_analysis", label: t("Notes.pyqAnalysis"), icon: TrendingUp },
      { key: "mnemonics", label: t("Notes.mnemonics"), icon: Zap },
      { key: "quick_revision", label: t("Notes.quickRevision"), icon: Layers },
    ] satisfies Section[]
  ).filter((s) => {
    // Only the bilingual overview is guaranteed by the publish gate; drop any
    // other block that came back empty so the reader never shows a bare header.
    switch (s.key) {
      case "key_facts":
        return body.key_facts.length > 0;
      case "quick_revision":
        return body.quick_revision.length > 0;
      case "mnemonics":
        return body.mnemonics.length > 0;
      case "up_angle":
        return body.up_angle.trim().length > 0;
      case "pyq_analysis":
        return body.pyq_analysis.trim().length > 0;
      default:
        return true;
    }
  });

  // Quick Revision mode: only key facts + the quick-revision list.
  const visible = quick ? sections.filter((s) => s.key === "key_facts" || s.key === "quick_revision") : sections;

  return (
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

      {/* article */}
      <article className="min-w-0 flex-1">
        {/* mobile section chips */}
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {visible.map((s) => (
            <a
              key={s.key}
              href={`#note-${s.key}`}
              className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              {s.label}
            </a>
          ))}
        </div>

        <div className="flex flex-col gap-7">
          {visible.map((s) => (
            <section key={s.key} id={`note-${s.key}`} className="scroll-mt-20">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <s.icon className="size-4 text-primary" aria-hidden /> {s.label}
                </h3>
                {s.key === "overview" && (
                  <AddButton
                    added={added.has("sec:overview")}
                    pending={pendingBlockKey === "sec:overview"}
                    onClick={() => addSection("overview", s.label)}
                    label={t("Notes.addToRevision")}
                  />
                )}
                {s.key === "up_angle" && (
                  <AddButton
                    added={added.has("sec:up_angle")}
                    pending={pendingBlockKey === "sec:up_angle"}
                    onClick={() => addSection("up_angle", s.label)}
                    label={t("Notes.addToRevision")}
                  />
                )}
              </div>

              {s.key === "overview" && <Prose locale={locale}>{body.overview}</Prose>}

              {s.key === "up_angle" && (
                <div className="rounded-xl border border-tulsi/25 bg-tulsi/[0.07] p-4">
                  <Prose locale={locale}>{body.up_angle}</Prose>
                </div>
              )}

              {s.key === "pyq_analysis" && (
                <div className="flex flex-col gap-3">
                  <Prose locale={locale}>{body.pyq_analysis}</Prose>
                  <Link
                    to={`/${locale}/learn/${paperCode}/${nodeId}?tab=pyqs`}
                    className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
                  >
                    <TrendingUp className="size-4" /> {t("Notes.practiceThesePyqs")}
                  </Link>
                </div>
              )}

              {s.key === "key_facts" && (
                <ul className="flex flex-col gap-2">
                  {body.key_facts.map((f, i) => {
                    const source = f.source_ref ? note.sources.find((src) => src.id === f.source_ref) : null;
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5"
                      >
                        <span
                          className={cn(
                            "min-w-0 flex-1 text-[15px]",
                            locale === "hi" ? "leading-[1.9]" : "leading-relaxed",
                          )}
                        >
                          {f.fact}
                          {source && (
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="ms-1.5 inline-flex items-center gap-0.5 align-middle text-xs font-medium text-primary hover:underline"
                            >
                              {f.source_ref} <ExternalLink className="size-3" />
                            </a>
                          )}
                        </span>
                        <AddButton
                          added={added.has(`fact:${i}`)}
                          pending={pendingBlockKey === `fact:${i}`}
                          onClick={() => addFact(i, f.fact)}
                          label={t("Notes.addToRevision")}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}

              {s.key === "mnemonics" && (
                <ul className="flex flex-col gap-2">
                  {body.mnemonics.map((m, i) => (
                    <li
                      key={i}
                      className={cn(
                        "rounded-lg border border-marigold/25 bg-marigold/[0.08] px-3 py-2 text-[15px]",
                        locale === "hi" ? "leading-[1.9]" : "leading-relaxed",
                      )}
                    >
                      {m}
                    </li>
                  ))}
                </ul>
              )}

              {s.key === "quick_revision" && (
                <ul className="flex flex-col gap-1.5">
                  {body.quick_revision.map((q, i) => (
                    <li
                      key={i}
                      className={cn(
                        "flex gap-2 text-[15px] text-foreground/90",
                        locale === "hi" ? "leading-[1.9]" : "leading-relaxed",
                      )}
                    >
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {/* Further reading + sources (hidden in quick mode) */}
          {!quick && (body.further_reading.length > 0 || note.sources.length > 0) && (
            <section className="flex flex-col gap-3 border-t border-border pt-5">
              <h3 className="text-sm font-semibold text-muted-foreground">{t("Notes.furtherReading")}</h3>
              <ul className="flex flex-col gap-1.5">
                {body.further_reading.map((r, i) => (
                  <li key={`fr-${i}`}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="size-3.5" /> {r.title}
                    </a>
                  </li>
                ))}
                {note.sources.map((src) => (
                  <li key={src.id}>
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:underline"
                    >
                      <ExternalLink className="size-3" /> [{src.id}] {src.title}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t("Notes.ourWordsNote")}</p>
            </section>
          )}
        </div>
      </article>
    </div>
  );
}

/** Free-tier gate for a note outside the top-5-per-paper allowance. */
function LockedNote({ overview, locale }: { overview: string; locale: Locale }) {
  const openPaywall = usePaywallStore((s) => s.openPaywall);
  return (
    <div className="flex flex-col gap-4">
      {/* Overview preview, fading into the gate. */}
      <div className="relative max-h-56 overflow-hidden">
        <Prose locale={locale}>{overview}</Prose>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
      </div>
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
    </div>
  );
}
