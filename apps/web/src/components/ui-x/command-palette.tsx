import { useEffect, useMemo, useState } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "cmdk";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import { SEARCH_MIN_QUERY_LENGTH, type SearchResultType } from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";
import { useSearch } from "@/hooks/use-search";
import { useAdminStatus } from "@/hooks/use-review";
import { visibleNav } from "@/lib/nav";
import { useCommandPaletteStore } from "@/stores/command-palette-store";

const GROUP_HEADING_CLASS =
  "px-2 py-1.5 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";
const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground";
const RESULT_ITEM_CLASS =
  "flex cursor-pointer flex-col items-start gap-0.5 rounded-lg px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground";

/** i18n key per result type — the group heading the palette renders. */
const TYPE_HEADING: Record<SearchResultType, string> = {
  syllabus: "CommandPalette.groupSyllabus",
  question: "CommandPalette.groupQuestion",
};

export function CommandPalette() {
  const { open, setOpen } = useCommandPaletteStore();
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { data: admin } = useAdminStatus();
  const navItems = visibleNav(admin?.admin_mode ?? false);

  const [input, setInput] = useState("");
  const { data, query, enabled, isTyping, isFetching, isError } = useSearch(input);

  // Nav items are a fixed ~10-row list that lives entirely on the client, so
  // they are matched here rather than round-tripped. Matched on BOTH the stable
  // id and the translated label, so "practice" finds the Hindi label too.
  const navResults = useMemo(() => {
    const q = input.trim().toLocaleLowerCase();
    if (!q) return navItems;
    return navItems.filter(
      (item) => item.id.toLocaleLowerCase().includes(q) || t(item.labelKey).toLocaleLowerCase().includes(q),
    );
  }, [navItems, input, t]);

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

  // Reset on close so reopening never shows the previous session's query with a
  // stale result list under it.
  useEffect(() => {
    if (!open) setInput("");
  }, [open]);

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  const groups = data?.groups ?? [];
  const hasAnything = navResults.length > 0 || groups.length > 0;
  // Distinguish the three ways this list can be short, rather than showing one
  // "no results" for all of them: still typing, below the minimum length, or a
  // genuinely empty search. `isTyping` also covers the debounce gap, so the
  // empty state never flashes between keystrokes.
  const showTooShort = input.trim().length > 0 && !enabled;
  const busy = enabled && (isFetching || isTyping);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      label={t("CommandPalette.label")}
      /**
       * ⚑ cmdk's built-in filtering MUST stay off. Results are matched
       * server-side against BOTH locales, but each row renders ONE locale's
       * title — so cmdk re-filtering them against the raw input would drop
       * every legitimate cross-locale hit (type "inflation" in the Hindi UI and
       * every Devanagari-titled match disappears). Nav items are filtered
       * explicitly above instead.
       */
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-50 bg-black/50"
      contentClassName="fixed left-1/2 top-24 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
    >
      <div className="relative">
        <CommandInput
          value={input}
          onValueChange={setInput}
          placeholder={t("CommandPalette.placeholder")}
          className="w-full border-b border-border bg-transparent px-4 py-3 pe-10 text-sm outline-none placeholder:text-muted-foreground"
        />
        {busy && (
          <Loader2
            className="absolute end-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden
          />
        )}
      </div>
      <CommandList className="max-h-80 overflow-y-auto p-2">
        {/* Only ever the genuinely-empty case — the other two are handled below
            so "keep typing" is never rendered as "nothing found". */}
        {!hasAnything && !showTooShort && !busy && (
          <CommandEmpty className="px-3 py-6 text-center text-sm text-muted-foreground">
            {isError ? t("CommandPalette.error") : t("CommandPalette.empty")}
          </CommandEmpty>
        )}

        {showTooShort && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("CommandPalette.tooShort", { count: SEARCH_MIN_QUERY_LENGTH })}
          </p>
        )}

        {/* A partial failure must SAY it is partial: otherwise a missing group
            reads as "this exam has no chapters on that", which is a different
            and wrong answer. */}
        {data?.degraded && (
          <p
            role="status"
            className="mx-2 mb-2 flex items-start gap-2 rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral-foreground"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t("CommandPalette.degraded")}
          </p>
        )}

        {navResults.length > 0 && (
          <CommandGroup heading={t("CommandPalette.navigate")} className={GROUP_HEADING_CLASS}>
            {navResults.map((item) => (
              <CommandItem
                key={item.id}
                value={`nav:${item.id}`}
                onSelect={() => go(`/${locale}/${item.to}`)}
                className={ITEM_CLASS}
              >
                <item.icon className="size-4" aria-hidden />
                {t(item.labelKey)}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {groups.map((group) => (
          <CommandGroup
            key={group.type}
            heading={t(TYPE_HEADING[group.type]) + (group.has_more ? ` ${t("CommandPalette.andMore")}` : "")}
            className={GROUP_HEADING_CLASS}
          >
            {group.results.map((result) => (
              <CommandItem
                // Type-prefixed: two content types can legitimately share an id
                // (a chapter and its own syllabus node), and cmdk keys on value.
                key={`${group.type}:${result.id}`}
                value={`${group.type}:${result.id}`}
                onSelect={() => go(`/${locale}/${result.to}`)}
                className={RESULT_ITEM_CLASS}
              >
                <span className="flex w-full min-w-0 flex-col">
                  <span className="truncate">{result.title}</span>
                  {result.subtitle && (
                    <span className="truncate text-xs text-muted-foreground">{result.subtitle}</span>
                  )}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      {/* Screen-reader-only running commentary. The visible spinner and the list
          itself are silent to assistive tech, so without this a search that
          returns results announces nothing at all. */}
      <span aria-live="polite" className="sr-only">
        {busy ? t("CommandPalette.searching") : query ? t("CommandPalette.resultCount", { count: data?.total ?? 0 }) : ""}
      </span>
    </CommandDialog>
  );
}
