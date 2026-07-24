/**
 * F6 ambient mixer: rain / tanpura / night crickets / fan, each independently
 * loopable with its own volume slider. See use-ambient-channel.ts for the
 * real-audio-with-synthesized-fallback playback strategy.
 */
import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { SUKOON_AMBIENT_SOUNDS, type SukoonAmbientId } from "@neev/shared";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useAmbientChannel } from "@/sukoon/lib/use-ambient-channel";

type ChannelState = { on: boolean; volume: number };

function AmbientChannelRow({
  id,
  label,
  state,
  onToggle,
  onVolumeChange,
}: {
  id: SukoonAmbientId;
  label: string;
  state: ChannelState;
  onToggle: () => void;
  onVolumeChange: (v: number) => void;
}) {
  useAmbientChannel(id, state.on, state.volume);
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant={state.on ? "default" : "outline"}
        size="sm"
        onClick={onToggle}
        className="w-28 shrink-0 justify-start gap-2"
      >
        {state.on ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        {label}
      </Button>
      <Slider
        value={[Math.round(state.volume * 100)]}
        onValueChange={([v]) => onVolumeChange((v ?? 0) / 100)}
        max={100}
        step={1}
        disabled={!state.on}
        className={cn(!state.on && "opacity-40")}
        aria-label={label}
      />
    </div>
  );
}

/**
 * Uncontrolled mixer — each channel manages its own on/off + volume locally,
 * since nothing outside this component needs to know the mix (a breathing or
 * timer session just wants "ambient sound playing in the background", not the
 * specific per-channel state).
 */
export function AmbientMixer() {
  const { t, language } = useSukoonLanguage();
  const [channels, setChannels] = useState<Record<SukoonAmbientId, ChannelState>>({
    rain: { on: false, volume: 0.5 },
    tanpura: { on: false, volume: 0.5 },
    crickets: { on: false, volume: 0.4 },
    fan: { on: false, volume: 0.4 },
  });

  const anyOn = Object.values(channels).some((c) => c.on);

  return (
    <div className="flex flex-col gap-3" lang={language}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{t("Sukoon.tools.ambient.title")}</p>
        {anyOn ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setChannels((cur) =>
                Object.fromEntries(
                  Object.entries(cur).map(([id, c]) => [id, { ...c, on: false }]),
                ) as Record<SukoonAmbientId, ChannelState>,
              )
            }
          >
            {t("Sukoon.tools.ambient.stopAll")}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        {SUKOON_AMBIENT_SOUNDS.map((sound) => (
          <AmbientChannelRow
            key={sound.id}
            id={sound.id}
            label={language === "hi" ? sound.label_hi : sound.label_en}
            state={channels[sound.id]}
            onToggle={() =>
              setChannels((cur) => ({ ...cur, [sound.id]: { ...cur[sound.id], on: !cur[sound.id].on } }))
            }
            onVolumeChange={(v) => setChannels((cur) => ({ ...cur, [sound.id]: { ...cur[sound.id], volume: v } }))}
          />
        ))}
      </div>
    </div>
  );
}
