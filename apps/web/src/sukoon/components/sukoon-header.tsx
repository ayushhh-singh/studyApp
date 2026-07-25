import { Link, useParams } from "react-router";
import { ArrowLeft, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { DEFAULT_LOCALE } from "@/lib/locale";

// Build-time only — never re-evaluated at runtime, so this safely tree-shakes
// away in a standalone build (VITE_APP=sukoon mounts Sukoon at "/" with no
// Neev routes to link back to at all).
const IS_STANDALONE = import.meta.env.VITE_APP === "sukoon";

export function SukoonHeader() {
  const { t, language, setLanguage } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border bg-card/60 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2">
        {!IS_STANDALONE && (
          <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground">
            {/* Neev's homepage (the marketing landing page), not the
                authenticated dashboard — this is a "leave Sukoon" exit, and
                the homepage is reachable whether or not the visitor is
                signed in (it renders its own signed-in-aware CTA). */}
            <Link to={`/${locale ?? DEFAULT_LOCALE}`}>
              <ArrowLeft className="size-4" aria-hidden />
              {t("Sukoon.backToNeev")}
            </Link>
          </Button>
        )}
        <span className="text-lg font-bold tracking-tight text-foreground" lang={language}>
          {t("Sukoon.brand")}
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setLanguage(language === "hi" ? "en" : "hi")}
        aria-label={t("Sukoon.languageToggle")}
      >
        <Languages className="size-3.5" aria-hidden />
        {language === "hi" ? "English" : "हिंदी"}
      </Button>
    </header>
  );
}
