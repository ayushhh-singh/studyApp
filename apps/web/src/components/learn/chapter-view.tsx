import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  BadgeCheck,
  BookMarked,
  BookOpen,
  Check,
  Clock,
  FileText,
  GraduationCap,
  ListChecks,
  ListTree,
  MapPin,
  Newspaper,
  PenSquare,
  Sparkles,
  Table as TableIcon,
} from "lucide-react";
import type {
  ChapterBox,
  ChapterBoxKind,
  ChapterSection,
  Locale,
  NoteDetail,
  Question,
} from "@neev/shared";
import { ChapterMarkdown } from "@/components/ui-x/chapter-markdown";
import { MermaidDiagram } from "@/components/ui-x/mermaid-diagram";
import { Button } from "@/components/ui/button";
import { useAddNoteBlock } from "@/hooks/use-notes";
import { useQuestions } from "@/hooks/use-questions";
import { useRecordEvent } from "@/hooks/use-record-event";
import { useSyllabusNode } from "@/hooks/use-syllabus-node";
import { cn } from "@/lib/utils";

// User-facing strings kept local (bilingual) to avoid touching the shared
// messages/*.json files (concurrent-edit races). Keyed by locale.
const COPY = {
  en: {
    minRead: (n: number) => `${n} min read`,
    words: (n: number) => `${n.toLocaleString("en-IN")} words`,
    factChecked: "Fact-checked",
    sections: "Sections",
    practicePyqs: "Practice this section's PYQs",
    addFacts: "Add key facts to revision",
    added: "Added",
    askMentor: "Ask mentor about this",
    relatedCa: "Related current affairs",
    viewAllCa: "See current affairs for this topic",
    proTopic: "Pro topic",
    pyq: "PYQ",
    boxLabels: {
      prelims_facts: "Prelims facts",
      mains_angle: "Mains angle",
      case_study: "Case study",
      data_table: "Data",
      up_special: "UP special",
      pyq_inline: "Related PYQs",
    } satisfies Record<ChapterBoxKind, string>,
  },
  hi: {
    minRead: (n: number) => `${n} मिनट पढ़ें`,
    words: (n: number) => `${n.toLocaleString("hi-IN")} शब्द`,
    factChecked: "तथ्य-जाँचित",
    sections: "अनुभाग",
    practicePyqs: "इस अनुभाग के PYQ हल करें",
    addFacts: "मुख्य तथ्य रिवीजन में जोड़ें",
    added: "जोड़ा गया",
    askMentor: "इस पर मेंटर से पूछें",
    relatedCa: "संबंधित करेंट अफेयर्स",
    viewAllCa: "इस विषय के करेंट अफेयर्स देखें",
    proTopic: "प्रो विषय",
    pyq: "PYQ",
    boxLabels: {
      prelims_facts: "प्रीलिम्स तथ्य",
      mains_angle: "मेन्स दृष्टिकोण",
      case_study: "केस स्टडी",
      data_table: "डेटा",
      up_special: "यूपी विशेष",
      pyq_inline: "संबंधित PYQ",
    } satisfies Record<ChapterBoxKind, string>,
  },
} as const;

const BOX_META: Record<
  ChapterBoxKind,
  { icon: typeof BookOpen; band: string; labelColor: string }
> = {
  prelims_facts: { icon: ListChecks, band: "border-primary/25 bg-primary/[0.06]", labelColor: "text-primary" },
  mains_angle: { icon: PenSquare, band: "border-tulsi/25 bg-tulsi/[0.07]", labelColor: "text-tulsi-foreground" },
  case_study: { icon: BookOpen, band: "border-marigold/25 bg-marigold/[0.08]", labelColor: "text-marigold-foreground" },
  data_table: { icon: TableIcon, band: "border-border bg-background", labelColor: "text-muted-foreground" },
  up_special: { icon: MapPin, band: "border-tulsi/25 bg-tulsi/[0.07]", labelColor: "text-tulsi-foreground" },
  pyq_inline: { icon: BookMarked, band: "border-primary/20 bg-primary/[0.04]", labelColor: "text-primary" },
};

