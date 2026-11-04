// ---------------------------------------------------------------------------
// PluginMenu — the `@` autocomplete in the composer.
//
// Lists the skill files found in the user's stored plugin zips. Choosing a row
// only edits the text, exactly like the slash and `$` menus: the zip is opened
// when the message is sent, never while it is being typed.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PluginSkillEntry } from "@/lib/plugin-mentions";

export interface PluginMenuProps {
  open: boolean;
  /** The `@token` typed so far, including the leading at sign. */
  token: string;
  /** Every mentionable skill, so the empty state can tell the two cases apart. */
  entries: PluginSkillEntry[];
  /** Rows already narrowed down to `token`. */
  options: PluginSkillEntry[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (entry: PluginSkillEntry) => void;
  /** Opens Settings → Plugins, for the empty state. */
  onManage: () => void;
}

export function PluginMenu({
  open,
  token,
  entries,
  options,
  activeIndex,
  onHover,
  onSelect,
  onManage,
}: PluginMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const safeIndex = options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={listRef}
          initial={{ opacity: 0, y: 6, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.99 }}
          transition={{ duration: 0.14 }}
          className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-[min(26rem,calc(100vw-3rem))] overflow-y-auto rounded-xl border bg-popover/95 p-1.5 shadow-lg backdrop-blur"
        >
          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
            Plugin skills
          </div>

          {entries.length === 0 ? (
            <div className="space-y-2 px-2 py-2">
              <p className="text-[11px] text-muted-foreground">
                No enabled plugin skills yet. Install a plugin zip in Settings →
                Plugins and its skills appear here as{" "}
                <span className="font-mono">@plugin/skill</span> mentions.
              </p>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onManage();
                }}
                className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent"
              >
                <Sparkles className="size-3" /> Open plugins
              </button>
            </div>
          ) : options.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">
              No skill matches “{token}”.
            </p>
          ) : (
            options.map((entry, index) => {
              const active = index === safeIndex;
              return (
                <button
                  key={`${entry.pluginId}:${entry.skillName}`}
                  type="button"
                  data-active={active}
                  onMouseEnter={() => onHover(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(entry);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                    active ? "bg-accent text-accent-foreground" : "text-foreground",
                  )}
                >
                  <Sparkles className="size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {entry.label}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {entry.pluginName} · <span className="font-mono">{entry.token}</span>
                    </span>
                  </span>
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
