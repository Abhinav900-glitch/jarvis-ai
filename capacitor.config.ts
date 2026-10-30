import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android wrapper around the built site.
 *
 * Two ways to run it:
 *
 * 1. Bundled (default) — `bun run build` fills `dist/`, Capacitor copies it
 *    into the Android project, and the app works offline of any host. Convex
 *    and every provider still need the network, but the shell does not depend
 *    on a deployment URL.
 *
 * 2. Remote — set VITE_CAPACITOR_SERVER_URL to a deployed build and the
 *    WebView loads that instead of the bundled copy. Useful while iterating,
 *    since a fix ships by redeploying rather than rebuilding the APK.
 *
 * No secret is ever baked in here: every API key is read server-side in
 * Convex, so the bundle that ends up inside the APK contains only public
 * config.
 */
const remoteUrl = process.env.VITE_CAPACITOR_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.jarvis.ai",
  appName: "Jarvis",
  webDir: "dist",
  ...(remoteUrl ? { server: { url: remoteUrl } } : {}),
  android: {
    // Keep the WebView on https — the app talks to Convex over wss and a
    // mixed-content fallback would silently break it.
    allowMixedContent: false,
    // Let the keyboard drive the composer instead of resizing the WebView
    // around it.
    captureInput: true,
    // Off for shipped builds; turn on locally only when debugging the bridge.
    webContentsDebuggingEnabled: false,
  },
};

export default config;
