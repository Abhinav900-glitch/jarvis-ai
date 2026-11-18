// The deck detector decides whether a sentence becomes a .pptx or a chat
// reply, so both directions matter: the asks that should reach the deck studio,
// and the ones that must stay conversational.

import { describe, expect, test } from "bun:test";
import { deckTopicFrom } from "../deck-request";

describe("deckTopicFrom", () => {
  test("an imperative deck request becomes the topic", () => {
    expect(deckTopicFrom("make me a ppt on on-device AI")).toBe(
      "make me a ppt on on-device AI",
    );
    expect(deckTopicFrom("Create a 10 slide deck about our Q3 numbers")).toContain(
      "10 slide deck",
    );
    expect(deckTopicFrom("Build a PowerPoint for the board meeting")).not.toBeNull();
    expect(deckTopicFrom("generate a presentation on Rust ownership")).not.toBeNull();
    expect(deckTopicFrom("put together a slide deck for new hires")).not.toBeNull();
  });

  test("whitespace is collapsed, so the topic is one clean line", () => {
    expect(deckTopicFrom("  make   a\n ppt  on\u00a0 AI  ")).toBe(
      "make a ppt on AI",
    );
  });

  test("questions stay chat", () => {
    expect(deckTopicFrom("how do I make a ppt in PowerPoint?")).toBeNull();
    expect(deckTopicFrom("can you make a deck of these notes")).toBeNull();
    expect(deckTopicFrom("what makes a good presentation")).toBeNull();
  });

  test("advice about slides is not a deck request", () => {
    expect(deckTopicFrom("make a list of tips for better presentations")).toBeNull();
    expect(deckTopicFrom("build an outline for my presentation")).toBeNull();
    expect(deckTopicFrom("create example slides for the training guide")).toBeNull();
  });

  test("a verb without a deck noun is ordinary prose", () => {
    expect(deckTopicFrom("make me a table of the sales numbers")).toBeNull();
    expect(deckTopicFrom("build the landing page copy")).toBeNull();
    expect(deckTopicFrom("")).toBeNull();
    expect(deckTopicFrom("   ")).toBeNull();
  });

  test("a paragraph too long for a topic is not intercepted", () => {
    expect(deckTopicFrom(`make a ppt ${"about things ".repeat(40)}`)).toBeNull();
  });
});
