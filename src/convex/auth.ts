// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import {
  convexAuth,
  createAccount,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { emailOtp } from "./auth/emailOtp";
import { createRemoteJWKSet, jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// Firebase Auth bridge
//
// Firebase owns sign-in; Convex Auth still owns the session. That split is
// deliberate: every function in this app resolves the caller with
// `getAuthUserId`, which needs a Convex Auth user document — a Firebase session
// on its own satisfies nothing here. So the client signs in with Firebase,
// hands us the resulting ID token, and this provider verifies it and maps the
// Firebase uid onto a Convex Auth account.
//
// The token is verified against Google's JWKS for this project and checked for
// the right issuer and audience. Nothing from the token is trusted before
// that, which is the whole point: a forged token must not be able to mint a
// session for somebody else's account.
// ---------------------------------------------------------------------------

const FIREBASE_PROJECT_ID = "studio-8553017369-3f522";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

/** Matches the `provider` string used for the Convex Auth account rows. */
const FIREBASE_PROVIDER = "firebase";

const firebase = ConvexCredentials({
  id: FIREBASE_PROVIDER,
  authorize: async (credentials, ctx) => {
    const token = credentials.token;
    if (typeof token !== "string" || !token) {
      throw new Error("No Firebase ID token was provided.");
    }

    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    }).catch(() => {
      throw new Error(
        "That Firebase session is no longer valid. Sign in with Google again.",
      );
    });

    const uid = payload.sub;
    if (!uid) throw new Error("That Firebase session has no account id.");

    // Returning to an existing account keeps the user on the same Convex
    // user id, and therefore on all of their existing data.
    const existing = await retrieveAccount(ctx, {
      provider: FIREBASE_PROVIDER,
      account: { id: uid },
    }).catch(() => null);
    if (existing) return { userId: existing.user._id };

    const email = typeof payload.email === "string" ? payload.email : undefined;
    // Only include claims that are actually present: the users table marks these
    // optional, but an explicit `undefined` is not the same as an absent key.
    const profile = {
      ...(typeof payload.name === "string" ? { name: payload.name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(typeof payload.picture === "string"
        ? { image: payload.picture }
        : {}),
      ...(payload.email_verified === true
        ? { emailVerificationTime: Date.now() }
        : {}),
    };

    const { user } = await createAccount(ctx, {
      provider: FIREBASE_PROVIDER,
      account: { id: uid },
      profile,
      // Linking by email is only safe for an address Firebase has already
      // verified — otherwise anyone could claim an existing account by
      // registering that address with an unverified Google identity.
      shouldLinkViaEmail:
        payload.email_verified === true && email !== undefined,
    });

    return { userId: user._id };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [firebase, emailOtp, Anonymous],
});