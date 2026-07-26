import { useTranslation } from "react-i18next";
import { Link, useNavigate, useLocation } from "react-router";
import { ArrowLeft, Languages, Printer } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { switchLocale } from "@/lib/locale";
import { useEntitlements } from "@/hooks/use-billing";
import { useMagazineExport } from "@/hooks/use-magazine";
import { usePaywallStore, toPaywallFeature } from "@/stores/paywall-store";
import { ApiError } from "@/lib/api";

/**
 * Shared sticky toolbar for the print-styled magazine edition routes (Prelims
 * Compendium / Mains Analysis): back link, language toggle, and a Pro-gated
 * print/PDF button. Web reading stays free; print-to-PDF is gated SERVER-SIDE:
 * the button always calls the /magazine/:month/:edition/export endpoint
 * (assertMagazinePdf) before printing, so a tampered-client isPro can't bypass
 * it. A 402 opens the upgrade paywall. The `isPro` flag is only a cosmetic hint
 * (tooltip); it never decides whether the export happens. Hidden in print
 * (`.mag-noprint`).
 */
export function MagazineToolbar({
  backTo,
  canPrint,
  month,
  edition,
}: {
  backTo: string;
  canPrint: boolean;
  month: string;
  edition: "prelims" | "mains";
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: entitlements } = useEntitlements();
  const openPaywall = usePaywallStore((s) => s.openPaywall);
  const exportEdition = useMagazineExport();

  const isPro = entitlements?.features.magazine_pdf ?? false;

  function toggleLang() {
    navigate(switchLocale(location.pathname, location.search, locale === "hi" ? "en" : "hi", location.hash), {
      replace: true,
    });
  }

  function handlePrint() {
    if (exportEdition.isPending) return;
    // The server is the authoritative gate: authorize the export, then print.
    exportEdition.mutate(
      { month, edition },
      {
        onSuccess: () => window.print(),
        onError: (err) => {
          if (err instanceof ApiError && err.status === 402) {
            openPaywall(toPaywallFeature(err.feature));
            return;
          }
          // Transient/non-paywall error (network blip): a real Free user always
          // gets a deterministic 402 above, so failing open here doesn't open a
          // bypass — it just avoids punishing a Pro user for a hiccup.
          window.print();
        },
      },
    );
  }

  return (
    <header className="mag-noprint sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {t("Magazine.back")}
      </Link>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleLang}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Languages className="size-4" /> {locale === "hi" ? "EN" : "हिं"}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          disabled={!canPrint || exportEdition.isPending}
          title={!isPro ? t("Magazine.printProOnly") : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <Printer className="size-4" /> {t("Magazine.print")}
        </button>
      </div>
    </header>
  );
}
