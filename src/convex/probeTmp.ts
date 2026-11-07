"use node";

// TEMPORARY — verification probe, deleted immediately after running.
import { action } from "./_generated/server";

export const probe = action({
  args: {},
  handler: async () => {
    const nvidiaKey =
      process.env.NVIDIA_API_KEY?.trim() ||
      process.env.NVIDIA_NIM_API_KEY?.trim() ||
      process.env.NGC_API_KEY?.trim() ||
      null;

    // Names only, never values: the exact env name the platform chose is
    // needed to read the key, and guessing it wrong fails silently.
    const falNames = Object.keys(process.env).filter(
      (k) => /fal|flux/i.test(k) && !/PATH|npm_|NODE_/i.test(k),
    );

    const out: Record<string, unknown> = { falNames };

    if (nvidiaKey) {
      try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
          timeout: 60_000,
          headers: { authorization: `Bearer ${nvidiaKey}` },
          signal: AbortSignal.timeout(60_000),
        } as RequestInit);
        const body = (await res.json().catch(() => null)) as
          | { data?: { id?: string }[] }
          | null;
        const ids = (body?.data ?? []).map((m) => m.id ?? "").filter(Boolean);
        out.nvidiaStatus = res.status;
        out.nvidiaCount = ids.length;
        // Only the families this app might route to, so the list stays short.
        out.nvidiaCandidates = ids.filter((id) =>
          /llama|nemotron|qwen|deepseek|gpt-oss|mistral|glm|kimi/i.test(id),
        );
      } catch (err) {
        out.nvidiaError = err instanceof Error ? err.message : String(err);
      }
    }

    return out;
  },
});
