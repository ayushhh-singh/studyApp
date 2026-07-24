import { useEffect, useState } from "react";

/** `navigator.onLine` kept live via the online/offline window events — drives
 *  the F6 offline indicator and gates any signed-audio-URL fetch attempt. */
export function useSukoonOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
