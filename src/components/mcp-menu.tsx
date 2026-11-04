// ---------------------------------------------------------------------------
// McpMenu — the `$` autocomplete in the composer.
//
// Lists the user's own MCP servers so a message can say `$github …` and have
// only that server's tools attached to the turn. Choosing a row only edits the
// text, exactly like the slash menu: nothing connects, and nothing is sent,
// until the user presses Enter on the message.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { mcpSlug, type McpMentionServer } from "@/lib/mcp-mentions";

export interface McpMenuProps {
  open: boolean;
  /** The `$token` typed so far, including the leading dollar. */
  token: string;
  servers: McpMentionServer[];
  /** Rows already narrowed down to `token`. */
  options: McpMentionServer[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (server: McpMentionServer) => void;
  /** Opens Settings → MCP, for the empty state. */
  onManage: () => void;
}

export function McpMenu({
  open,
  token,
  servers,
  options,
  activeIndex,
  onHover,
  onSelect,
  onManage,
}: McpMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const safeIndex = options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.99 }}
          transition={{ duration: 0.14 }}
          ref={listRef}
          className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-[min(24rem,calc(100vw-3rem))] overflow-y-auto rounded-xl border bg-popover/95 p-1.5 shadow-lg backdrop-blur"
        >
          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
            MCP servers
          </div>

          {servers.length === 0 ? (
            <div className="space-y-2 px-2 py-2">
              <p className="text-[11px] text-muted-foreground">
                No MCP servers yet. Add an endpoint in Settings → MCP and its
                tools become available here as a <span className="font-mono">$name</span> mention.
              </p>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onManage();
                }}
                className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent"
              >
                <Plug className="size-3" /> Add a server
              </button>
            </div>
          ) : options.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">
              No server matches “{token}”.
            </p>
          ) : (
            options.map((server, index) => {
              const active = index === safeIndex;
              return (
                <button
                  key={server._id}
                  type="button"
                  data-active={active}
                  onMouseEnter={() => onHover(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(server);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                    active ? "bg-accent text-accent-foreground" : "text-foreground",
                  )}
                >
                  <Plug className="size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {server.name}
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                      ${mcpSlug(server.name)}
                    </span>
                  </span>
                  {server.toolCount != null ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {server.toolCount} {server.toolCount === 1 ? "tool" : "tools"}
                    </span>
                  ) : null}
                  {active ? <CornerDownLeft className="size-3 shrink-0 opacity-60" /> : null}
                </button>
              );
            })
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
