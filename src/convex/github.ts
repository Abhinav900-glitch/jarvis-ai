"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { parseRepo, repoPath, repoSlug } from "../lib/github";
import { MAX_READ_CHARS } from "../lib/agent-tools";

// ---------------------------------------------------------------------------
// GitHub
//
// One token, two consumers: the `/github` card in chat, and the agent's
// `read_repo` tool. Both read the same repository the same way, so a file the
// card summarises and a file the agent reads cannot be different files.
//
// The token is optional for public repositories, but unauthenticated GitHub
// allows 60 requests an hour per IP — a shared server burns that in a minute.
// A missing token therefore produces a plain "add one" message rather than a
// mystery 403 from deep inside a tool call.
// ---------------------------------------------------------------------------

const API = "https://api.github.com";
/** Larger than this and the contents API starts truncating base64 silently. */
const MAX_FILE_BYTES = 400_000;

function token(): string | undefined {
  return process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim() || undefined;
}

function headers(accept = "application/vnd.github+json"): Record<string, string> {
  const out: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub requires a User-Agent on every request.
    "User-Agent": "jarvis-assistant",
  };
  const t = token();
  if (t) out.Authorization = `Bearer ${t}`;
  return out;
}

/** A GitHub failure as one sentence a person or a model can act on. */
function explain(status: number, slug: string, remaining?: string | null): string {
  if (status === 401) {
    return "GitHub rejected the token — check GITHUB_PERSONAL_ACCESS_TOKEN.";
  }
  if (status === 404) {
    return `Nothing at ${slug} on GitHub. Private repositories need a token with repo access.`;
  }
  if (status === 403) {
    return remaining === "0"
      ? "GitHub rate limit reached. GITHUB_PERSONAL_ACCESS_TOKEN raises it from 60 requests an hour."
      : "GitHub refused the request (403).";
  }
  return `GitHub failed (${status}).`;
}

export interface RepoCard {
  owner: string;
  name: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  license: string | null;
  private: boolean;
  archived: boolean;
  pushedAt: string | null;
  createdAt: string | null;
  topics: string[];
  defaultBranch: string;
  /** README excerpt, empty when the repository has none. */
  readme: string;
}

/**
 * A repository as a card: the handful of facts that answer "what is this?".
 *
 * Not recursive and not paginated — the card is the entry point. Anything more
 * detailed belongs to `read_repo`, which walks a tree on demand.
 */
export const repoCard = action({
  args: { repo: v.string() },
  handler: async (ctx, args): Promise<RepoCard> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to look up a repository.");

    const ref = parseRepo(args.repo);
    if (!ref) {
      throw new Error(
        "Name a repository as owner/name, e.g. /github convex-dev/convex",
      );
    }
    const slug = repoSlug(ref);

    const res = await fetch(`${API}/repos/${slug}`, {
      headers: headers(),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      throw new Error(
        explain(res.status, slug, res.headers.get("x-ratelimit-remaining")),
      );
    }

    const repo = (await res.json()) as {
      html_url?: string;
      description?: string | null;
      stargazers_count?: number;
      forks_count?: number;
      open_issues_count?: number;
      language?: string | null;
      license?: { spdx_id?: string; name?: string } | null;
      private?: boolean;
      archived?: boolean;
      pushed_at?: string | null;
      created_at?: string | null;
      topics?: string[];
      default_branch?: string;
    };

    // A repository without a README is a perfectly good repository, so this is
    // fetched tolerantly and its failure is not the card's failure.
    let readme = "";
    try {
      const readmeRes = await fetch(`${API}/repos/${slug}/readme`, {
        headers: headers("application/vnd.github.raw+json"),
        signal: AbortSignal.timeout(12_000),
      });
      if (readmeRes.ok) readme = (await readmeRes.text()).slice(0, 1800).trim();
    } catch {
      /* no README, or it timed out — the card still renders */
    }

    return {
      owner: ref.owner,
      name: ref.name,
      url: repo.html_url ?? `https://github.com/${slug}`,
      description: repo.description ?? null,
      stars: repo.stargazers_count ?? 0,
      forks: repo.forks_count ?? 0,
      openIssues: repo.open_issues_count ?? 0,
      language: repo.language ?? null,
      license: repo.license?.spdx_id ?? repo.license?.name ?? null,
      private: Boolean(repo.private),
      archived: Boolean(repo.archived),
      pushedAt: repo.pushed_at ?? null,
      createdAt: repo.created_at ?? null,
      topics: (repo.topics ?? []).slice(0, 8),
      defaultBranch: repo.default_branch ?? "main",
      readme,
    };
  },
});

interface ContentsEntry {
  type?: string;
  name?: string;
  path?: string;
  size?: number;
  content?: string;
  encoding?: string;
}

/**
 * Reads one path from a repository: the file's text, or a directory listing.
 *
 * Internal because it is a tool result, not a page: the caller is an agent step
 * that needs text back, so failures throw a sentence the model reads and acts
 * on rather than a structured error a screen would have to interpret.
 */
export const readRepoInternal = internalAction({
  args: {
    repo: v.string(),
    path: v.optional(v.string()),
    ref: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<{ text: string }> => {
    const parsed = parseRepo(args.repo);
    if (!parsed) throw new Error("Expected owner/name for the repository.");
    const slug = repoSlug(parsed);

    const path = repoPath(args.path);
    if (path === null) throw new Error("A repository path may not contain ..");

    const query = args.ref?.trim()
      ? `?ref=${encodeURIComponent(args.ref.trim())}`
      : "";
    const res = await fetch(
      `${API}/repos/${slug}/contents/${path}${query}`,
      { headers: headers(), signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) {
      throw new Error(
        explain(res.status, `${slug}${path ? `/${path}` : ""}`, res.headers.get("x-ratelimit-remaining")),
      );
    }

    const data = (await res.json()) as ContentsEntry | ContentsEntry[];

    if (Array.isArray(data)) {
      const listing = data
        .slice(0, 200)
        .map((entry) => {
          const kind = entry.type === "dir" ? "dir " : "file";
          const size = entry.type === "dir" ? "" : `  ${entry.size ?? 0} B`;
          return `${kind}  ${entry.path ?? entry.name ?? "?"}${size}`;
        })
        .join("\n");
      return {
        text: `${slug}/${path || ""} (${data.length} entries)\n\n${listing}`,
      };
    }

    if (data.type === "dir") {
      // Directories normally arrive as an array; a symlinked one does not.
      return { text: `${slug}/${path} is a directory. Read a path inside it.` };
    }
    if (data.type && data.type !== "file") {
      return { text: `${slug}/${path} is a ${data.type}, not a readable file.` };
    }
    if ((data.size ?? 0) > MAX_FILE_BYTES) {
      throw new Error(
        `${slug}/${path} is ${Math.round((data.size ?? 0) / 1024)} kB — too large to read whole. Read a directory around it and pick a smaller file.`,
      );
    }

    const text =
      data.encoding === "base64" && data.content
        ? Buffer.from(data.content, "base64").toString("utf8")
        : "";

    if (!text) {
      throw new Error(`${slug}/${path} came back empty.`);
    }

    const clipped =
      text.length > MAX_READ_CHARS
        ? `${text.slice(0, MAX_READ_CHARS)}\n\n[truncated: ${text.length - MAX_READ_CHARS} more characters]`
        : text;

    return { text: `${slug}/${path}\n\n${clipped}` };
  },
});
