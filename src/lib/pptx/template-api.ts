// ---------------------------------------------------------------------------
// PowerPoint Generator API — filling a .pptx template.
//
// This is a different product from the deck writer next door. Their API does
// not generate a deck from a prompt: it takes a PowerPoint file you already
// designed and replaces `{{tags}}` inside it, repeating a template slide once
// per deck slide. The value is the template — a company master, a brand theme,
// a layout the legal team approved — which the native writer cannot imitate.
//
// The contract, from the docs:
//   POST https://gen.powerpointgeneratorapi.com/v1.0/generator/create
//   Authorization: Bearer <token>, multipart/form-data
//   files     — the .pptx template (and any images)
//   jsonData  — { presentation: { template, export_version, slides: [...] } }
//   → 200 returns the finished .pptx as a binary stream
//
// Everything here is pure so the payload can be tested without the service.
// ---------------------------------------------------------------------------

import type { DeckSpec, SlideSpec } from "./spec";

export const TEMPLATE_API_BASE = "https://gen.powerpointgeneratorapi.com/v1.0";

/** The env var a bearer token is read from. Never the security key. */
export const TEMPLATE_TOKEN_ENV = "POWERPOINT_GENERATOR_TOKEN";

export type TemplateExportVersion = "Pptx2010" | "Pptx2013" | "Pptx2019";

export interface TemplateTag {
  key: string;
  value: string;
}

/**
 * Tags offered to a template.
 *
 * `body` is a single joined line and `body_1`…`body_6` are the individual
 * points, because replacing a tag swaps text inside one run: a template author
 * who wants real paragraphs needs one tag per bullet rather than a newline the
 * service cannot turn into a paragraph.
 */
export function slideTags(slide: SlideSpec, index: number, total: number): TemplateTag[] {
  const body = (slide.body ?? []).map((line) => line.replace(/\*\*/g, "").trim()).filter(Boolean);
  const date = new Date();
  const tags: TemplateTag[] = [
    { key: "index", value: String(index + 1) },
    { key: "total", value: String(total) },
    { key: "number", value: String(index + 1).padStart(2, "0") },
    { key: "title", value: slide.title },
    { key: "kicker", value: slide.kicker ?? "" },
    { key: "subtitle", value: slide.subtitle ?? "" },
    { key: "kind", value: slide.kind },
    { key: "body", value: body.join(" • ") },
    { key: "notes", value: slide.notes ?? "" },
    { key: "year", value: String(date.getFullYear()) },
  ];

  body.slice(0, 6).forEach((line, i) => {
    tags.push({ key: `body_${i + 1}`, value: line });
  });
  for (let i = body.length; i < 6; i += 1) {
    tags.push({ key: `body_${i + 1}`, value: "" });
  }

  if (slide.quote) {
    tags.push({ key: "quote", value: slide.quote.text });
    tags.push({ key: "quote_author", value: slide.quote.attribution ?? "" });
  }
  if (slide.metrics?.length) {
    slide.metrics.slice(0, 4).forEach((metric, i) => {
      tags.push({ key: `metric_${i + 1}_value`, value: metric.value });
      tags.push({ key: `metric_${i + 1}_label`, value: metric.label });
    });
  }
  if (slide.qr?.url) {
    tags.push({ key: "qr_url", value: slide.qr.url });
    tags.push({ key: "qr_label", value: slide.qr.label ?? "" });
  }
  if (slide.table) {
    // Cells are addressed by position, so a template table can be labelled
    // `{{cell_2_1}}` in the cell that should receive row 2, column 1.
    slide.table.rows.slice(0, 6).forEach((row, r) => {
      row.slice(0, 5).forEach((cell, c) => {
        tags.push({ key: `cell_${r + 1}_${c + 1}`, value: cell });
      });
    });
  }
  return tags;
}

export interface TemplatePayloadOptions {
  /** The upload name, which must match `presentation.template`. */
  templateName: string;
  /** Template slide to repeat for every deck slide (0-based). */
  slideIndex?: number;
  exportVersion?: TemplateExportVersion;
  /** Output name without the extension. */
  fileName?: string;
}

/**
 * Build the `jsonData` payload.
 *
 * Every deck slide is a separate entry pointing at the same template slide, so
 * the template is repeated rather than the deck being squeezed into it. The
 * presentation-level tags carry the deck's own metadata, for a cover the
 * template may reuse.
 */
export function buildTemplatePayload(deck: DeckSpec, options: TemplatePayloadOptions): unknown {
  const slideIndex = Math.max(0, Math.round(options.slideIndex ?? 0));
  const total = deck.slides.length;
  return {
    presentation: {
      template: options.templateName,
      export_version: options.exportVersion ?? "Pptx2019",
      resultFileName: options.fileName ?? "deck",
      tags: [
        { key: "deck_title", value: deck.title },
        { key: "deck_subtitle", value: deck.subtitle ?? "" },
        { key: "deck_author", value: deck.author ?? "" },
        { key: "deck_footer", value: deck.footer ?? "" },
        { key: "deck_slides", value: String(total) },
      ],
      slides: deck.slides.map((slide, index) => ({
        type: "slide",
        slide_index: slideIndex,
        tags: slideTags(slide, index, total),
      })),
    },
  };
}

/** A toast-ready sentence for a failed call, from their documented codes. */
export function describeTemplateError(status: number, body: string): string {
  const text = body.trim();
  let message = "";
  try {
    const parsed = JSON.parse(text) as { message?: string; detail?: string; details?: string };
    message = [parsed.message, parsed.detail ?? parsed.details].filter(Boolean).join(" — ");
  } catch {
    message = text.slice(0, 200);
  }
  if (status === 401) {
    return "The PowerPoint Generator token is missing, expired, or invalid. Generate a new bearer token and update POWERPOINT_GENERATOR_TOKEN.";
  }
  if (status === 429) {
    return `The PowerPoint Generator quota is exhausted. ${message}`.trim();
  }
  if (status === 400) {
    return `The template was rejected. ${message}`.trim();
  }
  return `PowerPoint Generator failed (${status}). ${message}`.trim();
}
