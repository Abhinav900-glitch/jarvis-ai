// ---------------------------------------------------------------------------
// A PowerPoint writer.
//
// What python-pptx does through a Presentation → slide → shape object model,
// this does by emitting the same OOXML parts directly: a presentation part, one
// slide master and layout, one theme, a slide per card, native chart parts,
// embedded pictures, tables as graphic frames, and real speaker notes. No
// dependency, no server, no provider key — a deck can be built and downloaded
// in the browser with nothing else running.
//
// Deliberate omissions, because a half-implemented feature is worse than an
// absent one: animations and SmartArt are not written (transitions are), and
// charts carry a cached data sheet but no embedded workbook, so PowerPoint
// draws them correctly while "Edit Data" has nothing to open.
//
// Coordinates are points (1 pt = 12700 EMU) on a 960 x 540 page. Every layout
// takes its colours and typefaces from the theme, so no hex value leaks in from
// a slide's content.
// ---------------------------------------------------------------------------

import { themeById, type DeckTheme } from "./theme";
import { qrDataUrl } from "../qr/png";
import type {
  ChartData,
  DeckSpec,
  SlideSpec,
  TableData,
} from "./spec";
import { zipFiles, type ZipEntry } from "./zip";

const EMU = 12700;
const emu = (pt: number) => Math.round(pt * EMU);
const SLIDE_W = 960;

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// XML 1.0 forbids most control characters outright; a model occasionally emits
// one, and PowerPoint reports the whole file as corrupt if it does.
// eslint-disable-next-line no-control-regex -- the range is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

const esc = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(CONTROL_CHARS, "");

const hex = (value: string | undefined, fallback: string): string => {
  const clean = (value ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return clean.length === 6 || clean.length === 8 ? clean : fallback;
};

/** `alpha` is a percentage; OOXML stores thousandths of a percent. */
const solid = (color: string, alpha?: number): string => {
  const fill = `<a:srgbClr val="${hex(color, "000000")}">${
    alpha === undefined ? "" : `<a:alpha val="${Math.round(alpha * 1000)}"/>`
  }</a:srgbClr>`;
  return `<a:solidFill>${fill}</a:solidFill>`;
};

const stroke = (color: string, widthPt = 1, alpha?: number): string =>
  `<a:ln w="${emu(widthPt)}" cap="flat">${solid(color, alpha)}</a:ln>`;

const noFill = "<a:noFill/>";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
  font?: string;
  /** Letter spacing in points, for eyebrow labels. */
  spacing?: number;
}

interface Para {
  runs: Run[];
  align?: "l" | "ctr" | "r" | "just";
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  font?: string;
  spaceBefore?: number;
  spaceAfter?: number;
  lineSpacing?: number;
  bullet?: string | null;
  bulletColor?: string;
  level?: number;
}

interface ShapeStyle {
  fill?: string;
  fillAlpha?: number;
  line?: string;
  lineWidth?: number;
  lineAlpha?: number;
  radius?: number;
  anchor?: "t" | "ctr" | "b";
  inset?: number;
  autofit?: boolean;
  flipH?: boolean;
  rot?: number;
}

/** `**bold**` and `` `code` `` in a bullet become real runs. */
function richRuns(text: string, base: Omit<Run, "text"> = {}): Run[] {
  const runs: Run[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) runs.push({ ...base, text: text.slice(last, at) });
    const token = match[0];
    if (token.startsWith("**")) {
      runs.push({ ...base, text: token.slice(2, -2), bold: true });
    } else {
      runs.push({
        ...base,
        text: token.slice(1, -1),
        font: "Consolas",
        color: base.color,
      });
    }
    last = at + token.length;
  }
  if (last < text.length) runs.push({ ...base, text: text.slice(last) });
  return runs.length ? runs : [{ ...base, text }];
}

function runsXml(runs: Run[], p: Para, theme: DeckTheme): string {
  return runs
    .map((run) => {
      const size = run.size ?? p.size ?? 16;
      const color = hex(run.color ?? p.color ?? theme.ink, theme.ink);
      const font = run.font ?? p.font ?? theme.bodyFont;
      const attrs = [
        `lang="en-US"`,
        `altLang="en-US"`,
        `sz="${Math.round(size * 100)}"`,
        `b="${run.bold ?? p.bold ? 1 : 0}"`,
        `i="${run.italic ?? p.italic ? 1 : 0}"`,
        run.spacing ? `spc="${Math.round(run.spacing * 100)}"` : "",
        `dirty="0"`,
      ]
        .filter(Boolean)
        .join(" ");
      return `<a:r><a:rPr ${attrs}>${solid(color)}<a:latin typeface="${esc(font)}"/><a:ea typeface="${esc(font)}"/><a:cs typeface="${esc(font)}"/></a:rPr><a:t>${esc(run.text)}</a:t></a:r>`;
    })
    .join("");
}

function paraXml(p: Para, theme: DeckTheme): string {
  const bullet = p.bullet === null ? null : (p.bullet ?? null);
  const marL = bullet ? 20 : 0;
  const indent = bullet ? -20 : 0;
  const pPr = [
    `<a:pPr algn="${p.align ?? "l"}" lvl="${p.level ?? 0}"`,
    marL ? ` marL="${emu(marL)}" indent="${emu(indent)}"` : "",
    ">",
    p.lineSpacing ? `<a:lnSpc><a:spcPct val="${Math.round(p.lineSpacing * 1000)}"/></a:lnSpc>` : "",
    p.spaceBefore ? `<a:spcBef><a:spcPts val="${Math.round(p.spaceBefore * 100)}"/></a:spcBef>` : "",
    p.spaceAfter ? `<a:spcAft><a:spcPts val="${Math.round(p.spaceAfter * 100)}"/></a:spcAft>` : "",
    bullet
      ? `${p.bulletColor ? `<a:buClr>${solid(p.bulletColor)}</a:buClr>` : ""}<a:buSzPct val="90000"/><a:buFont typeface="Arial"/><a:buChar char="${esc(bullet)}"/>`
      : "<a:buNone/>",
    "</a:pPr>",
  ].join("");
  const size = p.size ?? 16;
  return `<a:p>${pPr}${runsXml(p.runs, p, theme)}<a:endParaRPr lang="en-US" sz="${Math.round(size * 100)}" dirty="0"/></a:p>`;
}

function textBody(paras: Para[], style: ShapeStyle, theme: DeckTheme): string {
  const inset = style.inset ?? 0;
  const body = [
    `<a:bodyPr wrap="square" lIns="${emu(inset)}" rIns="${emu(inset)}" tIns="${emu(inset)}" bIns="${emu(inset)}" anchor="${style.anchor ?? "t"}"`,
    ">",
    style.autofit === false ? "<a:noAutofit/>" : "<a:normAutofit/>",
    "</a:bodyPr>",
  ].join("");
  return `<p:txBody>${body}<a:lstStyle/>${paras.map((p) => paraXml(p, theme)).join("")}</p:txBody>`;
}

function textShape(
  id: number,
  name: string,
  box: Box,
  paras: Para[],
  style: ShapeStyle,
  theme: DeckTheme,
): string {
  const geom = style.radius
    ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round((style.radius / Math.min(box.w, box.h)) * 100000)}"/></a:avLst></a:prstGeom>`
    : `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`;
  const fill = style.fill ? solid(style.fill, style.fillAlpha) : noFill;
  const line = style.line ? stroke(style.line, style.lineWidth ?? 0.75, style.lineAlpha) : "<a:ln><a:noFill/></a:ln>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm${style.rot ? ` rot="${Math.round(style.rot * 60000)}"` : ""}><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/></a:xfrm>${geom}${fill}${line}</p:spPr>${paras.length ? textBody(paras, style, theme) : ""}</p:sp>`;
}

