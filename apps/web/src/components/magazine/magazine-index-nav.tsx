import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { List, ListTree } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { cn } from "@/lib/utils";

export interface MagazineIndexEntry {
  /** Target section's DOM id (without the leading #). */
  id: string;
  label: string;
}

/**
 * Persistent magazine index — a sticky left rail on wide screens and a floating
 * "jump to" button + bottom sheet on smaller ones, replacing the old top-of-page
 * TOC that forced a scroll back to the top to change sections. Scroll-spy keeps
 * the current section highlighted. `mag-noprint` throughout — the print edition
 * has no navigation chrome.
 */
export function MagazineIndexNav({ entries }: { entries: MagazineIndexEntry[] }) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.id ?? null);
  const [open, setOpen] = useState(false);

  const idKey = entries.map((e) => e.id).join("|");
  useEffect(() => {
    const els = entries.map((e) => document.getElementById(e.id)).filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (ents) => {
        for (const en of ents) if (en.isIntersecting) setActiveId(en.target.id);
      },
      { rootMargin: "-15% 0px -80% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
    setOpen(false);
  }

  function Links({ onNavigate }: { onNavigate?: (id: string) => void }) {
    return (
      <ul className="flex flex-col gap-0.5 border-s border-border">
        {entries.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              aria-current={activeId === e.id ? "true" : undefined}
              onClick={onNavigate ? (ev) => (ev.preventDefault(), onNavigate(e.id)) : undefined}
              className={cn(
                "-ms-px block border-s-2 py-1 ps-3 text-sm transition-colors hover:text-foreground",
                activeId === e.id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-primary/50",
              )}
            >
              {e.label}
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      {/* Wide screens: sticky left rail */}
      <aside className="mag-noprint hidden xl:sticky xl:top-20 xl:block xl:h-fit xl:w-52 xl:shrink-0">
        <nav aria-label={t("Magazine.indexToc")}>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ListTree className="size-3.5" aria-hidden /> {t("Magazine.indexToc")}
          </p>
          <Links />
        </nav>
      </aside>

      {/* Smaller screens: floating button opening a bottom sheet */}
      <div className="mag-noprint fixed bottom-5 end-5 z-30 xl:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold shadow-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <List className="size-4" aria-hidden /> {t("Magazine.jumpTo")}
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" title={t("Magazine.indexToc")}>
            <Links onNavigate={jump} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
