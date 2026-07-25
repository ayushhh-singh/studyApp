import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "@/hooks/use-locale";
import { PageHeader } from "@/components/ui-x/page-header";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { Footer, SUPPORT_EMAIL } from "@/components/marketing/footer";
import { PageSeo } from "@/components/seo/page-seo";

/**
 * Shared shell for the three legal pages (Terms, Privacy, Refund). Content lives
 * entirely in i18n (`<Policy>.intro`, `<Policy>.s{n}Title`, `<Policy>.s{n}Body`),
 * so both locales stay in the message files under the flat-key convention.
 *
 * A deliberately tiny renderer (paragraphs on blank lines, `- ` bullet blocks,
 * **bold**, and the support email → mailto) — NOT a Markdown library — so it can
 * never misread the bracketed `[PROPRIETOR NAME]` / `[CITY, STATE]` placeholders
 * in the copy as links/citations, and stays fully self-contained.
 */

/** Inline: split on **bold** and linkify the support email. Everything else is plain text. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split("**").map((chunk, i) => {
    const inner = linkifyEmail(chunk, `${keyBase}-${i}`);
    return i % 2 === 1 ? (
      <strong key={`${keyBase}-b-${i}`} className="font-semibold text-foreground">
        {inner}
      </strong>
    ) : (
      <Fragment key={`${keyBase}-t-${i}`}>{inner}</Fragment>
    );
  });
}

function linkifyEmail(text: string, keyBase: string): ReactNode {
  if (!text.includes(SUPPORT_EMAIL)) return text;
  const parts = text.split(SUPPORT_EMAIL);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) {
      out.push(
        <a
          key={`${keyBase}-e-${i}`}
          href={`mailto:${SUPPORT_EMAIL}`}
          className="font-medium text-primary hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>,
      );
    }
    out.push(<Fragment key={`${keyBase}-p-${i}`}>{part}</Fragment>);
  });
  return out;
}

/** Blocks separated by a blank line; a block of only `- ` lines becomes a bullet list. */
function PolicyBody({ text, idBase }: { text: string; idBase: string }) {
  const blocks = text.split("\n\n");
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim().length > 0);
        const isList = lines.length > 0 && lines.every((l) => l.trim().startsWith("- "));
        if (isList) {
          return (
            <ul key={bi} className="flex list-none flex-col gap-2">
              {lines.map((line, li) => (
                <li key={li} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                  <span className="mt-[0.5rem] size-1.5 shrink-0 rounded-full bg-primary/50" aria-hidden />
                  <span className="min-w-0">{renderInline(line.trim().slice(2), `${idBase}-${bi}-${li}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="text-sm leading-relaxed text-muted-foreground">
            {renderInline(block, `${idBase}-${bi}`)}
          </p>
        );
      })}
    </div>
  );
}

export function PolicyPage({
  policy,
  path,
  sectionCount,
}: {
  /** i18n key prefix — "Terms" | "Privacy" | "Refund". */
  policy: string;
  /** Path without the locale prefix, e.g. "/terms". */
  path: string;
  sectionCount: number;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const sections = Array.from({ length: sectionCount }, (_, i) => i + 1);

  return (
    <div className="min-h-svh bg-background">
      <PageSeo locale={locale} path={path} title={t(`${policy}.metaTitle`)} description={t(`${policy}.subtitle`)} />

      <MarketingHeader maxWidthClass="max-w-3xl" />

      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 pb-16 sm:px-6">
        <div className="flex flex-col gap-3">
          <PageHeader title={t(`${policy}.title`)} description={t(`${policy}.subtitle`)} />
          <p className="text-xs font-medium text-muted-foreground">{t(`${policy}.updatedLabel`)}</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <PolicyBody text={t(`${policy}.intro`)} idBase={`${policy}-intro`} />
        </div>

        <div className="flex flex-col gap-8">
          {sections.map((n) => (
            <section key={n} className="flex flex-col gap-3">
              <h2 className="text-base font-bold tracking-tight text-foreground">
                {n}. {t(`${policy}.s${n}Title`)}
              </h2>
              <PolicyBody text={t(`${policy}.s${n}Body`)} idBase={`${policy}-s${n}`} />
            </section>
          ))}
        </div>
      </div>

      <Footer />
    </div>
  );
}
