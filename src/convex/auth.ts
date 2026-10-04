// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import Google from "@auth/core/providers/google";
import { emailOtp } from "./auth/emailOtp";


// Google reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET, and its callback is served
// by the Convex deployment itself, so it works from any origin the app is
// opened at — unlike the Cloudinary OAuth flow, which is not a sign-in method.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google, emailOtp, Anonymous],
});