function shape(
  id: number,
  name: string,
  box: Box,
  preset: "rect" | "ellipse" | "roundRect" | "triangle" | "line",
  style: ShapeStyle,
): string {
  const adj =
    preset === "roundRect"
      ? `<a:avLst><a:gd name="adj" fmla="val ${Math.round(((style.radius ?? 6) / Math.min(box.w, box.h)) * 100000)}"/></a:avLst>`
      : "<a:avLst/>";
  const fill = style.fill ? solid(style.fill, style.fillAlpha) : noFill;
  const line = style.line ? stroke(style.line, style.lineWidth ?? 0.75, style.lineAlpha) : "<a:ln><a:noFill/></a:ln>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(Math.max(1, box.w))}" cy="${emu(Math.max(1, box.h))}"/></a:xfrm><a:prstGeom prst="${preset}">${adj}</a:prstGeom>${fill}${line}</p:spPr></p:sp>`;
}

// ---------------------------------------------------------------------------
// Per-slide resources
// ---------------------------------------------------------------------------

interface Rel {
  id: string;
  type: string;
  target: string;
}

interface Part {
  path: string;
  xml: string;
}

interface SlideWriter {
  theme: DeckTheme;
  deck: DeckSpec;
  slide: SlideSpec;
  index: number;
  total: number;
  height: number;
  nextId: number;
  rels: Rel[];
  parts: Part[];
  /** Charts and pictures relationship ids are handed out by the slide. */
  relCounter: number;
  /** Embeds a data URL and returns the relationship id, or null if unusable. */
  addImage(dataUrl: string): string | null;
  /** Writes a chart part and returns the relationship id. */
  addChart(chart: ChartData): string | null;
}

const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_CHART = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const REL_NOTES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const REL_SLIDE_REF = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";

interface MediaStore {
  /** path → bytes. */
  files: Map<string, Uint8Array>;
  /** extension → "png" | "jpeg" | "gif". */
  extensions: Set<string>;
  count: number;
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const match = /^data:image\/(png|jpe?g|gif);base64,([\s\S]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const ext = match[1].toLowerCase() === "png" ? "png" : match[1].toLowerCase() === "gif" ? "gif" : "jpeg";
  try {
    const binary = atob(match[2].replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.length > 0 ? { bytes, ext } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Chart parts
// ---------------------------------------------------------------------------

const AXIS_CAT = 111111111;
const AXIS_VAL = 222222222;

/** Chart part numbering, reset at the start of every package. */
const chartCounter = { value: 0 };

function seriesXml(series: ChartData["series"][number], index: number, chart: ChartData, theme: DeckTheme): string {
  const colors = [theme.accent, theme.accentAlt, theme.muted];
  const color = colors[index % colors.length];
  const points = series.values
    .map((value, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(value) ? value : 0}</c:v></c:pt>`)
    .join("");
  const categories = chart.categories
    .map((category, i) => `<c:pt idx="${i}"><c:v>${esc(category)}</c:v></c:pt>`)
    .join("");
  const dataPoints =
    chart.kind === "pie" || chart.kind === "doughnut"
      ? series.values
          .map(
            (_, i) =>
              `<c:dPt><c:idx val="${i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr>${solid(colors[i % colors.length])}<a:ln w="19050">${solid(theme.bg)}</a:ln></c:spPr></c:dPt>`,
          )
          .join("")
      : "";
  const marker = chart.kind === "line" ? '<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill>' + `<a:srgbClr val="${hex(color, "000000")}"/>` + `</a:solidFill><a:ln w="9525">${solid(theme.bg)}</a:ln></c:spPr></c:marker>` : "";
  // Line series have no invertIfNegative element: the schema rejects it.
  const shapePr = chart.kind === "line" ? `<c:spPr><a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln></c:spPr>` : `<c:spPr>${solid(color)}</c:spPr>`;
  return [
    `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>`,
    `<c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(series.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`,
    shapePr,
    chart.kind === "line" ? marker : "",
    dataPoints,
    chart.kind === "line" ? "" : marker,
    `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${chart.categories.length + 1}</c:f><c:strCache><c:ptCount val="${chart.categories.length}"/>${categories}</c:strCache></c:strRef></c:cat>`,
    `<c:val><c:numRef><c:f>Sheet1!$B$2:$B$${chart.categories.length + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${series.values.length}"/>${points}</c:numCache></c:numRef></c:val>`,
    chart.kind === "line" ? '<c:smooth val="0"/>' : "",
    "</c:ser>",
  ].join("");
}

