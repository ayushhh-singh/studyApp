import { useEffect, useMemo } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "cmdk";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { SyllabusNode } from "@prayasup/shared";
import { useLocale } from "@/hooks/use-locale";
import { useSyllabusTree } from "@/hooks/use-syllabus-tree";
import { useAdminStatus } from "@/hooks/use-review";
import { visibleNav } from "@/lib/nav";
import { useCommandPaletteStore } from "@/stores/command-palette-store";

const GROUP_HEADING_CLASS =
  "px-2 py-1.5 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";
const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground";
const RESULT_ITEM_CLASS =
  "flex cursor-pointer flex-col items-start gap-0.5 rounded-lg px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground";

// Flattened once per fetch; capped below to keep the modal list DOM-light.
function flattenSyllabus(nodes: SyllabusNode[]): SyllabusNode[] {
  return nodes.flatMap((node) => [node, ...flattenSyllabus(node.children)]);
}

export function CommandPalette() {
  const { open, setOpen } = useCommandPaletteStore();
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { data: syllabus } = useSyllabusTree();
  const { data: admin } = useAdminStatus();
  const navItems = visibleNav(admin?.admin_mode ?? false);

  const syllabusResults = useMemo(
    // depth 0 rows are paper roots, not real topics — surfaced via the Learn
    // grid instead, so exclude them from the flattened search results.
    () => (syllabus ? flattenSyllabus(syllabus).filter((node) => node.depth > 0).slice(0, 60) : []),
    [syllabus],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      label={t("CommandPalette.label")}
      overlayClassName="fixed inset-0 z-50 bg-black/50"
      contentClassName="fixed left-1/2 top-24 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
    >
      <CommandInput
        placeholder={t("CommandPalette.placeholder")}
        className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <CommandList className="max-h-80 overflow-y-auto p-2">
        <CommandEmpty className="px-3 py-6 text-center text-sm text-muted-foreground">
          {t("CommandPalette.empty")}
        </CommandEmpty>
        <CommandGroup heading={t("CommandPalette.navigate")} className={GROUP_HEADING_CLASS}>
          {navItems.map((item) => (
            <CommandItem
              key={item.id}
              value={`${item.id} ${t(item.labelKey)}`}
              onSelect={() => go(`/${locale}/${item.to}`)}
              className={ITEM_CLASS}
            >
              <item.icon className="size-4" aria-hidden />
              {t(item.labelKey)}
            </CommandItem>
          ))}
        </CommandGroup>
        {syllabusResults.length > 0 && (
          <CommandGroup heading={t("CommandPalette.syllabus")} className={GROUP_HEADING_CLASS}>
            {syllabusResults.map((node) => (
              <CommandItem
                key={node.id}
                value={`${node.title_i18n.en} ${node.title_i18n.hi}`}
                onSelect={() => go(`/${locale}/learn/${node.paper_code}/${node.id}`)}
                className={RESULT_ITEM_CLASS}
              >
                <span className="flex flex-col">
                  <span>{node.title_i18n[locale]}</span>
                  <span className="text-xs text-muted-foreground">{node.paper_code}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
