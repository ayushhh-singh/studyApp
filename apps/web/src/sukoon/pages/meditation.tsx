/**
 * Personalized guided meditation (extends F6) — the setup + player surface.
 *
 * After a Saathi conversation or a mood check-in (the two offer cards link here),
 * this screen offers a SHORT AI-generated guided meditation that gently addresses
 * what the person just shared. The user tunes it — focus, duration, voice, and
 * language — then a warm narration (TTS) plays over a real ambient bed (S2
 * soundscapes, layered client-side under the narration).
 *
 * The generation is a plain POST; while it works we show a calm "preparing…"
 * state (the value is the audio, so there's no token stream to render). An
 * identical, unchanged request replays a cached meditation instantly (free).
 */
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { HeartHandshake, Sparkles, Wind } from "lucide-react";
import {
  SUKOON_AMBIENT_SOUNDS,
  SUKOON_MEDITATION_DURATIONS_MIN,
  SUKOON_MEDITATION_FOCUSES,
  SUKOON_MEDITATION_VOICES,
  type SukoonAmbientId,
  type SukoonChatLanguage,
  type SukoonMeditation,
  type SukoonMeditationDuration,
  type SukoonMeditationFocus,
  type SukoonMeditationSource,
  type SukoonMeditationVoice,
} from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui-x/skeleton";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useTrackSukoonFeatureView } from "@/sukoon/lib/use-sukoon-analytics";
import { useAmbientChannel } from "@/sukoon/lib/use-ambient-channel";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { AudioPlayer } from "@/sukoon/components/tools/audio-player";
import {
  useGenerateMeditation,
  useMeditationContext,
  useMeditationUsage,
} from "@/sukoon/lib/use-sukoon-meditation";

/** A pill toggle (same shape as the tools-page FilterChip). */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "shrink-0 rounded-full border px-3.5 py-2 text-sm transition-colors duration-300 " +
        (active
          ? "border-secondary bg-secondary/15 text-secondary"
          : "border-border bg-card text-muted-foreground hover:border-secondary/40")
      }
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground/80">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

const LANGUAGES: SukoonChatLanguage[] = ["hi", "en", "hinglish"];
const AMBIENT_OPTIONS: (SukoonAmbientId | null)[] = [null, ...SUKOON_AMBIENT_SOUNDS.map((s) => s.id)];

/** The calm player: narration audio + an ambient bed faded in under it. */
function MeditationPlayer({
  meditation,
  onNew,
}: {
  meditation: SukoonMeditation;
  onNew: () => void;
}) {
  const { t, language: uiLang } = useSukoonLanguage();
  const [narrationPlaying, setNarrationPlaying] = useState(false);
  const [done, setDone] = useState(false);

  // Ambient bed plays quietly UNDER the narration — only while it's playing, so
  // pausing the meditation pauses the whole soundscape. 0.28 keeps the voice clear.
  useAmbientChannel(
    meditation.ambient ?? "rain",
    narrationPlaying && meditation.ambient != null,
    0.28,
  );

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6" lang={uiLang}>
      <PageHeader title={t("Sukoon.meditate.playerTitle")} description={t(`Sukoon.meditate.focus.${meditation.focus}`)} />

      {meditation.from_cache ? (
        <p className="text-center text-xs text-muted-foreground">{t("Sukoon.meditate.replayNote")}</p>
      ) : null}

      {meditation.audio_url ? (
        <AudioPlayer
          src={meditation.audio_url}
          title={t("Sukoon.meditate.playerTitle")}
          onPlayingChange={setNarrationPlaying}
          onEnded={() => setDone(true)}
        />
      ) : (
        // TTS render failed — the narration audio isn't available, but the person
        // can still read the script and (optionally) sit with the ambient bed.
        <p className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-3 text-center text-sm text-muted-foreground">
          {t("Sukoon.meditate.audioUnavailable")}
        </p>
      )}

      {/* The script, as a gentle read-along transcript. */}
      <details className="rounded-2xl border border-border bg-card p-4">
        <summary className="cursor-pointer select-none text-sm font-medium text-foreground/80">
          {t("Sukoon.meditate.showScript")}
        </summary>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-8 text-foreground/90" lang={meditation.language === "en" ? "en" : "hi"}>
          {meditation.script}
        </p>
      </details>

      {done ? (
        <div className="sukoon-rise flex flex-col items-center gap-3 rounded-2xl border border-secondary/30 bg-secondary/10 px-4 py-5 text-center">
          <HeartHandshake className="size-6 text-secondary" aria-hidden />
          <p className="text-sm text-foreground/80">{t("Sukoon.meditate.completeNote")}</p>
        </div>
      ) : null}

      <div className="flex justify-center">
        <Button type="button" variant="ghost" onClick={onNew}>
          {t("Sukoon.meditate.another")}
        </Button>
      </div>
    </div>
  );
}

