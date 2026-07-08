import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError, useNavigate, useParams } from "react-router";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale";

const COPY = {
  en: {
    notFoundTitle: "Page not found",
    notFoundBody: "The page you're looking for doesn't exist or may have moved.",
    errorTitle: "Something went wrong",
    errorBody: "An unexpected error occurred. Reloading usually fixes it.",
    reload: "Reload",
    home: "Go to dashboard",
  },
  hi: {
    notFoundTitle: "पेज नहीं मिला",
    notFoundBody: "आप जो पेज ढूंढ रहे हैं वह मौजूद नहीं है या हट गया है।",
    errorTitle: "कुछ गड़बड़ हो गई",
    errorBody: "एक अनपेक्षित त्रुटि हुई। पेज रीलोड करने से आमतौर पर यह ठीक हो जाता है।",
    reload: "रीलोड करें",
    home: "डैशबोर्ड पर जाएं",
  },
} as const;

/** Wired as every route group's ErrorBoundary in router.tsx — catches loader errors and render errors alike, bubbling up from wherever they occurred to the nearest boundary. */
export function Component() {
  const error = useRouteError();
  const navigate = useNavigate();
  const params = useParams();
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = COPY[locale];
  const is404 = isRouteErrorResponse(error) && error.status === 404;

  useEffect(() => {
    if (!is404) {
      console.error("Route error boundary caught:", error);
      void import("@/lib/sentry-capture")
        .then((m) => m.captureException(error))
        .catch(() => {}); // e.g. a stale chunk hash after a deploy — never let error reporting itself throw an unhandled rejection
    }
  }, [error, is404]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-coral/10 text-coral">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold tracking-tight">{is404 ? t.notFoundTitle : t.errorTitle}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{is404 ? t.notFoundBody : t.errorBody}</p>
      </div>
      <div className="flex gap-2">
        {!is404 && (
          <Button type="button" variant="outline" onClick={() => window.location.reload()} className="gap-2">
            <RefreshCw className="size-4" aria-hidden />
            {t.reload}
          </Button>
        )}
        <Button type="button" onClick={() => navigate(`/${locale}/dashboard`)} className="gap-2">
          <Home className="size-4" aria-hidden />
          {t.home}
        </Button>
      </div>
    </div>
  );
}
