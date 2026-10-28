import { api } from "@/convex/_generated/api";
import { JarvisIcon } from "@/components/jarvis-icon";
import { useAction, useQuery } from "convex/react";
import { Loader2, XCircle, CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";

/**
 * OAuth 2.0 redirect target for Canva (authorization code + PKCE).
 * Canva redirects here with ?code=...&state=... (or ?error=...).
 * The code is exchanged server-side — the PKCE verifier never leaves Convex.
 */
export default function CanvaCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const exchangeCode = useAction(api.canva.exchangeCode);
  const canvaStatus = useQuery(api.canvaOAuth.getStatus);

  const [status, setStatus] = useState<"working" | "success" | "error">(
    "working",
  );
  const [message, setMessage] = useState("");
  const attempted = useRef(false);

  // The reactive answer, read through a ref so the catch block below sees the
  // current value rather than the one captured when the effect ran.
  const latestStatus = useRef(canvaStatus);
  latestStatus.current = canvaStatus;

  /**
   * Is the account connected right now?
   *
   * Waits briefly either way: the query may still be settling, and a
   * connection completed in another window needs a moment to land.
   */
  async function readConnected(): Promise<boolean> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const s = latestStatus.current;
      if (s?.connected) return true;
      if (s !== undefined && attempt >= 2) return false;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return latestStatus.current?.connected ?? false;
  }

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    const errorDescription = params.get("error_description");

    async function run() {
      try {
        if (oauthError) {
          throw new Error(
            errorDescription
              ? `${oauthError}: ${errorDescription}`
              : `Canva returned an error: ${oauthError}`,
          );
        }
        if (!code || !state) {
          throw new Error(
            "Missing authorization code — restart the connection from the app.",
          );
        }

        await exchangeCode({
          code,
          state,
          redirectUri: `${window.location.origin}/canva/callback`,
        });

        setStatus("success");
        setMessage("Canva connected. You can close this page.");
        setTimeout(() => navigate("/dashboard", { replace: true }), 1500);
      } catch (err) {
        // Two windows can race: this one's code was already spent by the
        // other, but the account may well be connected now. Checking is the
        // difference between a red X over a working connection and a truthful
        // success screen.
        if (await readConnected()) {
          setStatus("success");
          setMessage(
            "Canva connected — another window finished the sign-in first, so this one's code was already used.",
          );
          setTimeout(() => navigate("/dashboard", { replace: true }), 2500);
          return;
        }
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Unknown OAuth error.");
      }
    }
    void run();
  }, [params, exchangeCode, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-xl border border-border/60 bg-card p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-border/60 bg-background">
          {status === "working" && (
            <JarvisIcon className="size-6 animate-pulse" />
          )}
          {status === "success" && (
            <CheckCircle2 className="size-6 text-emerald-600" />
          )}
          {status === "error" && <XCircle className="size-6 text-red-500" />}
        </div>

        <h1 className="mt-5 text-lg font-semibold tracking-tight">
          {status === "working" && "Connecting Canva…"}
          {status === "success" && "Canva connected"}
          {status === "error" && "Connection failed"}
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {status === "working" &&
            "Exchanging your authorization code securely."}
          {message}
        </p>

        {status === "working" && (
          <Loader2 className="mx-auto mt-5 size-4 animate-spin text-muted-foreground" />
        )}

        {status === "error" && (
          <Button asChild variant="outline" className="mt-5">
            <Link to="/dashboard">Back to Jarvis</Link>
          </Button>
        )}
      </div>
    </main>
  );
}
