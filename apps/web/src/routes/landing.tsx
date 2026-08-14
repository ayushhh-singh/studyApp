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
  CalendarCheck,
  History,
  Lock,
  Trophy,
  TrendingUp,
} from "lucide-react";
import { paiseToRupeeString, type Plan } from "@neev/shared";
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
import { accentSolid, accentTint, type Accent } from "@/lib/accent";
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
/**
 * Slugs this page already covers ABOVE the compact "and everything around
 * them" row, and which must therefore not appear in it a second time: the four
 * deep-dive sections, plus the test series, which has its own full-width band.
 * Without the series here it would show up twice on one page AND leave a fifth
 * card orphaned on its own row in a 4-up grid.
 */
const COVERED_ABOVE: readonly string[] = [...FEATURE_SLUGS, "test-series"];

/**
 * The teaser's ladder, cheapest first. Derived from nothing on purpose: this is
 * a marketing summary with hand-written per-tier copy (`Landing.plan_<tier>_*`),
 * not a render of the plans table — /pricing is where every real cadence and
 * price lives, and each card here links there.
 */
const TEASER_TIERS = ["free", "pro", "max"] as const;

/**
 * The cheapest ONE-MONTH plan for a tier, or null.
 *
 * ⚑ The month filter is load-bearing, not a tidy-up. This teaser prints a
 * "/month" suffix, while the ladder's multi-month cadences carry a WHOLE-PERIOD
 * price — so labelling ₹999-per-quarter as "/month" would understate Pro by 3x
 * and ₹5,999-per-year as "/month" would understate Max by 12x. A tier with no
 * monthly cadence correctly renders the "See pricing" fallback rather than a
 * wrong number.
 */
function cheapestMonthly(plans: Plan[], tier: string): Plan | null {
  return (
    plans
      .filter((p) => p.tier === tier && p.price_paise > 0 && planMonths(p) === 1)
      .sort((a, b) => a.price_paise - b.price_paise)[0] ?? null
  );
}

/** Icons for the test-series band's three selling points, in copy order. */
const SERIES_POINT_ICONS = [CalendarRange, Trophy, History] as const;

/**
 * The window rule, as three states. Colour carries meaning here: locked is
 * INFORMATIONAL (a rule, not an error — so `primary`, never coral), the ranked
 * window is the prize (`marigold`), and staying open is the reassurance
 * (`tulsi`).
 */
