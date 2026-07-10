import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { BookMarked, Check, ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import type { SyllabusNode } from "@prayasup/shared";
import { useLocale } from "@/hooks/use-locale";
import { useSyllabusTree } from "@/hooks/use-syllabus-tree";
import { useSaveMentorNote } from "@/hooks/use-user-notes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function flatten(nodes: SyllabusNode[]): SyllabusNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/** "Auto-detect" is the default: the server infers the node from the answer. */
type NodeChoice = { kind: "auto" } | { kind: "node"; id: string; title: string };

/**
 * "Save as study material" on any mentor answer. Expands into an inline panel
 * with an optional topic (syllabus node) picker — defaults to auto-detect (the
 * server infers), or the page's node when opened from a Learn page. On success,
 * links straight to the saved note in the reader.
 */
export function SaveAsMaterial({ messageId, defaultNodeId }: { messageId: string; defaultNodeId?: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const save = useSaveMentorNote();
  const { data: tree } = useSyllabusTree();
  const nodes = useMemo(() => (tree ? flatten(tree).filter((n) => n.depth > 0) : []), [tree]);

  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<NodeChoice>(() => {
    if (defaultNodeId) {
      const found = nodes.find((n) => n.id === defaultNodeId);
      if (found) return { kind: "node", id: found.id, title: found.title_i18n[locale] };
    }
    return { kind: "auto" };
  });

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? nodes.filter((n) => n.title_i18n[locale].toLowerCase().includes(q))
      : nodes;
    return pool.slice(0, 8);
  }, [nodes, query, locale]);

  if (save.isSuccess) {
    return (
      <div className="mt-1 inline-flex flex-wrap items-center gap-2 rounded-lg border border-tulsi/30 bg-tulsi/10 px-3 py-1.5 text-xs">
        <Check className="size-3.5 text-tulsi" aria-hidden />
        <span className="text-tulsi-foreground">{t("Mentor.savedAsMaterial")}</span>
        <Link
          to={`/${locale}/my-notes/${save.data.id}`}
          className="font-semibold text-primary underline underline-offset-2"
        >
          {t("Mentor.viewNote")}
        </Link>
      </div>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="xs" onClick={() => setOpen(true)} className="mt-1">
        <BookMarked className="size-3.5" aria-hidden /> {t("Mentor.saveAsMaterial")}
      </Button>
    );
  }

  const submit = () => {
    save.mutate({
      messageId,
      nodeId: choice.kind === "node" ? choice.id : undefined,
      locale,
    });
  };

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="size-3.5 text-primary" aria-hidden /> {t("Mentor.saveAsMaterialTitle")}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={t("Common.close")}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* Topic (node) picker */}
      <div className="relative">
        <span className="mb-1 block text-xs text-muted-foreground">{t("Mentor.linkedTopic")}</span>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-sm hover:border-primary/40"
        >
          <span className="truncate">
            {choice.kind === "auto" ? t("Mentor.autoDetectTopic") : choice.title}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        {pickerOpen && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Mentor.searchTopic")}
              className="mb-1 w-full rounded border border-border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              type="button"
              onClick={() => {
                setChoice({ kind: "auto" });
                setPickerOpen(false);
              }}
              className={cn(
                "block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                choice.kind === "auto" && "font-semibold text-primary",
              )}
            >
              {t("Mentor.autoDetectTopic")}
            </button>
            {matches.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  setChoice({ kind: "node", id: n.id, title: n.title_i18n[locale] });
                  setPickerOpen(false);
                }}
                className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                {n.title_i18n[locale]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <BookMarked className="size-3.5" aria-hidden />}
          {t("Mentor.saveAsMaterial")}
        </Button>
        {save.isError && <span className="text-xs text-coral">{t("Mentor.saveFailed")}</span>}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("Mentor.saveAsMaterialHint")}</p>
    </div>
  );
}
