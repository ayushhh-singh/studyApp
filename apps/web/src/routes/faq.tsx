import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Flag, Mail } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, switchLocale, LOCALE_STORAGE_KEY, type Locale } from "@/lib/locale";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { BrandMark } from "@/components/marketing/brand-mark";
import { Footer, SUPPORT_EMAIL } from "@/components/marketing/footer";
import { PageSeo } from "@/components/seo/page-seo";
import { cn } from "@/lib/utils";

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useAuth();

  function setLocale(next: Locale) {
    if (next === locale) return;
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    navigate(switchLocale(location.pathname, location.search, next, location.hash));
  }

  // Item 1 (pricing) carries a real Link to /pricing rather than a plain
  // mention in the translated string, per the brief.
  const items = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    q: t(`Faq.q${n}`),
    a: t(`Faq.a${n}`),
    link: n === 1 ? { to: `/${locale}/pricing`, label: t("Faq.a1Link") } : null,
  }));

  return (
    <div className="min-h-svh bg-background">
      <PageSeo locale={locale} path="/faq" title={`${t("Faq.title")} — ${t("Landing.brand")}`} description={t("Faq.subtitle")} />

      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
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

      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 pb-16 sm:px-6">
        <PageHeader title={t("Faq.title")} description={t("Faq.subtitle")} />

        <Accordion type="single" collapsible className="rounded-2xl border border-border bg-card px-5">
          {items.map((item, i) => (
            <AccordionItem key={item.q} value={`item-${i}`}>
              <AccordionTrigger>{item.q}</AccordionTrigger>
              <AccordionContent>
                <p>{item.a}</p>
                {item.link && (
                  <Link to={item.link.to} className="mt-2 inline-block text-sm font-medium text-primary hover:underline">
                    {item.link.label} →
                  </Link>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {/* Contact — content issues go through the in-app report flow, not email. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-coral/15 text-coral">
              <Flag className="size-4.5" aria-hidden />
            </span>
            <h2 className="mt-3 text-sm font-semibold">{t("Faq.reportTitle")}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t("Faq.reportBody")}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Mail className="size-4.5" aria-hidden />
            </span>
            <h2 className="mt-3 text-sm font-semibold">{t("Faq.contactTitle")}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t("Faq.contactBody")}</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-1.5 inline-block text-sm font-medium text-primary hover:underline">
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
