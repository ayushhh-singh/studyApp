import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ArrowRight, ExternalLink, FileQuestion, GraduationCap, ListChecks } from "lucide-react";
import type {
  MentorContinueNode,
  MentorPyqRef,
  MentorQuizQuestion,
  MentorWebSource,
} from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";
import { QuizCards } from "./quiz-cards";
import { formatQuestionStem } from "@/lib/format-question-stem";

/**
 * The structured extras rendered below a teacher-mode lesson: real Related PYQs
 * from our bank (tappable to practice), a 2-question inline Quick check, and
 * "Continue with" adjacent syllabus nodes. All come from the platform (not the
 * prose model), so any/all may be empty — each block hides itself when so.
 */
export function TeacherExtras({
  relatedPyqs,
  quickCheck,
  continueWith,
  webSources,
}: {
  relatedPyqs?: MentorPyqRef[];
  quickCheck?: MentorQuizQuestion[];
  continueWith?: MentorContinueNode[];
  webSources?: MentorWebSource[];
}) {
  const { t } = useTranslation();
  const locale = useLocale();

  const hasPyqs = (relatedPyqs?.length ?? 0) > 0;
  const hasCheck = (quickCheck?.length ?? 0) > 0;
  const hasContinue = (continueWith?.length ?? 0) > 0;
  const hasSources = (webSources?.length ?? 0) > 0;
  if (!hasPyqs && !hasCheck && !hasContinue && !hasSources) return null;

  return (
    <div className="mt-3 flex flex-col gap-4 border-t border-border pt-3">
      {hasSources && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("Mentor.sources")}</span>
          {webSources!.map((s) => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              [{s.id}] {s.title} <ExternalLink className="size-3" aria-hidden />
            </a>
          ))}
        </div>
      )}

      {hasPyqs && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <FileQuestion className="size-4 text-primary" aria-hidden /> {t("Mentor.relatedPyqs")}
          </h4>
          <ul className="flex flex-col gap-1.5">
            {relatedPyqs!.map((q) => {
              const to = q.syllabus_node_id
                ? `/${locale}/learn/${q.paper_code}/${q.syllabus_node_id}?tab=pyqs&qid=${q.id}`
                : null;
              const inner = (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {q.year != null && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                        {q.year}
                      </span>
                    )}
                    {q.exam_label_i18n && (
                      <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {q.exam_label_i18n[locale]}
                      </span>
                    )}
                  </div>
                  <span className="line-clamp-2 text-sm text-foreground/90">
                    {formatQuestionStem(q.stem_i18n[locale])}
                  </span>
                </>
              );
              return (
                <li key={q.id}>
                  {to ? (
                    <Link
                      to={to}
                      className="flex flex-col gap-1 rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:border-primary/40"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background px-3 py-2">
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {hasCheck && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <ListChecks className="size-4 text-primary" aria-hidden /> {t("Mentor.quickCheck")}
          </h4>
          <QuizCards questions={quickCheck!} />
        </section>
      )}

      {hasContinue && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <GraduationCap className="size-4 text-primary" aria-hidden /> {t("Mentor.continueWith")}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {continueWith!.map((n) => (
              <Link
                key={n.node_id}
                to={`/${locale}/learn/${n.paper_code}/${n.node_id}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground/90 transition-colors hover:border-primary/40 hover:text-primary"
              >
                {n.title_i18n[locale]} <ArrowRight className="size-3" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