/** A ~240-char plain-text snippet of a markdown body, for a fallback revision-card back. */
function markdownSnippet(md: string): string {
  const plain = (md ?? "")
    .replace(/`[^`]*`/g, "")
    .replace(/[#*_>|`-]/g, " ")
    .replace(/\[S\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 240 ? `${plain.slice(0, 240).trimEnd()}…` : plain;
}

/** Every pyq id a section references, from its own list plus any pyq_inline boxes — deduped. */
function sectionAllPyqIds(s: ChapterSection): string[] {
  const ids = new Set<string>(s.pyq_ids);
  for (const b of s.boxes) {
    if (b.kind === "pyq_inline") b.pyq_ids.forEach((id) => ids.add(id));
  }
  return [...ids];
}

/** A short, distinguishing chip label — year + a truncated stem preview, not a bare "PYQ". */
function pyqChipLabel(question: Question | undefined, locale: Locale, fallback: string): string {
  if (!question) return fallback;
  const stem = (question.stem_i18n[locale] ?? "").replace(/\s+/g, " ").trim();
  if (!stem) return fallback;
  const preview = stem.length > 46 ? `${stem.slice(0, 46).trimEnd()}…` : stem;
  return question.year ? `${question.year} · ${preview}` : preview;
}

/** Deep-link chip into this section's scoped PYQ view, highlighting the one it represents. */
function PyqChip({
  sectionPyqLink,
  id,
  question,
  locale,
  fallback,
}: {
  sectionPyqLink: string;
  id: string;
  question: Question | undefined;
  locale: Locale;
  fallback: string;
}) {
  return (
    <Link
      to={`${sectionPyqLink}&qid=${id}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
    >
      <BookMarked className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{pyqChipLabel(question, locale, fallback)}</span>
    </Link>
  );
}

function ChapterBoxView({
  box,
  locale,
  sources,
  sectionPyqLink,
  questionsById,
  pyqFallback,
}: {
  box: ChapterBox;
  locale: Locale;
  sources: NoteDetail["sources"];
  sectionPyqLink: string;
  questionsById: Map<string, Question>;
  pyqFallback: string;
}) {
  const c = COPY[locale];
  const meta = BOX_META[box.kind];
  const Icon = meta.icon;
  return (
    <div className={cn("rounded-xl border p-4", meta.band)}>
      <p className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", meta.labelColor)}>
        <Icon className="size-3.5" aria-hidden /> {c.boxLabels[box.kind]}
      </p>
      {box.kind === "pyq_inline" ? (
        <div className="flex flex-wrap gap-2">
          {box.pyq_ids.map((id) => (
            <PyqChip
              key={id}
              sectionPyqLink={sectionPyqLink}
              id={id}
              question={questionsById.get(id)}
              locale={locale}
              fallback={pyqFallback}
            />
          ))}
        </div>
      ) : (
        <ChapterMarkdown content={box.content_i18n[locale]} locale={locale} sources={sources} />
      )}
    </div>
  );
}

export function ChapterView({
  note,
  paperCode,
  nodeId,
  locale,
}: {
  note: NoteDetail;
  paperCode: string;
  nodeId: string;
  locale: Locale;
}) {
  const c = COPY[locale];
  const sc = note.study_content_i18n;
  const sections = sc.sections;
  const navigate = useNavigate();
  const addBlock = useAddNoteBlock();
  const recordEvent = useRecordEvent();
  // LIVE node fetch — the same source the Learn-node CA tab reads; NOT baked
  // into the chapter, so the "Related current affairs" box always reflects the
  // current linked items.
  const nodeQuery = useSyllabusNode(nodeId);
  const relatedCa = nodeQuery.data?.related_current_affairs ?? [];

  const [added, setAdded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);
  const firedRef = useRef<Set<string>>(new Set());

  const caLink = `/${locale}/learn/${paperCode}/${nodeId}?tab=ca`;

  // Every PYQ this chapter cites, fetched ONCE in a single request (not one
  // per chip) so chip labels can show a real distinguishing preview instead
  // of a generic "PYQ" repeated for every question.
  const allPyqIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sections) sectionAllPyqIds(s).forEach((id) => ids.add(id));
    return [...ids];
  }, [sections]);
  const { data: pyqData } = useQuestions(allPyqIds.length > 0 ? { ids: allPyqIds } : { ids: [] });
  const questionsById = useMemo(() => {
    const map = new Map<string, Question>();
    for (const q of pyqData?.items ?? []) map.set(q.id, q);
    return map;
  }, [pyqData]);

  // TOC built from the sections themselves so anchor ids always align.
  const toc = useMemo(
    () => sections.map((s) => ({ id: s.id, label: s.heading_i18n[locale] })),
    [sections, locale],
  );

  // note_section_read (once per section) + active-TOC highlight, via two
  // IntersectionObservers (different thresholds/margins, so they don't fight).
  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(`chapter-${s.id}`))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;

    const readObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id.replace(/^chapter-/, "");
          if (firedRef.current.has(id)) continue;
          firedRef.current.add(id);
          recordEvent.mutate({
            name: "note_section_read",
            props: { node_id: nodeId, note_id: note.id, section_id: id },
          });
        }
      },
      { threshold: 0.15 },
    );

    const activeObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id.replace(/^chapter-/, ""));
        }
      },
      { rootMargin: "-20% 0px -75% 0px", threshold: 0 },
    );

    els.forEach((el) => {
      readObserver.observe(el);
      activeObserver.observe(el);
    });
    return () => {
      readObserver.disconnect();
      activeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, sections.length]);

  function markAdded(id: string) {
    setAdded((prev) => new Set(prev).add(id));
  }

  function addSectionFacts(section: ChapterSection, index: number) {
    const prelims = section.boxes.find((b) => b.kind === "prelims_facts");
    const back = prelims
      ? prelims.content_i18n
      : { hi: markdownSnippet(section.body_md_i18n.hi), en: markdownSnippet(section.body_md_i18n.en) };
    addBlock.mutate(
      {
        noteId: note.id,
        body: {
          block: "overview",
          index: 200 + index,
          front_i18n: section.heading_i18n,
          back_i18n: back,
        },
      },
      { onSuccess: () => markAdded(section.id) },
    );
  }

  function askMentor(heading: string) {
    const qs = new URLSearchParams({ teach: "1", topic: heading, node: nodeId });
    navigate(`/${locale}/doubts?${qs.toString()}`);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Chapter header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock className="size-4" aria-hidden /> {c.minRead(sc.est_read_minutes)}
        </span>
        <span className="flex items-center gap-1.5">
          <FileText className="size-4" aria-hidden /> {c.words(sc.word_count)}
        </span>
        {note.fact_audit_ok && (
          <span className="flex items-center gap-1 rounded-full border border-tulsi/30 bg-tulsi/10 px-2 py-0.5 text-xs font-medium text-tulsi-foreground">
            <BadgeCheck className="size-3.5" aria-hidden /> {c.factChecked}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
        {/* sticky section TOC (desktop) */}
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:h-fit lg:w-52 lg:shrink-0">
          <nav aria-label={c.sections}>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ListTree className="size-3.5" /> {c.sections}
            </p>
            <ul className="flex flex-col gap-0.5 border-s border-border">
              {toc.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#chapter-${s.id}`}
                    aria-current={activeId === s.id ? "true" : undefined}
                    className={cn(
                      "-ms-px block border-s-2 py-1 ps-3 text-sm transition-colors hover:text-foreground",
                      activeId === s.id
                        ? "border-primary font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:border-primary/50",
                    )}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0 flex-1">
          {/* mobile section chips */}
          <div className="mb-4 flex gap-2 overflow-x-auto scrollbar-hide pb-1 lg:hidden">
            {toc.map((s) => (
              <a
                key={s.id}
                href={`#chapter-${s.id}`}
                className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground"
              >
                {s.label}
              </a>
            ))}
          </div>

          <div className="flex flex-col gap-9">
            {sections.map((s, index) => {
              const sectionAdded = added.has(s.id);
              // All of this section's own cited PYQs (own list + any
              // pyq_inline boxes), so both the "Practice" button and every
              // chip on this section deep-link into a view scoped to just
              // these questions — not the whole node's paginated bank.
              const sectionIds = sectionAllPyqIds(s);
              const sectionPyqLink =
                sectionIds.length > 0
                  ? `/${locale}/learn/${paperCode}/${nodeId}?tab=pyqs&ids=${sectionIds.join(",")}`
                  : "";
              // Ids already shown via a pyq_inline box shouldn't render again
              // as a second, unlabeled chip row right below it.
              const boxPyqIds = new Set(
                s.boxes.flatMap((b) => (b.kind === "pyq_inline" ? b.pyq_ids : [])),
              );
              const looseIds = s.pyq_ids.filter((id) => !boxPyqIds.has(id));
              return (
                <section key={s.id} id={`chapter-${s.id}`} className="scroll-mt-20">
                  <h2 className="mb-3 text-lg font-semibold text-foreground" lang={locale}>
                    {s.heading_i18n[locale]}
                  </h2>

                  <ChapterMarkdown content={s.body_md_i18n[locale]} locale={locale} sources={note.sources} />

                  {/* Diagram */}
                  {s.diagram &&
                    (s.diagram.kind === "mermaid" ? (
                      <MermaidDiagram
                        source={s.diagram.source_i18n[locale]}
                        caption={s.diagram.caption_i18n?.[locale] ?? null}
                      />
                    ) : (
                      <figure className="my-4 overflow-x-auto rounded-xl border border-border bg-muted/20 p-3">
                        <ChapterMarkdown
                          content={s.diagram.source_i18n[locale]}
                          locale={locale}
                          sources={note.sources}
                        />
                        {s.diagram.caption_i18n?.[locale] && (
                          <figcaption className="mt-2 text-center text-xs text-muted-foreground">
                            {s.diagram.caption_i18n[locale]}
                          </figcaption>
                        )}
                      </figure>
                    ))}

                  {/* Boxes */}
                  {s.boxes.length > 0 && (
                    <div className="mt-4 flex flex-col gap-3">
                      {s.boxes.map((box, bi) => (
                        <ChapterBoxView
                          key={`${s.id}-box-${bi}`}
                          box={box}
                          locale={locale}
                          sources={note.sources}
                          sectionPyqLink={sectionPyqLink}
                          questionsById={questionsById}
                          pyqFallback={c.pyq}
                        />
                      ))}
                    </div>
                  )}

                  {/* Inline PYQ chips for section-level references not
                      already shown in a pyq_inline box above. */}
                  {looseIds.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1.5">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                        <BookMarked className="size-3.5" aria-hidden /> {c.boxLabels.pyq_inline}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {looseIds.map((id) => (
                          <PyqChip
                            key={id}
                            sectionPyqLink={sectionPyqLink}
                            id={id}
                            question={questionsById.get(id)}
                            locale={locale}
                            fallback={c.pyq}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section action row */}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {sectionIds.length > 0 && (
                      <Button asChild size="sm" variant="outline">
                        <Link to={sectionPyqLink}>
                          <ListChecks className="size-4" aria-hidden /> {c.practicePyqs}
                        </Link>
                      </Button>
                    )}
                    {/* Add + Ask-mentor are hidden for locked (Pro) notes. */}
                    {note.locked ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-primary/25 px-2 py-1 text-xs font-medium text-primary">
                        {c.proTopic}
                      </span>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={sectionAdded || addBlock.isPending}
                          onClick={() => addSectionFacts(s, index)}
                          className={sectionAdded ? "border-tulsi/40 text-tulsi-foreground" : ""}
                        >
                          {sectionAdded ? <Check className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}{" "}
                          {sectionAdded ? c.added : c.addFacts}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => askMentor(s.heading_i18n[locale])}
                        >
                          <GraduationCap className="size-4" aria-hidden /> {c.askMentor}
                        </Button>
                      </>
                    )}
                  </div>
                </section>
              );
            })}

            {/* LIVE related current affairs (never baked into the chapter) */}
            <section className="flex flex-col gap-3 border-t border-border pt-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Newspaper className="size-4" aria-hidden /> {c.relatedCa}
              </h3>
              {relatedCa.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {relatedCa.slice(0, 4).map((item) => (
                    <li key={item.id}>
                      <Link
                        to={caLink}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-primary/40"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title_i18n[locale]}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{item.date}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Link
                  to={caLink}
                  className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <Newspaper className="size-4" aria-hidden /> {c.viewAllCa}
                </Link>
              )}
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
