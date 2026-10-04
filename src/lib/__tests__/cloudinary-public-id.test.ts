// Regression tests for the signed-upload `public_id`.
//
// The bug: `getSignedUploadUrl` built `public_id` as `folder/name-timestamp`
// while also sending `folder` separately. Cloudinary joins the two, so every
// upload landed at `folder/folder/name` — the chat image path and the Puter
// path alike, because both go through this one action.
//
// Verified against the live service on 2026-10-03: an upload issued a
// `public_id` of `jarvis-verify/1791088632-w4x35i`, and Cloudinary stored it as
// `jarvis-verify/jarvis-verify/1791088632-w4x35i`.

import { describe, expect, test } from "bun:test";
import { buildPublicId } from "../../convex/cloudinary";

const TS = 1_700_000_000;

describe("buildPublicId", () => {
  test("is folder-relative, never prefixed with the folder", () => {
    // The regression. Cloudinary concatenates `folder` + `public_id`, so any
    // prefix here is duplicated on disk.
    for (const folder of ["jarvis-chat", "jarvis-verify", "a/b/c"]) {
      const id = buildPublicId("my cat photo.png", folder, TS);
      expect(id.startsWith(`${folder}/`)).toBe(false);
      expect(id.startsWith("/")).toBe(false);
      expect(id).not.toContain(folder);
    }
  });

  test("stays single-segment so no extra directory level appears", () => {
    expect(
      buildPublicId("photo.png", "jarvis-chat", TS).split("/"),
    ).toHaveLength(1);
  });

  test("sanitises a user filename into something Cloudinary accepts", () => {
    const id = buildPublicId("my cat photo.png", "jarvis-chat", TS);
    expect(id).toMatch(/^my_cat_photo-\d{10}-[a-z0-9]+$/);
  });

  test("strips the extension", () => {
    expect(buildPublicId("report.pdf", "jarvis-chat", TS)).toMatch(
      /^report-\d{10}-[a-z0-9]+$/,
    );
  });

  test("caps a very long filename", () => {
    const id = buildPublicId(`${"a".repeat(500)}.png`, "jarvis-chat", TS);
    expect(id.length).toBeLessThanOrEqual(60 + 1 + String(TS).length + 1 + 6);
  });

  test("falls back to a timestamped random id when no filename is given", () => {
    // The Puter flow, which names its own files, and the signed-upload action
    // called with no filename at all.
    const id = buildPublicId(undefined, "jarvis-chat", TS);
    expect(id).toMatch(/^\d{10}-[a-z0-9]+$/);
    expect(id).not.toContain("/");
  });

  test("produces distinct ids for simultaneous uploads", () => {
    // Without the random suffix, two images uploaded in the same second would
    // collide on one public_id and the second would overwrite the first.
    const ids = new Set(
      Array.from({ length: 50 }, () =>
        buildPublicId(undefined, "jarvis-chat", TS),
      ),
    );
    expect(ids.size).toBe(50);
  });

  test("does not collide when the same filename uploads twice in one second", () => {
    // Caught by this test: the filename branch originally had no random suffix,
    // so `photo.png` twice in one second produced an identical `public_id` and
    // Cloudinary replaced the first asset instead of adding a second one.
    const ids = new Set(
      Array.from({ length: 50 }, () =>
        buildPublicId("photo.png", "jarvis-chat", TS),
      ),
    );
    expect(ids.size).toBe(50);
  });

  test("still ends with a filename-derived stem, so assets stay findable", () => {
    // The random suffix must not replace the readable name entirely — it is
    // appended, so a chat history still shows which file this was.
    expect(buildPublicId("holiday photo.png", "jarvis-chat", TS)).toMatch(
      /^holiday_photo-/,
    );
  });
});
