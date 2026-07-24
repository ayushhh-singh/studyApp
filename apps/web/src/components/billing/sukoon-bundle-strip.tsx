import { useState } from "react";
import { Link } from "react-router";
import { ChevronDown, HeartHandshake } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/hooks/use-locale";

/**
 * The "+ Add Sukoon" bundle strip on the Neev pricing page (F13 item 6). A calm,
 * collapsible teaser: any active paid Neev plan → 40% off Sukoon Plus/Pro. Neev
 * may reference Sukoon (allowed import direction); kept self-contained here (no
 * Sukoon-module import) since it's a public marketing surface that can't call
 * the authenticated Sukoon plans endpoint. The prices shown are the marketing
 * headline — the ACTUAL charge is always priced server-side from sukoon_plans
 * (with the discount applied there), so this can never over-promise a charge.
 */
const COPY = {
  toggle: { en: "＋ Add Sukoon — your wellness companion", hi: "＋ सुकून जोड़ें — आपका वेलनेस साथी" },
  intro: {
    en: "Sukoon is Neev's calm corner — an AI companion (Saathi), journaling, mood tracking and guided journeys for the pressure of preparation.",
    hi: "सुकून नींव का शांत कोना है — एक एआई साथी, जर्नलिंग, मूड ट्रैकिंग और तैयारी के दबाव के लिए गाइडेड जर्नी।",
  },
  bundle: {
    en: "On any Neev plan? Add Sukoon at 40% off — Plus for about ₹59/mo (normally ₹99), Pro for about ₹149/mo.",
    hi: "किसी भी नींव प्लान पर हैं? सुकून 40% छूट पर जोड़ें — प्लस लगभग ₹59/माह (सामान्यतः ₹99), प्रो लगभग ₹149/माह।",
  },
  cta: { en: "Explore Sukoon", hi: "सुकून देखें" },
  note: {
    en: "A wellness companion, not a substitute for professional care.",
    hi: "एक वेलनेस साथी, पेशेवर देखभाल का विकल्प नहीं।",
  },
};

export function SukoonBundleStrip() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const pick = (v: { en: string; hi: string }) => (locale === "hi" ? v.hi : v.en);

  return (
    <div className="mx-auto mt-10 w-full max-w-4xl px-4">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        >
          <span className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
            <HeartHandshake className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            {pick(COPY.toggle)}
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
        {open ? (
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
            <p className="text-sm leading-relaxed text-muted-foreground">{pick(COPY.intro)}</p>
            <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm font-medium text-foreground">
              {pick(COPY.bundle)}
            </p>
            <Link
              to={`/${locale}/sukoon`}
              className="inline-flex h-9 w-fit items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {pick(COPY.cta)}
            </Link>
            <p className="text-[11px] text-muted-foreground">{pick(COPY.note)}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
