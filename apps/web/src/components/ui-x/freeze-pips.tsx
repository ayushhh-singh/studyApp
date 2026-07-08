import { useTranslation } from "react-i18next";
import { Snowflake } from "lucide-react";

/** Banked streak freezes as snowflake pips (max 2), with a live count for a11y. */
export function FreezePips({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex h-9 items-center gap-1 rounded-full border border-transparent bg-primary/10 px-2.5 text-primary"
      title={t("Dashboard.freezesBanked", { count })}
      aria-label={t("Dashboard.freezesBanked", { count })}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Snowflake key={i} className="size-4" aria-hidden />
      ))}
    </span>
  );
}
