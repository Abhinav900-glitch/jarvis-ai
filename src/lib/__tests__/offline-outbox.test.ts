import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearOutbox,
  readOutbox,
  writeOutbox,
} from "../offline-outbox";

// The outbox only ever touches localStorage; a small in-memory stand-in keeps
// these tests independent of whether the runtime provides one.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  value: storage,
  configurable: true,
});

describe("offline outbox", () => {
  beforeEach(() => storage.clear());

  test("round-trips a queued message", () => {
    writeOutbox({ text: "Summarise this when I'm back", sessionId: "k123", savedAt: 42 });
    expect(readOutbox()).toEqual({
      text: "Summarise this when I'm back",
      sessionId: "k123",
      savedAt: 42,
    });
  });

  test("normalises a missing session to null", () => {
    writeOutbox({ text: "New chat question", sessionId: null, savedAt: 7 });
    expect(readOutbox()?.sessionId).toBeNull();
  });

  test("ignores an empty message", () => {
    writeOutbox({ text: "   ", sessionId: null, savedAt: 1 });
    expect(readOutbox()).toBeNull();
  });

  test("ignores corrupt JSON instead of throwing", () => {
    localStorage.setItem("jarvis-offline-outbox", "{not json");
    expect(readOutbox()).toBeNull();
  });

  test("clear removes the queued message", () => {
    writeOutbox({ text: "hello", sessionId: null, savedAt: 1 });
    clearOutbox();
    expect(readOutbox()).toBeNull();
  });
});
