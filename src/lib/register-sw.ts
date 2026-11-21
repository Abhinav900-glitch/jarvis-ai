// ---------------------------------------------------------------------------
// Offline app shell registration.
//
// Production only: in development the Vite dev server owns the assets and a
// cache-first worker would serve yesterday's module graph, which looks like
// HMR being broken. The worker itself lives in public/sw.js so it is served
// from the site root, where its scope covers the whole app.
// ---------------------------------------------------------------------------

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  // After load, so installing the shell never competes with the first paint.
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // A blocked worker (private mode, unsupported browser) must not break
      // the app; offline simply stays unavailable there.
    });
  });
}
