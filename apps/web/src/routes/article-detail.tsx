import { Link, useLoaderData, useLocation, useParams, type LoaderFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { Footer } from "@/components/marketing/footer";
import { PageSeo } from "@/components/seo/page-seo";
import { ChapterMarkdown } from "@/components/ui-x/chapter-markdown";
import { ArticleDataBlock } from "@/components/content-hub/article-data-block";
import { blogPosting, breadcrumbList } from "@/lib/structured-data";
import {
  articlePath,
  getPublishedArticle,
  hubFromPathname,
  hubPath,
  publishedArticlesForHub,
  type ArticleHub,
} from "@/lib/articles";

/**
 * One article — `/:locale/<hub>/<category>/<slug>`.
 *
 * ⚑ EVERY URL 404s TODAY, and that is correct rather than unfinished. No slate
 * item has `status: "published"` yet (`lib/articles.ts` — §9.2, who writes
 * them, is still an open founder decision), and `getPublishedArticle` resolves
 * only published entries. The route, its SEO wiring and its rendering are the
 * infrastructure this commit exists to build; flipping one `status` and adding
 * its prose is then the whole of shipping an article.
 *
 * The loader requires all THREE segments to agree. A published analysis piece
 * reachable at both `/uppsc/analysis/<slug>` and `/uppsc/books/<slug>` would be
 * duplicate content at two URLs competing with each other — the specific SEO
 * own-goal this hub cannot afford, and free to prevent here.
 */
export function loader({ params, request }: LoaderFunctionArgs) {
  const hub = hubFromPathname(new URL(request.url).pathname);
  if (!getPublishedArticle(hub, params.category, params.slug)) {
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
  const { category, slug } = useParams<{ category: string; slug: string }>();

  const hub = hubFromPathname(pathname)!;
  const article = getPublishedArticle(hub, category, slug)!;
  const k = `Articles.${article.i18nKey}`;
  const primaryHref = session ? `/${locale}/dashboard` : `/${locale}/auth`;

  const related = publishedArticlesForHub(hub).filter((a) => a.slug !== article.slug).slice(0, 4);

  // Both graphs on one page, as a top-level array. `check:seo` guarantees a
  // published article carries both dates, so these are never undefined here —
  // the `??` keeps the type honest rather than papering over a real gap.
  const structuredData = [
    blogPosting({
      headline: t(`${k}.heroTitle`),
      description: t(`${k}.metaDescription`),
      path: articlePath(article, locale),
      datePublished: article.publishedAt ?? "",
      dateModified: article.updatedAt ?? article.publishedAt ?? "",
      locale,
    }),
    breadcrumbList([
      { name: t("Articles.breadcrumbHome"), path: `/${locale}` },
      { name: t(`Articles.hub.${hub}.heroEyebrow`), path: hubPath(hub, locale) },
      { name: t(`${k}.cardTitle`), path: articlePath(article, locale) },
    ]),
  ];

  return (
    <div className="min-h-svh bg-background">
      <PageSeo
        locale={locale}
        path={`/${hub}/${article.category}/${article.slug}`}
        title={t(`${k}.metaTitle`)}
        description={t(`${k}.metaDescription`)}
        structuredData={structuredData}
        ogType="article"
        publishedTime={article.publishedAt}
        modifiedTime={article.updatedAt}
      />

      <MarketingHeader maxWidthClass="max-w-3xl" />

      <div className="mx-auto max-w-3xl px-4 pt-6 sm:px-6">
        <Link
          to={hubPath(hub, locale)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t(`Articles.hub.${hub}.heroEyebrow`)}
        </Link>
      </div>

      <article className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="border-b border-border/60 pb-8">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            {t(`Articles.category.${article.category}`)}
          </span>
          <h1 className="mt-3 text-balance text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {t(`${k}.heroTitle`)}
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t(`${k}.heroSub`)}
          </p>
          {/* §5.2 — the page states its own currency ON the page, so a
              prerendered snapshot that is a few weeks behind reads as honestly
              dated rather than as wrong. */}
          {article.updatedAt && (
            <p className="mt-5 text-xs text-muted-foreground">
              <time dateTime={article.updatedAt}>
                {t("Articles.updatedOn", { date: formatDate(article.updatedAt, locale) })}
              </time>
              {article.dataBinding.length > 0 && <> · {t("Articles.dataBoundNote")}</>}
            </p>
          )}
        </header>

        {/* Long-form prose as one markdown string per locale, rendered by the
            same dependency-light renderer the study chapters use — it already
            handles GFM tables and already applies the Devanagari line-height
            floor its own way, so Hindi prose is typographically correct here
            independent of the app-wide fix.

            Interleaved with live data blocks at each `[[data:…]]` marker (§5):
            prose asserts what does not drift, blocks carry what does. See
            `article-data-block.tsx` for why a block rather than an interpolated
            value inside a sentence. */}
        <ArticleBody markdown={t(`${k}.bodyMd`)} locale={locale} hub={hub} />
      </article>

      {related.length > 0 && (
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
            <h2 className="text-sm font-semibold text-muted-foreground">{t("Articles.relatedTitle")}</h2>
            <div className="mt-4 flex flex-col gap-2.5">
              {related.map((a) => (
                <Link
                  key={a.slug}
                  to={articlePath(a, locale)}
                  className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {t(`Articles.${a.i18nKey}.cardTitle`)}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-border/60 bg-primary/5">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t("Articles.ctaTitle")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
            {t("Articles.ctaSub")}
          </p>
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

/**
 * The article body: markdown prose with live data blocks spliced in at each
 * `[[data:<name>]]` line.
 *
 * ⚑ THE MARKER MUST BE ITS OWN LINE, which the anchors enforce. Splitting on a
 * pattern that could match mid-paragraph would let a marker inside a sentence
 * tear a paragraph in half and render the remainder as a separate block of
 * prose — silently, and differently per locale, since the two translations wrap
 * differently. `^…$` with the `m` flag means a marker is either a whole line or
 * it is ordinary text that renders literally, and a literal `[[data:x]]` in the
 * output is a visible authoring error rather than an invisible one.
 *
 * A segment that is only whitespace renders nothing, so a marker surrounded by
 * blank lines (which is how it reads naturally in the source) does not emit an
 * empty `<ChapterMarkdown>`.
 */
function ArticleBody({ markdown, locale, hub }: { markdown: string; locale: "hi" | "en"; hub: ArticleHub }) {
  // The capture group makes `split` interleave: [prose, marker, prose, …].
  const parts = markdown.split(/^\[\[data:([a-zA-Z0-9:,_-]+)\]\]$/m);
  return (
    <div className="mt-8">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <ArticleDataBlock key={`block-${part}-${i}`} marker={part} hub={hub} />
        ) : part.trim() ? (
          // `document` scale: this markdown IS the page, so its `##` are real
          // h2s. The default (`sub`) is calibrated for a study chapter's body,
          // where the surrounding section already owns h2/h3 — under it an
          // article renders with no h2 at all.
          <ChapterMarkdown key={`prose-${i}`} content={part} locale={locale} headingScale="document" />
        ) : null,
      )}
    </div>
  );
}

/** Locale-aware, and deliberately not `toLocaleDateString()`'s default — a bare ISO string reads as a machine artifact. */
function formatDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
