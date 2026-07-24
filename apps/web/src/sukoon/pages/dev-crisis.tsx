import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { crisisSurface, type SukoonCrisisLevel } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useCrisisAssess } from "@/sukoon/lib/use-crisis-assess";
import { CrisisTakeover } from "@/sukoon/components/crisis-takeover";
import { CrisisInlineCard } from "@/sukoon/components/crisis-inline-card";
import { NotTherapyFooter } from "@/sukoon/components/not-therapy-footer";

/** Level → badge classes (calm scale; critical/high lean on destructive). */
const LEVEL_BADGE: Record<SukoonCrisisLevel, string> = {
  none: "bg-muted text-muted-foreground",
  low: "bg-secondary text-secondary-foreground",
  moderate: "bg-primary/15 text-primary",
  high: "bg-destructive/15 text-destructive",
  critical: "bg-destructive text-white",
};

/**
 * Hidden dev-only page (blueprint F3): type text, see the crisis engine's live
 * verdict, and preview the escalation UI. Routed at /sukoon/dev/crisis and gated
 * by import.meta.env.DEV in routes.tsx; the backend endpoint is likewise gated.
 */
export function Component() {
  const { t, language } = useSukoonLanguage();
  const assess = useCrisisAssess();
  const [text, setText] = useState("");
  const [takeoverOpen, setTakeoverOpen] = useState(false);

  const result = assess.data;
  const surface = result ? crisisSurface(result.level) : "none";

  function run() {
    const trimmed = text.trim();
    if (trimmed) assess.mutate(trimmed);
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-xl flex-col gap-6 px-5 py-8" lang={language}>
      <div className="flex items-center gap-3">
        <Link
          to="../.."
          relative="path"
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
          aria-label={t("Sukoon.navHome")}
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-5 text-primary" aria-hidden />
          <h1 className="text-lg font-semibold text-foreground">{t("Sukoon.crisis.devTitle")}</h1>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("Sukoon.crisis.devSub")}</p>

      <div className="flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
          }}
          rows={4}
          placeholder={t("Sukoon.crisis.devPlaceholder")}
          className="w-full resize-y rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button onClick={run} disabled={!text.trim() || assess.isPending} className="self-start">
          {assess.isPending ? t("Sukoon.crisis.devAssessing") : t("Sukoon.crisis.devAssess")}
        </Button>
      </div>

      {assess.isError && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("Sukoon.crisis.devError")}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold uppercase tracking-wide",
                LEVEL_BADGE[result.level],
              )}
            >
              {result.level}
            </span>
            {result.rate_limited && (
              <span className="inline-flex items-center rounded-full bg-destructive/15 px-3 py-1 text-xs font-medium text-destructive">
                {t("Sukoon.crisis.devRateLimited")}
              </span>
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("Sukoon.crisis.devLayer")}</dt>
            <dd className="font-medium text-foreground">{result.layer}</dd>
            <dt className="text-muted-foreground">{t("Sukoon.crisis.devSurface")}</dt>
            <dd className="font-medium text-foreground">{surface}</dd>
            <dt className="text-muted-foreground">{t("Sukoon.crisis.devReason")}</dt>
            <dd className="font-mono text-xs text-foreground">{result.reason}</dd>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setTakeoverOpen(true)}>
              {t("Sukoon.crisis.devPreviewTakeover")}
            </Button>
          </div>

          {surface === "inline" && <CrisisInlineCard />}
        </div>
      )}

      <div className="mt-auto">
        <NotTherapyFooter />
      </div>

      <CrisisTakeover open={takeoverOpen} onAcknowledge={() => setTakeoverOpen(false)} />
    </div>
  );
}
