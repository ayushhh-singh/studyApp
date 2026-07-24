import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Captions,
  Loader2,
  Mic,
  MicOff,
  Square,
  Volume2,
  VolumeX,
  WifiOff,
  Sparkles,
  Hand,
  Hourglass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { ApiError } from "@/lib/api";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonProfile } from "@/sukoon/lib/use-sukoon-profile";
import { useSukoonOnline } from "@/sukoon/lib/use-sukoon-online";
import { useAmbientChannel } from "@/sukoon/lib/use-ambient-channel";
import { useVoiceRecorder, type RecorderPermission, type VoiceRecordingResult } from "@/sukoon/lib/use-voice-recorder";
import { useVoiceTurn, useVoiceUsage } from "@/sukoon/lib/use-sukoon-voice";
import { VoiceOrb, type VoiceOrbMode } from "@/sukoon/components/voice/voice-orb";
import { VoiceMeterRing } from "@/sukoon/components/voice/voice-meter-ring";
import { NotTherapyFooter } from "@/sukoon/components/not-therapy-footer";
import { CrisisInlineCard } from "@/sukoon/components/crisis-inline-card";
import { CrisisTakeover } from "@/sukoon/components/crisis-takeover";

type TurnPhase = "idle" | "recording" | "processing" | "result" | "error";
type InteractionMode = "hold" | "tap";

/** Feature-detect once — no getUserMedia/MediaRecorder means voice mode simply
 *  cannot work on this device/browser/context (e.g. non-HTTPS). */
