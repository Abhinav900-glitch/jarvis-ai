// ---------------------------------------------------------------------------
// Which conversions a file is offered.
//
// The conversion itself happens on ConvertAPI's servers, so the only thing the
// app has to get right is the question it asks. That is this file: a short,
// deliberate list per kind of document instead of "every format the service
// knows", because a dropdown of 500 extensions is not a feature.
//
// Shared by the panel and by the action, so the button a client sees and the
// target the server accepts cannot drift apart — the action validates against
// exactly the list rendered here.
// ---------------------------------------------------------------------------

export interface ConversionTarget {
  /** The extension ConvertAPI is asked for, without a dot. */
  ext: string;
  label: string;
}

const PDF: ConversionTarget = { ext: "pdf", label: "PDF" };
const DOCX: ConversionTarget = { ext: "docx", label: "Word" };
const TXT: ConversionTarget = { ext: "txt", label: "Text" };
const HTML: ConversionTarget = { ext: "html", label: "HTML" };
const JPG: ConversionTarget = { ext: "jpg", label: "JPG" };
const PNG: ConversionTarget = { ext: "png", label: "PNG" };
const XLSX: ConversionTarget = { ext: "xlsx", label: "Excel" };
const CSV: ConversionTarget = { ext: "csv", label: "CSV" };
const PPTX: ConversionTarget = { ext: "pptx", label: "Slides" };
const WEBP: ConversionTarget = { ext: "webp", label: "WebP" };
const GIF: ConversionTarget = { ext: "gif", label: "GIF" };

/** Extensions grouped by the conversions that actually make sense for them. */
const BY_KIND: Record<string, ConversionTarget[]> = {
  pdf: [DOCX, TXT, HTML, JPG, PNG, XLSX],
  doc: [PDF, DOCX, TXT, HTML, JPG],
  docx: [PDF, TXT, HTML, JPG],
  odt: [PDF, DOCX, TXT, HTML],
  rtf: [PDF, DOCX, TXT, HTML],
  txt: [PDF, DOCX, HTML, TXT],
  md: [PDF, HTML, DOCX],
  xls: [PDF, XLSX, CSV, HTML, JPG],
  xlsx: [PDF, CSV, HTML, JPG],
  ods: [PDF, XLSX, CSV, HTML],
  csv: [PDF, XLSX, HTML, TXT],
  ppt: [PDF, PPTX, JPG, PNG],
  pptx: [PDF, JPG, PNG, HTML],
  odp: [PDF, PPTX, JPG],
  png: [PDF, JPG, WEBP, GIF],
  jpg: [PDF, PNG, WEBP, GIF],
  jpeg: [PDF, PNG, WEBP, GIF],
  webp: [PDF, JPG, PNG, GIF],
  gif: [PDF, JPG, PNG, WEBP],
  bmp: [PDF, JPG, PNG],
  tiff: [PDF, JPG, PNG],
  tif: [PDF, JPG, PNG],
  svg: [PDF, JPG, PNG],
  heic: [PDF, JPG, PNG],
  html: [PDF, DOCX, TXT, JPG],
};

/** A source the service can read but that has no curated list above. */
const FALLBACK: ConversionTarget[] = [PDF, JPG];

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  svg: "image/svg+xml",
  heic: "image/heic",
};

export function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

/** The targets offered for a file, or an empty list when it cannot convert. */
export function conversionTargets(fileName: string): ConversionTarget[] {
  const ext = extensionOf(fileName);
  if (!ext) return [];
  const listed = BY_KIND[ext];
  if (listed) return listed;
  // Unknown-but-plausible documents still get the two conversions that are
  // worth trying; a file the service cannot read fails with its own message.
  return FALLBACK;
}

export function mimeForTarget(ext: string): string {
  return MIME[ext] ?? "application/octet-stream";
}

/**
 * The name of the converted file.
 *
 * The base name keeps its own dots (`q3.report.v2.docx` → `q3.report.v2.pdf`)
 * and loses the conversion suffix, so a second pass does not produce
 * `q3.report.v2.pdf.pdf`.
 */
export function convertedName(fileName: string, ext: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").trim() || "converted";
  return `${base.slice(0, 100)}.${ext}`;
}

/** A target for a file, or null when that pair was never on offer. */
export function findTarget(fileName: string, ext: string): ConversionTarget | null {
  return conversionTargets(fileName).find((target) => target.ext === ext.toLowerCase()) ?? null;
}
