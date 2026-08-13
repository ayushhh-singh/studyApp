import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { ChevronDown, ExternalLink, FileDown, Landmark, Library } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Chip } from "@/components/ui-x/chip";
import { NeevLibraryCard } from "@/components/resources/neev-library-card";
import { useCurrentExam } from "@/hooks/use-current-exam";
import { useLocale } from "@/hooks/use-locale";
import { useAuth } from "@/providers/auth-provider";
import { stateFocusName } from "@/lib/exam-label";
import { cn } from "@/lib/utils";
import {
  NCERT_BOOKS,
  RESOURCE_SUBJECTS,
  activeSubjects,
  formatBytes,
  ncertBookUrl,
  ncertChapterUrl,
  officialResourcesFor,
  type NcertBook,
  type OfficialResource,
  type ResourceSubject,
} from "@/lib/resources";

/**
 * The body of the resources page, shared by its TWO shells.
 *
 * WHY TWO SHELLS. This is a browse/reference surface, and in this app every
 * browse surface lives INSIDE app-shell — learn, practice, pyq-archive, the
 * magazine index, current affairs. The only routes deliberately outside it are
 * tasks (test player, answer session, time attack, ghost) and print documents
 * (magazine editions, the PYQ paper print). So:
 *
 *   /:locale/resources        public, marketing chrome — the SEO surface and
 *                             what a signed-out visitor sees.
 *   /:locale/learn/resources  inside app-shell, full app chrome — what a
 *                             signed-in user gets, reached from Learn.
 *
 * Sending a signed-in user to the public one instead would strip the sidebar
 * and, at 390px, the bottom tab bar — replacing their app nav with a marketing
 * nav row mid-study. That is the whole reason this component exists separately
 * from either route.
 *
 * One subject filter drives all tiers at once, so picking "Polity" turns the
 * page into "everything free for Polity" rather than filtering one card in
 * isolation. The chips come from {@link activeSubjects}, i.e. only subjects
 * that actually have rows for THIS exam, so a chip can never select an empty
 * page.
 */

/** Search param owned by this page's subject filter. */
const SUBJECT_PARAM = "subject";

