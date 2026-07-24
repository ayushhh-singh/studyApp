/**
 * F4 journal export — pick a date range, then a print-styled preview the user
 * saves as a PDF via the browser print dialog (the existing Neev print-to-PDF
 * approach, as used by the magazine editions). The range is fetched decrypted
 * from the API (the user exporting their own journal); on print, an @media-print
 * block hides the whole app and shows only the print root.
 */
import { useState } from "react";
import { Printer, X } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui-x/markdown";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { fetchExportRange } from "@/sukoon/lib/use-sukoon-journal";
import { MOOD_EMOJI, useEntryDate, useMoodLabel, usePromptText } from "./journal-ui";
import type { SukoonJournalEntry } from "@neev/shared";

function firstOfMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function JournalExport({
  trigger,
  locale,
}: {
  trigger: React.ReactNode;
  locale?: string;
}) {
  const { t } = useSukoonLanguage();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SukoonJournalEntry[] | null>(null);

  const generate = async () => {
    setError(null);
    if (from > to) {
      setError(t("Sukoon.journal.exportRangeError"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetchExportRange(from, to);
      if (res.entries.length === 0) {
        setError(t("Sukoon.journal.exportEmpty"));
        return;
      }
      setPreview(res.entries);
      setOpen(false);
    } catch {
      setError(t("Sukoon.journal.exportRangeError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" title={t("Sukoon.journal.exportTitle")}>
          <p className="mb-4 text-sm text-muted-foreground">{t("Sukoon.journal.exportSub")}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {t("Sukoon.journal.filterFrom")}
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {t("Sukoon.journal.filterTo")}
              <input
                type="date"
                value={to}
                max={today()}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          <Button className="mt-4 w-full" disabled={loading} onClick={generate}>
            {t("Sukoon.journal.exportGenerate")}
          </Button>
        </SheetContent>
      </Sheet>

      {preview ? (
        <PrintPreview
          entries={preview}
          from={from}
          to={to}
          locale={locale}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}

function PrintPreview({
  entries,
  from,
  to,
  locale,
  onClose,
}: {
  entries: SukoonJournalEntry[];
  from: string;
  to: string;
  locale?: string;
  onClose: () => void;
}) {
  const { t, language } = useSukoonLanguage();
  const entryDate = useEntryDate();
  const promptText = usePromptText();
  const moodLabel = useMoodLabel();
  const rangeLabel = `${entryDate(`${from}T00:00:00Z`)} – ${entryDate(`${to}T00:00:00Z`)}`;

  return (
    <div
      className="sukoon-print-root fixed inset-0 z-[60] overflow-auto bg-white text-neutral-900"
      lang={language}
    >
      <style>{`
        @media print {
          body { visibility: hidden !important; }
          .sukoon-print-root, .sukoon-print-root * { visibility: visible !important; }
          .sukoon-print-root { position: absolute !important; inset: 0 !important; overflow: visible !important; }
          .sukoon-print-hide { display: none !important; }
        }
      `}</style>
      <div className="sukoon-print-hide sticky top-0 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="size-4" />
          {t("Sukoon.journal.cancel")}
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="size-4" />
          {t("Sukoon.journal.exportPrint")}
        </Button>
      </div>

      <div className="mx-auto max-w-2xl px-6 py-8" lang={locale === "hi" ? "hi" : language}>
        <header className="mb-6 border-b border-neutral-300 pb-4">
          <h1 className="text-2xl font-bold">{t("Sukoon.journal.exportHeading")}</h1>
          <p className="mt-1 text-sm text-neutral-500">{rangeLabel}</p>
        </header>
        <div className="space-y-6">
          {entries.map((entry) => (
            <article key={entry.id} className="break-inside-avoid border-b border-neutral-200 pb-5">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <span>{entryDate(entry.created_at)}</span>
                {entry.mood != null ? (
                  <span className="text-neutral-500">
                    {MOOD_EMOJI[entry.mood]} {moodLabel(entry.mood)}
                  </span>
                ) : null}
              </div>
              {entry.prompt ? (
                <p className="mb-2 text-sm italic text-neutral-500">{promptText(entry.prompt)}</p>
              ) : null}
              {entry.body ? (
                <Markdown content={entry.body} className="text-[15px] leading-[1.8]" />
              ) : (
                <p className="text-sm italic text-neutral-400">{t("Sukoon.journal.emptyBody")}</p>
              )}
              {entry.tags.length > 0 ? (
                <p className="mt-2 text-xs text-neutral-500">
                  {entry.tags.map((x) => `#${x}`).join("  ")}
                </p>
              ) : null}
              {entry.reflection ? (
                <div className="mt-3 rounded-lg bg-neutral-100 p-3 text-sm leading-relaxed">
                  <p className="mb-1 text-xs font-semibold text-neutral-500">
                    {t("Sukoon.journal.reflectionTitle")}
                  </p>
                  {entry.reflection}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
