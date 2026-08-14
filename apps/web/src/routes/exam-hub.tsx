import { Link, useLoaderData, useLocation, type LoaderFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronRight, BookOpen, Target, PenLine, Library } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { useExams } from "@/hooks/use-exams";
import { isAwaitingData } from "@/lib/query-state";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { Footer } from "@/components/marketing/footer";
import { PageSeo } from "@/components/seo/page-seo";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { ExamPatternTable } from "@/components/content-hub/exam-pattern-table";
import { accentSolid, type Accent } from "@/lib/accent";
import { breadcrumbList } from "@/lib/structured-data";
import { EXAM_PYQ_YEARS } from "@/lib/content-stats";
import {
  ARTICLE_HUBS,
  articlePath,
  hubFromPathname,
  hubPath,
  publishedArticlesForHub,
  type ArticleHub,
} from "@/lib/articles";

/**
 * An exam hub — `/:locale/uppsc` and `/:locale/upsc`.
 *
 * The hub is the point of the whole URL scheme (`docs/content-strategy.md`
 * §1a): it is itself a rankable asset for the exam's own name, and every
 * article beneath it at `<hub>/<category>/<slug>` feeds it internal link
 * equity. A flat `/blog/<slug>` throws that away, which is why §6.2 chose
 * exam-first hubs and §9.3 confirmed them.
 *
 * ⚑ IT STANDS ON ITS OWN WITH ZERO ARTICLES PUBLISHED, which is the state this
 * ships in. That is a requirement, not a consolation: a hub whose only content
 * is a list of links is a thin page, and a thin page on a site whose entire
 * pitch is accuracy is worse than no page. So the substance here is the exam
 * PATTERN — read live from the registry migration `0106` seeded out of each
 * commission's own notification PDF — plus static prose that says, honestly,
 * what we hold for this exam and what we do not.
 */
export function loader({ request }: LoaderFunctionArgs) {
  // Defence in depth. The router only points literal `uppsc`/`upsc` segments
  // here, so this cannot fire today — but if a third hub is ever added to
  // ARTICLE_HUBS and wired to a different path shape, a wrong segment must 404
  // rather than render an exam page with an undefined exam.
  if (!hubFromPathname(new URL(request.url).pathname)) {
    throw new Response("Not Found", { status: 404 });
  }
  return null;
}

export function Component() {
  useLoaderData(); // re-throws the loader's 404, if any, before we render
  const { t } = useTranslation();
  const locale = useLocale();
  const { session } = useAuth();
  const { pathname } = useLocation();
  const exams = useExams();

  const hub = hubFromPathname(pathname) as ArticleHub;
  const k = `Articles.hub.${hub}`;
  const primaryHref = session ? `/${locale}/dashboard` : `/${locale}/auth`;

  const exam = exams.data?.find((e) => e.exam_code === hub);
  const years = EXAM_PYQ_YEARS[hub];
  const articles = publishedArticlesForHub(hub);
  const otherHub = ARTICLE_HUBS.find((h) => h !== hub);

  // Public marketing surfaces only — a signed-out reader is the audience, so a
  // card must never point at something behind requireAuth.
  const holds = [
    { icon: Target, tint: "marigold", href: `/${locale}/features/pyq-practice`, key: "holdPyq" },
    { icon: BookOpen, tint: "tulsi", href: `/${locale}/features/notes`, key: "holdNotes" },
    { icon: PenLine, tint: "primary", href: `/${locale}/features/answer-evaluation`, key: "holdAnswers" },
    { icon: Library, tint: "coral", href: `/${locale}/resources`, key: "holdResources" },
  ] as const;

  const breadcrumbStructuredData = breadcrumbList([
    { name: t("Articles.breadcrumbHome"), path: `/${locale}` },
    { name: t(`${k}.heroEyebrow`), path: hubPath(hub, locale) },
  ]);

  return (
    <div className="min-h-svh bg-background">
      <PageSeo
        locale={locale}
        path={`/${hub}`}
        title={t(`${k}.metaTitle`)}
        // Year range interpolated, never frozen into the string (§5): the meta
        // description is the one place a stale "2018 to 2024" would be quoted
        // straight back at us in a search result.
        description={t(`${k}.metaDescription`, { from: years.from, to: years.to })}
        structuredData={breadcrumbStructuredData}
      />

      <MarketingHeader maxWidthClass="max-w-5xl" />

      {/* Hero */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {t(`${k}.heroEyebrow`)}
          </span>
          <h1 className="mt-5 text-balance text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {t(`${k}.heroTitle`)}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t(`${k}.heroSub`, { from: years.from, to: years.to })}
          </p>
        </div>
      </section>

      {/* What this exam is — static prose, and therefore the part a crawler
          actually reads (the pattern table below fetches; see its header). */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">{t(`${k}.introTitle`)}</h2>
          <div className="mt-5 space-y-4 text-base leading-relaxed text-muted-foreground">
            <p>{t(`${k}.introBody1`)}</p>
            <p>{t(`${k}.introBody2`)}</p>
          </div>
        </div>
      </section>

      {/* Exam pattern — live from the registry, never written into prose (§5). */}
      <section className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          {/* The exam name is interpolated so this H2 carries the page's primary
              keyword ("UPPSC PCS exam pattern") for both hubs from one key,
              rather than a generic heading that ranks for nothing. */}
          <h2 className="text-2xl font-bold tracking-tight">
            {t("Articles.hub.patternTitle", { exam: t(`${k}.heroEyebrow`) })}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("Articles.hub.patternSub")}</p>
          <div className="mt-7">
            {exams.isError ? (
              <QueryErrorState onRetry={() => void exams.refetch()} />
            ) : isAwaitingData(exams) ? (
              <div className="h-40 animate-pulse rounded-xl border border-border bg-card" aria-hidden />
            ) : exam ? (
              <ExamPatternTable exam={exam} />
            ) : (
              <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                {t("Articles.hub.patternUnavailable")}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Articles — renders only once something is actually published. An empty
          "Articles" heading is exactly the thin-page failure this hub avoids. */}
      {articles.length > 0 && (
        <section className="border-b border-border/60">
          <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
            <h2 className="text-2xl font-bold tracking-tight">{t("Articles.hub.articlesTitle")}</h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {articles.map((a) => (
                <Link
                  key={a.slug}
                  to={articlePath(a, locale)}
                  className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(`Articles.category.${a.category}`)}
                  </span>
                  <h3 className="mt-2 text-base font-bold tracking-tight">{t(`Articles.${a.i18nKey}.cardTitle`)}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {t(`Articles.${a.i18nKey}.cardTeaser`)}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                    {t("Common.learnMore")}
                    <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* What we hold for this exam */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight">{t(`${k}.holdTitle`)}</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {holds.map((h) => (
              <Link
                key={h.key}
                to={h.href}
                className="group flex gap-3 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                  style={accentSolid(h.tint as Accent)}
                >
                  <h.icon className="size-4.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{t(`${k}.${h.key}Title`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`${k}.${h.key}Body`)}</p>
                </div>
              </Link>
            ))}
          </div>

          {otherHub && (
            <p className="mt-8 text-sm text-muted-foreground">
              {t("Articles.hub.crossLinkPrefix")}{" "}
              <Link to={hubPath(otherHub, locale)} className="font-semibold text-primary underline-offset-4 hover:underline">
                {t(`Articles.hub.${otherHub}.heroEyebrow`)}
              </Link>
            </p>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="border-b border-border/60 bg-primary/5">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <h2 className="text-3xl font-extrabold tracking-tight">{t(`${k}.ctaTitle`)}</h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">{t(`${k}.ctaSub`)}</p>
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
