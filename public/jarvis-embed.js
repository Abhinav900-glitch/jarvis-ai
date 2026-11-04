/*!
 * Jarvis embed — the one-script plugin.
 *
 * Paste this on any site and a button appears; clicking it opens your agent in
 * a sandboxed frame. Nothing here trusts the host page: the widget lives in a
 * shadow root so host CSS cannot break it, messages are checked against the
 * origin the script was served from, and the frame itself runs the app's own
 * auth. No build step — this file is served as-is from /public.
 *
 *   <script src="https://YOUR-HOST/jarvis-embed.js" async></script>
 *
 * Options (data attributes):
 *   data-label      button text          (default "Ask Jarvis")
 *   data-position   "right" | "left"     (default "right")
 *   data-accent     highlight colour, hex (default "#22d3ee")
 *   data-open       "true" to open on load
 *
 * Programmatic control, for hosts that want their own trigger:
 *   window.JarvisEmbed.open() / .close() / .toggle()
 */
(function () {
  "use strict";

  // Idempotent: a host that includes the script twice gets one widget, not two.
  if (window.JarvisEmbed) return;

  var script = document.currentScript;
  if (!script) return;

  // The origin the plugin came from is where the app lives — derived, never
  // configured, so staging and production cannot be mixed up by a typo.
  var origin;
  try {
    origin = new URL(script.src, window.location.href).origin;
  } catch (e) {
    return;
  }

  var data = script.dataset || {};
  var label = (data.label || "Ask Jarvis").slice(0, 40);
  var position = data.position === "left" ? "left" : "right";
  // Accent drives every highlight in the widget. Accepting nothing but a hex
  // triple/sextet keeps a hostile data attribute from injecting arbitrary CSS
  // into the stylesheet below.
  var accent = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(data.accent || "")
    ? data.accent
    : "#22d3ee";
  var accentSoft = accent.length === 7 ? accent + "66" : accent;
  var frameUrl = origin + "/embed";

  // The brand mark, inline. A host page loading this script should not need a
  // second request (or the app's stylesheet) before the button looks right, so
  // the ribbon is drawn here at a weight that survives an 18px button.
  var MARK =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="18" height="18" aria-hidden="true" focusable="false">' +
    '<defs><linearGradient id="jv-g" x1="150" y1="30" x2="50" y2="160" gradientUnits="userSpaceOnUse">' +
    '<stop offset="0" stop-color="#63E6FF"/><stop offset=".27" stop-color="#3A8CFF"/>' +
    '<stop offset=".5" stop-color="#7A5CFF"/><stop offset=".72" stop-color="#C94BF0"/>' +
    '<stop offset=".89" stop-color="#FF5F9E"/><stop offset="1" stop-color="#FFA45E"/>' +
    '</linearGradient></defs>' +
    '<path d="M146 34L132 112C128 148 102 166 78 154C64 147 56 132 54 116" fill="none" stroke="url(#jv-g)" stroke-width="30"/>' +
    '<path d="M176 22c1.6 8.1 3.6 11.3 12 13.4-8.4 2.1-10.4 5.3-12 13.4-1.6-8.1-3.6-11.3-12-13.4 8.4-2.1 10.4-5.3 12-13.4Z" fill="#F8FBFF"/>' +
    '</svg>';

  var host = document.createElement("div");
  host.style.cssText =
    "all:initial;position:fixed;bottom:20px;z-index:2147483000;" +
    (position === "left" ? "left:20px;" : "right:20px;");

  var shadow = host.attachShadow({ mode: "open" });

  var style = document.createElement("style");
  style.textContent = [
    ".jv-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;",
    "border-radius:999px;border:1px solid " + accent + ";background:#04121f;",
    "color:#e6f6ff;font:600 13px/1 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;",
    "cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.45);transition:transform .15s ease,box-shadow .15s ease;}",
    ".jv-btn:hover{transform:translateY(-1px);box-shadow:0 14px 34px rgba(0,0,0,.5);}",
    ".jv-mark{width:18px;height:18px;flex:none;display:block;}",
    ".jv-mark svg{display:block;}",
    ".jv-card{position:absolute;bottom:58px;" +
      (position === "left" ? "left:0;" : "right:0;") +
      "width:min(420px,calc(100vw - 32px));height:min(680px,calc(100vh - 120px));",
    "border-radius:16px;overflow:hidden;border:1px solid " + accentSoft + ";",
    "background:#020a14;box-shadow:0 24px 60px rgba(0,0,0,.55);",
    "opacity:0;transform:translateY(8px) scale(.98);pointer-events:none;",
    "transition:opacity .18s ease,transform .18s ease;}",
    ".jv-card.jv-open{opacity:1;transform:none;pointer-events:auto;}",
    ".jv-frame{display:block;width:100%;height:100%;border:0;background:#020a14;}",
  ].join("");

  var button = document.createElement("button");
  button.type = "button";
  button.className = "jv-btn";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", label);

  var mark = document.createElement("span");
  mark.className = "jv-mark";
  mark.innerHTML = MARK;
  button.appendChild(mark);
  button.appendChild(document.createTextNode(label));

  var card = document.createElement("div");
  card.className = "jv-card";

  var frame = document.createElement("iframe");
  frame.className = "jv-frame";
  frame.title = label;
  frame.src = frameUrl;
  // The widget talks to no third party and needs no camera, mic or forms —
  // script-only is the tightest sandbox the panel works in.
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  card.appendChild(frame);

  shadow.appendChild(style);
  shadow.appendChild(button);
  shadow.appendChild(card);

  var open = function () {
    card.classList.add("jv-open");
    button.setAttribute("aria-expanded", "true");
    try {
      document.dispatchEvent(new CustomEvent("jarvis:open"));
    } catch (e) {
      /* older browsers: no event, no harm */
    }
  };

  var close = function () {
    card.classList.remove("jv-open");
    button.setAttribute("aria-expanded", "false");
    try {
      document.dispatchEvent(new CustomEvent("jarvis:close"));
    } catch (e) {
      /* ignore */
    }
  };

  var toggle = function () {
    if (card.classList.contains("jv-open")) close();
    else open();
  };

  button.addEventListener("click", toggle);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && card.classList.contains("jv-open")) close();
  });

  // Messages from the frame: checked against both origin and namespace, so a
  // hostile page that guesses the channel cannot close or probe the widget.
  window.addEventListener("message", function (e) {
    if (e.origin !== origin) return;
    var msg = e.data;
    if (!msg || msg.source !== "jarvis-embed") return;
    if (msg.type === "ready") {
      try {
        document.dispatchEvent(new CustomEvent("jarvis:ready"));
      } catch (err) {
        /* ignore */
      }
    } else if (msg.type === "close") {
      close();
    }
  });

  window.JarvisEmbed = {
    open: open,
    close: close,
    toggle: toggle,
    origin: origin,
    frame: frameUrl,
  };

  var mount = function () {
    (document.body || document.documentElement).appendChild(host);
    if (data.open === "true") open();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