function axisText(theme: DeckTheme, size = 10): string {
  return `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size * 100}" b="0">${solid(theme.muted)}<a:latin typeface="${esc(theme.bodyFont)}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
}

/** A native chart part: PowerPoint draws it, and the legend is real. */
export function chartXml(chart: ChartData, theme: DeckTheme): string {
  const isPie = chart.kind === "pie" || chart.kind === "doughnut";
  const series = chart.series.map((s, i) => seriesXml(s, i, chart, theme)).join("");

  // A horizontal bar chart puts its category axis on the left and its value
  // axis along the bottom; every other chart is the other way round.
  const horizontal = chart.kind === "bar";
  const catAxis = `<c:catAx><c:axId val="${AXIS_CAT}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisText(theme)}<c:crossAx val="${AXIS_VAL}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAxis = `<c:valAx><c:axId val="${AXIS_VAL}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/><c:majorGridlines><c:spPr>${stroke(theme.line, 0.75)}</c:spPr></c:majorGridlines><c:numFmt formatCode="${esc(chart.unit ? `0"${chart.unit}"` : "General")}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisText(theme)}<c:crossAx val="${AXIS_CAT}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;

  let plot: string;
  if (isPie) {
    // dLbls wants its text properties before the show* flags.
    plot = `<c:${chart.kind === "pie" ? "pieChart" : "doughnutChart"}><c:varyColors val="1"/>${series}<c:dLbls>${axisText(theme, 10)}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>${chart.kind === "doughnut" ? '<c:holeSize val="55"/>' : ""}</c:${chart.kind === "pie" ? "pieChart" : "doughnutChart"}>`;
  } else if (chart.kind === "line") {
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:marker val="1"/><c:smooth val="0"/><c:axId val="${AXIS_CAT}"/><c:axId val="${AXIS_VAL}"/></c:lineChart>${catAxis}${valAxis}`;
  } else {
    plot = `<c:barChart><c:barDir val="${chart.kind === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="70"/><c:overlap val="-12"/><c:axId val="${AXIS_CAT}"/><c:axId val="${AXIS_VAL}"/></c:barChart>${catAxis}${valAxis}`;
  }

  return `${XML_HEAD}<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>${plot}</c:plotArea>${isPie || chart.series.length > 1 ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${axisText(theme)}</c:legend>` : ""}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr>${solid(theme.bg)}<a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000">${solid(theme.muted)}<a:latin typeface="${esc(theme.bodyFont)}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr></c:chartSpace>`;
}

// ---------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------

function chartFrame(id: number, name: string, box: Box, rId: string): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/></p:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="${rId}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

function tableFrame(id: number, name: string, box: Box, table: TableData, theme: DeckTheme): string {
  const columns = table.columns.length;
  // The first column carries the label, so it gets the extra room.
  const weights = table.columns.map((_, i) => (i === 0 ? 1.35 : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const grid = weights
    .map((w) => `<a:gridCol w="${emu((box.w * w) / totalWeight)}"/>`)
    .join("");
  const rowHeight = Math.min(34, (box.h - 8) / (table.rows.length + 1));

  const cell = (value: string, opts: { header: boolean; row: number; last: boolean }) => {
    const fill = opts.header ? theme.accent : opts.row % 2 === 0 ? theme.panel : theme.panelAlt;
    const color = opts.header
      ? // On a light accent (moss, tide) the background is the readable colour.
        theme.dark
        ? theme.bg
        : theme.ink
      : theme.ink;
    const size = opts.header ? 11.5 : 11;
    return [
      "<a:tc>",
      `<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l" marL="0" indent="0"><a:buNone/></a:pPr>`,
      `<a:r><a:rPr lang="en-US" sz="${Math.round(size * 100)}" b="${opts.header ? 1 : 0}" dirty="0">${solid(color)}<a:latin typeface="${esc(theme.bodyFont)}"/><a:cs typeface="${esc(theme.bodyFont)}"/></a:rPr><a:t>${esc(value)}</a:t></a:r></a:p></a:txBody>`,
      `<a:tcPr marL="${emu(10)}" marR="${emu(8)}" marT="${emu(4)}" marB="${emu(4)}" anchor="ctr"><a:lnB w="9525">${solid(theme.line)}</a:lnB>${solid(fill)}</a:tcPr>`,
      "</a:tc>",
    ].join("");
  };

  const header = `<a:tr h="${emu(rowHeight)}">${table.columns
    .map((column, i) => cell(column, { header: true, row: 0, last: i === columns - 1 }))
    .join("")}</a:tr>`;
  const rows = table.rows
    .map(
      (row, r) =>
        `<a:tr h="${emu(rowHeight)}">${row
          .map((value, i) => cell(value, { header: false, row: r, last: i === columns - 1 }))
          .join("")}</a:tr>`,
    )
    .join("");

  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.w)}" cy="${emu(rowHeight * (table.rows.length + 1))}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="0"><a:tableStyleId>{2D5ABB26-0587-4C30-8999-92F81FD0307C}</a:tableStyleId></a:tblPr><a:tblGrid>${grid}</a:tblGrid>${header}${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function pictureFrame(id: number, name: string, box: Box, rId: string, descr = ""): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(name)}" descr="${esc(descr)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr></p:pic>`;
}

/** The decoration in the margins: theme-specific, and identical on every body slide. */
function motif(w: SlideWriter, shapes: string[], box: Box): void {
  const { theme } = w;
  if (theme.motif === "rings") {
    shapes.push(shape(w.nextId++, "Ring", { x: box.x + box.w - 150, y: box.y - 40, w: 220, h: 220 }, "ellipse", { line: theme.accent, lineWidth: 0.75, lineAlpha: 22 }));
    shapes.push(shape(w.nextId++, "Ring inner", { x: box.x + box.w - 96, y: box.y + 14, w: 112, h: 112 }, "ellipse", { line: theme.accent, lineWidth: 0.75, lineAlpha: 12 }));
  } else if (theme.motif === "dots") {
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        shapes.push(shape(w.nextId++, "Dot", { x: box.x + box.w - 96 + col * 14, y: box.y - 6 + row * 14, w: 2.2, h: 2.2 }, "ellipse", { fill: theme.accent, fillAlpha: 35 }));
      }
    }
  } else if (theme.motif === "grid") {
    for (let i = 0; i < 5; i += 1) {
      shapes.push(shape(w.nextId++, "Grid line", { x: box.x + box.w - 130 + i * 26, y: box.y - 10, w: 0.75, h: 70 }, "rect", { fill: theme.accent, fillAlpha: 16 }));
    }
  } else {
    shapes.push(shape(w.nextId++, "Rule A", { x: box.x + box.w - 120, y: box.y - 2, w: 120, h: 1 }, "rect", { fill: theme.accent, fillAlpha: 45 }));
    shapes.push(shape(w.nextId++, "Rule B", { x: box.x + box.w - 70, y: box.y + 8, w: 70, h: 1 }, "rect", { fill: theme.accent, fillAlpha: 25 }));
  }
}

function header(w: SlideWriter, shapes: string[], opts: { withRule?: boolean } = {}): number {
  const { theme, slide } = w;
  const top = 54;
  // The same rule the pipeline applies: an eyebrow is a label, so a sentence
  // saved into it is hidden rather than printed at 10pt across the slide.
  const kicker = slide.kicker?.trim().length && slide.kicker.trim().length <= 48 ? slide.kicker.trim() : undefined;
  let y = top;
  if (kicker) {
    shapes.push(
      textShape(
        w.nextId++,
        "Kicker",
        { x: 64, y, w: 700, h: 14 },
        [
          {
            runs: [{ text: kicker.toUpperCase(), size: 10, color: theme.accent, bold: true, spacing: 1.6 }],
            size: 10,
          },
        ],
        { anchor: "t", autofit: false },
        theme,
      ),
    );
    y += 20;
  }

  // A title over ~46 characters at this size wraps; the content below has to
  // move with it, so the height is estimated rather than fixed.
  const perLine = Math.floor(760 / (theme.titleSize * 0.52));
  const lines = Math.min(3, Math.max(1, Math.ceil(slide.title.length / perLine)));
  const titleHeight = lines * theme.titleSize * 1.14;
  shapes.push(
    textShape(
      w.nextId++,
      "Title",
      { x: 64, y, w: 800, h: titleHeight },
      [{ runs: richRuns(slide.title, { size: theme.titleSize, bold: true, color: theme.ink }), size: theme.titleSize, color: theme.ink, bold: true, lineSpacing: 0.98 }],
      { anchor: "t" },
      theme,
    ),
  );
  y += titleHeight + 6;
  if (opts.withRule !== false) {
    shapes.push(shape(w.nextId++, "Accent rule", { x: 64, y, w: 54, h: 3 }, "rect", { fill: theme.accent }));
    y += 3;
  }
  return y + 22;
}

function footer(w: SlideWriter, shapes: string[]): void {
  const { theme, deck, index, total, height } = w;
  const y = height - 40;
  shapes.push(shape(w.nextId++, "Footer rule", { x: 64, y: y - 12, w: SLIDE_W - 128, h: 0.6 }, "rect", { fill: theme.line, fillAlpha: 70 }));
  const label = deck.footer?.trim() || deck.title;
  shapes.push(
    textShape(
      w.nextId++,
      "Footer text",
      { x: 64, y, w: 620, h: 14 },
      [{ runs: [{ text: label, size: 9, color: theme.muted }], size: 9 }],
      { anchor: "t", autofit: false },
      theme,
    ),
  );
  const number = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  shapes.push(
    textShape(
      w.nextId++,
      "Slide number",
      { x: SLIDE_W - 144, y, w: 80, h: 14 },
      [{ runs: [{ text: number, size: 9, color: theme.muted, bold: true, spacing: 0.8 }], size: 9, align: "r" }],
      { anchor: "t", autofit: false },
      theme,
    ),
  );
}

function bulletsLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const slide = w.slide;
  const top = header(w, shapes);
  const bottom = w.height - 64;
  const body = slide.body ?? [];
  const hasSubtitle = Boolean(slide.subtitle);

  if (body.length === 0 && hasSubtitle) {
    // A statement slide: one idea, large, with nothing beside it.
    shapes.push(
      textShape(
        w.nextId++,
        "Statement",
        { x: 64, y: top + 8, w: 760, h: bottom - top - 20 },
        [{ runs: richRuns(slide.subtitle ?? "", { size: 26, color: theme.ink }), size: 26, lineSpacing: 1.12 }],
        { anchor: "t" },
        theme,
      ),
    );
    return;
  }

  const size = body.length > 5 ? 15 : body.length > 3 ? 17 : 19;
  const paras: Para[] = body.map((line, i) => ({
    runs: richRuns(line, { size, color: theme.ink }),
    size,
    color: theme.ink,
    bullet: "•",
    bulletColor: theme.accent,
    spaceBefore: i === 0 ? 0 : 14,
    lineSpacing: 1.08,
  }));
  if (paras.length) {
    shapes.push(textShape(w.nextId++, "Body", { x: 64, y: top + 4, w: 760, h: bottom - top - 16 }, paras, { anchor: "t" }, theme));
  }

  if (slide.subtitle) {
    shapes.push(
      textShape(
        w.nextId++,
        "Subtitle",
        { x: 64, y: bottom - 54, w: 760, h: 40 },
        [{ runs: richRuns(slide.subtitle, { size: 13, color: theme.muted }), size: 13, lineSpacing: 1.05 }],
        { anchor: "b" },
        theme,
      ),
    );
  }
}

function agendaLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const items = (w.slide.body ?? []).slice(0, 6);
  const top = header(w, shapes);
  const rowHeight = Math.min(56, (w.height - 64 - top) / Math.max(1, items.length));
  items.forEach((item, i) => {
    const y = top + i * rowHeight;
    shapes.push(
      textShape(
        w.nextId++,
        "Agenda number",
        { x: 64, y: y + 2, w: 44, h: 24 },
        [{ runs: [{ text: String(i + 1).padStart(2, "0"), size: 12, color: theme.accent, bold: true, spacing: 1.2 }], size: 12 }],
        { anchor: "t", autofit: false },
        theme,
      ),
    );
    shapes.push(
      textShape(
        w.nextId++,
        "Agenda item",
        { x: 112, y, w: 700, h: 30 },
        [{ runs: richRuns(item, { size: 17, color: theme.ink }), size: 17 }],
        { anchor: "t", autofit: false },
        theme,
      ),
    );
    if (i < items.length - 1) {
      shapes.push(shape(w.nextId++, "Agenda rule", { x: 112, y: y + rowHeight - 10, w: 700, h: 0.5 }, "rect", { fill: theme.line, fillAlpha: 55 }));
    }
  });
}

function sectionLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const sectionNumber = String(w.index).padStart(2, "0");
  shapes.push(shape(w.nextId++, "Section bar", { x: 64, y: 150, w: 5, h: 190 }, "rect", { fill: theme.accent }));
  shapes.push(
    textShape(
      w.nextId++,
      "Section number",
      { x: 84, y: 126, w: 300, h: 90 },
      [{ runs: [{ text: sectionNumber, size: 64, color: theme.accent, bold: true }], size: 64 }],
      { anchor: "t", autofit: false },
      theme,
    ),
  );
  shapes.push(
    textShape(
      w.nextId++,
      "Section title",
      { x: 84, y: 214, w: 760, h: 120 },
      [
        { runs: richRuns(w.slide.title, { size: theme.sectionSize, color: theme.ink, bold: true }), size: theme.sectionSize, bold: true, lineSpacing: 0.98 },
      ],
      { anchor: "t" },
      theme,
    ),
  );
  if (w.slide.subtitle) {
    shapes.push(
      textShape(
        w.nextId++,
        "Section subtitle",
        { x: 84, y: 340, w: 660, h: 60 },
        [{ runs: richRuns(w.slide.subtitle, { size: 15, color: theme.muted }), size: 15, lineSpacing: 1.1 }],
        { anchor: "t" },
        theme,
      ),
    );
  }

  // A writer often puts the section's argument in `body` even on a divider.
  // Rendering it keeps that copy in the deck instead of dropping it.
  const points = (w.slide.body ?? []).slice(0, 3);
  if (points.length) {
    const paras: Para[] = points.map((point, i) => ({
      runs: richRuns(point, { size: 11.5, color: theme.muted }),
      size: 11.5,
      bullet: "–",
      bulletColor: theme.accent,
      spaceBefore: i === 0 ? 0 : 6,
      lineSpacing: 1.06,
    }));
    shapes.push(
      textShape(
        w.nextId++,
        "Section points",
        { x: 84, y: w.slide.subtitle ? 404 : 360, w: 640, h: 78 },
        paras,
        { anchor: "t" },
        theme,
      ),
    );
  }
}

function columnsLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const top = header(w, shapes);
  const bottom = w.height - 64;
  const columns = (w.slide.columns ?? []).slice(0, 2);
  const gap = 18;
  const width = columns.length === 1 ? 560 : (SLIDE_W - 128 - gap) / 2;
  columns.forEach((column, i) => {
    const x = 64 + i * (width + gap);
    shapes.push(
      textShape(
        w.nextId++,
        "Column panel",
        { x, y: top, w: width, h: bottom - top },
        [],
        { fill: theme.panel, line: theme.line, lineWidth: 0.75, radius: 10 },
        theme,
      ),
    );
    shapes.push(shape(w.nextId++, "Column mark", { x: x + 20, y: top + 20, w: 26, h: 3 }, "rect", { fill: i === 0 ? theme.accent : theme.accentAlt }));
    const paras: Para[] = [
      { runs: [{ text: column.heading || (i === 0 ? "One reading" : "The other") , size: 13, color: theme.muted, bold: true, spacing: 0.8 }], size: 13, spaceAfter: 10 },
      ...column.points.map((point, n) => ({
        runs: richRuns(point, { size: 13.5, color: theme.ink }),
        size: 13.5,
        bullet: "–",
        bulletColor: theme.accent,
        spaceBefore: n === 0 ? 4 : 9,
        lineSpacing: 1.05,
      })),
    ];
    shapes.push(textShape(w.nextId++, "Column text", { x: x + 20, y: top + 36, w: width - 40, h: bottom - top - 56 }, paras, { anchor: "t" }, theme));
  });
}

function quoteLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const quote = w.slide.quote;
  if (!quote) return;
  shapes.push(
    textShape(
      w.nextId++,
      "Quote mark",
      { x: 58, y: 96, w: 140, h: 150 },
      [{ runs: [{ text: "\u201C", size: 150, color: theme.accent }], size: 150, color: theme.accent, font: "Georgia" }],
      { anchor: "t", autofit: false },
      theme,
    ),
  );
  shapes.push(shape(w.nextId++, "Quote bar", { x: 64, y: 250, w: 4, h: 150 }, "rect", { fill: theme.accent }));
  shapes.push(
    textShape(
      w.nextId++,
      "Quote",
      { x: 92, y: 238, w: 760, h: 180 },
      [{ runs: richRuns(quote.text, { size: 28, color: theme.ink, italic: true }), size: 28, italic: true, lineSpacing: 1.14 }],
      { anchor: "t" },
      theme,
    ),
  );
  if (quote.attribution) {
    shapes.push(
      textShape(
        w.nextId++,
        "Quote attribution",
        { x: 96, y: 424, w: 700, h: 22 },
        [{ runs: [{ text: `— ${quote.attribution}`, size: 12, color: theme.muted, bold: true, spacing: 0.6 }], size: 12 }],
        { anchor: "t", autofit: false },
        theme,
      ),
    );
  }
}

function statsLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const top = header(w, shapes);
  const bottom = w.height - 64;
  const metrics = (w.slide.metrics ?? []).slice(0, 4);
  const gap = 16;
  const width = (SLIDE_W - 128 - gap * (metrics.length - 1)) / metrics.length;
  const height = Math.min(210, bottom - top);
  metrics.forEach((metric, i) => {
    const x = 64 + i * (width + gap);
    shapes.push(
      textShape(w.nextId++, "Metric card", { x, y: top, w: width, h: height }, [], { fill: theme.panel, line: theme.line, radius: 10 }, theme),
    );
    shapes.push(shape(w.nextId++, "Metric rule", { x: x + 22, y: top + 22, w: 30, h: 3 }, "rect", { fill: i % 2 === 0 ? theme.accent : theme.accentAlt }));
    shapes.push(
      textShape(
        w.nextId++,
        "Metric value",
        { x: x + 22, y: top + 44, w: width - 44, h: 62 },
        [{ runs: [{ text: metric.value, size: 40, color: i % 2 === 0 ? theme.accent : theme.accentAlt, bold: true }], size: 40, bold: true }],
        { anchor: "t", autofit: false },
        theme,
      ),
    );
    shapes.push(
      textShape(
        w.nextId++,
        "Metric label",
        { x: x + 22, y: top + 108, w: width - 44, h: 56 },
        [{ runs: richRuns(metric.label, { size: 12.5, color: theme.ink, bold: true }), size: 12.5, lineSpacing: 1.08 }],
        { anchor: "t" },
        theme,
      ),
    );
    if (metric.note) {
      shapes.push(
        textShape(
          w.nextId++,
          "Metric note",
          { x: x + 22, y: top + height - 40, w: width - 44, h: 24 },
          [{ runs: [{ text: metric.note, size: 9.5, color: theme.muted }], size: 9.5 }],
          { anchor: "b", autofit: false },
          theme,
        ),
      );
    }
  });
}

function timelineLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const top = header(w, shapes);
  const steps = (w.slide.steps ?? []).slice(0, 6);
  const rows = steps.length > 4 ? 2 : 1;
  const perRow = rows === 1 ? steps.length : Math.ceil(steps.length / 2);
  const rowHeight = Math.min(200, (w.height - 74 - top) / rows);

  shapes.push(shape(w.nextId++, "Timeline rail", { x: 88, y: top + 26, w: SLIDE_W - 176, h: 1.2 }, "rect", { fill: theme.line }));

  steps.forEach((step, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const count = row === 0 ? perRow : steps.length - perRow;
    const span = (SLIDE_W - 176) / Math.max(1, count);
    const x = 88 + col * span;
    const y = top + row * rowHeight;
    if (row > 0) {
      shapes.push(shape(w.nextId++, "Timeline rail 2", { x: 88, y: y + 26, w: (SLIDE_W - 176) * (count / perRow), h: 1.2 }, "rect", { fill: theme.line }));
    }
    shapes.push(shape(w.nextId++, "Node", { x: x - 5, y: y + 20, w: 12, h: 12 }, "ellipse", { fill: theme.accent }));
    shapes.push(shape(w.nextId++, "Node inner", { x: x - 1.5, y: y + 23.5, w: 5, h: 5 }, "ellipse", { fill: theme.bg }));
    shapes.push(
      textShape(
        w.nextId++,
        "When",
        { x: x - 4, y: y - 12, w: span - 14, h: 16 },
        [{ runs: [{ text: step.when.toUpperCase(), size: 9.5, color: theme.accent, bold: true, spacing: 1 }], size: 9.5 }],
        { anchor: "t", autofit: false },
        theme,
      ),
    );
    shapes.push(
      textShape(
        w.nextId++,
        "Step title",
        { x: x - 4, y: y + 44, w: span - 16, h: 26 },
        [{ runs: richRuns(step.title, { size: 13.5, color: theme.ink, bold: true }), size: 13.5, bold: true }],
        { anchor: "t" },
        theme,
      ),
    );
    if (step.detail) {
      shapes.push(
        textShape(
          w.nextId++,
          "Step detail",
          { x: x - 4, y: y + 72, w: span - 20, h: 60 },
          [{ runs: [{ text: step.detail, size: 10.5, color: theme.muted }], size: 10.5, lineSpacing: 1.08 }],
          { anchor: "t" },
          theme,
        ),
      );
    }
  });
}

function tableLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const table = w.slide.table;
  if (!table) return;
  const top = header(w, shapes);
  const available = w.height - 92 - top;
  shapes.push(tableFrame(w.nextId++, "Table", { x: 64, y: top, w: SLIDE_W - 128, h: available }, table, theme));
  if (table.caption) {
    shapes.push(
      textShape(
        w.nextId++,
        "Table caption",
        { x: 64, y: w.height - 78, w: 700, h: 18 },
        [{ runs: [{ text: table.caption, size: 9.5, color: theme.muted }], size: 9.5 }],
        { anchor: "t", autofit: false },
        theme,
      ),
    );
  }
}

function chartLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const chart = w.slide.chart;
  if (!chart) return;
  const top = header(w, shapes);
  const box: Box = { x: 48, y: top - 6, w: SLIDE_W - 96, h: w.height - top - 76 };
  const rId = w.addChart(chart);
  if (rId) shapes.push(chartFrame(w.nextId++, "Chart", box, rId));
  if (chart.caption) {
    shapes.push(
      textShape(
        w.nextId++,
        "Chart caption",
        { x: 64, y: w.height - 74, w: 760, h: 18 },
        [{ runs: [{ text: chart.caption, size: 9.5, color: theme.muted }], size: 9.5 }],
        { anchor: "t", autofit: false },
        theme,
      ),
    );
  }
}

function imageLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const image = w.slide.image;
  const rId = image?.dataUrl ? w.addImage(image.dataUrl) : null;
  const bottom = w.height - 64;

  if (rId && image?.layout === "full") {
    // Full bleed: the picture owns the slide, and a scrim keeps the title
    // legible. The ordinary header is skipped — it would draw a second title.
    shapes.push(pictureFrame(w.nextId++, "Backdrop", { x: 0, y: 0, w: SLIDE_W, h: w.height }, rId, image.caption ?? ""));
    shapes.push(shape(w.nextId++, "Scrim", { x: 0, y: 0, w: SLIDE_W, h: w.height }, "rect", { fill: theme.bg, fillAlpha: 62 }));
    shapes.push(
      textShape(
        w.nextId++,
        "Overlay title",
        { x: 64, y: w.height / 2 - 70, w: 700, h: 140 },
        [{ runs: richRuns(w.slide.title, { size: 38, color: theme.ink, bold: true }), size: 38, bold: true, lineSpacing: 1.02 }],
        { anchor: "t" },
        theme,
      ),
    );
    if (image.caption) {
      shapes.push(
        textShape(
          w.nextId++,
          "Backdrop caption",
          { x: 64, y: w.height / 2 + 78, w: 700, h: 22 },
          [{ runs: [{ text: image.caption, size: 10.5, color: theme.muted }], size: 10.5 }],
          { anchor: "t", autofit: false },
          theme,
        ),
      );
    }
    return;
  }

  const top = header(w, shapes);

  if (rId) {
    const box: Box = { x: 64, y: top, w: SLIDE_W - 128, h: bottom - top - (image?.caption ? 34 : 0) };
    shapes.push(pictureFrame(w.nextId++, "Picture", box, rId, image?.caption ?? ""));
    if (image?.caption) {
      shapes.push(
        textShape(
          w.nextId++,
          "Image caption",
          { x: 64, y: bottom - 26, w: 760, h: 20 },
          [{ runs: [{ text: image.caption, size: 10, color: theme.muted }], size: 10 }],
          { anchor: "t", autofit: false },
          theme,
        ),
      );
    }
    return;
  }

  // No picture: a deliberate visual placeholder, so the slide still reads as a
  // design rather than an empty frame.
  const box: Box = { x: 64, y: top, w: SLIDE_W - 128, h: bottom - top - (image?.caption ? 34 : 0) };
  shapes.push(shape(w.nextId++, "Visual panel", box, "roundRect", { fill: theme.panel, line: theme.line, radius: 12 }));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  [180, 130, 80].forEach((size, i) => {
    shapes.push(shape(w.nextId++, "Visual ring", { x: cx - size / 2, y: cy - size / 2, w: size, h: size }, "ellipse", { line: i === 2 ? theme.accent : theme.accentAlt, lineWidth: 1, lineAlpha: i === 2 ? 70 : 26 }));
  });
  shapes.push(
    textShape(
      w.nextId++,
      "Visual label",
      { x: cx - 130, y: cy + 110, w: 260, h: 20 },
      [{ runs: [{ text: "VISUAL PLACEHOLDER", size: 9, color: theme.muted, bold: true, spacing: 2 }], size: 9, align: "ctr" }],
      { anchor: "t", autofit: false, inset: 0 },
      theme,
    ),
  );
  if (image?.caption) {
    shapes.push(
      textShape(
        w.nextId++,
        "Image caption",
        { x: 64, y: bottom - 26, w: 760, h: 20 },
        [{ runs: [{ text: image.caption, size: 10, color: theme.muted }], size: 10 }],
        { anchor: "t", autofit: false },
        theme,
      ),
    );
  }
}

function qrLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  const qr = w.slide.qr;
  if (!qr) return;
  const top = header(w, shapes);
  const rId = qr.dataUrl ? w.addImage(qr.dataUrl) : null;

  const size = 244;
  const card: Box = { x: 72, y: top + 4, w: size + 40, h: size + 40 };
  shapes.push(textShape(w.nextId++, "QR card", card, [], { fill: theme.panel, line: theme.line, radius: 14 }, theme));

  if (rId) {
    shapes.push(pictureFrame(w.nextId++, "QR code", { x: card.x + 20, y: card.y + 20, w: size, h: size }, rId, qr.url));
  } else {
    shapes.push(
      textShape(
        w.nextId++,
        "QR unavailable",
        { x: card.x + 20, y: card.y + 20, w: size, h: size },
        [{ runs: [{ text: "QR unavailable", size: 11, color: theme.muted }], size: 11, align: "ctr" }],
        { anchor: "ctr", line: theme.line, radius: 8 },
        theme,
      ),
    );
  }

  const textX = card.x + card.w + 34;
  const width = SLIDE_W - 64 - textX;
  let y = top + 10;
  shapes.push(
    textShape(
      w.nextId++,
      "QR label",
      { x: textX, y, w: width, h: 30 },
      [
        {
          runs: richRuns(qr.label ?? "Scan to open", { size: 19, bold: true, color: theme.ink }),
          size: 19,
          bold: true,
          lineSpacing: 1.02,
        },
      ],
      { anchor: "t" },
      theme,
    ),
  );
  y += 40;

  if (qr.caption) {
    shapes.push(
      textShape(
        w.nextId++,
        "QR caption",
        { x: textX, y, w: width, h: 70 },
        [{ runs: richRuns(qr.caption, { size: 12, color: theme.muted }), size: 12, lineSpacing: 1.12 }],
        { anchor: "t" },
        theme,
      ),
    );
    y += 76;
  }

  shapes.push(shape(w.nextId++, "QR rule", { x: textX, y, w: 34, h: 3 }, "rect", { fill: theme.accent }));
  shapes.push(
    textShape(
      w.nextId++,
      "QR url",
      { x: textX, y: y + 12, w: width, h: 70 },
      [{ runs: [{ text: qr.url, size: 10.5, color: theme.accent, font: "Consolas" }], size: 10.5, lineSpacing: 1.1 }],
      { anchor: "t" },
      theme,
    ),
  );
}

function coverLayout(w: SlideWriter, shapes: string[]): void {
  const { theme, deck } = w;
  const slide = w.slide;
  const height = w.height;

  shapes.push(shape(w.nextId++, "Cover ring", { x: SLIDE_W - 330, y: -110, w: 420, h: 420 }, "ellipse", { line: theme.accent, lineWidth: 1, lineAlpha: 30 }));
  shapes.push(shape(w.nextId++, "Cover ring 2", { x: SLIDE_W - 250, y: -30, w: 250, h: 250 }, "ellipse", { fill: theme.accent, fillAlpha: 7, line: theme.accent, lineWidth: 0.75, lineAlpha: 18 }));
  shapes.push(shape(w.nextId++, "Cover block", { x: 64, y: 132, w: 64, h: 5 }, "rect", { fill: theme.accent }));

  const kicker = slide.kicker?.trim() || (deck.author ? deck.author.toUpperCase() : "JARVIS DECK STUDIO");
  shapes.push(
    textShape(
      w.nextId++,
      "Cover kicker",
      { x: 64, y: 96, w: 620, h: 16 },
      [{ runs: [{ text: kicker.toUpperCase(), size: 10, color: theme.accent, bold: true, spacing: 2 }], size: 10 }],
      { anchor: "t", autofit: false },
      theme,
    ),
  );

  // A cover title can be long; the box grows downward and the subtitle follows.
  const perLine = Math.floor(620 / (theme.coverSize * 0.5));
  const lines = Math.min(3, Math.max(1, Math.ceil(slide.title.length / perLine)));
  const titleHeight = lines * theme.coverSize * 1.12;
  shapes.push(
    textShape(
      w.nextId++,
      "Cover title",
      { x: 64, y: 160, w: 640, h: titleHeight },
      [{ runs: richRuns(slide.title, { size: theme.coverSize, color: theme.ink, bold: true }), size: theme.coverSize, bold: true, lineSpacing: 0.97 }],
      { anchor: "t" },
      theme,
    ),
  );

  const subtitleY = 160 + titleHeight + 22;
  if (slide.subtitle) {
    shapes.push(
      textShape(
        w.nextId++,
        "Cover subtitle",
        { x: 64, y: subtitleY, w: 600, h: 80 },
        [{ runs: richRuns(slide.subtitle, { size: 17, color: theme.muted, font: theme.bodyFont }), size: 17, lineSpacing: 1.16 }],
        { anchor: "t" },
        theme,
      ),
    );
  }

  const footerY = height - 64;
  shapes.push(shape(w.nextId++, "Cover rule", { x: 64, y: footerY - 22, w: SLIDE_W - 128, h: 0.6 }, "rect", { fill: theme.line, fillAlpha: 70 }));
  shapes.push(
    textShape(
      w.nextId++,
      "Cover footer",
      { x: 64, y: footerY, w: 660, h: 16 },
      [{ runs: [{ text: deck.footer?.trim() || `${new Date().getFullYear()} · built with Jarvis`, size: 9.5, color: theme.muted }], size: 9.5 }],
      { anchor: "t", autofit: false },
      theme,
    ),
  );
  shapes.push(
    textShape(
      w.nextId++,
      "Cover slide count",
      { x: SLIDE_W - 200, y: footerY, w: 136, h: 16 },
      [{ runs: [{ text: `${w.total} SLIDES`, size: 9.5, color: theme.muted, bold: true, spacing: 1.4 }], size: 9.5, align: "r" }],
      { anchor: "t", autofit: false },
      theme,
    ),
  );
}

function closingLayout(w: SlideWriter, shapes: string[]): void {
  const { theme } = w;
  shapes.push(shape(w.nextId++, "Closing ring", { x: SLIDE_W / 2 - 170, y: 96, w: 340, h: 340 }, "ellipse", { line: theme.accent, lineWidth: 0.75, lineAlpha: 24 }));
  shapes.push(
    textShape(
      w.nextId++,
      "Closing title",
      { x: 120, y: 196, w: SLIDE_W - 240, h: 84 },
      [{ runs: richRuns(w.slide.title, { size: 44, color: theme.ink, bold: true }), size: 44, align: "ctr", bold: true }],
      { anchor: "t" },
      theme,
    ),
  );
  shapes.push(shape(w.nextId++, "Closing rule", { x: SLIDE_W / 2 - 26, y: 292, w: 52, h: 3 }, "rect", { fill: theme.accent }));
  if (w.slide.subtitle) {
    shapes.push(
      textShape(
        w.nextId++,
        "Closing subtitle",
        { x: 160, y: 312, w: SLIDE_W - 320, h: 70 },
        [{ runs: [{ text: w.slide.subtitle, size: 14, color: theme.muted }], size: 14, align: "ctr", lineSpacing: 1.15 }],
        { anchor: "t" },
        theme,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Slide assembly
// ---------------------------------------------------------------------------

interface SlideArtifacts {
  xml: string;
  rels: Rel[];
  parts: Part[];
  notes: string | null;
}

function buildSlide(deck: DeckSpec, slide: SlideSpec, index: number, theme: DeckTheme, height: number, media: MediaStore): SlideArtifacts {
  const writer: SlideWriter = {
    theme,
    deck,
    slide,
    index,
    total: deck.slides.length,
    height,
    nextId: 2,
    rels: [],
    parts: [],
    relCounter: 0,
    addImage(dataUrl: string) {
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded) return null;
      media.count += 1;
      const path = `image${media.count}.${decoded.ext}`;
      media.files.set(path, decoded.bytes);
      media.extensions.add(decoded.ext);
      const id = `rId${++this.relCounter}`;
      this.rels.push({ id, type: REL_IMAGE, target: `../media/${path}` });
      return id;
    },
    addChart(chart: ChartData) {
      const path = `chart${++chartCounter.value}.xml`;
      this.parts.push({ path: `ppt/charts/${path}`, xml: chartXml(chart, theme) });
      const id = `rId${++this.relCounter}`;
      this.rels.push({ id, type: REL_CHART, target: `../charts/${path}` });
      return id;
    },
  };

  const shapes: string[] = [];
  switch (slide.kind) {
    case "cover":
      coverLayout(writer, shapes);
      break;
    case "agenda":
      agendaLayout(writer, shapes);
      footer(writer, shapes);
      break;
    case "section":
      sectionLayout(writer, shapes);
      footer(writer, shapes);
      break;
    case "columns":
      columnsLayout(writer, shapes);
      footer(writer, shapes);
      break;
    case "quote":
      quoteLayout(writer, shapes);
      footer(writer, shapes);
      break;
    case "stats":
      statsLayout(writer, shapes);
      footer(writer, shapes);
      break;
    case "timeline":
      timelineLayout(writer, shapes);
      footer(writer, shapes);
      break;
    case "table":
      tableLayout(writer, shapes);
      footer(writer, shapes);
      break;
    case "chart":
      chartLayout(writer, shapes);
      footer(writer, shapes);
      break;
    case "image":
      imageLayout(writer, shapes);
      footer(writer, shapes);
      break;
    case "qr":
      qrLayout(writer, shapes);
      footer(writer, shapes);
      break;
    case "closing":
      closingLayout(writer, shapes);
      footer(writer, shapes);
      break;
    default:
      bulletsLayout(writer, shapes);
      footer(writer, shapes);
      break;
  }

  // Body slides carry the theme's motif in the top-right margin; the cover and
  // the closing already own that space with their own art.
  if (slide.kind !== "cover" && slide.kind !== "closing" && slide.kind !== "section" && slide.kind !== "quote") {
    motif(writer, shapes, { x: 64, y: 40, w: SLIDE_W - 128, h: 60 });
  }

  const transition =
    deck.transition === "none"
      ? ""
      : `<p:transition spd="med">${
          deck.transition === "push"
            ? '<p:push dir="l"/>'
            : deck.transition === "wipe"
              ? '<p:wipe dir="r"/>'
              : "<p:fade/>"
        }</p:transition>`;

  const xml = `${XML_HEAD}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgPr>${solid(theme.bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transition}</p:sld>`;

  return { xml, rels: writer.rels, parts: writer.parts, notes: slide.notes?.trim() || null };
}

// ---------------------------------------------------------------------------
// Package parts
// ---------------------------------------------------------------------------

function themeXml(theme: DeckTheme): string {
  const clr = (name: string, value: string) => `<a:${name}><a:srgbClr val="${hex(value, "000000")}"/></a:${name}>`;
  const font = (name: string, face: string) =>
    `<a:${name}><a:latin typeface="${esc(face)}"/><a:ea typeface="${esc(face)}"/><a:cs typeface="${esc(face)}"/></a:${name}>`;
  const fillStyle = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`;
  return `${XML_HEAD}<a:theme xmlns:a="${NS_A}" name="Jarvis ${esc(theme.label)}"><a:themeElements><a:clrScheme name="Jarvis"><a:dk1><a:srgbClr val="${hex(theme.ink, "000000")}"/></a:dk1><a:lt1><a:srgbClr val="${hex(theme.bg, "FFFFFF")}"/></a:lt1><a:dk2><a:srgbClr val="${hex(theme.ink, "000000")}"/></a:dk2><a:lt2><a:srgbClr val="${hex(theme.panel, "FFFFFF")}"/></a:lt2>${clr("accent1", theme.accent)}${clr("accent2", theme.accentAlt)}${clr("accent3", theme.muted)}${clr("accent4", theme.panelAlt)}${clr("accent5", theme.accent)}${clr("accent6", theme.accentAlt)}${clr("hlink", theme.accent)}${clr("folHlink", theme.muted)}</a:clrScheme><a:fontScheme name="Jarvis">${font("majorFont", theme.headFont)}${font("minorFont", theme.bodyFont)}</a:fontScheme><a:fmtScheme name="Jarvis"><a:fillStyleLst>${fillStyle}${fillStyle}${fillStyle}</a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="28575" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fillStyle}${fillStyle}${fillStyle}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

function masterXml(theme: DeckTheme): string {
  const style = (size: number) =>
    `<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="${size}" kern="1200">${solid(theme.ink)}<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>`;
  return `${XML_HEAD}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgPr>${solid(theme.bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${style(3200)}</p:titleStyle><p:bodyStyle>${style(1600)}</p:bodyStyle><p:otherStyle>${style(1600)}</p:otherStyle></p:txStyles></p:sldMaster>`;
}

function layoutXml(): string {
  return `${XML_HEAD}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function notesMasterXml(theme: DeckTheme): string {
  return `${XML_HEAD}<p:notesMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgPr>${solid(theme.bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Speaker notes</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200">${solid(theme.ink)}<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
}

function notesSlideXml(text: string, theme: DeckTheme): string {
  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map(
      (line) =>
        `<a:p><a:pPr lvl="0"><a:buNone/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" dirty="0">${solid(theme.ink)}<a:latin typeface="${esc(theme.bodyFont)}"/></a:rPr><a:t>${esc(line)}</a:t></a:r></a:p>`,
    )
    .join("");
  return `${XML_HEAD}<p:notes xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

function relsXml(rels: Rel[], extra: Rel[] = []): string {
  return `${XML_HEAD}<Relationships xmlns="${NS_PKG}">${[...extra, ...rels]
    .map((rel) => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${esc(rel.target)}"/>`)
    .join("")}</Relationships>`;
}

const REL = {
  officeDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  core: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  app: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
  slideMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
  slideLayout: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
  notesMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
  slide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  presProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps",
};

function coreXml(deck: DeckSpec): string {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.title)}</dc:title><dc:creator>${esc(deck.author || "Jarvis Deck Studio")}</dc:creator><cp:lastModifiedBy>${esc(deck.author || "Jarvis Deck Studio")}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`;
}

function appXml(slideCount: number, ratio: DeckSpec["ratio"]): string {
  return `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Jarvis Deck Studio</Application><PresentationFormat>${ratio === "4:3" ? "On-screen Show (4:3)" : "Widescreen"}</PresentationFormat><Slides>${slideCount}</Slides><Notes>${slideCount}</Notes><Company></Company><AppVersion>1.0</AppVersion></Properties>`;
}

export interface PptxPackage {
  files: Map<string, string | Uint8Array>;
  width: number;
  height: number;
}

/** Every part of the package, before zipping. Exported for tests. */
export function buildPptxParts(deck: DeckSpec): PptxPackage {
  const theme = themeById(deck.theme);
  const width = SLIDE_W;
  const height = deck.ratio === "4:3" ? 720 : 540;
  const files = new Map<string, string | Uint8Array>();
  const media: MediaStore = { files: new Map(), extensions: new Set(), count: 0 };
  const slideParts: { path: string; relsPath: string; xml: string; rels: Rel[]; notes: string | null }[] = [];
  const chartParts: Part[] = [];
  chartCounter.value = 0;

  const slides = deck.slides.length ? deck.slides : [];
  slides.forEach((slide, index) => {
    const built = buildSlide(deck, slide, index, theme, height, media);
    slideParts.push({
      path: `ppt/slides/slide${index + 1}.xml`,
      relsPath: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      xml: built.xml,
      rels: built.rels,
      notes: built.notes,
    });
    chartParts.push(...built.parts);
  });

  // presentation.xml.rels: master, notes master, then one relationship per slide.
  const presentationRels: Rel[] = [
    { id: "rId1", type: REL.slideMaster, target: "slideMasters/slideMaster1.xml" },
    { id: "rId2", type: REL.notesMaster, target: "notesMasters/notesMaster1.xml" },
  ];
  slides.forEach((_, i) => {
    presentationRels.push({ id: `rId${i + 3}`, type: REL.slide, target: `slides/slide${i + 1}.xml` });
  });

  const slideIds = slides
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`)
    .join("");

    files.set(
    "ppt/presentation.xml",
    `${XML_HEAD}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${emu(width)}" cy="${emu(height)}" type="custom"/><p:notesSz cx="${emu(540)}" cy="${emu(720)}"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`,
  );
  files.set("ppt/_rels/presentation.xml.rels", relsXml(presentationRels));
  files.set("ppt/slideMasters/slideMaster1.xml", masterXml(theme));
  files.set(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    relsXml([{ id: "rId1", type: REL.slideLayout, target: "../slideLayouts/slideLayout1.xml" }, { id: "rId2", type: REL.theme, target: "../theme/theme1.xml" }]),
  );
  files.set("ppt/slideLayouts/slideLayout1.xml", layoutXml());
  files.set("ppt/slideLayouts/_rels/slideLayout1.xml.rels", relsXml([{ id: "rId1", type: REL.slideMaster, target: "../slideMasters/slideMaster1.xml" }]));
  files.set("ppt/theme/theme1.xml", themeXml(theme));
  files.set("ppt/notesMasters/notesMaster1.xml", notesMasterXml(theme));
  files.set("ppt/notesMasters/_rels/notesMaster1.xml.rels", relsXml([{ id: "rId1", type: REL.theme, target: "../theme/theme1.xml" }]));

  let notesIndex = 0;
  slideParts.forEach((part, i) => {
    const notesRel: Rel[] = [];
    if (part.notes) {
      notesIndex += 1;
      files.set(`ppt/notesSlides/notesSlide${notesIndex}.xml`, notesSlideXml(part.notes, theme));
      files.set(`ppt/notesSlides/_rels/notesSlide${notesIndex}.xml.rels`, relsXml([
        { id: "rId1", type: REL_SLIDE_REF, target: `../slides/slide${i + 1}.xml` },
        { id: "rId2", type: REL.notesMaster, target: "../notesMasters/notesMaster1.xml" },
      ]));
      notesRel.push({ id: `rId${part.rels.length + 1}`, type: REL_NOTES, target: `../notesSlides/notesSlide${notesIndex}.xml` });
    }
    files.set(part.path, part.xml);
    files.set(part.relsPath, relsXml([...part.rels, ...notesRel]));
  });

  for (const part of chartParts) files.set(part.path, part.xml);
  for (const [name, bytes] of media.files) files.set(`ppt/media/${name}`, bytes);

  const overrides = [
    ["/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
    ["/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"],
    ["/ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"],
    ["/ppt/notesMasters/notesMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"],
    ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
    ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
    ...slideParts.map((_, i): [string, string] => [
      `/ppt/slides/slide${i + 1}.xml`,
      "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
    ]),
    ...Array.from({ length: notesIndex }, (_, i): [string, string] => [
      `/ppt/notesSlides/notesSlide${i + 1}.xml`,
      "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
    ]),
    ...chartParts.map((part): [string, string] => [
      `/${part.path}`,
      "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
    ]),
  ];

  const defaults = new Set(["png", "jpeg", "gif"]);
  for (const ext of media.extensions) defaults.add(ext);
  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...defaults]
    .map((ext) => `<Default Extension="${ext}" ContentType="image/${ext === "jpg" ? "jpeg" : ext}"/>`)
    .join("")}${overrides
    .map(([name, type]) => `<Override PartName="${name}" ContentType="${type}"/>`)
    .join("")}</Types>`;
  files.set("[Content_Types].xml", contentTypes);
  files.set("_rels/.rels", relsXml([
    { id: "rId1", type: REL.officeDocument, target: "ppt/presentation.xml" },
    { id: "rId2", type: REL.core, target: "docProps/core.xml" },
    { id: "rId3", type: REL.app, target: "docProps/app.xml" },
  ]));
  files.set("docProps/core.xml", coreXml(deck));
  files.set("docProps/app.xml", appXml(slides.length, deck.ratio));

  return { files, width, height };
}

/**
 * Render every QR slide to a PNG part.
 *
 * Encoding is async (it deflates the image), while part assembly is not, so
 * this runs first and attaches a data URL the writer can embed synchronously.
 * The colours are fixed black-on-white rather than themed: a QR code tinted to
 * match a dark slide is prettier and scans worse, and the code has to survive
 * being photographed off a projector.
 */
export async function withQrImages(deck: DeckSpec): Promise<DeckSpec> {
  const slides = await Promise.all(
    deck.slides.map(async (slide) => {
      if (slide.kind !== "qr" || !slide.qr || slide.qr.dataUrl) return slide;
      try {
        const dataUrl = await qrDataUrl(slide.qr.url, { scale: 10, margin: 4 });
        return { ...slide, qr: { ...slide.qr, dataUrl } };
      } catch {
        // A link that cannot be encoded (far too long) leaves the placeholder
        // frame rather than failing the whole download.
        return slide;
      }
    }),
  );
  return { ...deck, slides };
}

/** Build the .pptx bytes. */
export async function buildPptx(deck: DeckSpec): Promise<Uint8Array> {
  const { files } = buildPptxParts(await withQrImages(deck));
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [];
  // [Content_Types].xml must be first: some readers look for it before they
  // trust the rest of the archive, and it costs nothing to be conventional.
  const ordered = [...files.entries()].sort(([a], [b]) =>
    a === "[Content_Types].xml" ? -1 : b === "[Content_Types].xml" ? 1 : a.localeCompare(b),
  );
  for (const [path, data] of ordered) {
    entries.push({ path, data: typeof data === "string" ? encoder.encode(data) : data });
  }
  return zipFiles(entries);
}

/** The filename a browser should save this deck under. */
export function deckFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "deck"}.pptx`;
}
