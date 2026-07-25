import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronRight } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { Footer } from "@/components/marketing/footer";
import { PageSeo } from "@/components/seo/page-seo";
import { FEATURES } from "@/lib/features";

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { session } = useAuth();

  const primaryHref = session ? `/${locale}/dashboard` : `/${locale}/auth`;

  return (
    <div className="min-h-svh bg-background">
      <PageSeo
        locale={locale}
        path="/features"
        title={t("Features.hub.metaTitle")}
        description={t("Features.hub.metaDescription")}
      />

      <MarketingHeader maxWidthClass="max-w-6xl" />

      {/* Hero */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {t("Features.hub.heroEyebrow")}
          </span>
          <h1 className="mt-5 text-balance text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {t("Features.hub.heroTitle")}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("Features.hub.heroSub")}
          </p>
        </div>
      </section>

      {/* Grid */}
      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto grid max-w-6xl gap-5 px-4 py-14 sm:grid-cols-2 sm:px-6 sm:py-20 lg:grid-cols-4">
          {FEATURES.map((f) => {
            const k = `Features.${f.i18nKey}`;
            return (
              <Link
                key={f.slug}
                to={`/${locale}/features/${f.slug}`}
                className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
              >
                <span
                  className="inline-flex size-10 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `var(--${f.tint})`, color: `var(--${f.tint}-foreground)` }}
                >
                  <f.icon className="size-4.5" aria-hidden />
                </span>
                <h2 className="mt-4 text-base font-bold tracking-tight">{t(`${k}.heroEyebrow`)}</h2>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{t(`${k}.hubTeaser`)}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  {t("Common.learnMore")}
                  <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-border/60 bg-primary/5">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <h2 className="text-3xl font-extrabold tracking-tight">{t("Features.hub.ctaTitle")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">{t("Features.hub.ctaSub")}</p>
          <Button asChild size="lg" className="mt-8 h-12 gap-2 px-8 text-base">
            <Link to={primaryHref}>
              {session ? t("Landing.goToApp") : t("Landing.startFree")} <ArrowRight className="size-5" />
            </Link>
          </Button>
        </div>
      </section>

      <Footer />
    </div>
  );
}