function deviceSupportsRecording(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export function Component() {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const online = useSukoonOnline();
  const base = locale ? `/${locale}/sukoon` : "";

  const profileQuery = useSukoonProfile({ enabled: !!session });
  const profile = profileQuery.data?.profile ?? null;
  const usageQuery = useVoiceUsage({ enabled: !!session });
  const usage = usageQuery.data;

  const [phase, setPhase] = useState<TurnPhase>("idle");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<string | null>(null);
  const [crisisSurface, setCrisisSurfaceState] = useState<"inline" | "takeover" | null>(null);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorFeature, setErrorFeature] = useState<string | undefined>(undefined);
  const [showCaptions, setShowCaptions] = useState(true);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("hold");
  const [ambientOn, setAmbientOn] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [slowNetwork, setSlowNetwork] = useState(false);

  const conversationIdRef = useRef<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const deviceSupported = useMemo(deviceSupportsRecording, []);

  useAmbientChannel("rain", ambientOn, 0.22);

  const turnMutation = useVoiceTurn();

  const stopPlayback = useCallback(() => {
    audioElRef.current?.pause();
    audioElRef.current = null;
    setIsSpeaking(false);
  }, []);

  const playReply = useCallback((audioBase64: string, mimeType: string) => {
    const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
    audioElRef.current = audio;
    audio.onplay = () => setIsSpeaking(true);
    audio.onended = () => setIsSpeaking(false);
    audio.onerror = () => setIsSpeaking(false);
    void audio.play().catch(() => setIsSpeaking(false));
  }, []);

  const resetTurnState = useCallback(() => {
    setTranscript(null);
    setReplyText(null);
    setCrisisSurfaceState(null);
    setErrorMessage(null);
    setErrorFeature(undefined);
    setPhase("idle");
  }, []);

  const handleRecordingComplete = useCallback(
    (result: VoiceRecordingResult) => {
      setPhase("processing");
      setErrorMessage(null);
      setErrorFeature(undefined);
      turnMutation.mutate(
        {
          conversationId: conversationIdRef.current,
          blob: result.blob,
          mimeType: result.mimeType,
          durationSeconds: result.durationSeconds,
        },
        {
          onSuccess: (data) => {
            conversationIdRef.current = data.conversation_id ?? conversationIdRef.current;
            setTranscript(data.user_transcript);
            setReplyText(data.assistant_text);
            setCrisisSurfaceState(data.crisis?.surface ?? null);
            setPhase("result");
            if (data.crisis?.surface === "takeover") {
              setTakeoverOpen(true);
            } else if (data.assistant_audio_base64 && data.assistant_audio_mime) {
              playReply(data.assistant_audio_base64, data.assistant_audio_mime);
            }
          },
          onError: (err) => {
            setPhase("error");
            if (err instanceof ApiError) {
              setErrorMessage(err.message);
              setErrorFeature(err.feature);
            } else {
              setErrorMessage(t("Sukoon.voice.errorGeneric"));
            }
          },
        },
      );
    },
    [turnMutation, playReply, t],
  );

  const recorder = useVoiceRecorder(handleRecordingComplete);

  // A crisis takeover or an in-flight recording must never be left stranded if
  // the user navigates away — the recorder's own unmount cleanup handles the
  // mic/stream, this just stops any reply audio still playing.
  useEffect(() => stopPlayback, [stopPlayback]);

  // Slow-network affordance: a voice turn is 3 real round trips (STT + a model
  // call + TTS) — on a bad connection "processing" can legitimately take a
  // while. Rather than leave the orb spinning with no explanation, switch the
  // status copy after a few seconds so it reads as "still working" rather
  // than "stuck".
  useEffect(() => {
    if (phase !== "processing") {
      setSlowNetwork(false);
      return;
    }
    const timer = setTimeout(() => setSlowNetwork(true), 6000);
    return () => clearTimeout(timer);
  }, [phase]);

  const restricted = profile?.restricted_mode ?? false;
  const canUseVoice = !!session && !restricted;

  const busy = phase === "processing" || isSpeaking;

  const handlePress = useCallback(() => {
    if (interactionMode !== "hold" || busy || recorder.state !== "idle") return;
    resetTurnState();
    void recorder.start();
  }, [interactionMode, busy, recorder, resetTurnState]);

  const handleRelease = useCallback(() => {
    if (interactionMode !== "hold" || recorder.state !== "recording") return;
    recorder.stop();
  }, [interactionMode, recorder]);

  const handleTap = useCallback(() => {
    if (interactionMode !== "tap" || busy) return;
    if (recorder.state === "idle") {
      resetTurnState();
      void recorder.start();
    } else if (recorder.state === "recording") {
      recorder.stop();
    }
  }, [interactionMode, busy, recorder, resetTurnState]);

  // ---- Non-happy-path gates -------------------------------------------------

  if (authLoading) return null;
  if (!session) {
    const redirect = encodeURIComponent(
      typeof window !== "undefined" ? window.location.pathname + window.location.search : "",
    );
    return (
      <VoiceScreenShell base={base} title={t("Sukoon.voice.title")}>
        <EmptyMessage
          icon={Sparkles}
          title={t("Sukoon.onboarding.signInTitle")}
          body={t("Sukoon.onboarding.signInSub")}
          action={
            locale ? (
              <Button asChild>
                <Link to={`/${locale}/auth?redirect=${redirect}`}>{t("Sukoon.onboarding.signInCta")}</Link>
              </Button>
            ) : null
          }
        />
      </VoiceScreenShell>
    );
  }
  if (restricted) {
    return (
      <VoiceScreenShell base={base} title={t("Sukoon.voice.title")}>
        <EmptyMessage
          icon={MicOff}
          title={t("Sukoon.saathi.restrictedTitle")}
          body={t("Sukoon.saathi.restrictedBody")}
          action={
            <Button asChild variant="secondary">
              <Link to={`${base}/tools`}>{t("Sukoon.saathi.restrictedTools")}</Link>
            </Button>
          }
        />
      </VoiceScreenShell>
    );
  }
  if (usageQuery.isLoading || profileQuery.isLoading) {
    return (
      <VoiceScreenShell base={base} title={t("Sukoon.voice.title")}>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label={t("Sukoon.saathi.loading")} />
        </div>
      </VoiceScreenShell>
    );
  }
  if (usage && !usage.eligible) {
    return (
      <VoiceScreenShell base={base} title={t("Sukoon.voice.title")}>
        <EmptyMessage
          icon={Sparkles}
          title={t("Sukoon.voice.lockedTitle")}
          body={t("Sukoon.voice.lockedBody")}
          action={
            <Button onClick={() => navigate(`${base}/pricing`)}>{t("Sukoon.voice.seePlans")}</Button>
          }
        />
      </VoiceScreenShell>
    );
  }
  if (!deviceSupported) {
    return (
      <VoiceScreenShell base={base} title={t("Sukoon.voice.title")}>
        <EmptyMessage icon={MicOff} title={t("Sukoon.voice.unsupportedTitle")} body={t("Sukoon.voice.unsupportedBody")} />
      </VoiceScreenShell>
    );
  }
  if (!canUseVoice || !usage) return null;

  // ---- The real voice screen -------------------------------------------------

  const orbMode: VoiceOrbMode =
    recorder.state === "recording" ? "listening" : phase === "processing" ? "thinking" : isSpeaking ? "speaking" : "idle";

  const permissionBlocked: RecorderPermission | null =
    recorder.permission === "denied" || recorder.permission === "unsupported" ? recorder.permission : null;

  const capReached = errorFeature === "sukoon_voice_cap";

  return (
    <VoiceScreenShell
      base={base}
      title={t("Sukoon.voice.title")}
      meter={
        <VoiceMeterRing
          remainingSeconds={usage.remaining_seconds}
          limitSeconds={usage.limit_seconds}
          warning={usage.warning}
          label={t("Sukoon.voice.minutesLeft", { count: Math.ceil(usage.remaining_seconds / 60) })}
        />
      }
    >
      <div className="flex flex-1 flex-col items-center justify-between gap-6 py-2" lang={language}>
        {!online ? (
          <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <WifiOff className="size-3.5" aria-hidden />
            {t("Sukoon.voice.offlineNotice")}
          </div>
        ) : null}

        <div className="flex w-full flex-1 flex-col items-center justify-center gap-6">
          <VoiceOrb mode={orbMode} level={recorder.level} />

          <div className="flex min-h-8 flex-col items-center gap-1 text-center text-sm font-medium text-muted-foreground">
            <span>
              {recorder.state === "recording"
                ? t("Sukoon.voice.statusListening")
                : phase === "processing"
                  ? t("Sukoon.voice.statusThinking")
                  : isSpeaking
                    ? t("Sukoon.voice.statusSpeaking")
                    : phase === "idle" && !transcript
                      ? t("Sukoon.voice.statusIdle")
                      : null}
            </span>
            {phase === "processing" && slowNetwork ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
                <Hourglass className="size-3" aria-hidden />
                {t("Sukoon.voice.statusSlow")}
              </span>
            ) : null}
          </div>

          {isSpeaking ? (
            <button
              type="button"
              onClick={stopPlayback}
              className="text-xs font-medium text-secondary underline-offset-2 hover:underline"
            >
              {t("Sukoon.voice.stopSpeaking")}
            </button>
          ) : null}
        </div>

        {/* Captions: both transcripts from the most recent turn. */}
        {showCaptions && (transcript || errorMessage) ? (
          <div className="flex w-full max-w-md flex-col gap-3">
            {crisisSurface === "inline" ? <CrisisInlineCard /> : null}
            {transcript ? (
              <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm leading-relaxed">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("Sukoon.voice.youSaid")}
                </p>
                <p className="mt-1 text-foreground">{transcript}</p>
              </div>
            ) : null}
            {replyText ? (
              <div className="rounded-2xl border border-secondary/30 bg-secondary/5 px-4 py-3 text-sm leading-relaxed">
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary">{t("Sukoon.brand")}</p>
                <p className="mt-1 text-foreground">{replyText}</p>
              </div>
            ) : null}
            {errorMessage ? (
              <div
                role="alert"
                className={cn(
                  "rounded-2xl border px-4 py-3 text-sm leading-relaxed",
                  capReached
                    ? "border-border bg-muted text-muted-foreground"
                    : "border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                <p>{errorMessage}</p>
                {capReached ? (
                  <Link to={`${base}/saathi`} className="mt-2 inline-block text-xs font-medium text-secondary underline-offset-2 hover:underline">
                    {t("Sukoon.voice.useTypedChat")}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Controls */}
        <div className="flex w-full flex-col items-center gap-4">
          {permissionBlocked ? (
            <p className="max-w-xs text-center text-xs leading-relaxed text-muted-foreground">
              {permissionBlocked === "denied" ? t("Sukoon.voice.permissionDenied") : t("Sukoon.voice.unsupportedBody")}
            </p>
          ) : null}

          <button
            type="button"
            aria-pressed={recorder.state === "recording"}
            aria-label={recorder.state === "recording" ? t("Sukoon.voice.releaseToSend") : t("Sukoon.voice.holdToTalk")}
            disabled={busy || !!permissionBlocked || !online}
            onPointerDown={handlePress}
            onPointerUp={handleRelease}
            onPointerLeave={handleRelease}
            onContextMenu={(e) => e.preventDefault()}
            onClick={handleTap}
            className={cn(
              "flex size-16 touch-none select-none items-center justify-center rounded-full shadow-lg transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              recorder.state === "recording"
                ? "bg-destructive text-white"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/90",
            )}
          >
            {recorder.state === "recording" ? (
              <Square className="size-6" aria-hidden />
            ) : phase === "processing" ? (
              <Loader2 className="size-6 animate-spin" aria-hidden />
            ) : (
              <Mic className="size-6" aria-hidden />
            )}
          </button>

          <p className="text-xs text-muted-foreground">
            {interactionMode === "hold" ? t("Sukoon.voice.holdHint") : t("Sukoon.voice.tapHint")}
          </p>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setInteractionMode((m) => (m === "hold" ? "tap" : "hold"))}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Hand className="size-3.5" aria-hidden />
              {interactionMode === "hold" ? t("Sukoon.voice.switchToTap") : t("Sukoon.voice.switchToHold")}
            </button>
            <button
              type="button"
              onClick={() => setShowCaptions((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Captions className="size-3.5" aria-hidden />
              {showCaptions ? t("Sukoon.voice.hideCaptions") : t("Sukoon.voice.showCaptions")}
            </button>
            <button
              type="button"
              onClick={() => setAmbientOn((v) => !v)}
              aria-pressed={ambientOn}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {ambientOn ? <Volume2 className="size-3.5" aria-hidden /> : <VolumeX className="size-3.5" aria-hidden />}
              {t("Sukoon.voice.ambient")}
            </button>
          </div>
        </div>

        <NotTherapyFooter />
      </div>

      <CrisisTakeover
        open={takeoverOpen}
        onAcknowledge={() => {
          setTakeoverOpen(false);
          resetTurnState();
        }}
      />
    </VoiceScreenShell>
  );
}

function VoiceScreenShell({
  base,
  title,
  meter,
  children,
}: {
  base: string;
  title: string;
  meter?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useSukoonLanguage();
  return (
    <div className="mx-auto flex min-h-svh max-w-xl flex-col gap-5 px-5 py-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={`${base}/saathi`}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
            aria-label={t("Sukoon.navSaathi")}
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        </div>
        {meter}
      </div>
      {children}
    </div>
  );
}

function EmptyMessage({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Sparkles;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-secondary/15 text-secondary" aria-hidden>
        <Icon className="size-7" />
      </span>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}
