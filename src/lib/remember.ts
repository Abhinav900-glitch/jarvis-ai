// ---------------------------------------------------------------------------
// Turning a reply into something worth remembering.
//
// A memory is one sentence about the user or their work, not a copy of the
// answer. Markdown is stripped before it is stored so the recall prompt reads
// "Prefers Cambria for long documents" rather than a wall of asterisks, and the
// result is capped to the same 280 characters the server enforces — doing it
// here means the UI can show exactly what will be kept.
// ---------------------------------------------------------------------------

export const MEMORY_MAX = 280;

export function memoryExcerpt(content: string): string {
  const plain = content
    // Fenced code first: its contents are syntax, not prose, and a half-copied
    // block reads as nonsense in a memory.
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    // Links keep their text, lose the target.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>~|]/g, " ")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) return "";
  return plain.length > MEMORY_MAX ? `${plain.slice(0, MEMORY_MAX - 1).trimEnd()}…` : plain;
}
