// ---------------------------------------------------------------------------
// Ghost line — a temporary number with a live SMS/OTP inbox.
//
// The number is bought from Temp Number's wallet-backed API, not minted by
// this app. The panel shows the wallet, live price and stock, the numbers the
// account owns, and polls the selected number's inbox so a verification code
// appears without leaving Jarvis. Buying and releasing are explicit because
// both move money.
// ---------------------------------------------------------------------------

import { useAction } from "convex/react";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  TempNumberAccount,
  TempNumberCountry,
  TempNumberInbox,
  TempNumberInventory,
  TempNumberNumber,
  TempNumberPackage,
} from "@/lib/temp-number";

const TOP_UP_URL = "https://temp-number.com/login";

function packageKeyOf(pkg: TempNumberPackage): string {
  return `${pkg.number_type}:${pkg.duration}`;
}

function formatMoney(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The shortest useful code finder.
 *
 * Most OTPs are six digits after a word like "code", "OTP" or "verification".
 * The fallback catches a bare six-digit code, which is the other common shape.
 * It deliberately does not try to parse every provider's format.
 */
function extractCode(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const keyword = normalized.match(
    /\b(?:code|otp|pin|passcode|verification)\b[^A-Z0-9]{0,24}([A-Z0-9]{4,8})\b/i,
  );
  if (keyword) return keyword[1].toUpperCase();
  const bare = normalized.match(/\b(\d{6})\b/);
  return bare ? bare[1] : null;
}

function statusClass(status: string): string {
  if (status === "active") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
  return "border-border/70 bg-muted/40 text-muted-foreground";
}

export interface TempNumberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TempNumberDialog({
  open,
  onOpenChange,
}: TempNumberDialogProps) {
  const getAccount = useAction(api.tempNumbers.account);
  const getPricing = useAction(api.tempNumbers.pricing);
  const getInventory = useAction(api.tempNumbers.inventory);
  const getNumbers = useAction(api.tempNumbers.list);
  const getMessages = useAction(api.tempNumbers.messages);
  const buyNumber = useAction(api.tempNumbers.buy);
  const cancelNumber = useAction(api.tempNumbers.cancel);

  const [account, setAccount] = useState<TempNumberAccount | null>(null);
  const [countries, setCountries] = useState<TempNumberCountry[]>([]);
  const [numbers, setNumbers] = useState<TempNumberNumber[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [inbox, setInbox] = useState<TempNumberInbox | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<TempNumberInventory | null>(null);
  const [country, setCountry] = useState("");
  const [packageKey, setPackageKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [buying, setBuying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<TempNumberNumber | null>(
    null,
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [wallet, priceList, lines] = await Promise.all([
        getAccount(),
        getPricing(),
        getNumbers(),
      ]);
      setAccount(wallet);
      setCountries(priceList);
      setNumbers(lines);
      setSelectedId((current) => {
        if (current !== null && lines.some((line) => line.id === current)) {
          return current;
        }
        return (
          lines.find((line) => line.status === "active")?.id ??
          lines[0]?.id ??
          null
        );
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not load Ghost line.",
      );
    } finally {
      setLoading(false);
    }
  }, [getAccount, getPricing, getNumbers]);

  useEffect(() => {
    if (open) void loadAll();
  }, [open, loadAll]);

  // Pick a country and a sensible first package whenever the catalog changes.
  useEffect(() => {
    if (countries.length === 0) return;
    const current =
      countries.find((entry) => entry.country_code === country) ?? countries[0];
    if (current.country_code !== country) {
      setCountry(current.country_code);
      return;
    }
    const keys = current.packages.map(packageKeyOf);
    if (!keys.includes(packageKey)) {
      const preferred =
        current.packages.find(
          (pkg) =>
            pkg.duration === "oneMonth" && pkg.number_type === "voip",
        ) ?? current.packages[0];
      setPackageKey(preferred ? packageKeyOf(preferred) : "");
    }
  }, [countries, country, packageKey]);

  const countryData = useMemo(
    () => countries.find((entry) => entry.country_code === country) ?? null,
    [countries, country],
  );
  const packages = countryData?.packages ?? [];
  const selectedPackage = useMemo(
    () => packages.find((pkg) => packageKeyOf(pkg) === packageKey) ?? null,
    [packages, packageKey],
  );

  useEffect(() => {
    if (!open || !selectedPackage) {
      setInventory(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await getInventory({
          countryCode: country,
          duration: selectedPackage.duration,
          numberType: selectedPackage.number_type,
        });
        if (!cancelled) setInventory(result);
      } catch {
        if (!cancelled) setInventory(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    country,
    selectedPackage?.duration,
    selectedPackage?.number_type,
    getInventory,
  ]);

  // Poll only while the dialog is open and a line is selected. A recursive
  // timeout avoids stacking requests when an inbox call is slower than 5s.
  useEffect(() => {
    if (!open || selectedId === null) {
      setInbox(null);
      setInboxError(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await getMessages({ numberId: selectedId });
        if (!cancelled) {
          setInbox(result);
          setInboxError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setInboxError(
            err instanceof Error ? err.message : "Could not read the inbox.",
          );
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(poll, 5_000);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open, selectedId, getMessages]);

  const refreshNumbers = async () => {
    setRefreshing(true);
    try {
      const lines = await getNumbers();
      setNumbers(lines);
      setSelectedId((current) => {
        if (current !== null && lines.some((line) => line.id === current)) {
          return current;
        }
        return (
          lines.find((line) => line.status === "active")?.id ??
          lines[0]?.id ??
          null
        );
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not refresh your lines.",
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleBuy = async () => {
    if (!selectedPackage || buying) return;
    setBuying(true);
    try {
      const result = await buyNumber({
        countryCode: country,
        duration: selectedPackage.duration,
        numberType: selectedPackage.number_type,
      });
      toast.success(
        `Bought ${result.number.phone_number} for ${formatMoney(
          result.charged,
          result.currency,
        )}.`,
      );
      setAccount({
        balance: result.balanceAfter,
        currency: result.currency,
      });
      setNumbers((current) => [
        result.number,
        ...current.filter((line) => line.id !== result.number.id),
      ]);
      setSelectedId(result.number.id);
      setInbox(null);
      // The purchase already succeeded; a failed refresh must not turn it into
      // an apparent failure in the toast.
      try {
        setNumbers(await getNumbers());
      } catch {
        // Keep the optimistic entry.
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not buy that number.",
      );
    } finally {
      setBuying(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const result = await cancelNumber({ numberId: cancelTarget.id });
      toast.success(
        `Released ${result.number.phone_number}. Refund: ${formatMoney(
          result.refunded,
          result.currency,
        )}.`,
      );
      setAccount({
        balance: result.balanceAfter,
        currency: result.currency,
      });
      setCancelTarget(null);
      if (selectedId === result.number.id) {
        setSelectedId(null);
        setInbox(null);
      }
      try {
        setNumbers(await getNumbers());
      } catch {
        // The release already succeeded; the next refresh will reconcile.
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not release that number.",
      );
    } finally {
      setCancelling(false);
    }
  };

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success("Copied.");
    } catch {
      toast.error("The browser blocked clipboard access; select the text.");
    }
  };

  const selectedNumber =
    numbers.find((line) => line.id === selectedId) ?? inbox?.number ?? null;
  const outOfStock = inventory ? !inventory.available : false;
  const balance = account?.balance ?? null;
  const price = selectedPackage?.price ?? null;
  const canBuy =
    Boolean(selectedPackage) &&
    balance !== null &&
    price !== null &&
    balance >= price &&
    !outOfStock &&
    !buying;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] w-[calc(100%_-_2rem)] max-w-xl gap-0 overflow-y-auto p-0">
          <DialogHeader className="border-b border-border/60 px-5 py-4">
            <p className="hud-label hud-label-cyan">Ghost line</p>
            <DialogTitle className="mt-1 flex items-center gap-2 text-base">
              <Smartphone className="size-4 text-cyan-600 dark:text-cyan-400" />
              Temporary numbers &amp; SMS
            </DialogTitle>
            <DialogDescription className="text-[11px] leading-5">
              Buy a private number, then watch its inbox for OTPs and
              verification codes. Numbers live on your Temp Number wallet, not
              in this app.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Temp Number wallet
                </p>
                <p className="mt-0.5 font-mono text-xl font-semibold tracking-tight text-foreground">
                  {account
                    ? formatMoney(account.balance, account.currency)
                    : "—"}
                </p>
              </div>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[10px]"
              >
                <a href={TOP_UP_URL} target="_blank" rel="noreferrer">
                  Add funds <ExternalLink className="size-2.5" />
                </a>
              </Button>
            </div>

            {account && account.balance <= 0 ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[10px] leading-4 text-amber-800 dark:text-amber-300">
                Your Temp Number wallet is empty. Add funds on Temp Number
                before buying a line; this app never charges your card.
              </p>
            ) : null}

            <div className="space-y-2.5 rounded-lg border border-border/60 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-foreground">
                  Get a number
                </p>
                {inventory ? (
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[9px] ${
                      inventory.available
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {inventory.available
                      ? `${inventory.stock ?? 0} in stock`
                      : "Out of stock"}
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="text-[9px] font-medium text-muted-foreground">
                    Country
                  </p>
                  <Select
                    value={country || undefined}
                    onValueChange={(value) => {
                      setCountry(value);
                      setPackageKey("");
                    }}
                    disabled={countries.length === 0}
                  >
                    <SelectTrigger className="h-8 text-[11px]">
                      <SelectValue placeholder="Country" />
                    </SelectTrigger>
                    <SelectContent>
                      {countries.map((entry) => (
                        <SelectItem
                          key={entry.country_code}
                          value={entry.country_code}
                        >
                          {entry.country_name} ({entry.country_code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <p className="text-[9px] font-medium text-muted-foreground">
                    Package
                  </p>
                  <Select
                    value={packageKey || undefined}
                    onValueChange={setPackageKey}
                    disabled={packages.length === 0}
                  >
                    <SelectTrigger className="h-8 text-[11px]">
                      <SelectValue placeholder="Package" />
                    </SelectTrigger>
                    <SelectContent>
                      {packages.map((pkg) => (
                        <SelectItem
                          key={packageKeyOf(pkg)}
                          value={packageKeyOf(pkg)}
                        >
                          {pkg.duration_label} ·{" "}
                          {pkg.number_type === "non_voip"
                            ? "Non-VoIP"
                            : "VoIP"}{" "}
                          · {formatMoney(pkg.price)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedPackage ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
                  <div>
                    <p className="font-mono text-sm font-semibold text-foreground">
                      {formatMoney(selectedPackage.price)}
                    </p>
                    <p className="text-[9px] text-muted-foreground">
                      {selectedPackage.duration_label} ·{" "}
                      {selectedPackage.number_type === "non_voip"
                        ? "Non-VoIP"
                        : "VoIP"}{" "}
                      · {countryData?.country_name}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 gap-1.5 text-[10px]"
                    disabled={!canBuy}
                    onClick={() => void handleBuy()}
                  >
                    {buying ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Plus className="size-3" />
                    )}
                    {!account
                      ? "Loading…"
                      : outOfStock
                        ? "Out of stock"
                        : balance !== null && price !== null && balance < price
                          ? "Add funds to buy"
                          : `Buy for ${formatMoney(selectedPackage.price)}`}
                  </Button>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  {loading ? "Loading packages…" : "No package selected."}
                </p>
              )}

              <p className="text-[9px] leading-4 text-muted-foreground/80">
                The number is private to this wallet. SMS usually arrives within
                a few minutes; keep this panel open to watch the inbox.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-foreground">
                  Your lines
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7"
                  disabled={refreshing}
                  title="Refresh lines"
                  onClick={() => void refreshNumbers()}
                >
                  {refreshing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                </Button>
              </div>

              {numbers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 px-3 py-3 text-[10px] leading-4 text-muted-foreground">
                  No lines yet. Buy one above; it appears here with its live
                  inbox.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {numbers.map((line) => (
                    <button
                      key={line.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(line.id);
                        setInbox(null);
                        setInboxError(null);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        selectedId === line.id
                          ? "border-cyan-500/40 bg-cyan-500/5"
                          : "border-border/60 hover:border-border hover:bg-muted/20"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-sm font-semibold text-foreground">
                          {line.phone_number}
                        </p>
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[9px] ${statusClass(
                            line.status,
                          )}`}
                        >
                          {line.status}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[9px] text-muted-foreground">
                        {line.country_name} ·{" "}
                        {line.number_type === "non_voip"
                          ? "Non-VoIP"
                          : "VoIP"}{" "}
                        · expires {formatDate(line.expire_date)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedId !== null ? (
              <div className="overflow-hidden rounded-lg border border-border/60">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-foreground">
                      {selectedNumber?.phone_number ?? "Line"}
                    </p>
                    <p className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                      <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                      {inboxError
                        ? "Inbox unavailable"
                        : "Live inbox · polling every 5 seconds"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {selectedNumber?.phone_number ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-[10px]"
                        onClick={() =>
                          void copyText(
                            selectedNumber.phone_number,
                            "number",
                          )
                        }
                      >
                        {copiedKey === "number" ? (
                          <Check className="size-3" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                        Copy
                      </Button>
                    ) : null}
                    {selectedNumber?.status === "active" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[10px] text-muted-foreground hover:text-destructive"
                        onClick={() => setCancelTarget(selectedNumber)}
                      >
                        Release
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2 px-3 py-2.5">
                  {inboxError ? (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-4 text-amber-800 dark:text-amber-300">
                      {inboxError}
                    </p>
                  ) : null}

                  {inbox === null && !inboxError ? (
                    <p className="py-3 text-center text-[10px] text-muted-foreground">
                      Loading inbox…
                    </p>
                  ) : inbox?.messages.length ? (
                    inbox.messages.map((message) => {
                      const code = extractCode(message.body);
                      return (
                        <div
                          key={message.id}
                          className="rounded-md border border-border/50 bg-background/60 px-2.5 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-[9px] font-medium text-muted-foreground">
                              {message.from}
                            </p>
                            <p className="shrink-0 text-[9px] text-muted-foreground/80">
                              {formatTime(message.received_at)}
                            </p>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-4 text-foreground">
                            {message.body}
                          </p>
                          {code ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mt-1.5 h-6 gap-1 border-emerald-500/30 bg-emerald-500/10 px-2 font-mono text-[10px] text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                              onClick={() =>
                                void copyText(code, `code-${message.id}`)
                              }
                            >
                              {copiedKey === `code-${message.id}` ? (
                                <Check className="size-3" />
                              ) : (
                                <Copy className="size-3" />
                              )}
                              {code}
                            </Button>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <p className="rounded-md border border-dashed border-border/70 px-3 py-3 text-center text-[10px] leading-4 text-muted-foreground">
                      Waiting for the first SMS…
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
            <span className="text-[10px] text-muted-foreground">
              Numbers and SMS are managed by Temp Number.
            </span>
            <a
              href={TOP_UP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] underline decoration-border underline-offset-2 hover:text-foreground"
            >
              Open wallet <ExternalLink className="size-2.5" />
            </a>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(next) => {
          if (!next && !cancelling) setCancelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Release {cancelTarget?.phone_number}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Temp Number refunds a number only between 15 and 120 minutes
              after purchase and before it receives its first SMS. Releasing it
              removes the line and its inbox.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              onClick={(event) => {
                event.preventDefault();
                void handleCancel();
              }}
            >
              {cancelling ? "Releasing…" : "Release for refund"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
