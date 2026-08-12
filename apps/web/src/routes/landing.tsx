import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  PenLine,
  Target,
  BookOpen,
  BarChart3,
  Check,
  ChevronRight,
  ClipboardCheck,
  Layers,
  ListChecks,
  Newspaper,
  CalendarRange,
  TrendingUp,
} from "lucide-react";
import { paiseToRupeeString } from "@neev/shared";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { usePlans } from "@/hooks/use-billing";
import { planMonths } from "@/lib/billing-copy";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { GuestEntryButton } from "@/components/marketing/guest-entry-button";
import { LiveExamChips } from "@/components/marketing/live-exam-chips";
import { BrandPanel } from "@/components/marketing/brand-panel";
import { Footer } from "@/components/marketing/footer";
import { Screenshot } from "@/components/marketing/screenshot";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { PageSeo } from "@/components/seo/page-seo";
import { CONTENT_STATS } from "@/lib/content-stats";
import { FEATURES } from "@/lib/features";
import { accentSolid, type Accent } from "@/lib/accent";
import { cn } from "@/lib/utils";

const FEATURE_ICONS = [PenLine, Target, BookOpen, BarChart3] as const;
/** The reference's four-card bar: Learn / Revise / Practice / Improve. */
const PILLAR_ICONS = [BookOpen, Layers, ClipboardCheck, TrendingUp] as const;
/** Icons for the stat strip, in the same order as CONTENT_STATS. */
const STAT_ICONS = [ListChecks, BookOpen, Newspaper, CalendarRange] as const;
// Matches lib/features.ts's slugs for these same four features — kept as a
// small local list (not importing FEATURES) since this teaser's order/copy
// is landing-page-specific, not driven by the feature config.
const FEATURE_SLUGS = ["answer-evaluation", "pyq-practice", "notes", "revision"] as const;

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { session } = useAuth();

  const primaryHref = session ? `/${locale}/dashboard` : `/${locale}/auth`;

  // The teaser's Pro price comes from the REAL plan ladder (GET /billing/plans
  // is public, same source the /pricing page renders) — it used to be a
  // hardcoded "Coming soon" string that went stale the day the ladder shipped.
  //
  // Deliberately the cheapest ONE-MONTH tier, not the cheapest tier outright:
  // this teaser prints a "/month" suffix, and the ladder's multi-month tiers
  // (quarterly/half-yearly/yearly) carry a whole-period price, so labelling
  // ₹999-per-quarter as "/month" would overstate the price by 3x. If no
  // monthly tier exists the teaser links to /pricing instead of guessing.
  const plans = usePlans();
  const monthlyPlan =
    (plans.data?.plans ?? [])
      .filter((p) => p.price_paise > 0 && planMonths(p) === 1)
      .sort((a, b) => a.price_paise - b.price_paise)[0] ?? null;

  const pillars = [1, 2, 3, 4].map((n) => ({
    Icon: PILLAR_ICONS[n - 1],
    title: t(`Landing.pillar${n}Title`),
    body: t(`Landing.pillar${n}Body`),
  }));

  const features = [0, 1, 2, 3].map((i) => ({
    Icon: FEATURE_ICONS[i],
    title: t(`Landing.feature${i + 1}Title`),
    body: t(`Landing.feature${i + 1}Body`),
    img: ["evaluation", "practice", "notes", "revision"][i],
    tint: ["primary", "marigold", "tulsi", "coral"][i],
    slug: FEATURE_SLUGS[i],
  }));

  // Organization schema — helps Google's Knowledge Graph (and AI Overview
  // grounding) identify neevstudy.com as a distinct entity, since "Neev" also
  // names an unrelated Physics Wallah school-foundation product line and a
  // brand-new domain has near-zero other disambiguating signal yet. Every
  // field here is real (name/url/logo/description) — deliberately no
  // `sameAs` social profiles, since none exist yet; inventing one would be
  // worse than omitting it.
  const organizationStructuredData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Neev",
    alternateName: "नींव",
    url: "https://neevstudy.com",
    logo: "https://neevstudy.com/pwa/icon-512.png",
    description: t("Landing.heroSub"),
  };

  return (
    <div className="min-h-svh bg-background">
      <PageSeo
        locale={locale}
        path=""
        title={`${t("Landing.brand")} — ${t("Landing.heroLine1")} ${t("Landing.heroAccent")} ${t("Landing.heroLine2")}`}
        description={t("Landing.heroSub")}
        structuredData={organizationStructuredData}
      />
      <MarketingHeader maxWidthClass="max-w-6xl" />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--primary)/8%,transparent)]"
        />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-12 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-2 lg:items-center lg:gap-12 lg:pb-16 lg:pt-20">
          <div>
            {/* ONE language per heading. This used to stack the Hindi and the
                English headline inside a single <h1> in BOTH locales, so an
                English reader's primary heading opened in Devanagari and the
                element had no single `lang`. Hindi is still first-class — it
                just gets its own headline in its own locale, rather than being
                bolted onto the English one. */}
            <h1 className="text-balance font-heading text-4xl font-extrabold leading-[1.2] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              {t("Landing.heroLine1")}{" "}
              <span className="whitespace-nowrap">
                {/* --marigold-foreground, NOT the raw brand gold the mockup
                    paints here: #F7C873 on this page measures 1.48:1, far
                    under AA, and this is the codebase's single most-repeated
                    defect. The paired token is a deep amber in light (7.6:1)
                    and a pale gold in dark (14.6:1) — reads gold in both,
                    legible in both. */}
                <span className="text-marigold-foreground">{t("Landing.heroAccent")}</span> {t("Landing.heroLine2")}
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("Landing.heroSub")}
            </p>
            {/* ONE primary, one secondary, and the guest path as a quiet
                tertiary. Three equally-weighted buttons stacked in a row make
                a visitor choose before they have read anything — the guest
                entry is a genuine third option, but it is not a third
                DECISION, so it reads as a link under the pair rather than
                competing with them. */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="h-12 gap-2 px-6 text-base">
                <Link to={primaryHref}>
                  {session ? t("Landing.goToApp") : t("Landing.startPreparing")} <ArrowRight className="size-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base">
                <Link to={`/${locale}/features`}>{t("Landing.exploreFeatures")}</Link>
              </Button>
            </div>
            {/* A flex ROW, not a <p> with the control inline: GuestEntryButton
                renders a <div> (it carries its own failure note), and a <div>
                inside a <p> is invalid nesting — React flags it and the
                browser silently closes the paragraph early. */}
            <div className="mt-4 flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>{t("Landing.heroCtaption")}</span>
                {!session ? (
                  <>
                    <span aria-hidden>·</span>
                    <GuestEntryButton
                      variant="ghost"
                      size="default"
                      className="gap-0 [&>button]:h-auto [&>button]:px-0 [&>button]:text-sm [&>button]:font-medium [&>button]:text-primary [&>button]:underline-offset-4 [&>button:hover]:bg-transparent [&>button:hover]:underline"
                    />
                  </>
                ) : null}
              </div>
              <LiveExamChips />
            </div>
          </div>

          {/* Hero visual: the reference's navy brand panel, with the flagship
              Rubric Dial floating off its lower edge — our own signature
              element rather than stock art in the illustration slot. */}
          <div className="relative mx-auto w-full max-w-md pb-24 sm:pb-28 lg:max-w-none lg:pb-16">
            <BrandPanel className="py-5 sm:py-7" />
            <div className="absolute inset-x-4 bottom-0 rounded-2xl border border-border bg-card p-4 shadow-xl shadow-primary/10 sm:inset-x-8 sm:p-5 lg:inset-x-auto lg:right-2 lg:w-72">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("Landing.heroCardLabel")}
              </p>
              <div className="mt-2 flex items-center gap-4">
                <ScoreGauge value={78} label={t("Landing.heroCardScore")} size={104} />
                <ul className="flex flex-1 flex-col gap-1.5 text-xs">
                  {[
                    { k: "Landing.dimStructure", v: 8 },
                    { k: "Landing.dimContent", v: 7 },
                    { k: "Landing.dimExamples", v: 6 },
                  ].map((d) => (
                    <li key={d.k} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t(d.k)}</span>
                      <span className="font-display font-bold tabular-nums">{d.v}/10</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Four-pillar bar — Learn / Revise / Practice / Improve */}
      <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p) => (
            <li key={p.title} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <p.Icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="font-heading text-base font-bold tracking-tight">{p.title}</h2>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Stat strip — real measured content counts (see lib/content-stats.ts) */}
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-4 sm:px-6 lg:pb-16">
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-6 lg:grid-cols-4 lg:divide-x lg:divide-border">
            {CONTENT_STATS.map((stat, i) => {
              const Icon = STAT_ICONS[i];
              return (
                <div key={stat.labelKey} className="flex items-center gap-3 lg:justify-center lg:px-2">
                  <Icon className="size-7 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0">
                    <dt className="sr-only">{t(stat.labelKey)}</dt>
                    <dd>
                      <span className="block font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
                        {stat.value}
                      </span>
                      <span aria-hidden className="block text-xs leading-snug text-muted-foreground sm:text-sm">
                        {t(stat.labelKey)}
                      </span>
                    </dd>
                  </div>
                </div>
              );
            })}
          </dl>
          <p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">{t("Landing.statsNote")}</p>
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
                    style={accentSolid(f.tint as Accent)}
                  >
                    <f.Icon className="size-5" />
                  </span>
                  <h3 className="mt-4 text-2xl font-bold tracking-tight">{f.title}</h3>
                  <p className="mt-3 text-base leading-relaxed text-muted-foreground">{f.body}</p>
                  <Link
                    to={`/${locale}/features/${f.slug}`}
                    className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                  >
                    {t("Common.learnMore")}
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                </div>
                <Screenshot src={`/marketing/${f.img}.png`} alt={f.title} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The other four features, compact. The deep-dive sections above cover
          the four flagship surfaces with screenshots; without this row the
          homepage silently implies the product IS those four, when it also has
          current affairs, a grounded AI mentor, a mastery/streak layer and a
          peer-review community. Driven off FEATURES so it cannot drift from
          the feature pages it links to. */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-heading text-2xl font-extrabold tracking-tight sm:text-3xl">{t("Landing.moreTitle")}</h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">{t("Landing.moreSub")}</p>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.filter((f) => !FEATURE_SLUGS.includes(f.slug as (typeof FEATURE_SLUGS)[number])).map((f) => (
              <li key={f.slug}>
                <Link
                  to={`/${locale}/features/${f.slug}`}
                  className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                    style={accentSolid(f.tint as Accent)}
                  >
                    <f.icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="font-heading text-base font-bold tracking-tight">
                    {t(`Features.${f.i18nKey}.heroEyebrow`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t(`Features.${f.i18nKey}.hubTeaser`)}
                  </p>
                  <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-semibold text-primary">
                    {t("Common.learnMore")}
                    <ChevronRight className="size-4" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
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
                <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">
                  {plan === "free" ? (
                    t("Landing.plan_free_price")
                  ) : monthlyPlan ? (
                    <>
                      ₹{paiseToRupeeString(monthlyPlan.price_paise)}
                      <span className="text-sm font-medium text-muted-foreground">{t("Landing.planPerMonth")}</span>
                    </>
                  ) : (
                    // Registry not loaded (or failed): link out rather than
                    // print a number we don't have. Never a hardcoded price.
                    <span className="text-base font-semibold text-primary">{t("Landing.plan_pro_priceFallback")}</span>
                  )}
                </p>
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

      <Footer />
    </div>
  );
}
