// ---------------------------------------------------------------------------
// GitHub identifiers.
//
// Kept out of the Convex module so the parsing that decides *which repository*
// is being talked about can be tested without a token, a network or a database.
// Both the `/github` card and the agent's `read_repo` tool go through here, so
// they cannot disagree about whether `git@github.com:owner/name.git` counts.
// ---------------------------------------------------------------------------

export interface RepoRef {
  owner: string;
  name: string;
}

/**
 * Accepts `owner/name`, a github.com URL (with or without a `/tree/...` path),
 * and a clone-style `git@github.com:owner/name.git`.
 *
 * Returns null rather than guessing: a wrong repository is worse than a clear
 * "name it as owner/name".
 */
export function parseRepo(raw: string): RepoRef | null {
  if (!raw) return null;
  let text = raw.trim();
  text = text.replace(/^git@github\.com:/i, "");
  text = text.replace(/^ssh:\/\/git@github\.com\//i, "");
  text = text.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  text = text.replace(/^(www\.)?github\.com\//i, "");
  text = text.replace(/[?#].*$/, "");
  text = text.replace(/\.git$/i, "").replace(/\/+$/, "");

  const parts = text.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const [owner, name] = parts;
  // GitHub allows letters, digits, dots, hyphens and underscores. Anything else
  // is a typo or an attempt to steer the request elsewhere — and `.`/`..` pass
  // that test while naming a directory, not a repository.
  const valid = /^[A-Za-z0-9._-]+$/;
  if (!valid.test(owner) || !valid.test(name)) return null;
  if (owner === "." || owner === ".." || name === "." || name === "..") {
    return null;
  }

  return { owner, name };
}

/**
 * A path inside a repository, normalized for the contents API.
 *
 * An empty path means the repository root. `..` segments are refused outright:
 * they cannot escape the API's own path handling, but they make a tool call
 * ambiguous about what it read.
 */
export function repoPath(raw: string | undefined): string | null {
  if (!raw) return "";
  const segments = raw
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  if (segments.some((s) => s === "..")) return null;
  return segments.join("/");
}

/** "owner/name" for display and API paths. */
export function repoSlug(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}
