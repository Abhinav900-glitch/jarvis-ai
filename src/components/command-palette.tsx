import type { ReactNode } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

/**
 * The command palette.
 *
 * One keyboard surface for everything that used to need a hidden corner of the
 * UI: tools, panels, chats, projects, personas. It is deliberately dumb — the
 * caller supplies the commands, so this file never has to know what "Deep
 * Research" does.
 */

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  /** Extra terms the search should match on, e.g. "img" for "Generate image". */
  keywords?: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  placeholder = "Type a command or search…",
  emptyLabel = "Nothing matches that.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PaletteCommand[];
  placeholder?: string;
  emptyLabel?: string;
}) {
  // Grouped once per open rather than on every keystroke of the filter.
  const groups = commands.reduce<Map<string, PaletteCommand[]>>((acc, command) => {
    const bucket = acc.get(command.group);
    if (bucket) bucket.push(command);
    else acc.set(command.group, [command]);
    return acc;
  }, new Map());

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search commands, chats and projects"
      className="sm:max-w-xl"
    >
      <CommandInput placeholder={placeholder} />
      <CommandList>
        <CommandEmpty>{emptyLabel}</CommandEmpty>
        {[...groups.entries()].map(([group, items], index) => (
          <div key={group}>
            {index > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {items.map((command) => (
                <CommandItem
                  key={command.id}
                  value={`${command.label} ${command.keywords ?? ""}`}
                  disabled={command.disabled}
                  onSelect={() => {
                    // Close first: a command that opens a dialog should not
                    // leave the palette fighting it for focus.
                    onOpenChange(false);
                    command.run();
                  }}
                >
                  {command.icon}
                  <span>{command.label}</span>
                  {command.shortcut && (
                    <kbd className="ml-auto font-mono text-[10px] tracking-widest text-muted-foreground">
                      {command.shortcut}
                    </kbd>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
