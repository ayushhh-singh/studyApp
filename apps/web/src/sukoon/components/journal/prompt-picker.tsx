/**
 * F4 guided-prompt picker — a bottom Sheet listing seeded prompts, filterable by
 * category, shown in the UI language (writes in any language). Picking one hands
 * it to the editor.
 */
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useJournalPrompts } from "@/sukoon/lib/use-sukoon-journal";
import { usePromptText } from "./journal-ui";
import type { SukoonJournalPrompt, SukoonPromptCategory } from "@neev/shared";

const CATEGORIES: SukoonPromptCategory[] = [
  "reflection",
  "gratitude",
  "worry_dump",
  "mock_review",
  "result_feelings",
  "comparison",
  "parental",
  "self_compassion",
  "letter_future",
];

export function PromptPicker({
  trigger,
  onPick,
}: {
  trigger: React.ReactNode;
  onPick: (prompt: SukoonJournalPrompt) => void;
}) {
  const { t } = useSukoonLanguage();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const promptText = usePromptText();
  const promptsQuery = useJournalPrompts({ category }, { enabled: open });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" title={t("Sukoon.journal.promptPicker")}>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("Sukoon.journal.promptPickerSub")}
        </p>
        <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
          <CategoryChip active={!category} onClick={() => setCategory(undefined)}>
            {t("Sukoon.journal.allCategories")}
          </CategoryChip>
          {CATEGORIES.map((c) => (
            <CategoryChip key={c} active={category === c} onClick={() => setCategory(c)}>
              {t(`Sukoon.journal.categories.${c}`)}
            </CategoryChip>
          ))}
        </div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pb-2">
          {promptsQuery.isPending ? (
            <PromptSkeleton />
          ) : (
            (promptsQuery.data?.prompts ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onPick(p);
                  setOpen(false);
                }}
                className="w-full rounded-2xl border border-border bg-card p-3 text-left text-sm leading-relaxed transition-colors duration-300 hover:border-secondary/50"
              >
                {promptText(p)}
              </button>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-300",
        active
          ? "border-secondary bg-secondary/15 text-secondary"
          : "border-border bg-card text-muted-foreground hover:border-secondary/40",
      )}
    >
      {children}
    </button>
  );
}

function PromptSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted" />
      ))}
    </div>
  );
}
