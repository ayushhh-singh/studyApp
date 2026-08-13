import { useTranslation } from "react-i18next";
import { PageSeo } from "@/components/seo/page-seo";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { Footer } from "@/components/marketing/footer";
import { ResourcesContent } from "@/components/resources/resources-content";
import { useCurrentExam } from "@/hooks/use-current-exam";
import { useLocale } from "@/hooks/use-locale";
import { useAuth } from "@/providers/auth-provider";

export const handle = { titleKey: "Resources.navTitle" };

/**
 * /:locale/resources — the PUBLIC resources page: marketing chrome, indexable,
 * and what a signed-out visitor sees.
 *
 * A signed-in user is sent to `/:locale/learn/resources` instead (same content,
 * inside app-shell) — see ResourcesContent's header for why. This route stays
 * reachable signed-in rather than redirecting, because it is a real public URL
 * that gets shared and indexed, and bouncing an authenticated visitor off a
 * link someone sent them would be worse than showing it in marketing chrome.
 */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { session } = useAuth();
  const { name: examName } = useCurrentExam();

  return (
    <div className="min-h-svh bg-background">
      <PageSeo
        locale={locale}
        path="/resources"
        title={`${t("Resources.seoTitle")} — ${t("Landing.brand")}`}
        description={t("Resources.seoDescription")}
      />
      <MarketingHeader maxWidthClass="max-w-5xl" />

      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 pb-16 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-heading text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
            {t("Resources.title")}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {/* Signed out there is no target exam — useCurrentExam falls back to
                the DEFAULT exam, so naming it told every visitor it was theirs.
                The public copy also drops the "chapters we have written for you"
                clause, since that section is signed-in only. */}
            {session ? t("Resources.description", { exam: examName }) : t("Resources.descriptionPublic")}
          </p>
        </div>

        <ResourcesContent />
      </div>

      <Footer />
    </div>
  );
}
