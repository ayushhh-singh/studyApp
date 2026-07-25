import { Link, useParams, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { Footer } from "@/components/marketing/footer";
import { Screenshot } from "@/components/marketing/screenshot";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { PageSeo } from "@/components/seo/page-seo";
import { FEATURES, getFeatureBySlug } from "@/lib/features";

export function loader({ params }: LoaderFunctionArgs) {
  if (!getFeatureBySlug(params.slug)) {
    throw new Response("Not Found", { status: 404 });
  }
  return null;
}

export function Component() {
  useLoaderData(); // re-throws the loader's 404, if any, before we render
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const locale = useLocale();
  const { session } = useAuth();

  const feature = getFeatureBySlug(slug)!;
  const k = `Features.${feature.i18nKey}`;
  const primaryHref = session ? `/${locale}/dashboard` : `/${locale}/auth`;

  const steps = [1, 2, 3].map((n) => ({ title: t(`${k}.step${n}Title`), body: t(`${k}.step${n}Body`) }));
  const highlights = [1, 2, 3, 4].map((n) => ({ title: t(`${k}.highlight${n}Title`), body: t(`${k}.highlight${n}Body`) }));
  const faqs = [1, 2, 3, 4].map((n) => ({ q: t(`${k}.faqQ${n}`), a: t(`${k}.faqA${n}`) }));
  const otherFeatures = FEATURES.filter((f) => f.slug !== feature.slug);

  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="min-h-svh bg-background">
      <PageSeo
        locale={locale}
        path={`/features/${feature.slug}`}
        title={t(`${k}.metaTitle`)}
        description={t(`${k}.metaDescription`)}
        structuredData={faqStructuredData}
      />

      <MarketingHeader maxWidthClass="max-w-4xl" />

      <div className="mx-auto max-w-4xl px-4 pt-6 sm:px-6">
        <Link
          to={`/${locale}/features`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("Features.hub.heroEyebrow")}
        </Link>
      </div>

      {/* Hero */}
      <section className="border-b border-border/60">
        <div className="mx-auto grid max-w-4xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-2 lg:items-center">
          <div>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: `var(--${feature.tint})`, color: `var(--${feature.tint}-foreground)` }}
            >
              <feature.icon className="size-3.5" aria-hidden />
              {t(`${k}.heroEyebrow`)}
            </span>
            <h1 className="mt-4 text-balance text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              {t(`${k}.heroTitle`)}
            </h1>
            <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t(`${k}.heroSub`)}
            </p>
            <div className="mt-7">
              <Button asChild size="lg" className="h-12 gap-2 px-6 text-base">
                <Link to={primaryHref}>
                  {session ? t("Landing.goToApp") : t("Landing.startFree")} <ArrowRight className="size-5" />
                </Link>
              </Button>
            </div>
          </div>
          <Screenshot src={feature.screenshot} alt={t(`${k}.heroTitle`)} />
        </div>
      </section>

      {/* How it works */}
      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">{t(`${k}.howTitle`)}</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.title} className="rounded-2xl border border-border bg-card p-5">
                <span
                  className="flex size-8 items-center justify-center rounded-full text-sm font-extrabold tabular-nums"
                  style={{ backgroundColor: `var(--${feature.tint})`, color: `var(--${feature.tint}-foreground)` }}
                >
                  {i + 1}
                </span>
                <h3 className="mt-3 text-sm font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">{t(`${k}.highlightsTitle`)}</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {highlights.map((h) => (
              <div key={h.title} className="flex gap-3 rounded-2xl border border-border bg-card p-5">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `color-mix(in oklch, var(--${feature.tint}) 15%, transparent)`, color: `var(--${feature.tint}-foreground)` }}
                >
                  <Check className="size-4.5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{h.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{h.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">{t(`${k}.faqTitle`)}</h2>
          <Accordion type="single" collapsible className="mt-6 rounded-2xl border border-border bg-card px-5">
            {faqs.map((f, i) => (
              <AccordionItem key={f.q} value={`item-${i}`}>
                <AccordionTrigger>{f.q}</AccordionTrigger>
                <AccordionContent>
                  <p>{f.a}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-border/60 bg-primary/5">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <h2 className="text-3xl font-extrabold tracking-tight">{t(`${k}.ctaTitle`)}</h2>
          <p className="mx-auto mt-2 max-w-xl text-base text-muted-foreground">{t(`${k}.ctaSub`)}</p>
          <Button asChild size="lg" className="mt-8 h-12 gap-2 px-8 text-base">
            <Link to={primaryHref}>
              {session ? t("Landing.goToApp") : t("Landing.startFree")} <ArrowRight className="size-5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Explore other features — internal linking */}
      <section>
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("Features.hub.heroEyebrow")}</h2>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {otherFeatures.map((f) => (
              <Link
                key={f.slug}
                to={`/${locale}/features/${f.slug}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
              >
                <f.icon className="size-3.5" aria-hidden />
                {t(`Features.${f.i18nKey}.heroEyebrow`)}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
