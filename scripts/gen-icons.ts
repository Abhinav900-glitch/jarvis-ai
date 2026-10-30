// ---------------------------------------------------------------------------
// Icon generation.
//
// public/logo.svg is the source of truth; this turns it into the PNGs a
// manifest and Android actually accept (Chrome and the Play Store ignore SVG
// icons). Run it after changing the logo:
//
//     bun run icons
//
// Outputs:
//   public/icons/icon-192.png          — manifest, any purpose
//   public/icons/icon-512.png          — manifest, any purpose
//   public/icons/icon-maskable-512.png — manifest, maskable purpose: the mark
//                                         is scaled into Android's 66% safe
//                                         zone over a full-bleed background,
//                                         so the circular crop cannot clip it
//   resources/icon.png                 — 1024px source for the native
//                                         launcher icons (@capacitor/assets)
//
// and, when android/ exists (after `bun run android:init`), the launcher
// icons the APK itself ships: every mipmap density, square and round, plus
// the adaptive-icon foreground. Re-run this after adding the platform,
// otherwise the home screen shows Capacitor's default icon.
// ---------------------------------------------------------------------------
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCE = `${ROOT}public/logo.svg`;
const VIEW = 512;
/** Share of the canvas the mark occupies on the maskable icon. */
const MASKABLE_SCALE = 0.62;

const logo = await Bun.file(SOURCE).text();

/** The logo's own drawing, without its XML prolog or outer <svg> wrapper. */
const inner = logo
  .replace(/<\?xml[^>]*\?>/g, "")
  .replace(/^\s*[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");

const maskable = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW}" height="${VIEW}" viewBox="0 0 ${VIEW} ${VIEW}">
  <rect width="${VIEW}" height="${VIEW}" fill="#000000"/>
  <g transform="translate(${VIEW * (1 - MASKABLE_SCALE) * 0.5} ${VIEW * (1 - MASKABLE_SCALE) * 0.5}) scale(${MASKABLE_SCALE})">
    ${inner}
  </g>
</svg>`;

async function render(svg: string, file: string, width: number) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } })
    .render()
    .asPng();
  await Bun.write(file, png);
  console.log(`✓ ${file.replace(ROOT, "")} (${width}px, ${png.length} B)`);
}

/** Adaptive-icon layer: the mark in the safe zone, over transparency. */
const foreground = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW}" height="${VIEW}" viewBox="0 0 ${VIEW} ${VIEW}">
  <g transform="translate(${VIEW * (1 - MASKABLE_SCALE) * 0.5} ${VIEW * (1 - MASKABLE_SCALE) * 0.5}) scale(${MASKABLE_SCALE})">
    ${inner}
  </g>
</svg>`;

await mkdir(`${ROOT}public/icons`, { recursive: true });
await mkdir(`${ROOT}resources`, { recursive: true });

await render(logo, `${ROOT}public/icons/icon-192.png`, 192);
await render(logo, `${ROOT}public/icons/icon-512.png`, 512);
await render(maskable, `${ROOT}public/icons/icon-maskable-512.png`, 512);
await render(logo, `${ROOT}resources/icon.png`, 1024);

// ---- Native launcher icons -------------------------------------------------
const RES = `${ROOT}android/app/src/main/res`;
if (!existsSync(RES)) {
  console.log("· android/ not present yet — run `bun run android:init` first, then re-run this script to brand the launcher icon.");
} else {
  const densities = [
    { name: "mdpi", launcher: 48, foreground: 108 },
    { name: "hdpi", launcher: 72, foreground: 162 },
    { name: "xhdpi", launcher: 96, foreground: 216 },
    { name: "xxhdpi", launcher: 144, foreground: 324 },
    { name: "xxxhdpi", launcher: 192, foreground: 432 },
  ];
  for (const d of densities) {
    const dir = `${RES}/mipmap-${d.name}`;
    await render(logo, `${dir}/ic_launcher.png`, d.launcher);
    await render(maskable, `${dir}/ic_launcher_round.png`, d.launcher);
    await render(foreground, `${dir}/ic_launcher_foreground.png`, d.foreground);
  }
}
