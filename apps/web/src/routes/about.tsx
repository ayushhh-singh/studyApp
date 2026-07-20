import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, PenLine, BookOpen, MessagesSquare, Newspaper, Trophy, Sparkles, ShieldCheck, Flag } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, switchLocale, LOCALE_STORAGE_KEY, type Locale } from "@/lib/locale";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/marketing/brand-mark";
import { Footer, SUPPORT_EMAIL } from "@/components/marketing/footer";
import { PageSeo } from "@/components/seo/page-seo";
import { cn } from "@/lib/utils";

const PILLAR_ICONS = [BookOpen, Sparkles, MessagesSquare, Newspaper, Trophy, ShieldCheck] as const;

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useAuth();

  const authHref = `/${locale}/auth`;
  const primaryHref = session ? `/${locale}/dashboard` : authHref;

  function setLocale(next: Locale) {
    if (next === locale) return;
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    navigate(switchLocale(location.pathname, location.search, next, location.hash));
  }

  const pillars = [1, 2, 3, 4, 5, 6].map((i) => ({
    Icon: PILLAR_ICONS[i - 1],
    title: t(`About.pillar${i}Title`),
    body: t(`About.pillar${i}Body`),
  }));

  return (
    <div className="min-h-svh bg-background">
      <PageSeo locale={locale} path="/about" title={`${t("About.title")} — ${t("Landing.brand")}`} description={t("About.subtitle")} />

      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link to={`/${locale}`} aria-label={t("Landing.brand")}>
            <BrandMark />
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
              {SUPPORTED_LOCALES.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  aria-pressed={l === locale}
                  className={cn(
                    "min-h-8 rounded-full px-2.5 text-xs font-semibold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    l === locale ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            <Button asChild size="sm">
              <Link to={session ? `/${locale}/dashboard` : `/${locale}/auth`}>
                {session ? t("Landing.goToApp") : t("Landing.signIn")}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h1 className="text-balance text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{t("About.title")}</h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">{t("About.subtitle")}</p>
        </div>
      </section>

      {/* Who it's for */}
      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">{t("About.whoTitle")}</h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">{t("About.whoBody")}</p>
        </div>
      </section>

      {/* Flagship */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <PenLine className="size-5" aria-hidden />
          </span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight">{t("About.flagshipTitle")}</h2>
          <div className="mt-4 space-y-4 text-base leading-relaxed text-muted-foreground">
            <p>{t("About.flagshipBody1")}</p>
            <p>{t("About.flagshipBody2")}</p>
            <p>{t("About.flagshipBody3")}</p>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">{t("About.pillarsTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("About.pillarsSub")}</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {pillars.map((p) => (
              <div key={p.title} className="flex gap-3 rounded-2xl border border-border bg-card p-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <p.Icon className="size-4.5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{p.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust / accuracy */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-tulsi/15 text-tulsi-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight">{t("About.trustTitle")}</h2>
          <div className="mt-4 space-y-4 text-base leading-relaxed text-muted-foreground">
            <p>{t("About.trustBody1")}</p>
            <p>{t("About.trustBody2")}</p>
            <p>{t("About.trustBody3")}</p>
            <p className="flex items-start gap-2">
              <Flag className="mt-1 size-4 shrink-0 text-coral" aria-hidden />
              <span>{t("About.trustBody4")}</span>
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-border/60 bg-primary/5">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <h2 className="text-3xl font-extrabold tracking-tight">{t("About.ctaTitle")}</h2>
          <p className="mt-2 text-base text-muted-foreground">{t("About.ctaSub")}</p>
          <Button asChild size="lg" className="mt-6 h-12 gap-2 px-8 text-base">
            <Link to={primaryHref}>
              {session ? t("Landing.goToApp") : t("Landing.startFree")} <ArrowRight className="size-5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Support */}
      <section>
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-lg font-bold tracking-tight">{t("About.supportTitle")}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("About.supportBody")}</p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
      </section>

      <Footer />
    </div>
  );
}
