// Firebase client integration.
//
// Only the *client* config lives here. Every value below is designed to be
// public — it ships in browser code for every Firebase web app, and the
// `apiKey` is an identifier, not a secret. Real protection comes from Firebase
// Security Rules and from the fact that these APIs only ever authenticate a
// user against this one project.
//
// Everything is initialised on first use rather than at import time, so a page
// that never touches Firebase never pays for the SDK.

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from "firebase/storage";

export const FIREBASE_PROJECT_ID = "studio-8553017369-3f522";

const firebaseConfig = {
  apiKey: "AIzaSyCG3hixUhjpamJqqvfozhHXmmOBbjK0Sbw",
  authDomain: "studio-8553017369-3f522.firebaseapp.com",
  projectId: FIREBASE_PROJECT_ID,
  storageBucket: "studio-8553017369-3f522.firebasestorage.app",
  messagingSenderId: "49816127083",
  appId: "1:49816127083:web:5a32d3c6c2e491b6e3132e",
};

function app(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function firebaseAuth(): Auth {
  return getAuth(app());
}

export function firebaseStorage(): FirebaseStorage {
  return getStorage(app());
}

/**
 * Upload bytes to Firebase Storage and return the public download URL.
 *
 * `path` is the object path within the bucket (e.g. `jarvis-chat/abc.png`).
 * Note this returns a token-bearing download URL rather than a bare
 * `https://firebasestorage.googleapis.com/...` link, which only works for
 * public objects.
 */
export async function uploadToFirebaseStorage(
  path: string,
  data: Blob,
): Promise<{ url: string; path: string }> {
  const objectRef = ref(firebaseStorage(), path);
  await uploadBytes(objectRef, data);
  const url = await getDownloadURL(objectRef);
  return { url, path };
}