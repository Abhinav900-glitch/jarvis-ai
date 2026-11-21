// ---------------------------------------------------------------------------
// /account — the signed-in overview.
//
// Separate from the chat on purpose: the workspace is for working, this is for
// the questions people ask about their account ("how much have I made?", "is
// Cloudinary connected?", "what is switched on?"). Everything here is read
// only except sign-out and the links back into the app.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { animate, motion } from "framer-motion";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Brain,
  Check,
  Copy,
  FolderOpen,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Link2Off,
  Loader2,
  LogOut,
  MessageSquare,
  Minus,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { JarvisMark } from "@/components/jarvis-logo";
import { cn } from "@/lib/utils";

/** 1_234 -> "1.2K", so axis ticks and summary cards stay readable. */
function compact(value: number): string {
  if (value < 1000) return String(value);
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

const USAGE_CONFIG = {
  messages: { label: "Messages", color: "var(--chart-1)" },
  tokens: { label: "Tokens", color: "var(--chart-2)" },
} satisfies ChartConfig;

/**
 * Counts a stat up from zero the first time it arrives.
 *
 * Writes through a ref instead of setState on every frame: a 60 fps state
 * update would re-render the whole page 54 times for one number. Framer
 * Motion's own `animate` handles the easing, and the OS/in-app reduced-motion
 * setting gets the final value immediately instead of a count-up.
 */
function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motion === "reduced";
    node.textContent = value.toLocaleString();
    if (reduced || value === 0) return;

    const controls = animate(0, value, {
      duration: 0.9,
      ease: "easeOut",
      onUpdate: (latest) => {
        node.textContent = Math.round(latest).toLocaleString();
      },
    });
    return () => controls.stop();
  }, [value]);

  return <span ref={ref}>{value.toLocaleString()}</span>;
}

/** Heat buckets for the activity grid: 0 quiet, 4 busy. */
function heatLevel(messages: number): number {
  if (messages <= 0) return 0;
  if (messages <= 2) return 1;
  if (messages <= 5) return 2;
  if (messages <= 10) return 3;
  return 4;
}

