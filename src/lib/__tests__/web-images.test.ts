import { describe, expect, test } from "bun:test";
import { findWebImageQuery } from "../web-images";

describe("findWebImageQuery", () => {
  // The shape that produced "I cannot display a live image gallery" — a bare
  // request the chat path answered with links instead of pictures.
  test("bare noun-first requests", () => {
    expect(findWebImageQuery("images of Robert Downey Jr.")).toBe(
      "Robert Downey Jr.",
    );
    expect(findWebImageQuery("photos of the moon")).toBe("the moon");
    expect(findWebImageQuery("pictures of northern lights")).toBe(
      "northern lights",
    );
    expect(findWebImageQuery("pics of my dog")).toBe("my dog");
  });

  test("polite and verb-led phrasings", () => {
    expect(findWebImageQuery("show me pictures of cats")).toBe("cats");
    expect(findWebImageQuery("can you show me some photos of Paris")).toBe(
      "Paris",
    );
    expect(findWebImageQuery("find images of the Eiffel Tower")).toBe(
      "the Eiffel Tower",
    );
    expect(findWebImageQuery("i want to see photos of kittens")).toBe(
      "kittens",
    );
    expect(findWebImageQuery("jarvis, search for images of mars")).toBe("mars");
  });

  test("subject-last requests", () => {
    expect(findWebImageQuery("Robert Downey Jr. images")).toBe(
      "Robert Downey Jr.",
    );
    expect(findWebImageQuery("Northern lights photos")).toBe("Northern lights");
  });

  test("trailing punctuation and quotes are noise, not query", () => {
    expect(findWebImageQuery("photos of the moon?")).toBe("the moon");
    expect(findWebImageQuery('photos of "the sun"')).toBe("the sun");
  });

  test("creation verbs belong to the image generator", () => {
    expect(findWebImageQuery("generate an image of a dragon")).toBeNull();
    expect(findWebImageQuery("make me a picture of a castle")).toBeNull();
    expect(findWebImageQuery("draw a painting of my house")).toBeNull();
    expect(findWebImageQuery("please render an illustration of a fox")).toBeNull();
    expect(findWebImageQuery("hey jarvis create an image of a logo")).toBeNull();
  });

  test("a question about pictures is not a request for pictures", () => {
    expect(
      findWebImageQuery("what do you think about pictures of my holiday"),
    ).toBeNull();
    expect(findWebImageQuery("tell me about images of the surgery")).toBeNull();
    expect(findWebImageQuery("describe photos of the accident")).toBeNull();
    expect(findWebImageQuery("should i use pictures of the moon")).toBeNull();
  });

  test("messages that are not asking for images", () => {
    expect(findWebImageQuery("hello, how are you today?")).toBeNull();
    expect(findWebImageQuery("the images look blurry")).toBeNull();
    expect(findWebImageQuery("these images")).toBeNull();
    expect(findWebImageQuery("what images do you have")).toBeNull();
    expect(findWebImageQuery("photos of")).toBeNull();
    expect(findWebImageQuery("I cannot display a live image gallery")).toBeNull();
    expect(findWebImageQuery("see https://example.com/images")).toBeNull();
  });
});
