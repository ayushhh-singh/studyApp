/**
 * F10 Voice Mode's central visual — a calm, breathing presence that reflects
 * the turn's current phase (the same "the motion IS the state" spirit as F6's
 * BreathingCircle, not a literal scrolling waveform). Four visually DISTINCT
 * phases so the person always knows whose turn it is:
 *
 *   idle      — a slow resting breath; the mic invites a tap/hold.
 *   listening — YOUR turn: the orb swells live with the mic level (amplitude
 *               visualisation) over soft outward ripples; the mic stays lit.
 *   thinking  — SAATHI's turn: a calm shimmer sweeps the ring while three dots
 *               breathe in the core ("gathering words").
 *   speaking  — SAATHI's turn: a warm rhythmic swell with a gentle equaliser
 *               in the core, clearly different from the amplitude jitter of
 *               listening.
 *
 * The mic glyph shows for the two USER-driven phases (idle/listening) and gives
 * way to Saathi's own presence (dots / equaliser) for the two SAATHI-driven
 * phases — that swap is the clearest "calm listening vs Saathi is responding"
 * signal. All phase motion is CSS `animation` (theme/index.css), so the global
 * prefers-reduced-motion override calms it to a still orb automatically; the
 * halo/ring scale eases over 700ms so switching phases glides (S1 motion). The
 * listening amplitude is the one live, inline transform — essential feedback,
 * kept subtle and clamped so silence still reads as "alive" and a shout never
 * blows the orb out of its frame.
 */
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

export type VoiceOrbMode = "idle" | "listening" | "thinking" | "speaking";

export function VoiceOrb({ mode, level }: { mode: VoiceOrbMode; level: number }) {
  const listening = mode === "listening";
  const thinking = mode === "thinking";
  const speaking = mode === "speaking";
  const saathiTurn = thinking || speaking;

  // Amplitude visualisation (listening only): the halo swells with the live mic
  // level (0-1), clamped so a shout never overflows the frame and silence still
  // shows a little life.
  const amp = Math.min(1, Math.max(0, level));
  const haloScale = listening ? 1 + amp * 0.45 : 1;
  const ring1Scale = listening ? 1 + amp * 0.3 : 1;
  const coreScale = listening ? 1 + amp * 0.12 : 1;

  return (
    <div
      className="relative mx-auto flex aspect-square w-full max-w-64 items-center justify-center"
      aria-hidden
    >
      {/* Outer halo — a soft blurred glow. Breathes at idle, swells with the mic
          while listening, pulses warmly while Saathi speaks. */}
      <div
        className={cn(
          "absolute inset-[6%] rounded-full bg-secondary/25 blur-2xl transition-transform duration-700 ease-out",
          mode === "idle" && "sukoon-orb-breathe",
          speaking && "sukoon-orb-speak",
          thinking && "opacity-70",
        )}
        style={listening ? { transform: `scale(${haloScale})` } : undefined}
      />

      {/* Soft outer ring. */}
      <div
        className={cn(
          "absolute inset-[10%] rounded-full bg-secondary/10 transition-transform duration-700 ease-out",
          mode === "idle" && "sukoon-orb-breathe",
          speaking && "sukoon-orb-speak",
        )}
        style={listening ? { transform: `scale(${ring1Scale})` } : undefined}
      />

      {/* Listening ripples — two rings expanding outward, staggered, only while
          actively hearing you. */}
      {listening ? (
        <>
          <div className="sukoon-orb-ripple absolute inset-[22%] rounded-full border border-secondary/40" />
          <div
            className="sukoon-orb-ripple absolute inset-[22%] rounded-full border border-secondary/30"
            style={{ animationDelay: "1.3s" }}
          />
        </>
      ) : null}

      {/* Thinking shimmer — a calm teal sweep around the ring (a conic sheen
          masked to a thin ring), rotating slowly. */}
      {thinking ? (
        <div
          className="sukoon-orb-sweep absolute inset-[16%] rounded-full"
          style={{
            background: "conic-gradient(from 0deg, transparent 0deg, var(--secondary) 90deg, transparent 200deg)",
            opacity: 0.55,
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
          }}
        />
      ) : null}

      {/* Soft inner ring. */}
      <div className="absolute inset-[18%] rounded-full bg-secondary/15" />

      {/* Core disc — Saathi's presence. Mic for your turn; dots/equaliser for
          Saathi's. */}
      <div
        className={cn(
          "relative flex size-28 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-lg transition-transform duration-700 ease-out",
          mode === "idle" && "sukoon-orb-core",
        )}
        style={listening ? { transform: `scale(${coreScale})` } : undefined}
      >
        {saathiTurn ? (
          thinking ? (
            <div className="flex items-end gap-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="sukoon-think-dot size-2.5 rounded-full bg-secondary-foreground"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="sukoon-orb-eq h-8 w-1.5 rounded-full bg-secondary-foreground"
                  style={{ animationDelay: `${i * 0.16}s` }}
                />
              ))}
            </div>
          )
        ) : (
          <Mic className="size-10" aria-hidden />
        )}
      </div>
    </div>
  );
}
