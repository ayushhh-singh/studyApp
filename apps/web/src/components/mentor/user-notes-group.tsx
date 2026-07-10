import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronRight, StickyNote } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { useUserNotes } from "@/hooks/use-user-notes";

/**
 * "My notes" — the user's personal notes saved for a syllabus node, shown as a
 * compact group above the official note in the Learn reader. Renders nothing
 * when the user has none for this node.
 */
export function UserNotesGroup({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data } = useUserNotes(nodeId);
  const notes = data?.items ?? [];
  if (notes.length === 0) return null;

  return (
    <section className="mb-5 rounded-xl border border-tulsi/25 bg-tulsi/[0.05] p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-tulsi-foreground">
        <StickyNote className="size-4" aria-hidden /> {t("MyNotes.groupTitle")}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {notes.map((n) => (
          <li key={n.id}>
            <Link
              to={`/${locale}/my-notes/${n.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-primary/40"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{n.title}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
