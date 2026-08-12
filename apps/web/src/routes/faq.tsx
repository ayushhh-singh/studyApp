import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Flag, Mail } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { LiveExamChips } from "@/components/marketing/live-exam-chips";
import { Footer, SUPPORT_EMAIL } from "@/components/marketing/footer";
import { PageSeo } from "@/components/seo/page-seo";

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();

  // Item 1 (pricing) carries a real Link to /pricing rather than a plain
  // mention in the translated string, per the brief. Item 4 ("what exams does
  // this cover?") ends by listing the LIVE exams from the registry instead of
  // naming them in the string — that answer went stale the day upsc launched,
  // and this is the one page where being out of date is the whole failure.
  const items = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    q: t(`Faq.q${n}`),
    a: t(`Faq.a${n}`),
    link: n === 1 ? { to: `/${locale}/pricing`, label: t("Faq.a1Link") } : null,
    exams: n === 4,
  }));

  return (
    <div className="min-h-svh bg-background">
      <PageSeo locale={locale} path="/faq" title={`${t("Faq.title")} — ${t("Landing.brand")}`} description={t("Faq.subtitle")} />

      <MarketingHeader maxWidthClass="max-w-3xl" />

      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 pb-16 sm:px-6 sm:py-14">
        {/* Centred title — docs/design/reference-1's FAQ panel. */}
        <div className="text-center">
          <h1 className="font-heading text-3xl font-extrabold tracking-tight sm:text-4xl">{t("Faq.title")}</h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">{t("Faq.subtitle")}</p>
        </div>

        <Accordion type="single" collapsible className="rounded-2xl border border-border bg-card px-5">
          {items.map((item, i) => (
            <AccordionItem key={item.q} value={`item-${i}`}>
              <AccordionTrigger>{item.q}</AccordionTrigger>
              <AccordionContent>
                <p>{item.a}</p>
                {item.exams && <LiveExamChips className="mt-3" showLabel={false} />}
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
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link to={`/${locale}/contact`} className="text-sm font-medium text-primary hover:underline">
                {t("Footer.contact")} →
              </Link>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="break-all text-sm text-muted-foreground hover:text-foreground">
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
