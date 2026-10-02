// ---------------------------------------------------------------------------
// SlashMenu — autocomplete for the composer's slash commands.
//
// Opens while the user is typing a leading `/`, navigates with the arrow keys,
// and fills the composer with the command plus its example argument. Nothing is
// executed from here: choosing a command only ever edits the text, so a
// mis-typed `/` can never fire something.
//
// Grouped by category and keyboard-driven, because the only way to reach it in
// practice is to start typing.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { SLASH_COMMANDS, type SlashCommand } from "@/lib/slash-commands";

export interface SlashMenuProps {
  open: boolean;
  /** The `/token` currently typed, including the leading slash. */
  token: string;
  /** Index of the highlighted row. */
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (command: SlashCommand) => void;
}

/** Subsequence match, so `/wt` still finds `/weather`. */
function matches(command: SlashCommand, needle: string): boolean {
  const names = [command.name, ...command.aliases];
  return names.some((name) => {
    let i = 0;
    for (const ch of name) {
      if (ch === needle[i]) i++;
      if (i === needle.length) return true;
    }
    return needle.length === 0;
  });
}

export function SlashMenu({ open, token, activeIndex, onHover, onSelect }: SlashMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const needle = token.replace(/^\//, "").toLowerCase();

  const groups = useMemo(() => {
    const matching = SLASH_COMMANDS.filter((c) => matches(c, needle));
    const order: SlashCommand["group"][] = ["World", "Create", "Math", "Session"];
    return order
      .map((group) => ({
        group,
        items: matching.filter((c) => c.group === group),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [needle]);

  // Flattened so the highlighted index maps onto a single row order.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Keep the highlighted row in view when navigating with the keyboard.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  // Guard against the index outliving a narrowed list.
  const safeIndex = flat.length === 0 ? -1 : Math.min(activeIndex, flat.length - 1);

  let cursor = -1;

  return (
    <AnimatePresence>
      {open && flat.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.99 }}
          transition={{ duration: 0.14 }}
          ref={listRef}
          className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-[min(26rem,calc(100vw-3rem))] overflow-y-auto rounded-xl border bg-popover/95 p-1.5 shadow-lg backdrop-blur"
        >
          {groups.map(({ group, items }) => (
            <div key={group} className="mb-1 last:mb-0">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
                {group}
              </div>
              {items.map((command) => {
                cursor += 1;
                const index = cursor;
                const active = index === safeIndex;
                return (
                  <button
                    key={command.name}
                    type="button"
                    data-active={active}
                    onMouseEnter={() => onHover(index)}
                    // mousedown, not click: the composer would blur on mousedown
                    // and the menu would be gone before click fired.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelect(command);
                    }}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                      active ? "bg-accent text-accent-foreground" : "text-foreground",
                    )}
                  >
                    <span className="shrink-0 font-mono text-xs font-medium">
                      /{command.name}
                      {command.argHint ? (
                        <span className="ml-1 font-sans text-[10px] text-muted-foreground">
                          {command.argHint}
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                      {command.summary}
                    </span>
                    {active ? (
                      <CornerDownLeft className="size-3 shrink-0 opacity-60" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}