export function ResourcesContent() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { session } = useAuth();
  const { examCode, exam } = useCurrentExam();
  const [params, setParams] = useSearchParams();

  // A state-scoped exam's own state name ("Uttar Pradesh"), used by the
  // `state_focus` subject label and the per-row badge. Empty for a nationally
  // scoped exam — consistent, because that exam has no state_focus rows for the
  // label to appear on in the first place.
  const state = stateFocusName(exam, locale, examCode) ?? "";

  // No session means no known exam — see officialResourcesFor. Passing the
  // default exam here is what leaked UP-specific rows to every visitor.
  const scopedExam = session ? examCode : null;
  const subjects = useMemo(() => activeSubjects(scopedExam), [scopedExam]);

  // An unknown/stale ?subject= (a link shared from another exam, a typo) falls
  // back to "all" rather than rendering an empty page — same convention as
  // /learn's own filters.
  const raw = params.get(SUBJECT_PARAM);
  const active: ResourceSubject | "all" =
    raw && (subjects as string[]).includes(raw) ? (raw as ResourceSubject) : "all";

  const setSubject = (next: ResourceSubject | "all") => {
    const nextParams = new URLSearchParams(params);
    if (next === "all") nextParams.delete(SUBJECT_PARAM);
    else nextParams.set(SUBJECT_PARAM, next);
    setParams(nextParams, { replace: true });
  };

  const matches = (s: ResourceSubject) => active === "all" || s === active;

  const ncert = NCERT_BOOKS.filter((b) => matches(b.subject));
  const official = officialResourcesFor(scopedExam).filter((r) => matches(r.subject));

  return (
    <>
      <NeevLibraryCard />

      {subjects.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted-foreground">{t("Resources.filterLabel")}</span>
          <div className="flex flex-wrap gap-2">
            <Chip active={active === "all"} onClick={() => setSubject("all")}>
              {t("Common.allPapers")}
            </Chip>
            {subjects.map((s) => (
              <Chip key={s} active={active === s} onClick={() => setSubject(s)}>
                {t(`Resources.subject_${s}`, { state })}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <NcertSection books={ncert} state={state} />
      <OfficialSection resources={official} state={state} />
    </>
  );
}

/** An external link that names, in the link itself, what it opens. */
function ExternalAction({
  href,
  children,
  icon: Icon = ExternalLink,
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  icon?: typeof ExternalLink;
  /** Spells out what the compact visible label means, for screen readers. */
  ariaLabel?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={ariaLabel}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-primary transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {children}
    </a>
  );
}

/** Groups rows by subject in RESOURCE_SUBJECTS order, dropping empty buckets. */
function groupBySubject<T extends { subject: ResourceSubject }>(
  rows: T[],
  sort?: (a: T, b: T) => number,
): [ResourceSubject, T[]][] {
  const out: [ResourceSubject, T[]][] = [];
  for (const s of RESOURCE_SUBJECTS) {
    const bucket = rows.filter((r) => r.subject === s);
    if (bucket.length) out.push([s, sort ? [...bucket].sort(sort) : bucket]);
  }
  return out;
}

function NcertSection({ books, state }: { books: NcertBook[]; state: string }) {
  const { t } = useTranslation();

  // Within a subject, class ascending — a reader works up through the classes
  // in one subject, never across subjects at one class.
  const grouped = useMemo(() => groupBySubject(books, (a, b) => a.klass - b.klass), [books]);

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <FileDown className="size-4 text-tulsi-foreground" aria-hidden />
          {t("Resources.ncertTitle")}
        </span>
      }
      description={t("Resources.ncertDescription")}
    >
      <p className="rounded-lg border border-tulsi/25 bg-tulsi/10 px-3 py-2 text-xs text-foreground">
        {t("Resources.ncertNotice")}
      </p>
      {grouped.length === 0 ? (
        // NCERT's list is exam-independent, so the only way it empties is the
        // subject filter.
        <EmptyState
          icon={Library}
          title={t("Resources.noneForFilterTitle")}
          description={t("Resources.noneForFilterBody")}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map(([subject, rows]) => (
            <div key={subject} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {t(`Resources.subject_${subject}`, { state })}
              </h3>
              <ul className="flex flex-col gap-2">
                {rows.map((book) => (
                  <NcertRow key={book.id} book={book} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/**
 * One NCERT book: the complete book per language, plus an expandable list of
 * direct chapter PDFs.
 *
 * Both are offered because they fail in opposite directions. The zip is a
 * single file but needs an unzip app; a chapter PDF opens natively in one tap
 * but is many files. On the biggest books the zip is not a realistic download
 * at all — 15 of 81 editions are over 50MB, the largest 201MB — and there the
 * chapter list is the only usable route on mobile data.
 *
 * Sizes ride on the complete-book buttons for the same reason.
 *
 * Chapters are collapsed by default: 44 books would otherwise render ~1,400
 * links on first paint.
 */
function NcertRow({ book }: { book: NcertBook }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const editions = [
    {
      lang: "en" as const,
      label: t("Resources.openEnglish"),
      code: book.code,
      bytes: book.bytes,
      chapters: book.chapters,
    },
    ...(book.codeHi && book.bytesHi && book.chaptersHi
      ? [
          {
            lang: "hi" as const,
            label: t("Resources.openHindi"),
            code: book.codeHi,
            bytes: book.bytesHi,
            chapters: book.chaptersHi,
          },
        ]
      : []),
  ];

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("Resources.ncertClass", { klass: book.klass })}
          </span>
          <span className="text-sm font-medium">{book.title}</span>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {editions.map((e) => (
            <ExternalAction
              key={e.lang}
              href={ncertBookUrl(e.code)}
              icon={FileDown}
              ariaLabel={t("Resources.bookAria", {
                lang: e.label,
                title: book.title,
                size: formatBytes(e.bytes),
              })}
            >
              {e.label}
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {formatBytes(e.bytes)}
              </span>
            </ExternalAction>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        {t("Resources.chapterToggle", { count: book.chapters })}
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          {editions.map((e) => (
            <div key={e.lang} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{e.label}</span>
              {Array.from({ length: e.chapters }, (_, i) => i + 1).map((n) => (
                <a
                  key={n}
                  href={ncertChapterUrl(e.code, n)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border px-2 text-xs font-medium tabular-nums text-primary transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("Resources.chapterAria", { n, title: book.title, lang: e.label })}
                >
                  {n}
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function OfficialSection({ resources, state }: { resources: OfficialResource[]; state: string }) {
  const { t } = useTranslation();
  const grouped = useMemo(() => groupBySubject(resources), [resources]);

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Landmark className="size-4 text-primary" aria-hidden />
          {t("Resources.officialTitle")}
        </span>
      }
      description={t("Resources.officialDescription")}
    >
      {grouped.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title={t("Resources.noneForFilterTitle")}
          description={t("Resources.noneForFilterBody")}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map(([subject, rows]) => (
            <div key={subject} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {t(`Resources.subject_${subject}`, { state })}
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    // min-w-0 for the same reason as the chapter grid — a grid
                    // item defaults to min-width:auto and a long publisher name
                    // would otherwise widen the track past the viewport.
                    className="flex min-w-0 flex-col justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{r.title}</span>
                        {r.stateSpecific && (
                          <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                            {t("Resources.stateSpecific", { state })}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{r.publisher}</span>
                    </div>
                    <div>
                      <ExternalAction href={r.url}>{t("Resources.openOfficial")}</ExternalAction>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
