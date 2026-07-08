import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Search, SquarePen, Trash2 } from "lucide-react";
import type { SrsCardListItem, SrsSourceType } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useCreateSrsCard, useDeleteSrsCard, useSrsCards, useUpdateSrsCard } from "@/hooks/use-srs";
import { useLocale } from "@/hooks/use-locale";
import { CardForm } from "./card-form";

const INPUT_CLASS =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

const SOURCE_FILTERS: { value: SrsSourceType | "all"; labelKey: string }[] = [
  { value: "all", labelKey: "Revision.filterAll" },
  { value: "question", labelKey: "Revision.filterQuestion" },
  { value: "current_affairs", labelKey: "Revision.filterCurrentAffairs" },
  { value: "manual", labelKey: "Revision.filterManual" },
];

function CardRow({ card }: { card: SrsCardListItem }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateSrsCard();
  const del = useDeleteSrsCard();

  if (editing) {
    return (
      <CardForm
        initial={card}
        isSaving={update.isPending}
        onCancel={() => setEditing(false)}
        onSave={(body) => update.mutate({ id: card.id, ...body }, { onSuccess: () => setEditing(false) })}
      />
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium text-card-foreground">
          {card.front_i18n[locale] || card.front_i18n.en || card.front_i18n.hi}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {card.back_i18n[locale] || card.back_i18n.en || card.back_i18n.hi}
        </p>
        <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {t(`Revision.filter${card.source_type === "current_affairs" ? "CurrentAffairs" : card.source_type === "question" ? "Question" : "Manual"}`)}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={t("Revision.edit")} onClick={() => setEditing(true)}>
          <SquarePen className="size-4" aria-hidden />
        </Button>
        {confirmDelete ? (
          <Button
            variant="destructive"
            size="icon-sm"
            aria-label={t("Revision.deleteConfirm")}
            disabled={del.isPending}
            onClick={() => del.mutate(card.id)}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Revision.delete")}
            onClick={() => setConfirmDelete(true)}
            onBlur={() => setConfirmDelete(false)}
          >
            <Trash2 className="size-4 text-coral" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

export function ManageCardList() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceType, setSourceType] = useState<SrsSourceType | "all">("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const createCard = useCreateSrsCard();

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, sourceType]);

  const { data, isLoading } = useSrsCards({
    query: debouncedSearch || undefined,
    sourceType: sourceType === "all" ? undefined : sourceType,
    page,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            className={`${INPUT_CLASS} pl-9`}
            placeholder={t("Revision.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={`${INPUT_CLASS} sm:w-44`}
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value as SrsSourceType | "all")}
        >
          {SOURCE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {t(f.labelKey)}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => setCreating((v) => !v)}>
          <Plus className="size-4" aria-hidden />
          {t("Revision.newCard")}
        </Button>
      </div>

      {creating && (
        <CardForm
          isSaving={createCard.isPending}
          onCancel={() => setCreating(false)}
          onSave={(body) => createCard.mutate(body, { onSuccess: () => setCreating(false) })}
        />
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <ListRowSkeleton key={i} />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t("Revision.noCardsFound")} />
      ) : (
        <div className="flex flex-col gap-2">
          {data.items.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </div>
      )}

      {data && data.pagination.total_pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t("Revision.prevPage")}
          </Button>
          <span className="text-muted-foreground">
            {t("Revision.pageOf", { page: data.pagination.page, total: data.pagination.total_pages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.pagination.total_pages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("Revision.nextPage")}
          </Button>
        </div>
      )}
    </div>
  );
}