export function Component() {
  const { t, language: uiLang } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  useTrackSukoonFeatureView("tools");
  const [searchParams] = useSearchParams();

  const ctxQuery = useMeditationContext({ enabled: !!session });
  const usageQuery = useMeditationUsage({ enabled: !!session });
  const generate = useGenerateMeditation();

  // Controls — seeded from the inferred context once it loads.
  const [focus, setFocus] = useState<SukoonMeditationFocus | null>(null);
  const [durationMin, setDurationMin] = useState<SukoonMeditationDuration>(5);
  const [scriptLang, setScriptLang] = useState<SukoonChatLanguage | null>(null);
  const [voice, setVoice] = useState<SukoonMeditationVoice>("warm");
  const [ambient, setAmbient] = useState<SukoonAmbientId | null>("rain");
  const [meditation, setMeditation] = useState<SukoonMeditation | null>(null);

  // The source: the offer card's explicit hint wins, else the inferred one.
  const sourceParam = searchParams.get("source");
  const inferred = ctxQuery.data;
  const source: SukoonMeditationSource =
    sourceParam === "chat" || sourceParam === "mood" || sourceParam === "manual"
      ? sourceParam
      : inferred?.source ?? "manual";

  // Controls default to the inferred suggestion / UI language until the user
  // taps a chip (which sets the explicit state and takes over) — no seeding
  // during render needed, the derivation reflects the suggestion for free.
  const effectiveFocus = focus ?? inferred?.suggested_focus ?? "unwind";
  const effectiveLang = scriptLang ?? uiLang;

  const themeLabel = useMemo(() => {
    if (!inferred) return null;
    return uiLang === "hi" ? inferred.theme_label_hi : inferred.theme_label_en;
  }, [inferred, uiLang]);

  const paywall = generate.error instanceof ApiError && generate.error.status === 402;
  const usage = usageQuery.data;
  const outOfCredits = usage != null && usage.remaining <= 0;

  const runGenerate = () => {
    generate.mutate(
      {
        source,
        conversation_id: source === "chat" ? inferred?.conversation_id ?? null : null,
        focus: effectiveFocus,
        duration_min: durationMin,
        language: effectiveLang,
        voice,
        ambient,
      },
      { onSuccess: (data) => setMeditation(data.meditation) },
    );
  };

  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  // Player view.
  if (meditation) {
    return (
      <MeditationPlayer
        meditation={meditation}
        onNew={() => {
          setMeditation(null);
          generate.reset();
        }}
      />
    );
  }

  // Generating view — a calm "preparing" moment (no token stream to show).
  if (generate.isPending) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-6 py-16 text-center" lang={uiLang}>
        <div className="sukoon-glow-breathe flex size-24 items-center justify-center rounded-full bg-secondary/15">
          <Sparkles className="size-9 text-secondary" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-medium text-foreground">{t("Sukoon.meditate.preparingTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("Sukoon.meditate.preparingBody")}</p>
        </div>
        <Skeleton className="h-2 w-40 rounded-full" />
      </div>
    );
  }

  // Setup view.
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6" lang={uiLang}>
      <PageHeader title={t("Sukoon.meditate.setupTitle")} description={t("Sukoon.meditate.setupSub")} />

      {themeLabel ? (
        <p className="rounded-2xl border border-secondary/25 bg-secondary/10 px-4 py-3 text-sm text-foreground/80">
          {t("Sukoon.meditate.themePrefix")} <span className="font-medium text-secondary">{themeLabel}</span>
        </p>
      ) : null}

      {ctxQuery.isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : (
        <div className="flex flex-col gap-5">
          <Field label={t("Sukoon.meditate.focusLabel")}>
            {SUKOON_MEDITATION_FOCUSES.map((f) => (
              <Chip key={f} active={effectiveFocus === f} onClick={() => setFocus(f)}>
                {t(`Sukoon.meditate.focus.${f}`)}
              </Chip>
            ))}
          </Field>

          <Field label={t("Sukoon.meditate.durationLabel")}>
            {SUKOON_MEDITATION_DURATIONS_MIN.map((d) => (
              <Chip key={d} active={durationMin === d} onClick={() => setDurationMin(d)}>
                {t("Sukoon.meditate.minutes", { n: d })}
              </Chip>
            ))}
          </Field>

          <Field label={t("Sukoon.meditate.voiceLabel")}>
            {SUKOON_MEDITATION_VOICES.map((v) => (
              <Chip key={v} active={voice === v} onClick={() => setVoice(v)}>
                {t(`Sukoon.meditate.voice.${v}`)}
              </Chip>
            ))}
          </Field>

          <Field label={t("Sukoon.meditate.languageLabel")}>
            {LANGUAGES.map((l) => (
              <Chip key={l} active={effectiveLang === l} onClick={() => setScriptLang(l)}>
                {t(`Sukoon.meditate.language.${l}`)}
              </Chip>
            ))}
          </Field>

          <Field label={t("Sukoon.meditate.ambientLabel")}>
            {AMBIENT_OPTIONS.map((a) => (
              <Chip key={a ?? "none"} active={ambient === a} onClick={() => setAmbient(a)}>
                {a === null
                  ? t("Sukoon.meditate.ambient.none")
                  : uiLang === "hi"
                    ? SUKOON_AMBIENT_SOUNDS.find((s) => s.id === a)?.label_hi
                    : SUKOON_AMBIENT_SOUNDS.find((s) => s.id === a)?.label_en}
              </Chip>
            ))}
          </Field>
        </div>
      )}

      {paywall || outOfCredits ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-4 text-center text-sm">
          <p className="text-foreground/80">{t("Sukoon.meditate.capReached")}</p>
          <Link to={`${base}/pricing`} className="mt-2 inline-block font-medium text-secondary hover:underline">
            {t("Sukoon.meditate.seePlans")}
          </Link>
        </div>
      ) : generate.isError ? (
        <p className="text-center text-sm text-destructive">{t("Sukoon.meditate.genError")}</p>
      ) : null}

      <div className="flex flex-col items-center gap-2">
        <Button type="button" size="lg" className="w-full" onClick={runGenerate} disabled={outOfCredits}>
          <Wind className="size-4" aria-hidden />
          {t("Sukoon.meditate.prepare")}
        </Button>
        {usage ? (
          <p className="text-xs text-muted-foreground">
            {usage.scope === "lifetime"
              ? t("Sukoon.meditate.creditsLifetime", { n: usage.remaining })
              : t("Sukoon.meditate.creditsDaily", { n: usage.remaining })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
