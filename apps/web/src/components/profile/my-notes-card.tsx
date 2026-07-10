import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronRight, StickyNote } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { useLocale } from "@/hooks/use-locale";
import { useUserNotes } from "@/hooks/use-user-notes";

/**
 * "My notes" — all personal notes the user saved from mentor answers. Links to
 * each in the reader; renders a compact empty state (with a pointer to the
 * mentor) when there are none.
 */
export function MyNotesCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isLoading } = useUserNotes();
  const notes = data?.items ?? [];

  return (
    <SectionCard title={t("MyNotes.title")} description={t("MyNotes.profileDescription")}>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : notes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {t("MyNotes.emptyProfile")}{" "}
          <Link to={`/${locale}/doubts`} className="font-medium text-primary hover:underline">
            {t("Nav.doubts")}
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {notes.map((n) => (
            <li key={n.id}>
              <Link
                to={`/${locale}/my-notes/${n.id}`}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-primary/40"
              >
                <StickyNote className="size-4 shrink-0 text-tulsi" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  {n.syllabus_title_i18n && (
                    <span className="block truncate text-xs text-muted-foreground">{n.syllabus_title_i18n[locale]}</span>
                  )}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
