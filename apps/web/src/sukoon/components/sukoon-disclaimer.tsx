import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";

/**
 * The persistent "not a substitute" footer required on every Sukoon surface
 * (SUKOON_CONTEXT.md's hard safety rules — never "therapy"/"treatment"/etc.,
 * always this disclaimer). Rendered once per page from shell.tsx so every
 * current and future Sukoon page carries it without repeating the markup.
 */
export function SukoonDisclaimer() {
  const { t } = useSukoonLanguage();
  return (
    <p className="mt-10 rounded-xl border border-dashed border-border bg-card/50 px-4 py-3 text-center text-xs leading-relaxed text-muted-foreground">
      {t("Sukoon.disclaimer")}
    </p>
  );
}
