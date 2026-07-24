/**
 * F10 Voice Mode's central visual — one calm circular orb that reflects the
 * turn's current phase (matches BreathingCircle's "the motion IS the state"
 * spirit from F6, not a literal audio waveform): idle invites a tap/hold,
 * listening pulses with the live mic level, thinking shows the "Saathi is
 * composing a reply" wait, speaking pulses gently while the reply plays.
 */
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

export type VoiceOrbMode = "idle" | "listening" | "thinking" | "speaking";

export function VoiceOrb({ mode, level }: { mode: VoiceOrbMode; level: number }) {
  // Listening: the ring scales directly with the live mic level (0-1), clamped
  // to a sensible visual range so silence still reads as "alive", not flat.
  const listenScale = 1 + Math.min(0.35, level * 0.35);

  return (
    <div className="relative mx-auto flex aspect-square w-full max-w-64 items-center justify-center">
      {/* Outer ambient ring — slow breathing pulse at idle, steady glow otherwise. */}
      <div
        className={cn(
          "absolute inset-0 rounded-full bg-secondary/10 transition-transform duration-300 ease-out",
          mode === "idle" && "animate-[pulse_4s_ease-in-out_infinite]",
          mode === "thinking" && "animate-pulse",
        )}
        style={mode === "listening" ? { transform: `scale(${listenScale})` } : undefined}
        aria-hidden
      />
      <div
        className={cn(
          "absolute inset-6 rounded-full bg-secondary/20 transition-transform duration-150 ease-out",
          mode === "speaking" && "animate-[pulse_1.1s_ease-in-out_infinite]",
        )}
        style={mode === "listening" ? { transform: `scale(${1 + Math.min(0.5, level * 0.5)})` } : undefined}
        aria-hidden
      />
      <div className="relative flex size-28 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-lg">
        <Mic className={cn("size-10", mode === "thinking" && "opacity-60")} aria-hidden />
      </div>
    </div>
  );
}
