// ---------------------------------------------------------------------------
// Public entry points for the live lookups.
//
// The actions in `liveTools` are internal: they hold the SerpAPI and Spoonacular
// keys, so they must not be callable by an anonymous visitor. The chat's slash
// commands do need them though, and a client can only call a public function.
//
// These wrappers are that boundary and nothing else — one auth check each, then
// the same action the agent uses. Keeping the check here rather than in
// `liveTools` means the agent's tool path (already behind a signed-in run) and
// the chat path share one implementation of the lookup itself.
//
// The return types are written out rather than inferred: `ctx.runAction` on an
// internal function whose type comes from the generated API creates a cycle
// (api → live → api) that TypeScript resolves as `any`.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

/** One place, matching what `liveTools.places` returns. */
interface PlaceReply {
  name: string;
  type: string;
  address: string;
  rating: number | null;
  reviews: number | null;
  price: string;
  openState: string;
  hours: { day: string; hours: string }[];
  phone: string;
  website: string;
  mapsUrl: string;
  lat: number | null;
  lng: number | null;
}

interface PlacesReply {
  ok: boolean;
  places: PlaceReply[];
  message: string | null;
}

/** One recipe, matching what `liveTools.recipes` returns. */
interface RecipeReply {
  title: string;
  url: string;
  source: string;
  minutes: number | null;
  servings: number | null;
  healthScore: number | null;
  diets: string[];
  dishTypes: string[];
  ingredients: string[];
  summary: string;
}

interface RecipesReply {
  ok: boolean;
  recipes: RecipeReply[];
  message: string | null;
}

/** Google Maps places for the `/places` command. */
export const places = action({
  args: {
    query: v.string(),
    near: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PlacesReply> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        ok: false,
        places: [],
        message: "Sign in to search for places.",
      };
    }
    const reply = (await ctx.runAction(internal.liveTools.places, {
      query: args.query,
      near: args.near,
      limit: args.limit,
    })) as PlacesReply;
    return reply;
  },
});

/** Spoonacular recipes for the `/recipe` command. */
export const recipes = action({
  args: {
    query: v.string(),
    diet: v.optional(v.string()),
    maxReadyTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<RecipesReply> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        ok: false,
        recipes: [],
        message: "Sign in to search for recipes.",
      };
    }
    const reply = (await ctx.runAction(internal.liveTools.recipes, {
      query: args.query,
      diet: args.diet,
      maxReadyTime: args.maxReadyTime,
      limit: args.limit,
    })) as RecipesReply;
    return reply;
  },
});