function initials(name: string | null | undefined, email: string | null | undefined) {
  const source = (name ?? "").trim() || (email ?? "").split("@")[0] || "J";
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function Stat({
  label,
  value,
  icon: Icon,
  hint,
  loading,
}: {
  label: string;
  value: number | null;
  icon: typeof MessageSquare;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="hud-panel rounded-xl px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
        {loading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : value === null ? (
          "—"
        ) : (
          <AnimatedNumber value={value} />
        )}
      </p>
      {hint ? (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function StatusRow({
  label,
  ready,
  detail,
}: {
  label: string;
  ready: boolean;
  detail?: string;
}) {
  return (
    <li className="flex items-center gap-2 py-1.5 text-xs">
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full",
          ready
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        {ready ? <Check className="size-2.5" /> : <Minus className="size-2.5" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {detail ?? (ready ? "Ready" : "Not configured")}
      </span>
    </li>
  );
}

export default function Account() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();

  const sessionsQuery = useQuery(api.chats.listSessions);
  const sessions = useMemo(() => sessionsQuery ?? [], [sessionsQuery]);
  const memories = useQuery(api.memories.list, { limit: 200 });
  const decks = useQuery(api.decks.list);
  const providers = useQuery(api.config.providerHealth);
  const imageProviders = useQuery(api.config.imageProviders);
  const cloudinaryStatus = useQuery(api.cloudinaryOAuth.getStatus);

  // The picture count is the one stat that lives in Cloudinary, not Convex.
  // Fetched once on mount; a failure just leaves the card blank.
  const listMedia = useAction(api.cloudinary.listMedia);
  const [pictures, setPictures] = useState<number | null>(null);
  /** 7 / 30 / 90 days, chosen with the small range switch on the chart. */
  const [usageDays, setUsageDays] = useState(30);
  const usage = useQuery(api.usage.daily, { days: usageDays });
  /** Fixed 90-day window, independent of the chart's range switch. */
  const heatmap = useQuery(api.usage.daily, { days: 90 });
  const shares = useQuery(api.chatShares.listMine);
  const revokeShare = useMutation(api.chatShares.revoke);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void listMedia({ limit: 6 })
      .then((page) => {
        if (live) setPictures(page.total);
      })
      .catch(() => {
        // Not fatal: the rest of the page still works without Cloudinary.
        if (live) setPictures(null);
      });
    return () => {
      live = false;
    };
  }, [listMedia]);

  const conversationCount = sessions.filter((s) => !s.deletedAt).length;
  const pinnedCount = sessions.filter((s) => s.pinned && !s.deletedAt).length;
  const chatProviders = providers?.providers ?? [];
  const keyedChatProviders = chatProviders.filter((p) => p.configured);
  const readyImageProviders = (imageProviders?.providers ?? []).filter(
    (p) => p.available,
  );
  const doneDecks = (decks ?? []).filter((d) => d.status === "done").length;

  // Chart rows carry a short human label, while the ISO date stays available
  // in the tooltip payload for anyone reading the data rather than the axis.
  const usageSeries = (usage?.points ?? []).map((point) => ({
    ...point,
    label: new Date(`${point.date}T00:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));
  const hasUsage = usageSeries.some((point) => point.messages > 0);

  // 90 days of activity as columns of seven days, Monday first. Copied into
  // its own memo so switching the chart's range does not rebuild the grid.
  const heatmapWeeks = useMemo(() => {
    const points = heatmap?.points ?? [];
    if (points.length === 0) return [];
    const first = new Date(`${points[0].date}T00:00:00Z`).getUTCDay();
    const pad = (first + 6) % 7;
    const cells: ((typeof points)[number] | null)[] = [
      ...Array.from({ length: pad }, () => null),
      ...points,
    ];
    const weeks: ((typeof points)[number] | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  }, [heatmap]);
  const heatmapTotal = (heatmap?.points ?? []).reduce(
    (sum, point) => sum + point.messages,
    0,
  );

  const copyShareLink = async (slug: string) => {
    const url = `${window.location.origin}/c/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(slug);
      window.setTimeout(() => setCopiedSlug(null), 1600);
    } catch {
      // Clipboard permission can be denied; showing the link still lets the
      // user copy it by hand instead of leaving the button silently broken.
      toast.error(url);
    }
  };

  const stopSharing = async (sessionId: (typeof sessions)[number]["_id"]) => {
    try {
      const { removed } = await revokeShare({ sessionId });
      toast[removed ? "success" : "info"](
        removed ? "Public link revoked." : "That link was already off.",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not revoke the link.",
      );
    }
  };

  const memberSince = user?._creationTime
    ? new Date(user._creationTime).toLocaleDateString(undefined, {
        dateStyle: "medium",
      })
    : null;

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="hud-grid-bg min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <JarvisMark className="size-6" />
            <span className="text-sm font-medium tracking-tight">Jarvis</span>
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <span className="text-xs text-muted-foreground">Account</span>
        </div>
        <Link to="/dashboard">
          <Button variant="outline" size="sm">
            <ArrowLeft className="size-3.5" />
            Back to chat
          </Button>
        </Link>
      </header>

      {!online && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-800 dark:text-amber-300 sm:px-8">
          <WifiOff className="size-3.5 shrink-0" />
          Offline — showing what was already loaded. Live counts resume with the
          connection.
        </div>
      )}

      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6"
      >
        {/* ---- Identity ---- */}
        <section className="hud-panel hud-corners rounded-2xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/15 text-lg font-semibold text-primary">
              {initials(user?.name, user?.email)}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {user?.name || "Your account"}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {user?.email ?? "Signed in"}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {memberSince ? <span>Member since {memberSince}</span> : null}
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="size-3" />
                  End-to-end encrypted chats
                </span>
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSignOut()}
            >
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </div>
        </section>

        {/* ---- Activity ---- */}
        <section className="mt-6">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Activity
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat
              label="Conversations"
              icon={MessageSquare}
              value={conversationCount}
              hint={`${pinnedCount} pinned`}
              loading={sessionsQuery === undefined}
            />
            <Stat
              label="Memory facts"
              icon={Sparkles}
              value={memories?.length ?? null}
              hint="Recalled in later chats"
              loading={memories === undefined}
            />
            <Stat
              label="Recent decks"
              icon={BookOpen}
              value={decks?.length ?? null}
              hint={`${doneDecks} finished`}
              loading={decks === undefined}
            />
            <Stat
              label="Pictures in Cloudinary"
              icon={ImageIcon}
              value={pictures}
              hint="Whole account, not just this app"
              loading={pictures === null && cloudinaryStatus?.connected !== false}
            />
            <Stat
              label="Chat providers"
              icon={Brain}
              value={keyedChatProviders.length}
              hint={`of ${chatProviders.length || "—"} in the registry`}
              loading={providers === undefined}
            />
            <Stat
              label="Image providers"
              icon={KeyRound}
              value={readyImageProviders.length}
              hint="Keyed and ready"
              loading={imageProviders === undefined}
            />
          </div>
        </section>

        {/* ---- Usage over time ---- */}
        <section className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Usage
            </h2>
            <div className="flex items-center gap-1">
              {[7, 30, 90].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setUsageDays(days)}
                  aria-pressed={usageDays === days}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                    usageDays === days
                      ? "border-foreground/30 bg-accent text-foreground"
                      : "border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>

          <div className="hud-panel rounded-xl p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: "var(--chart-1)" }}
                  />
                  Messages
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: "var(--chart-2)" }}
                  />
                  Tokens
                </span>
              </div>
              <span className="tabular-nums">
                {usage
                  ? `${usage.totals.messages.toLocaleString()} messages · ${compact(usage.totals.tokens)} tokens`
                  : "Reading usage…"}
              </span>
            </div>

            {usage === undefined ? (
              <div className="flex h-52 items-center justify-center text-[11px] text-muted-foreground">
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                Reading usage…
              </div>
            ) : hasUsage ? (
              <ChartContainer
                config={USAGE_CONFIG}
                className="aspect-auto h-52 w-full"
              >
                <ComposedChart
                  data={usageSeries}
                  margin={{ top: 8, right: 0, left: -20, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="messages"
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="tokens"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(value: number) => compact(value)}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent indicator="dot" />}
                  />
                  <Bar
                    yAxisId="messages"
                    dataKey="messages"
                    fill="var(--color-messages)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={18}
                    animationDuration={650}
                  />
                  <Line
                    yAxisId="tokens"
                    type="monotone"
                    dataKey="tokens"
                    stroke="var(--color-tokens)"
                    strokeWidth={2}
                    dot={false}
                    animationDuration={650}
                  />
                </ComposedChart>
              </ChartContainer>
            ) : (
              <div className="flex h-52 flex-col items-center justify-center gap-1 text-center">
                <Sparkles className="size-4 text-muted-foreground/60" />
                <p className="text-xs text-muted-foreground">
                  No messages in this window yet.
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  Start a chat and the chart fills in from the first turn.
                </p>
              </div>
            )}

            {usage && usage.replies > 0 && usage.reported < usage.replies ? (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Tokens counted for {usage.reported} of {usage.replies} replies —
                some engines answer without usage numbers.
              </p>
            ) : null}

            {heatmapWeeks.length > 0 && heatmapTotal > 0 ? (
              <div className="mt-4 border-t border-border/50 pt-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>
                    Last 90 days · {heatmapTotal.toLocaleString()} message
                    {heatmapTotal === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    Less
                    {[0, 1, 2, 3, 4].map((level) => (
                      <span
                        key={level}
                        className={cn(
                          "size-2 rounded-[2px]",
                          level === 0 && "bg-muted/50",
                        )}
                        style={
                          level === 0
                            ? undefined
                            : {
                                backgroundColor: "var(--chart-1)",
                                opacity: 0.2 + level * 0.2,
                              }
                        }
                      />
                    ))}
                    More
                  </span>
                </div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.1 }}
                  className="flex gap-1 overflow-x-auto pb-1"
                >
                  {heatmapWeeks.map((week, weekIndex) => (
                    <div key={weekIndex} className="flex flex-col gap-1">
                      {week.map((cell, dayIndex) =>
                        cell ? (
                          <div
                            key={cell.date}
                            title={`${new Date(`${cell.date}T00:00:00Z`).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric", year: "numeric" },
                            )} · ${cell.messages} message${cell.messages === 1 ? "" : "s"}`}
                            className={cn(
                              "size-2.5 rounded-[3px] transition-transform hover:scale-125",
                              heatLevel(cell.messages) === 0 && "bg-muted/50",
                            )}
                            style={
                              heatLevel(cell.messages) === 0
                                ? undefined
                                : {
                                    backgroundColor: "var(--chart-1)",
                                    opacity: 0.18 + heatLevel(cell.messages) * 0.2,
                                  }
                            }
                          />
                        ) : (
                          <div
                            key={`pad-${weekIndex}-${dayIndex}`}
                            className="size-2.5"
                          />
                        ),
                      )}
                    </div>
                  ))}
                </motion.div>
              </div>
            ) : null}
          </div>
        </section>

        {/* ---- Shared links ---- */}
        <section id="shares" className="mt-6 scroll-mt-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Shared links
            </h2>
            <span className="text-[10px] text-muted-foreground">
              {shares ? `${shares.length} active` : "—"}
            </span>
          </div>
          <div className="hud-panel rounded-xl">
            {shares === undefined ? (
              <div className="flex items-center justify-center py-6 text-[11px] text-muted-foreground">
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                Reading links…
              </div>
            ) : shares.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <Link2 className="mx-auto size-4 text-muted-foreground/60" />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  No public links yet.
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                  Share a chat from Tools → Share this chat; it appears here
                  until you revoke it.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {shares.map((share) => (
                  <li
                    key={share.slug}
                    className="flex flex-wrap items-center gap-2 px-4 py-2.5"
                  >
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-foreground">
                        {share.title || "Untitled chat"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Shared{" "}
                        {new Date(share.createdAt).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric" },
                        )}{" "}
                        · {share.messages} message
                        {share.messages === 1 ? "" : "s"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyShareLink(share.slug)}
                      title="Copy the public link"
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
                        copiedSlug === share.slug && "text-foreground",
                      )}
                    >
                      {copiedSlug === share.slug ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      {copiedSlug === share.slug ? "Copied" : "Copy link"}
                    </button>
                    <a
                      href={`/c/${share.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Open the public page"
                      className="rounded-md border border-border/70 p-1 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      <ArrowUpRight className="size-3" />
                    </a>
                    <button
                      type="button"
                      onClick={() => void stopSharing(share.sessionId)}
                      title="Stop sharing this chat"
                      className="rounded-md border border-border/70 p-1 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                    >
                      <Link2Off className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ---- Connections ---- */}
        <section className="mt-6 grid gap-3 md:grid-cols-2">
          <div className="hud-panel rounded-xl px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Brain className="size-3" />
              Chat engines
            </h2>
            <ul className="mt-1 divide-y divide-border/40">
              {providers === undefined ? (
                <li className="py-3 text-[11px] text-muted-foreground">
                  <Loader2 className="mr-1.5 inline size-3 animate-spin" />
                  Checking…
                </li>
              ) : (
                chatProviders.map((provider) => (
                  <StatusRow
                    key={provider.id}
                    label={provider.label}
                    ready={provider.configured}
                    detail={
                      provider.configured
                        ? `${provider.engines.filter((e) => e.available).length} models`
                        : undefined
                    }
                  />
                ))
              )}
            </ul>
          </div>

          <div className="hud-panel rounded-xl px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <ImageIcon className="size-3" />
              Media & storage
            </h2>
            <ul className="mt-1 divide-y divide-border/40">
              <StatusRow
                label="Cloudinary library"
                ready={Boolean(cloudinaryStatus?.connected || pictures !== null)}
                detail={
                  cloudinaryStatus?.connected
                    ? "OAuth linked"
                    : pictures !== null
                      ? "API key"
                      : undefined
                }
              />
              <li className="flex items-center gap-2 py-1.5 text-xs">
                <FolderOpen className="ml-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <Link
                  to="/gallery"
                  className="min-w-0 flex-1 truncate text-foreground underline-offset-2 hover:underline"
                >
                  Open the gallery
                </Link>
                <ArrowUpRight className="size-3 text-muted-foreground" />
              </li>
              <li className="flex items-center gap-2 py-1.5 text-xs">
                <Link2 className="ml-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <a
                  href="#shares"
                  className="min-w-0 flex-1 truncate text-foreground underline-offset-2 hover:underline"
                >
                  Public share links
                </a>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {shares ? `${shares.length} active` : "—"}
                </span>
              </li>
              {imageProviders !== undefined ? (
                <li className="flex flex-wrap gap-1 py-2">
                  {(imageProviders.providers ?? []).map((provider) => (
                    <span
                      key={provider.id}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        provider.available
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "border-border/70 text-muted-foreground",
                      )}
                    >
                      {provider.label}
                    </span>
                  ))}
                </li>
              ) : null}
            </ul>
          </div>
        </section>

        {/* ---- Shortcuts ---- */}
        <section className="mt-6 flex flex-wrap gap-2">
          <Link to="/dashboard">
            <Button size="sm">
              <MessageSquare className="size-3.5" />
              Back to chat
            </Button>
          </Link>
          <Link to="/gallery">
            <Button variant="outline" size="sm">
              <FolderOpen className="size-3.5" />
              Gallery
            </Button>
          </Link>
          <Link to="/resources">
            <Button variant="outline" size="sm">
              <BookOpen className="size-3.5" />
              Resources
            </Button>
          </Link>
        </section>

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          Keys and integrations are managed from the chat's Settings menu. This
          page only shows what is switched on.
        </p>
      </motion.main>
    </div>
  );
}
