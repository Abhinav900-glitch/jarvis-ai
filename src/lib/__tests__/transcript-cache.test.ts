import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearCachedTranscript,
  readCachedTranscript,
  saveTranscript,
} from "../transcript-cache";

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

describe("offline transcript cache", () => {
  beforeEach(() => storage.clear());

  test("round-trips the last conversation", () => {
    const saved = saveTranscript("session-1", "Planning a trip", [
      { id: "m1", role: "user", content: "Where should I go?", createdAt: 1 },
      { id: "m2", role: "assistant", content: "Kyoto in spring.", createdAt: 2 },
    ]);

    expect(saved?.messages).toHaveLength(2);
    expect(readCachedTranscript()).toMatchObject({
      sessionId: "session-1",
      title: "Planning a trip",
      messages: [
        { id: "m1", content: "Where should I go?" },
        { id: "m2", content: "Kyoto in spring." },
      ],
    });
  });

  test("keeps the newest tail when the transcript is long", () => {
    const messages = Array.from({ length: 120 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
      createdAt: i,
    }));

    const saved = saveTranscript("session-2", "Long chat", messages);
    expect(saved?.messages).toHaveLength(80);
    expect(saved?.messages[0].id).toBe("m40");
    expect(saved?.messages[saved.messages.length - 1]?.id).toBe("m119");
  });

  test("drops empty turns rather than saving them", () => {
    const saved = saveTranscript("session-3", "Blank", [
      { id: "u1", role: "user", content: "", createdAt: 1 },
      { id: "a1", role: "assistant", content: "Only this counts.", createdAt: 2 },
    ]);
    expect(saved?.messages.map((m) => m.id)).toEqual(["a1"]);
  });

  test("rejects corrupt or versionless data", () => {
    localStorage.setItem("jarvis-offline-transcript", "{not json");
    expect(readCachedTranscript()).toBeNull();

    localStorage.setItem(
      "jarvis-offline-transcript",
      JSON.stringify({ sessionId: "x", messages: [] }),
    );
    expect(readCachedTranscript()).toBeNull();
  });

  test("clear removes the saved copy", () => {
    saveTranscript("session-4", "Anything", [
      { id: "u1", role: "user", content: "hi", createdAt: 1 },
    ]);
    clearCachedTranscript();
    expect(readCachedTranscript()).toBeNull();
  });
});
