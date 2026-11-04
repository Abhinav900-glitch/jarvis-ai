import { describe, expect, test } from "bun:test";
import {
  draftKeyFor,
  loadDraft,
  NEW_CHAT_DRAFT_KEY,
  saveDraft,
} from "../chat-drafts";

function makeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe("draftKeyFor", () => {
  test("one key per conversation, one for the unsaved composer", () => {
    expect(draftKeyFor("abc123")).toBe("jarvis-draft:abc123");
    expect(draftKeyFor(null)).toBe(NEW_CHAT_DRAFT_KEY);
    expect(draftKeyFor(undefined)).toBe(NEW_CHAT_DRAFT_KEY);
  });
});

describe("saveDraft and loadDraft", () => {
  test("round-trips text under its own key", () => {
    const storage = makeStorage();
    saveDraft(draftKeyFor("a"), "half a thought", storage);
    saveDraft(draftKeyFor("b"), "another", storage);

    expect(loadDraft(draftKeyFor("a"), storage)).toBe("half a thought");
    expect(loadDraft(draftKeyFor("b"), storage)).toBe("another");
  });

  test("clears rather than storing an empty draft", () => {
    const storage = makeStorage();
    saveDraft(draftKeyFor("a"), "text", storage);
    saveDraft(draftKeyFor("a"), "", storage);

    expect(storage.map.has("jarvis-draft:a")).toBe(false);
    expect(loadDraft(draftKeyFor("a"), storage)).toBe("");
  });

  test("whitespace-only is not a draft", () => {
    const storage = makeStorage();
    saveDraft(draftKeyFor("a"), "   \n\t ", storage);
    expect(storage.map.size).toBe(0);
  });

  test("loads empty for an unknown key", () => {
    expect(loadDraft("jarvis-draft:nobody", makeStorage())).toBe("");
  });
});

describe("storage that refuses", () => {
  const hostile = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };

  test("reading a blocked storage yields an empty draft, not a crash", () => {
    expect(loadDraft("jarvis-draft:a", hostile)).toBe("");
  });

  test("writing to a blocked storage is swallowed", () => {
    expect(() => saveDraft("jarvis-draft:a", "text", hostile)).not.toThrow();
  });
});
