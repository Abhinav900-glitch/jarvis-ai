// ---------------------------------------------------------------------------
// Space & screen lookups.
//
// Three read-only actions behind `/movie`, `/nasa` and `/isro`. Each one is
// written to fail with a sentence a person can act on — a missing key, an
// upstream outage, or a title that simply does not exist — because these are
// typed by hand into a chat box, not called by another program.
//
// Keys (Keys tab): OMDB_API_KEY for films; NASA_API_KEY for the space image
// (DEMO_KEY is used when absent, at NASA's much stricter rate limit). ISRO's
// launch schedule comes from Launch Library 2 and needs no key at all.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action } from "./_generated/server";

const TIMEOUT_MS = 20_000;

async function fetchJson(url: string): Promise<{ status: number; body: unknown; text: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

function omdbKey(): string | null {
  return (
    process.env.OMDB_API_KEY?.trim() ||
    process.env.OMDB_API_KEY_2?.trim() ||
    null
  );
}

interface OmdbSearchHit {
  Title?: string;
  Year?: string;
  imdbID?: string;
  Type?: string;
  Poster?: string;
}

interface OmdbTitle {
  Response?: string;
  Error?: string;
  Title?: string;
  Year?: string;
  Rated?: string;
  Released?: string;
  Runtime?: string;
  Genre?: string;
  Director?: string;
  Writer?: string;
  Actors?: string;
  Plot?: string;
  Language?: string;
  Country?: string;
  Awards?: string;
  Poster?: string;
  Ratings?: { Source?: string; Value?: string }[];
  Metascore?: string;
  imdbRating?: string;
  imdbVotes?: string;
  imdbID?: string;
  Type?: string;
  BoxOffice?: string;
  totalSeasons?: string;
  Response2?: string;
}

/**
 * OMDb's `s=` search returns titles and posters but no plot, rating or cast, so
 * the search is used only to resolve an IMDb id and the details endpoint does
 * the real work. A bare `tt…` id skips the search entirely.
 */
export const lookupMovie = action({
  args: { query: v.string() },
  handler: async (_ctx, args) => {
    const key = omdbKey();
    if (!key) {
      throw new Error(
        "OMDB_API_KEY is not configured — add it in the Keys tab to look films up.",
      );
    }
    const query = args.query.trim();
    if (!query) throw new Error("Usage: /movie <title>  — e.g. /movie Interstellar");

    const isImdbId = /^tt\d{6,9}$/i.test(query);
    let imdbId = isImdbId ? query : "";
    let matched: { title: string; year: string } | null = null;

    if (!imdbId) {
      const search = await fetchJson(
        `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&s=${encodeURIComponent(query)}`,
      );
      const payload = (search.body ?? {}) as {
        Response?: string;
        Error?: string;
        Search?: OmdbSearchHit[];
      };
      if (payload.Response === "False") {
        throw new Error(payload.Error ?? `No film or series found for “${query}”.`);
      }
      const first = payload.Search?.[0];
      if (!first?.imdbID) {
        throw new Error(`No film or series found for “${query}”.`);
      }
      imdbId = first.imdbID;
      matched = { title: first.Title ?? query, year: first.Year ?? "" };
    }

    const details = await fetchJson(
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbId)}&plot=short`,
    );
    const d = (details.body ?? {}) as OmdbTitle;
    if (d.Response === "False" || !d.Title) {
      throw new Error(d.Error ?? "OMDb returned no details for that title.");
    }

    const notAvailable = (value?: string) =>
      !value || value === "N/A" ? null : value;

    return {
      title: d.Title,
      year: d.Year ?? "",
      rated: notAvailable(d.Rated),
      runtime: notAvailable(d.Runtime),
      genre: notAvailable(d.Genre),
      director: notAvailable(d.Director),
      actors: notAvailable(d.Actors),
      plot: notAvailable(d.Plot),
      poster: notAvailable(d.Poster),
      imdbRating: notAvailable(d.imdbRating),
      imdbVotes: notAvailable(d.imdbVotes),
      metascore: notAvailable(d.Metascore),
      released: notAvailable(d.Released),
      awards: notAvailable(d.Awards),
      boxOffice: notAvailable(d.BoxOffice),
      seasons: notAvailable(d.totalSeasons),
      kind: d.Type ?? "movie",
      imdbId: d.imdbID ?? imdbId,
      matchedTitle: matched?.title ?? null,
      provider: "omdb",
    };
  },
});

/**
 * NASA's picture of the day, with a fallback that is not a placeholder: APOD
 * currently answers 500 for every key including DEMO_KEY (verified), so a
 * transient APOD outage must not leave the command dead. EPIC — the DSCOVR
 * satellite's full-disc photo of Earth — is the stand-in, and it is a real
 * image with a real caption.
 */
export const spacePicture = action({
  args: {},
  handler: async () => {
    const key = process.env.NASA_API_KEY?.trim() || "DEMO_KEY";

    const apod = await fetchJson(
      `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(key)}&thumbs=true`,
    );
    const picture = (apod.body ?? {}) as {
      title?: string;
      date?: string;
      explanation?: string;
      url?: string;
      hdurl?: string;
      thumbnail_url?: string;
      media_type?: string;
      copyright?: string;
    };
    if (apod.status === 200 && picture.title) {
      const isVideo = picture.media_type === "video";
      return {
        source: "apod",
        title: picture.title,
        date: picture.date ?? "",
        url: isVideo ? (picture.thumbnail_url ?? picture.url ?? null) : (picture.hdurl ?? picture.url ?? null),
        pageUrl: "https://apod.nasa.gov/apod/astropix.html",
        explanation: (picture.explanation ?? "").slice(0, 900),
        credit: picture.copyright?.trim() || "NASA",
        mediaType: picture.media_type ?? "image",
      };
    }

    // `/EPIC/api/natural` answers; the `…/natural/images` path 404s (verified),
    // so the rest of the URL is not guessable either way — it is pinned here.
    const epic = await fetchJson(
      `https://api.nasa.gov/EPIC/api/natural?api_key=${encodeURIComponent(key)}`,
    );
    const frames = (epic.body ?? []) as { image?: string; caption?: string; date?: string }[];
    const latest = Array.isArray(frames) ? frames[frames.length - 1] : undefined;
    if (epic.status === 200 && latest?.image && latest.date) {
      const [day] = latest.date.split(" ");
      const [year, month, date] = day.split("-");
      return {
        source: "epic",
        title: "Earth, full disc",
        date: day,
        url: `https://epic.gsfc.nasa.gov/archive/natural/${year}/${month}/${date}/png/${latest.image}.png`,
        pageUrl: "https://epic.gsfc.nasa.gov/",
        explanation:
          latest.caption ??
          "DSCOVR's Earth Polychromatic Imaging Camera, 1.5 million km from Earth.",
        credit: "NASA / EPIC (DSCOVR)",
        mediaType: "image",
        apodStatus: apod.status,
      };
    }

    throw new Error(
      `NASA is not answering right now (APOD ${apod.status}, EPIC ${epic.status}). Try again in a few minutes.`,
    );
  },
});

