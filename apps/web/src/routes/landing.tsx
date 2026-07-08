import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, PenLine, Target, BookOpen, BarChart3, Check, Sparkles } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, switchLocale, LOCALE_STORAGE_KEY, type Locale } from "@/lib/locale";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/marketing/brand-mark";
import { Screenshot } from "@/components/marketing/screenshot";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { cn } from "@/lib/utils";

const FEATURE_ICONS = [PenLine, Target, BookOpen, BarChart3] as const;

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

  const features = [0, 1, 2, 3].map((i) => ({
    Icon: FEATURE_ICONS[i],
    title: t(`Landing.feature${i + 1}Title`),
    body: t(`Landing.feature${i + 1}Body`),
    img: ["evaluation", "practice", "notes", "revision"][i],
    tint: ["primary", "marigold", "tulsi", "coral"][i],
  }));

  return (
    <div className="min-h-svh bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandMark />
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
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to={authHref}>{t("Landing.signIn")}</Link>
            </Button>
            <Button asChild size="sm">
              <Link to={primaryHref}>{session ? t("Landing.goToApp") : t("Landing.startFree")}</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--primary)/8%,transparent)]"
        />
        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-2 lg:items-center lg:gap-12 lg:pb-24 lg:pt-20">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" /> {t("Landing.badge")}
            </span>
            {/* Bilingual, Hindi-first headline (shown in both locales — Devanagari
                is the star of this product, not a fallback). */}
            <h1 className="mt-5 text-balance text-4xl font-extrabold leading-[1.2] tracking-tight sm:text-5xl lg:text-[3.35rem]">
              <span lang="hi" className="block">
                {t("Landing.heroTitleHi")}
              </span>
              <span lang="en" className="mt-2 block text-2xl font-bold text-primary sm:text-3xl">
                {t("Landing.heroTitleEn")}
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("Landing.heroSub")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="h-12 gap-2 px-6 text-base">
                <Link to={primaryHref}>
                  {session ? t("Landing.goToApp") : t("Landing.startFree")} <ArrowRight className="size-5" />
                </Link>
              </Button>
              <p className="text-sm text-muted-foreground">{t("Landing.heroCtaption")}</p>
            </div>
          </div>

          {/* Hero visual: the flagship evaluation, anchored by the Rubric Dial */}
          <div className="relative">
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-3xl border border-border bg-card p-6 shadow-2xl shadow-primary/10 sm:p-8">
              <p className="self-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("Landing.heroCardLabel")}
              </p>
              <ScoreGauge value={78} label={t("Landing.heroCardScore")} size={196} />
              <div className="grid w-full grid-cols-3 gap-2 text-center">
                {[
                  { k: "Landing.dimStructure", v: 8, c: "tulsi" },
                  { k: "Landing.dimContent", v: 7, c: "marigold" },
                  { k: "Landing.dimExamples", v: 6, c: "coral" },
                ].map((d) => (
                  <div key={d.k} className="rounded-xl border border-border bg-background p-2.5">
                    <div
                      className="text-lg font-extrabold tabular-nums"
                      style={{ color: `var(--${d.c})` }}
                    >
                      {d.v}
                      <span className="text-xs font-semibold text-muted-foreground">/10</span>
                    </div>
                    <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{t(d.k)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature sections */}
      <section className="border-t border-border/60 bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("Landing.featuresTitle")}</h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">{t("Landing.featuresSub")}</p>
          </div>

          <div className="mt-14 space-y-16 lg:space-y-24">
            {features.map((f, i) => (
              <div
                key={f.title}
                className={cn(
                  "grid items-center gap-8 lg:grid-cols-2 lg:gap-12",
                  i % 2 === 1 && "lg:[&>*:first-child]:order-2",
                )}
              >
                <div>
                  <span
                    className="inline-flex size-11 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `var(--${f.tint})`, color: `var(--${f.tint}-foreground)` }}
                  >
                    <f.Icon className="size-5" />
                  </span>
                  <h3 className="mt-4 text-2xl font-bold tracking-tight">{f.title}</h3>
                  <p className="mt-3 text-base leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
                <Screenshot src={`/marketing/${f.img}.png`} alt={f.title} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("Landing.pricingTitle")}</h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">{t("Landing.pricingSub")}</p>
          </div>
          <div className="mx-auto mt-12 grid max-w-3xl gap-5 sm:grid-cols-2">
            {(["free", "pro"] as const).map((plan) => (
              <div
                key={plan}
                className={cn(
                  "rounded-2xl border p-6 sm:p-7",
                  plan === "pro" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card",
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">{t(`Landing.plan_${plan}_name`)}</h3>
                  {plan === "pro" ? (
                    <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
                      {t("Landing.planPopular")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-2xl font-extrabold tabular-nums">{t(`Landing.plan_${plan}_price`)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t(`Landing.plan_${plan}_tag`)}</p>
                <ul className="mt-5 space-y-2.5">
                  {[0, 1, 2, 3].map((n) => {
                    const key = `Landing.plan_${plan}_f${n}`;
                    const text = t(key);
                    if (text === key) return null;
                    return (
                      <li key={n} className="flex items-start gap-2.5 text-sm leading-relaxed">
                        <Check className="mt-0.5 size-4 shrink-0 text-tulsi" />
                        <span>{text}</span>
                      </li>
                    );
                  })}
                </ul>
                <Button asChild className="mt-6 w-full" variant={plan === "pro" ? "default" : "outline"}>
                  <Link to={primaryHref}>{plan === "pro" ? t("Landing.startFree") : t("Landing.plan_free_cta")}</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border/60 bg-primary/5">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:py-20">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("Landing.ctaTitle")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">{t("Landing.ctaSub")}</p>
          <Button asChild size="lg" className="mt-8 h-12 gap-2 px-8 text-base">
            <Link to={primaryHref}>
              {session ? t("Landing.goToApp") : t("Landing.startFree")} <ArrowRight className="size-5" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <BrandMark />
          <p>{t("Landing.footer")}</p>
        </div>
      </footer>
    </div>
  );
}
