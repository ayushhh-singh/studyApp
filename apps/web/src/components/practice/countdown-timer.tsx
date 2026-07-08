import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Countdown derived from the server-authoritative attempt.started_at + test duration — never a client-side clock. */
export function CountdownTimer({
  deadline,
  onExpire,
  size = "sm",
}: {
  deadline: number;
  onExpire: () => void;
  /** "lg" is the Time Attack "big timer". */
  size?: "sm" | "lg";
}) {
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remainingMs = deadline - now;
  const expired = remainingMs <= 0;

  useEffect(() => {
    if (expired && !firedRef.current) {
      firedRef.current = true;
      onExpire();
    }
  }, [expired, onExpire]);

  const low = remainingMs <= 5 * 60 * 1000;

  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full font-semibold tabular-nums",
        size === "lg" ? "px-4 py-1.5 text-2xl font-display" : "px-3 py-1 text-sm",
        low ? "bg-coral/15 text-coral-foreground" : "bg-muted text-foreground",
      )}
    >
      <Clock className={size === "lg" ? "size-5" : "size-4"} aria-hidden />
      {formatClock(remainingMs / 1000)}
    </span>
  );
}
