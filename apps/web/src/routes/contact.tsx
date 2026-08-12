import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Mail, Flag, Copy, Check, Send } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { Footer, SUPPORT_EMAIL } from "@/components/marketing/footer";
import { PageSeo } from "@/components/seo/page-seo";

/**
 * Contact — docs/design/reference-1's CONTACT page: a lead column of contact
 * details beside a Name / Email / Subject / Message form.
 *
 * ⚑ The form composes a `mailto:` and hands off to the visitor's own mail app.
 * It does NOT post anywhere, because there is no contact endpoint: `apps/api`
 * has no mail sender, no inbox, and no spam handling, and standing one up is a
 * backend feature with an abuse surface, not a page restyle. A form that
 * silently dropped what someone typed would be worse than no form at all, so
 * the button says what it does, the raw address is always visible and
 * copyable next to it, and nothing is ever "sent" behind the user's back.
 *
 * The mockup's phone number and "Mon-Sat, 9 AM - 7 PM" hours are placeholders.
 * We have neither, so they are omitted rather than invented — publishing a
 * support line that doesn't answer is worse than not listing one.
 */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Signature line rather than a "From:" header — a mailto cannot set the
    // sender, and the address they typed is the one we'd need to reply to.
    const body = [message, "", "—", name, email].filter(Boolean).join("\n");
    const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is permission-gated and absent over plain http — the address
      // is already on screen as selectable text, so failing quietly is fine.
    }
  }

  const field =
    "flex w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-base shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <div className="min-h-svh bg-background">
      <PageSeo
        locale={locale}
        path="/contact"
        title={`${t("Contact.title")} — ${t("Landing.brand")}`}
        description={t("Contact.subtitle")}
      />

      <MarketingHeader maxWidthClass="max-w-5xl" />

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 pb-16 sm:px-6 sm:py-14 lg:grid-cols-2 lg:gap-12">
        <div>
          <h1 className="text-balance font-heading text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t("Contact.title")}
          </h1>
          <p className="mt-3 text-pretty text-base leading-relaxed text-muted-foreground">{t("Contact.subtitle")}</p>

          <ul className="mt-8 flex flex-col gap-5">
            <li className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Mail className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{t("Contact.emailTitle")}</h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="break-all text-sm text-primary hover:underline">
                    {SUPPORT_EMAIL}
                  </a>
                  <button
                    type="button"
                    onClick={copyEmail}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                    {copied ? t("Contact.copied") : t("Contact.copy")}
                  </button>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("Contact.emailBody")}</p>
              </div>
            </li>

            {/* Content issues have a better route than email, and the FAQ
                already tells people so — repeat it here rather than let a
                wrong-answer report sit in an inbox. */}
            <li className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-coral/15 text-coral-foreground">
                <Flag className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{t("Contact.reportTitle")}</h2>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{t("Contact.reportBody")}</p>
              </div>
            </li>
          </ul>

          <p className="mt-8 text-sm text-muted-foreground">
            {t("Contact.faqHint")}{" "}
            <Link to={`/${locale}/faq`} className="font-medium text-primary hover:underline">
              {t("Footer.faq")}
            </Link>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="contact-name" className="text-sm font-medium">
              {t("Contact.fieldName")}
            </label>
            <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="contact-email" className="text-sm font-medium">
              {t("Contact.fieldEmail")}
            </label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="contact-subject" className="text-sm font-medium">
              {t("Contact.fieldSubject")}
            </label>
            <Input id="contact-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="contact-message" className="text-sm font-medium">
              {t("Contact.fieldMessage")}
            </label>
            <textarea
              id="contact-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              required
              className={field}
            />
          </div>
          <Button type="submit" size="lg" className="mt-1 h-12 gap-2 text-base">
            <Send className="size-4.5" aria-hidden />
            {t("Contact.submit")}
          </Button>
          {/* Says plainly what the button does — this hands off to the mail
              app, it does not post to a server. */}
          <p className="text-xs leading-relaxed text-muted-foreground">{t("Contact.mailtoNote")}</p>
        </form>
      </div>

      <Footer />
    </div>
  );
}
