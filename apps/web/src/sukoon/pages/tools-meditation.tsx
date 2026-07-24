/**
 * F6 guided meditation player: a custom audio player (Media Session API,
 * background-play capable) over a signed/pinned audio stream. Degrades to an
 * honest "not uploaded yet" state when the operator hasn't recorded this
 * meditation's audio for the current language yet (see the 0084 seed note).
 */
import { useRef } from "react";
import { Link, useParams } from "react-router";
import { Headphones, WifiOff } from "lucide-react";
import type { SukoonExercise } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useExerciseSession } from "@/sukoon/lib/use-exercise-session";
import { useResolvedAudioSrc } from "@/sukoon/lib/use-resolved-audio-src";
import { ToolPlayerFrame } from "@/sukoon/components/tools/tool-player-frame";
import { AudioPlayer } from "@/sukoon/components/tools/audio-player";
import { PinAudioButton } from "@/sukoon/components/tools/pin-audio-button";

function MeditationPlayer({ exercise }: { exercise: Extract<SukoonExercise, { type: "meditation" }> }) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const title = language === "hi" ? exercise.title_hi : exercise.title_en;
  const hasAudio = language === "hi" ? exercise.has_audio_hi : exercise.has_audio_en;
  const session = useExerciseSession(exercise.id);
  const resolved = useResolvedAudioSrc(exercise.id, language, hasAudio);
  const startedRef = useRef(false);
  const handleFirstPlay = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    session.start();
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6" lang={language}>
      <PageHeader
        title={title}
        description={t(`Sukoon.tools.meditation.category.${exercise.config.category}`, {
          defaultValue: exercise.config.category,
        })}
        action={
          <Link to={`${base}/tools`} className="text-sm font-medium text-muted-foreground hover:text-foreground">
            {t("Sukoon.tools.backToTools")}
          </Link>
        }
      />

      {!hasAudio ? (
        <EmptyState
          icon={Headphones}
          title={t("Sukoon.tools.meditation.notUploadedTitle")}
          description={t("Sukoon.tools.meditation.notUploadedBody")}
        />
      ) : resolved.status === "offline-unavailable" ? (
        <EmptyState
          icon={WifiOff}
          title={t("Sukoon.tools.offlineUnavailableTitle")}
          description={t("Sukoon.tools.meditation.pinHint")}
        />
      ) : resolved.status === "error" ? (
        <EmptyState icon={Headphones} title={t("Sukoon.tools.loadErrorTitle")} description={t("Sukoon.tools.loadErrorBody")} />
      ) : resolved.status === "ready" ? (
        <div className="flex flex-col gap-3">
          <AudioPlayer
            src={resolved.src}
            title={title}
            onPlay={handleFirstPlay}
            onEnded={() => session.complete(exercise.config.duration_min * 60)}
          />
          <div className="flex justify-center">
            <PinAudioButton exerciseId={exercise.id} lang={language} label={title} signedUrl={resolved.signedUrl} />
          </div>
        </div>
      ) : (
        <Skeleton className="h-48 w-full rounded-2xl" />
      )}
    </div>
  );
}

export function Component() {
  return <ToolPlayerFrame type="meditation">{(exercise) => <MeditationPlayer exercise={exercise} />}</ToolPlayerFrame>;
}
