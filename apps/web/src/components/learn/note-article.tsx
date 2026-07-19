import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { BookOpen, ExternalLink, Layers, MapPin, Sparkles, TrendingUp, Zap } from "lucide-react";
import type { Locale, NoteBody, NoteSource } from "@neev/shared";
import { cn } from "@/lib/utils";

export type NoteBlockKey =
  | "overview"
  | "key_facts"
  | "up_angle"
  | "pyq_analysis"
  | "mnemonics"
  | "quick_revision";

/** A prose block that respects Devanagari reading rhythm. */
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

interface Section {
  key: NoteBlockKey;
  label: string;
  icon: typeof BookOpen;
}

/**
 * The presentational note article — the section list + further reading — shared
 * by the official AI-note reader (NotesView) and the personal "My notes" reader,
 * so both render the fixed block structure identically. State (which blocks are
 * added to revision, deck/translate actions, the TOC/toolbar) lives in each
 * wrapper; the per-block "add to revision" affordance is passed in via render
 * props so each wrapper wires its own mutation.
 */
export function NoteArticle({
  body,
  sources,
  locale,
  quick,
  practiceLink,
  renderSectionAdd,
  renderFactAdd,
}: {
  body: NoteBody;
  sources: NoteSource[];
  locale: Locale;
  quick: boolean;
  /** Deep link for the "practice these PYQs" chip under pyq_analysis (null → hidden). */
  practiceLink?: string | null;
  renderSectionAdd?: (block: "overview" | "up_angle") => ReactNode;
  renderFactAdd?: (index: number, fact: string) => ReactNode;
}) {
  const { t } = useTranslation();

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

  const visible = quick ? sections.filter((s) => s.key === "key_facts" || s.key === "quick_revision") : sections;
  // A source grounded in our own bank (no real web URL) has nothing to link to —
  // only show/link sources with an actual http(s) URL in the further-reading footer.
  const linkableSources = sources.filter((src) => /^https?:\/\//.test(src.url));

  return (
    <article className="min-w-0 flex-1">
      {/* mobile section chips */}
      <div className="mb-4 flex gap-2 overflow-x-auto scrollbar-hide pb-1 lg:hidden">
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
              {s.key === "overview" && renderSectionAdd?.("overview")}
              {s.key === "up_angle" && renderSectionAdd?.("up_angle")}
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
                {practiceLink && (
                  <Link
                    to={practiceLink}
                    className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
                  >
                    <TrendingUp className="size-4" /> {t("Notes.practiceThesePyqs")}
                  </Link>
                )}
              </div>
            )}

            {s.key === "key_facts" && (
              <ul className="flex flex-col gap-2">
                {body.key_facts.map((f, i) => {
                  const matched = f.source_ref ? sources.find((src) => src.id === f.source_ref) : null;
                  const source = matched && /^https?:\/\//.test(matched.url) ? matched : null;
                  return (
                    <li key={i} className="flex items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5">
                      <span className={cn("min-w-0 flex-1 text-[15px]", locale === "hi" ? "leading-[1.9]" : "leading-relaxed")}>
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
                      {renderFactAdd?.(i, f.fact)}
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
                    className={cn("flex gap-2 text-[15px] text-foreground/90", locale === "hi" ? "leading-[1.9]" : "leading-relaxed")}
                  >
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {!quick && (body.further_reading.length > 0 || linkableSources.length > 0) && (
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
              {linkableSources.map((src, i) => (
                <li key={`${src.id}-${i}`}>
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
  );
}

/**
 * Section-list TOC used by both readers' sticky aside. A PURE function (takes
 * `t`), not a hook — the callers compute it after their loading/error early
 * returns, where calling a hook would violate the rules of hooks.
 */
export function noteVisibleSections(t: TFunction, body: NoteBody, quick: boolean): Section[] {
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
  return quick ? sections.filter((s) => s.key === "key_facts" || s.key === "quick_revision") : sections;
}
