import { describe, expect, test } from "bun:test";
import { toCanvaAspectRatio, toCanvaModel } from "../../convex/canva";

describe("canva aspect ratio mapping", () => {
  test("maps the app's landscape ratio to Canva's landscape", () => {
    expect(toCanvaAspectRatio("3:2")).toBe("landscape");
  });

  test("maps the app's portrait ratio to Canva's portrait", () => {
    expect(toCanvaAspectRatio("2:3")).toBe("portrait");
  });

  test("maps 1:1 to square", () => {
    expect(toCanvaAspectRatio("1:1")).toBe("square");
  });

  // Canva's enum is square|landscape|portrait only. Anything else sent
  // through would be rejected as an invalid parameter, so the default has to
  // be a value Canva definitely accepts.
  test("falls back to square for an absent or unrecognised ratio", () => {
    expect(toCanvaAspectRatio(undefined)).toBe("square");
    expect(toCanvaAspectRatio("16:9")).toBe("square");
    expect(toCanvaAspectRatio("banana")).toBe("square");
  });

  test("never returns a value outside Canva's enum", () => {
    for (const input of ["1:1", "3:2", "2:3", "", "16:9"]) {
      expect(["square", "landscape", "portrait"]).toContain(
        toCanvaAspectRatio(input),
      );
    }
  });
});

describe("canva model mapping", () => {
  test("passes through a model Canva actually offers", () => {
    expect(toCanvaModel("lucid_origin")).toBe("lucid_origin");
    expect(toCanvaModel("z_image_turbo")).toBe("z_image_turbo");
  });

  // Canva documents that it never substitutes a model: an unknown model
  // fails the job outright. Dropping it lets Canva choose instead.
  test("drops another provider's model rather than forwarding it", () => {
    expect(toCanvaModel("flux")).toBeUndefined();
    expect(toCanvaModel("gpt-image-1")).toBeUndefined();
    expect(toCanvaModel("nano-banana")).toBeUndefined();
    expect(toCanvaModel("default")).toBeUndefined();
  });

  test("treats an absent model as 'let Canva choose'", () => {
    expect(toCanvaModel(undefined)).toBeUndefined();
    expect(toCanvaModel("")).toBeUndefined();
  });

  test("never returns a value outside Canva's enum", () => {
    for (const input of ["flux", "default", "lucid_origin", "sdxl"]) {
      const mapped = toCanvaModel(input);
      expect(mapped === undefined || CANVA_ENUM.includes(mapped)).toBe(true);
    }
  });
});

const CANVA_ENUM = ["lucid_origin", "z_image_turbo"];
