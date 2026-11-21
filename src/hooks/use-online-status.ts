// ---------------------------------------------------------------------------
// Network presence.
//
// `navigator.onLine` is the browser's own answer, not a probe: it says whether
// the machine has a network interface, which is exactly what the UI needs for
// "do not try to reach the server". It can be a little optimistic right after a
// laptop wakes, so the flag is re-read when the tab becomes visible as well as
// on the online/offline events.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };

    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return online;
}
