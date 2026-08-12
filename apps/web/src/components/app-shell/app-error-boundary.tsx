import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError, useNavigate, useParams, Link } from "react-router";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale";

/**
 * Copy is a local object rather than i18n on purpose: this boundary has to
 * render even when the failure IS the i18n bundle (or any other provider),
 * so it must not depend on anything that can itself be the thing that broke.
 */
const COPY = {
  en: {
    notFoundTitle: "Page not found",
    notFoundBody: "Looks like you're lost. The page you're looking for doesn't exist or may have moved.",
    errorTitle: "Something went wrong",
    errorBody: "An unexpected error occurred. Reloading usually fixes it.",
    reload: "Reload",
    home: "Go to homepage",
    contact: "Still stuck? Contact us",
  },
  hi: {
    notFoundTitle: "पेज नहीं मिला",
    notFoundBody: "लगता है आप भटक गए हैं। आप जो पेज ढूंढ रहे हैं वह मौजूद नहीं है या हट गया है।",
    errorTitle: "कुछ गड़बड़ हो गई",
    errorBody: "एक अनपेक्षित त्रुटि हुई। पेज रीलोड करने से आमतौर पर यह ठीक हो जाता है।",
    reload: "रीलोड करें",
    home: "होमपेज पर जाएं",
    contact: "फिर भी अटके हैं? हमसे संपर्क करें",
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
    <div className="flex min-h-svh items-center justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-3xl flex-col items-center gap-8 md:flex-row md:items-center md:gap-12">
        <div className="order-2 flex flex-col items-center text-center md:order-1 md:items-start md:text-start">
          {is404 ? (
            // docs/design/reference-3's 404 PAGE: the status as a display
            // numeral. Only for a real 404 — printing "404" over a render
            // error would be a lie about what happened.
            <span
              aria-hidden
              className="font-display text-7xl font-extrabold leading-none tracking-tight text-muted-foreground/40 sm:text-8xl"
            >
              404
            </span>
          ) : (
            <span className="flex size-12 items-center justify-center rounded-full bg-coral/15 text-coral-foreground">
              <AlertTriangle className="size-6" aria-hidden />
            </span>
          )}
          <h1 className="mt-4 font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            {is404 ? t.notFoundTitle : t.errorTitle}
          </h1>
          <p className="mt-2 max-w-sm text-pretty text-base leading-relaxed text-muted-foreground">
            {is404 ? t.notFoundBody : t.errorBody}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2 md:justify-start">
            {!is404 && (
              <Button type="button" variant="outline" onClick={() => window.location.reload()} className="gap-2">
                <RefreshCw className="size-4" aria-hidden />
                {t.reload}
              </Button>
            )}
            {/* Homepage, not the dashboard: a signed-out visitor who lands on a
                404 would be bounced straight to /auth by RequireAuth, which
                reads as a second thing going wrong. The landing page is valid
                for everyone and links onward to the app. */}
            <Button type="button" onClick={() => navigate(`/${locale}`)} className="gap-2">
              <Home className="size-4" aria-hidden />
              {t.home}
            </Button>
          </div>
          <Link
            to={`/${locale}/contact`}
            className="mt-5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t.contact}
          </Link>
        </div>

        {/* The brand mark, sized as illustration. Decorative — the message
            above already says everything, so it carries no alt text. */}
        <img
          src="/pwa/icon-512.png"
          alt=""
          aria-hidden
          width={512}
          height={512}
          className="order-1 w-40 shrink-0 object-contain sm:w-52 md:order-2"
        />
      </div>
    </div>
  );
}
