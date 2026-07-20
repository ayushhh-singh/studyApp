import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, PenLine, BookOpen, MessagesSquare, Newspaper, Trophy, Sparkles, ShieldCheck, KeyRound, ScanSearch, UserCheck, Flag } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { Footer, SUPPORT_EMAIL } from "@/components/marketing/footer";
import { PageSeo } from "@/components/seo/page-seo";

const PILLAR_ICONS = [BookOpen, Sparkles, MessagesSquare, Newspaper, Trophy, ShieldCheck] as const;
const ACCURACY_ICONS = [KeyRound, ScanSearch, UserCheck, Flag] as const;

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { session } = useAuth();

  const primaryHref = session ? `/${locale}/dashboard` : `/${locale}/auth`;

  const stats = [1, 2, 3].map((i) => ({ num: t(`About.stat${i}Num`), label: t(`About.stat${i}Label`) }));
  const accuracy = [1, 2, 3, 4].map((i) => ({
    Icon: ACCURACY_ICONS[i - 1],
    title: t(`About.accuracy${i}Title`),
    body: t(`About.accuracy${i}Body`),
  }));
  const pillars = [1, 2, 3, 4, 5, 6].map((i) => ({
    Icon: PILLAR_ICONS[i - 1],
    title: t(`About.pillar${i}Title`),
    body: t(`About.pillar${i}Body`),
  }));

  return (
    <div className="min-h-svh bg-background">
      <PageSeo locale={locale} path="/about" title={t("About.metaTitle")} description={t("About.leadSubtitle")} />

      <MarketingHeader maxWidthClass="max-w-4xl" />

      {/* Hero — one concrete lead sentence + who it's for */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h1 className="text-balance text-2xl font-extrabold leading-snug tracking-tight sm:text-3xl">
            {t("About.leadTitle")}
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("About.leadSubtitle")}
          </p>
        </div>
      </section>

      {/* Stats band — concrete proof, up front */}
      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto grid max-w-4xl gap-4 px-4 py-10 sm:grid-cols-3 sm:px-6">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-5">
              <span className="text-4xl font-extrabold tabular-nums tracking-tight text-primary">{s.num}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Accuracy — the differentiator, leads the feature story */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-tulsi/15 text-tulsi-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight">{t("About.accuracyTitle")}</h2>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">{t("About.accuracyIntro")}</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {accuracy.map((a) => (
              <div key={a.title} className="rounded-2xl border border-border bg-card p-5">
                <span className="flex size-9 items-center justify-center rounded-lg bg-tulsi/15 text-tulsi-foreground">
                  <a.Icon className="size-4.5" aria-hidden />
                </span>
                <h3 className="mt-3 text-sm font-semibold">{a.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flagship */}
      <section className="border-b border-border/60 bg-muted/30">
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

      {/* Everything else — pillars */}
      <section className="border-b border-border/60">
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