const SERIES_WINDOW_STEPS = [
  { tint: "primary", Icon: Lock },
  { tint: "marigold", Icon: Trophy },
  { tint: "tulsi", Icon: CalendarCheck },
] as const satisfies readonly { tint: Accent; Icon: typeof Lock }[];

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { session } = useAuth();

  const primaryHref = session ? `/${locale}/dashboard` : `/${locale}/auth`;

  // Prices come from the REAL plan ladder (GET /billing/plans is public, the
  // same source /pricing renders) — never a hardcoded number. See
  // cheapestMonthly for why it must be the one-MONTH cadence.
  const plans = usePlans();
  const allPlans = plans.data?.plans ?? [];

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

      {/* ── Test series: a SECOND hero, deliberately not the first ──────────
          Placement is the decision here, so it is recorded rather than left
          to be re-litigated. The scheduled series is the strongest thing we
          sell against the coaching market (institutes lead with a test series
          at ₹9,000-16,000), and it gets hero weight: its own full-width band,
          its own eyebrow/headline/visual, directly under the fold rather than
          in the compact "and everything around them" row.

          It is NOT the page's primary headline, for two reasons that both
          point the same way:

          1. It is Max-only. The homepage's job is a free signup, and leading
             with the top tier's exclusive raises the perceived price of entry
             before a visitor has seen anything they can have today.
          2. Every series is still `draft` (docs/max-tier-design.md "Still
             open"), so no non-admin can open one. A primary headline for a
             surface nobody can reach is the exact claim this repo's own
             convention forbids.

          So the copy sells the MECHANICS and the calendar — all of which are
          true and shipped — and deliberately makes no "sit one today" claim.
          When a series is published, this section needs no rewrite. */}
      <section className="relative overflow-hidden border-t border-border/60">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_60%_at_75%_0%,var(--marigold)/10%,transparent)]"
        />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-12 lg:py-24">
          <div>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={accentSolid("marigold")}
            >
              <CalendarCheck className="size-3.5" aria-hidden />
              {t("Landing.seriesEyebrow")}
            </span>
            <h2 className="mt-4 text-balance font-heading text-3xl font-extrabold leading-[1.2] tracking-tight sm:text-4xl">
              {t("Landing.seriesTitle")}
            </h2>
            <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("Landing.seriesBody")}
            </p>
            <ul className="mt-7 flex flex-col gap-5">
              {[1, 2, 3].map((n) => {
                const Icon = SERIES_POINT_ICONS[n - 1];
                return (
                  <li key={n} className="flex gap-3.5">
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                      style={accentTint("marigold")}
                    >
                      <Icon className="size-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-heading text-base font-bold tracking-tight">
                        {t(`Landing.seriesPoint${n}Title`)}
                      </h3>
                      <p className="mt-1 text-sm leading-[1.75] text-muted-foreground">
                        {t(`Landing.seriesPoint${n}Body`)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" variant="outline" className="h-12 gap-2 px-6 text-base">
                <Link to={`/${locale}/features/test-series`}>
                  {t("Landing.seriesCta")}
                  <ChevronRight className="size-5" aria-hidden />
                </Link>
              </Button>
              <span className="text-sm text-muted-foreground">{t("Landing.seriesPlanNote")}</span>
            </div>
          </div>

          {/* The window rule, as the visual. Deliberately NOT a mocked-up
              calendar with invented paper names, dates and rank numbers: the
              asymmetric window IS the differentiator, and it can be shown
              exactly as it behaves without inventing a single figure. */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xl shadow-marigold/10 sm:p-6">
            <h3 className="font-heading text-base font-bold tracking-tight">{t("Landing.seriesWindowTitle")}</h3>
            <ol className="mt-4 flex flex-col gap-3">
              {SERIES_WINDOW_STEPS.map((step, i) => (
                <li key={step.tint} className="rounded-xl border border-border/70 bg-background p-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                      style={accentTint(step.tint)}
                    >
                      <step.Icon className="size-4" aria-hidden />
                    </span>
                    <span className="font-heading text-sm font-bold tracking-tight">
                      {t(`Landing.seriesWindow${i + 1}Label`)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-[1.75] text-muted-foreground">
                    {t(`Landing.seriesWindow${i + 1}Body`)}
                  </p>
                </li>
              ))}
            </ol>
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
            {FEATURES.filter((f) => !COVERED_ABOVE.includes(f.slug)).map((f) => (
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
          <div className="mx-auto mt-12 grid max-w-5xl gap-5 md:grid-cols-3">
            {TEASER_TIERS.map((tier) => {
              const paid = tier !== "free";
              const monthly = paid ? cheapestMonthly(allPlans, tier) : null;
              const top = tier === "max";
              return (
                <div
                  key={tier}
                  className={cn(
                    "flex flex-col rounded-2xl border p-6 sm:p-7",
                    top ? "border-marigold bg-card shadow-lg shadow-marigold/20" : "border-border bg-card",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-bold">{t(`Landing.plan_${tier}_name`)}</h3>
                    {top ? (
                      // Gold pill, text --brand-navy via accentSolid. "Top tier"
                      // is arithmetic; the badge here used to read "Popular",
                      // which is a claim about what other people bought that we
                      // have no data for — /pricing already rejected exactly
                      // that wording (billing-copy.ts compareTitle).
                      <span
                        className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={accentSolid("marigold")}
                      >
                        {t("Landing.planTopTier")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">
                    {!paid ? (
                      t("Landing.plan_free_price")
                    ) : monthly ? (
                      <>
                        ₹{paiseToRupeeString(monthly.price_paise)}
                        <span className="text-sm font-medium text-muted-foreground">{t("Landing.planPerMonth")}</span>
                      </>
                    ) : (
                      // Registry not loaded (or failed), or this tier has no
                      // monthly cadence: link out rather than print a number we
                      // don't have. Never a hardcoded price.
                      <span className="text-base font-semibold text-primary">{t("Landing.planPriceFallback")}</span>
                    )}
                  </p>
                  <p className="mt-1 text-sm leading-[1.75] text-muted-foreground">{t(`Landing.plan_${tier}_tag`)}</p>
                  <ul className="mt-5 space-y-2.5">
                    {[0, 1, 2, 3].map((n) => {
                      const key = `Landing.plan_${tier}_f${n}`;
                      const text = t(key);
                      if (text === key) return null;
                      return (
                        <li key={n} className="flex items-start gap-2.5 text-sm leading-[1.75]">
                          {/* -foreground, not the raw token: `text-tulsi` on a
                              card measures 2.5:1 (design skill, the codebase's
                              single most-repeated defect). */}
                          <Check className="mt-1 size-4 shrink-0 text-tulsi-foreground" aria-hidden />
                          <span>{text}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {/* mt-auto so the three buttons line up despite different
                      bullet counts. A PAID card must route to /pricing: it
                      used to send every visitor to sign-up, so the section
                      advertised a paid tier and then offered no way to see the
                      ladder or buy it — and the Pro card's own label read
                      "Start free", which describes the card next to it. */}
                  {/* The spacing sits on a WRAPPER, not the Button: mt-auto
                      bottom-aligns the three buttons despite differing bullet
                      heights, but collapses to zero once a card's bullets fill
                      it — which put the Max card's button flush against its
                      last bullet while the shorter cards looked fine. pt-6 is
                      a floor that always applies. It cannot go on the Button
                      itself, where padding would push the label down inside
                      the control instead of away from the list above it. */}
                  <div className="mt-auto pt-6">
                    <Button asChild className="w-full" variant={paid ? "outline" : "default"}>
                      <Link to={paid ? `/${locale}/pricing` : primaryHref}>
                        {paid ? t("Landing.planSeePlans") : t("Landing.plan_free_cta")}
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
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
