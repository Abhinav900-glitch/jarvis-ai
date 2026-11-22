// ---------------------------------------------------------------------------
// Messages — CometChat, inside Jarvis.
//
// A second, people-to-people surface beside the assistant: conversations,
// user search, and one-to-one or group threads. It is deliberately a separate
// route rather than another panel in the console, because it has its own
// websocket session and its own unread state.
//
// Auth order:
//   1. A Convex action (api.cometchat.session) returns either a short-lived
//      auth token (when a REST key is configured) or the development Auth Key.
//   2. If the deployment has no server-side keys but the frontend has the
//      three VITE_ names, the browser can start in Auth-Key mode itself. That
//      path ships a broad credential to the bundle and is a development
//      convenience, not a production recommendation.
//
// The UIKit owns its own CSS; it is imported with this lazy route so the chat
// console does not pay for it.
// ---------------------------------------------------------------------------

import "@cometchat/chat-uikit-react/styles";

import { CometChat } from "@cometchat/chat-sdk-javascript";
import {
  CometChatConversations,
  CometChatMessageComposer,
  CometChatMessageHeader,
  CometChatMessageList,
  CometChatProvider,
  CometChatUIKit,
  CometChatUsers,
  UIKitSettingsBuilder,
} from "@cometchat/chat-uikit-react";
import { useAction } from "convex/react";
import {
  ArrowLeft,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { JarvisMark } from "@/components/jarvis-logo";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";

interface CometChatSession {
  configured: boolean;
  mode: "token" | "authKey" | null;
  appId: string | null;
  region: string | null;
  uid: string;
  name: string;
  missing: string[];
  authToken?: string;
  authKey?: string;
  error?: string;
}

type Status =
  | "loading"
  | "connecting"
  | "ready"
  | "unconfigured"
  | "failed";

/**
 * Init and login are process-wide, but React StrictMode mounts effects twice.
 * One shared promise keeps the second mount from racing two logins; the SDK
 * itself refuses a second init.
 */
let connection: { key: string; promise: Promise<void> } | null = null;

function connectOnce(session: CometChatSession): Promise<void> {
  const key = `${session.uid}:${session.mode}:${session.authToken ? "token" : "key"}`;
  if (connection?.key !== key) {
    connection = {
      key,
      promise: connect(session).catch((err: unknown) => {
        connection = null;
        throw err;
      }),
    };
  }
  return connection.promise;
}

async function connect(session: CometChatSession): Promise<void> {
  if (!session.appId || !session.region) {
    throw new Error("CometChat App ID or Region is missing.");
  }

  if (!CometChatUIKit.isInitialized()) {
    const builder = new UIKitSettingsBuilder()
      .setAppId(session.appId)
      .setRegion(session.region)
      .subscribePresenceForAllUsers();
    if (session.mode === "authKey" && session.authKey) {
      builder.setAuthKey(session.authKey);
    }
    await CometChatUIKit.init(builder.build());
  }

  const current = CometChatUIKit.getLoggedInUser();
  if (current?.getUid() === session.uid) return;
  if (current) await CometChatUIKit.logout();

  if (session.mode === "token") {
    if (!session.authToken) throw new Error("CometChat returned no auth token.");
    await CometChatUIKit.loginWithAuthToken(session.authToken);
    return;
  }

  if (!session.authKey) throw new Error("CometChat Auth Key is missing.");
  // Auth-Key mode is the only way to reach a UID that does not exist yet.
  // An "already exists" failure is expected on every later visit; login below
  // is the real test and its error is shown if it fails.
  try {
    const person = new CometChat.User(session.uid);
    person.setName(session.name);
    await CometChat.createUser(person, session.authKey);
  } catch {
    // Existing user.
  }
  await CometChatUIKit.login(session.uid);
}

function envFromBundle(): { appId: string; region: string; authKey: string } | null {
  const appId = (import.meta.env.VITE_COMETCHAT_APP_ID as string | undefined)?.trim();
  const region = (import.meta.env.VITE_COMETCHAT_REGION as string | undefined)?.trim();
  const authKey = (import.meta.env.VITE_COMETCHAT_AUTH_KEY as string | undefined)?.trim();
  if (!appId || !region || !authKey) return null;
  return { appId, region, authKey };
}

export default function Messages() {
  const { user } = useAuth();
  const sessionAction = useAction(api.cometchat.session);
  const [session, setSession] = useState<CometChatSession | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState<{
    user?: CometChat.User;
    group?: CometChat.Group;
  } | null>(null);
  const [showUsers, setShowUsers] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    setStatus("loading");
    setError(null);

    // Fast path: credentials are present in the client bundle. This is the
    // documented Auth-Key development mode; the key is public to anyone who
    // opens the bundle.
    const bundled = envFromBundle();
    if (bundled && user?._id) {
      const local: CometChatSession = {
        configured: true,
        mode: "authKey",
        appId: bundled.appId,
        region: bundled.region,
        uid: String(user._id),
        name: user.name?.trim() || user.email?.split("@")[0] || "Jarvis user",
        missing: [],
        authKey: bundled.authKey,
      };
      setSession(local);
      setStatus("connecting");
      try {
        await connectOnce(local);
        if (mounted.current) setStatus("ready");
      } catch (err) {
        if (mounted.current) {
          setError(err instanceof Error ? err.message : "CometChat could not connect.");
          setStatus("failed");
        }
      }
      return;
    }

    // Server path: token mode when a REST key exists, Auth Key otherwise.
    try {
      const result = (await sessionAction({})) as CometChatSession;
      if (!mounted.current) return;
      setSession(result);
      if (!result.configured) {
        setStatus("unconfigured");
        return;
      }
      if (result.error) {
        setError(result.error);
        setStatus("failed");
        return;
      }
      setStatus("connecting");
      await connectOnce(result);
      if (mounted.current) setStatus("ready");
    } catch (err) {
      if (mounted.current) {
        setError(
          err instanceof Error ? err.message : "CometChat could not start a session.",
        );
        setStatus("failed");
      }
    }
  }, [sessionAction, user]);

  // Deferred one tick: the first paint is the loading card, and the SDK session
  // starts from a task rather than synchronously inside the effect.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void start();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [start, attempt]);

  const header = (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background/90 px-4 backdrop-blur">
      <Link
        to="/dashboard"
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Back to Jarvis"
      >
        <ArrowLeft className="size-4" />
      </Link>
      <JarvisMark className="size-6" />
      <span className="text-sm font-semibold tracking-tight">Messages</span>
      <span className="hud-label hud-label-cyan hidden sm:inline">people</span>
      <Link
        to="/dashboard"
        className="ml-auto text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        Back to assistant
      </Link>
    </header>
  );

  if (status !== "ready") {
    return (
      <div className="flex h-dvh flex-col bg-background text-foreground">
        {header}
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4 sm:p-6">
          <div className="hud-panel hud-corners w-full max-w-lg rounded-2xl p-6">
            {status === "loading" || status === "connecting" ? (
              <div className="flex flex-col items-center py-6 text-center">
                <Loader2 className="size-6 animate-spin text-primary" />
                <p className="mt-4 text-sm font-medium">
                  {status === "loading" ? "Checking CometChat…" : "Opening your conversations…"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Signing in with your Jarvis account.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <WifiOff className="size-4 text-muted-foreground" />
                  <h1 className="text-sm font-semibold">
                    {status === "unconfigured" ? "Connect CometChat" : "CometChat could not connect"}
                  </h1>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {status === "unconfigured"
                    ? "The Messages page is ready, but this deployment has no CometChat credentials. Add them in the Keys tab under the backend/Convex scope, then retry."
                    : error ?? "The CometChat SDK refused the session."}
                </p>

                {session?.missing && session.missing.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Missing
                    </p>
                    <ul className="mt-1.5 space-y-1 font-mono text-[11px]">
                      {session.missing.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <p className="mt-4 text-[11px] leading-5 text-muted-foreground/70">
                  Optional secure path: add <span className="font-mono">COMETCHAT_REST_API_KEY</span>{" "}
                  so tokens are minted server-side and the Auth Key never reaches a
                  browser. Frontend-only setup can use{" "}
                  <span className="font-mono">VITE_COMETCHAT_APP_ID</span>,{" "}
                  <span className="font-mono">VITE_COMETCHAT_REGION</span> and{" "}
                  <span className="font-mono">VITE_COMETCHAT_AUTH_KEY</span>.
                </p>

                <Button className="mt-5 gap-2" onClick={() => setAttempt((n) => n + 1)}>
                  <RefreshCw className="size-3.5" />
                  Retry
                </Button>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {header}
      <main className="min-h-0 flex-1">
        <CometChatProvider theme="dark">
          <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
            <aside
              className={`min-h-0 flex-col border-border/60 md:border-r ${
                target ? "hidden md:flex" : "flex"
              }`}
            >
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
                <span className="hud-label">Conversations</span>
                <button
                  type="button"
                  onClick={() => setShowUsers((open) => !open)}
                  className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title={showUsers ? "Show conversations" : "New message"}
                >
                  <MessageSquarePlus className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {showUsers ? (
                  <CometChatUsers
                    onItemClick={(person) => {
                      setTarget({ user: person });
                      setShowUsers(false);
                    }}
                  />
                ) : (
                  <CometChatConversations
                    onItemClick={(conversation) => {
                      const other = conversation.getConversationWith();
                      setTarget(
                        other instanceof CometChat.Group
                          ? { group: other }
                          : { user: other as CometChat.User },
                      );
                    }}
                  />
                )}
              </div>
            </aside>

            <section
              className={`min-h-0 flex-col ${
                target ? "flex" : "hidden md:flex"
              }`}
            >
              {target ? (
                <>
                  <button
                    type="button"
                    onClick={() => setTarget(null)}
                    className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-3 text-[11px] text-muted-foreground md:hidden"
                  >
                    <ArrowLeft className="size-3.5" />
                    All conversations
                  </button>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <CometChatMessageHeader
                      user={target.user}
                      group={target.group}
                      hideBackButton
                    />
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <CometChatMessageList
                        user={target.user}
                        group={target.group}
                      />
                    </div>
                    <CometChatMessageComposer
                      user={target.user}
                      group={target.group}
                      placeholder="Message…"
                    />
                  </div>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <JarvisMark className="size-10 opacity-70" />
                  <p className="mt-4 text-sm font-medium">Pick a conversation</p>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                    One-to-one and group chats live here. Use the compose button to
                    find someone, or open an existing thread on the left.
                  </p>
                </div>
              )}
            </section>
          </div>
        </CometChatProvider>
      </main>
    </div>
  );
}
