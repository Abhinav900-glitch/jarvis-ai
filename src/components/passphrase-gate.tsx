/**
 * The one screen that stands between you and your own words.
 *
 * First visit: choose a passphrase. Afterwards: enter it. That is the whole
 * flow, and there is no "forgot passphrase" — nothing on the server can
 * recover it, because nothing on the server ever saw it. Saying that out loud
 * here rather than in a support article matters: a user who invents a
 * passphrase they cannot reproduce has just lost every message they typed.
 */
import { useState } from "react";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  MIN_PASSPHRASE_LENGTH,
  checkVerifier,
  makeVerifier,
  newSalt,
} from "@/lib/e2e";
import { useUnlockKey } from "@/lib/use-e2e";

export function PassphraseGate({
  mode,
  salt,
  verifier,
  onClose,
  onUnlocked,
}: {
  /** `setup` on first use, `unlock` once a passphrase exists, null when closed. */
  mode: "setup" | "unlock" | null;
  /** The account's stored salt, or null when no passphrase exists yet. */
  salt: string | null;
  /** Stored verifier, or null when this account has never set a passphrase. */
  verifier: string | null;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = useUnlockKey();
  const createKeyMaterial = useMutation(api.chats.createKeyMaterial);

  const setup = mode === "setup";

  const submit = async () => {
    setError(null);
    if (setup) {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
        return;
      }
      if (passphrase !== confirm) {
        setError("The two passphrases do not match.");
        return;
      }
    } else if (!passphrase) {
      setError("Enter your passphrase.");
      return;
    }

    setBusy(true);
    try {
      if (setup) {
        // Derive first, prove it can open its own verifier, then persist the
        // salt and verifier — in that order, so a bad derivation never leaves
        // rows behind that no passphrase can open.
        const salt = newSalt();
        const key = await unlock(passphrase, salt);
        const verifierText = await makeVerifier(key);
        await createKeyMaterial({ salt, verifier: verifierText });
      } else {
        if (!verifier || !salt) {
          throw new Error("No passphrase is set for this account.");
        }
        const key = await unlock(passphrase, salt);
        const ok = await checkVerifier(key, verifier);
        if (!ok) {
          setError("That passphrase does not open this account.");
          setBusy(false);
          return;
        }
      }
      setPassphrase("");
      setConfirm("");
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPassphrase("");
          setConfirm("");
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {setup ? <Lock className="size-4" /> : <ShieldCheck className="size-4" />}
            {setup ? "Choose a passphrase" : "Unlock your chats"}
          </DialogTitle>
          <DialogDescription>
            {setup
              ? "This encrypts everything you type. It is derived in this browser only — the server never sees it, so there is no way to recover it if you lose it."
              : "Enter the passphrase you chose. It is derived here and never sent anywhere."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="e2e-pass">Passphrase</Label>
            <div className="relative">
              <Input
                id="e2e-pass"
                type={reveal ? "text" : "password"}
                autoFocus
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder={setup ? "At least 8 characters" : "Your passphrase"}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={reveal ? "Hide" : "Show"}
                aria-label={reveal ? "Hide passphrase" : "Show passphrase"}
              >
                {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {setup && (
            <div className="space-y-1.5">
              <Label htmlFor="e2e-confirm">Confirm passphrase</Label>
              <Input
                id="e2e-confirm"
                type={reveal ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder="Type it again"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          {!setup && (
            <Button variant="ghost" onClick={onClose}>
              Later
            </Button>
          )}
          <Button onClick={() => void submit()} disabled={busy || !passphrase}>
            {busy ? "Working…" : setup ? "Create passphrase" : "Unlock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
