import { useAuth } from "@/hooks/use-auth";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { readCachedTranscript } from "@/lib/transcript-cache";
import { Loader2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();
  const online = useOnlineStatus();

  // Auth needs the server, so a cold start with no connection would otherwise
  // leave this screen spinning forever and hide the transcript saved on the
  // device. With a saved copy present, the app is allowed to open read-only;
  // everything that writes still fails once the user tries it, and the moment
  // the connection returns the real auth state takes over again.
  const offlineCopy = useMemo(
    () => (!online ? readCachedTranscript() : null),
    [online],
  );

  if (isLoading) {
    if (offlineCopy) return children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated && !offlineCopy) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  return children;
}
