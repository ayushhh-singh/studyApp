import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import {
  BookmarkPlus,
  Check,
  Languages,
  Layers,
  ListTree,
  Loader2,
  MapPin,
  StickyNote,
  Trash2,
  Zap,
} from "lucide-react";
import type { NoteBody } from "@prayasup/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import { useCreateSrsCard } from "@/hooks/use-srs";
import {
  useAddUserNoteDeck,
  useDeleteUserNote,
  useTranslateUserNote,
  useUserNote,
} from "@/hooks/use-user-notes";
import { NoteArticle, noteVisibleSections } from "@/components/learn/note-article";
import { cn } from "@/lib/utils";

function AddButton({ added, pending, onClick, label }: { added: boolean; pending: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || added}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        added ? "border-tulsi/40 bg-tulsi/15 text-tulsi-foreground" : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
      )}
    >
      {added ? <Check className="size-4" /> : <BookmarkPlus className="size-4" />}
    </button>
  );
}

/** The personal "My notes" reader — same block reader as the official notes, with a "My note" badge. */
export function UserNoteReader({ id }: { id: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { data: note, isLoading, isError } = useUserNote(id);
  const addDeck = useAddUserNoteDeck(id);
  const translate = useTranslateUserNote(id);
  const remove = useDeleteUserNote();
  const createCard = useCreateSrsCard();

  const [quick, setQuick] = useState(false);
  const [deckDone, setDeckDone] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }
  if (isError || !note) {
    return <EmptyState icon={StickyNote} title={t("MyNotes.notFoundTitle")} description={t("MyNotes.notFoundDescription")} />;
  }

  // Render the current locale if it's populated, else the one that is, with a
  // "translate" prompt to fill the current locale.
  const hasCurrent = note.filled_locales.includes(locale);
  const viewLocale = hasCurrent ? locale : (note.filled_locales[0] ?? locale);
  const body: NoteBody = note.content_i18n[viewLocale];
  const visible = noteVisibleSections(t, body, quick);

  const markAdded = (key: string) => setAdded((prev) => new Set(prev).add(key));

  function addFact(index: number, fact: string) {
    if (!note) return;
    const key = `fact:${index}`;
    setPendingKey(key);
    const hi = note.content_i18n.hi.key_facts[index]?.fact ?? (viewLocale === "hi" ? fact : "");
    const en = note.content_i18n.en.key_facts[index]?.fact ?? (viewLocale === "en" ? fact : "");
    createCard.mutate(
      { front_i18n: { hi, en }, back_i18n: { hi: t("Notes.factCardBack"), en: t("Notes.factCardBack") } },
      { onSuccess: () => markAdded(key), onSettled: () => setPendingKey(null) },
    );
  }

  function addSection(block: "overview" | "up_angle") {
    if (!note) return;
    const key = `sec:${block}`;
    setPendingKey(key);
    const label = block === "overview" ? t("Notes.overview") : t("Notes.upAngle");
    createCard.mutate(
      {
        front_i18n: { hi: label, en: label },
        back_i18n: { hi: note.content_i18n.hi[block], en: note.content_i18n.en[block] },
      },
      { onSuccess: () => markAdded(key), onSettled: () => setPendingKey(null) },
    );
  }

  const del = () => {
    if (!window.confirm(t("MyNotes.deleteConfirm"))) return;
    remove.mutate(id, { onSuccess: () => navigate(`/${locale}/profile`) });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-tulsi/15 px-2 py-0.5 text-xs font-semibold text-tulsi-foreground">
            <StickyNote className="size-3" aria-hidden /> {t("MyNotes.badge")}
          </span>
          {note.syllabus_node_id && note.syllabus_paper_code && note.syllabus_title_i18n && (
            <Link
              to={`/${locale}/learn/${note.syllabus_paper_code}/${note.syllabus_node_id}`}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-primary"
            >
              <MapPin className="size-3" aria-hidden /> {note.syllabus_title_i18n[locale]}
            </Link>
          )}
        </div>
        <h1 className="text-xl font-bold">{note.title}</h1>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
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
                onClick={() => addDeck.mutate(undefined, { onSuccess: () => setDeckDone(true) })}
                className="justify-start"
              >
                {deckDone ? <Check className="size-4 text-tulsi-foreground" /> : <Layers className="size-4" />}{" "}
                {deckDone
                  ? t("Notes.deckAdded", { count: addDeck.data?.added ?? note.srs_candidates.length })
                  : t("Notes.addDeck", { count: note.srs_candidates.length })}
              </Button>
            )}
            {!hasCurrent && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={translate.isPending}
                onClick={() => translate.mutate()}
                className="justify-start"
              >
                {translate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Languages className="size-4" />}{" "}
                {t("MyNotes.translate")}
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={del} disabled={remove.isPending} className="justify-start text-coral hover:text-coral">
              <Trash2 className="size-4" /> {t("MyNotes.delete")}
            </Button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {!hasCurrent && (
            <div className="mb-4 rounded-lg border border-marigold/30 bg-marigold/10 px-3 py-2 text-xs text-marigold-foreground">
              {t("MyNotes.otherLocaleNotice")}
            </div>
          )}
          <NoteArticle
            body={body}
            sources={note.sources}
            locale={viewLocale}
            quick={quick}
            renderSectionAdd={(block) => (
              <AddButton added={added.has(`sec:${block}`)} pending={pendingKey === `sec:${block}`} onClick={() => addSection(block)} label={t("Notes.addToRevision")} />
            )}
            renderFactAdd={(i, fact) => (
              <AddButton added={added.has(`fact:${i}`)} pending={pendingKey === `fact:${i}`} onClick={() => addFact(i, fact)} label={t("Notes.addToRevision")} />
            )}
          />
        </div>
      </div>
    </div>
  );
}
