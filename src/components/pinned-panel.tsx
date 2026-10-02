// ---------------------------------------------------------------------------
// PinnedPanel — the pinned messages from every conversation.
//
// A pin is the user saying "I will want this again". Scoping that to the chat
// it was pinned in would hide it exactly when they are looking for it, so the
// list spans the whole account and each row says which chat it came from.
//
// A jump list, not a second reader: long replies are clipped server-side, and
// choosing one navigates rather than expanding.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { Pin, PinOff, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

export interface PinnedPanelProps {
  open: boolean;
  onClose: () => void;
  /** Jump to a message: switch chat, and let the caller highlight it. */
  onOpenMessage: (sessionId: Id<"chatSessions">, messageId: Id<"chatMessages">) => void;
}

export function PinnedPanel({ open, onClose, onOpenMessage }: PinnedPanelProps) {
  const pinned = useQuery(api.chats.listPinned);
  const setPin = useMutation(api.chats.setPin);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const rows = pinned ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.99 }}
      transition={{ duration: 0.16 }}
      className="fixed right-4 top-16 z-[80] w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover/95 shadow-xl backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Pin className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">
          Pinned
          {rows.length > 0 ? (
            <span className="ml-1.5 font-normal text-muted-foreground">
              {rows.length}
            </span>
          ) : null}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/70">Esc to close</span>
      </div>

      <div className="max-h-[26rem] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] leading-5 text-muted-foreground">
            Nothing pinned yet. Use the pin on any message to keep it here — pins
            show up in every chat, not just this one.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row._id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpenMessage(row.sessionId, row._id)}
                  className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-accent/60"
                >
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="truncate">{row.sessionTitle}</span>
                    {row.model ? (
                      <>
                        <span>·</span>
                        <span className="font-mono">{row.model.split("/")[1] ?? row.model}</span>
                      </>
                    ) : null}
                  </div>
                  <p className="line-clamp-3 text-[11px] leading-5 text-foreground/90">
                    {row.preview}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void setPin({ messageId: row._id, pinned: false })}
                  title="Unpin"
                  className={cn(
                    "absolute right-2 top-2 rounded p-1 text-muted-foreground",
                    "opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100",
                    "group-hover:opacity-100",
                  )}
                >
                  <PinOff className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rows.length > 0 ? (
        <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground/70">
          <Trash2 className="mr-1 inline size-2.5" />
          Deleting the message removes its pin too.
        </div>
      ) : null}
    </motion.div>
  );
}