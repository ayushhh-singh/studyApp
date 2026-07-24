import { useEffect, useState } from "react";

const NIGHT_START_HOUR = 21; // 9pm
const NIGHT_END_HOUR = 6; // 6am

function isNightNow(): boolean {
  const hour = new Date().getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/**
 * Sukoon's own dark-mode schedule (9pm–6am local device time), deliberately
 * independent of Neev's manual theme-store toggle — aspirants study late,
 * and this should switch automatically without the user having to think
 * about it, without also flipping Neev's global `.dark` class (which the
 * user may have set differently, or not at all). Consumed by shell.tsx to
 * add a `sukoon-dark` class alongside `.sukoon`, matched by theme/index.css.
 */
export function useSukoonNightMode(): boolean {
  const [isNight, setIsNight] = useState(isNightNow);

  useEffect(() => {
    const id = window.setInterval(() => setIsNight(isNightNow()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return isNight;
}
