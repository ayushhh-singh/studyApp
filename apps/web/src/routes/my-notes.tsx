import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronRight, MapPin, StickyNote, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import { useUserNotes, useDeleteUserNote } from "@/hooks/use-user-notes";

export const handle = { titleKey: "Nav.myNotes" };

/** "My notes" — every personal note saved from the AI Mentor, its own top-level page. */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isLoading } = useUserNotes();
  const remove = useDeleteUserNote();
  const notes = data?.items ?? [];

  const del = (id: string) => {
    if (window.confirm(t("MyNotes.deleteConfirm"))) remove.mutate(id);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={t("MyNotes.title")} description={t("MyNotes.pageDescription")} />

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title={t("MyNotes.emptyTitle")}
          description={t("MyNotes.emptyPageDescription")}
          action={
            <Button asChild>
              <Link to={`/${locale}/doubts`}>{t("MyNotes.askMentor")}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="group flex items-center gap-1 rounded-xl border border-border bg-card pe-2 transition-colors hover:border-primary/40"
            >
              <Link to={`/${locale}/my-notes/${n.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tulsi/15 text-tulsi">
                  <StickyNote className="size-4.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{n.title}</span>
                  {n.syllabus_title_i18n && (
                    <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="size-3 shrink-0" aria-hidden /> {n.syllabus_title_i18n[locale]}
                    </span>
                  )}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => del(n.id)}
                disabled={remove.isPending}
                aria-label={t("MyNotes.delete")}
                title={t("MyNotes.delete")}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-coral/10 hover:text-coral focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