interface LaunchResult {
  name?: string;
  net?: string;
  status?: { abbrev?: string; description?: string };
  launch_service_provider?: { name?: string };
  rocket?: { configuration?: { full_name?: string } };
  mission?: { name?: string; description?: string; type?: string };
  pad?: { name?: string; location?: { name?: string } };
  /** A bare URL in list mode, an object in detailed mode. */
  image?: string | { image_url?: string; thumbnail_url?: string } | null;
}

function launchImage(image: LaunchResult["image"]): string | null {
  if (!image) return null;
  if (typeof image === "string") return image;
  return image.image_url ?? image.thumbnail_url ?? null;
}

/**
 * Upcoming ISRO launches. Launch Library 2 is the community-maintained mirror of
 * what ISRO itself does not publish as an API — ISRO has no public JSON feed —
 * and it needs no key. Its unauthenticated allowance is small (15 requests an
 * hour), which is why the result is trimmed and callers should not poll it.
 */
export const isroLaunches = action({
  args: { limit: v.optional(v.number()) },
  handler: async (_ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 3, 1), 10);
    const res = await fetchJson(
      `https://ll.thespacedevs.com/2.3.0/launches/upcoming/?search=ISRO&limit=${limit}&mode=detailed`,
    );
    if (res.status === 429) {
      throw new Error(
        "Launch Library is rate-limiting requests (15 an hour without a key). Try again later.",
      );
    }
    if (res.status !== 200) {
      throw new Error(`Launch schedule unavailable right now (Launch Library ${res.status}).`);
    }

    const payload = res.body as { count?: number; results?: LaunchResult[] } | null;
    const results = Array.isArray(payload?.results) ? payload.results : [];
    if (results.length === 0) {
      return { launches: [], count: 0, source: "Launch Library 2" };
    }

    return {
      count: payload?.count ?? results.length,
      source: "Launch Library 2",
      launches: results.slice(0, limit).map((launch) => ({
        name: launch.name ?? "Unnamed launch",
        net: launch.net ?? null,
        vehicle: launch.rocket?.configuration?.full_name ?? null,
        status: launch.status?.abbrev ?? null,
        statusDetail: launch.status?.description?.slice(0, 160) ?? null,
        pad: launch.pad?.name ?? null,
        location: launch.pad?.location?.name ?? null,
        mission: launch.mission?.name ?? null,
        description: launch.mission?.description?.slice(0, 320) ?? null,
        image: launchImage(launch.image),
      })),
    };
  },
});
