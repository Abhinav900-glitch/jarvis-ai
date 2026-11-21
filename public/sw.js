// ---------------------------------------------------------------------------
// Jarvis app shell, offline.
//
// The assistant needs the server — this worker cannot make replies appear
// without a network. What it can do is make the *app* open: the HTML shell,
// hashed JS/CSS, the logo and the manifest are kept in a cache, so a browser
// with no connection still reaches the offline notice and any drafts stored on
// the device instead of a native "no internet" page.
//
// Only same-origin GETs are touched. The Convex client lives on another origin
// (and speaks WebSockets anyway), so live data keeps its own retry behaviour.
//
// Registered in production only — see src/lib/register-sw.ts — so Vite's dev
// server and HMR are never shadowed by a stale cache.
// ---------------------------------------------------------------------------

const CACHE = "jarvis-shell-v1";

// Fetched when the worker installs. Individually cached so one missing file
// cannot fail the whole install.
const SHELL = ["/", "/logo.svg", "/manifest.webmanifest"];

const STATIC_PREFIXES = ["/assets/", "/icons/", "/sounds/"];
const STATIC_FILES = new Set(["/logo.svg", "/manifest.webmanifest"]);

function isStatic(pathname) {
  if (STATIC_FILES.has(pathname)) return true;
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return /\.(?:css|js|mjs|woff2?|ttf|otf|png|jpe?g|webp|avif|svg|gif|mp3|wav|json)$/i.test(
    pathname,
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "reload" });
            if (response.ok) await cache.put(url, response);
          } catch {
            // First install may itself be offline; the fetch handler will
            // cache what it can once a connection exists.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheAndReturn(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    try {
      const cache = await caches.open(CACHE);
      await cache.put(request, copy);
    } catch {
      // Quota or opaque response: serving the network copy still works.
    }
  }
  return response;
}

function offlinePage() {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Jarvis is offline</title>
<style>
  html,body{height:100%;margin:0;background:#070b14;color:#e6f5ff;
    font:15px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
  main{height:100%;display:grid;place-content:center;text-align:center;padding:24px}
  h1{font-size:20px;font-weight:600;margin:0 0 8px}
  p{max-width:34ch;margin:0 auto;color:#8aa4b8}
  .dot{width:34px;height:34px;margin:0 auto 18px;border-radius:50%;
    border:2px solid #22c8ff;box-shadow:0 0 24px #22c8ff66}
</style></head><body><main><div class="dot"></div>
<h1>No connection</h1>
<p>The app shell wasn't cached yet. Open Jarvis once while online and it
will start offline from here.</p></main></body></html>`,
    {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, so a deployed build is picked up; the cached
  // shell is the fallback when the network is gone.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          await cacheAndReturn("/", response.clone());
          await cacheAndReturn(request, response.clone());
          return response;
        } catch {
          const cached =
            (await caches.match(request)) || (await caches.match("/"));
          return cached || offlinePage();
        }
      })(),
    );
    return;
  }

  if (!isStatic(url.pathname)) return;

  // Static assets: cache first (their names are content-hashed), network as
  // the filler on the first visit.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        return cacheAndReturn(request, response.clone());
      } catch {
        return new Response("", { status: 504 });
      }
    })(),
  );
});
