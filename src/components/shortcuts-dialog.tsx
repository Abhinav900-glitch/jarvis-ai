import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Keyboard shortcuts, in the order someone actually needs them.
 *
 * Grouped rather than one long list because the two contexts are genuinely
 * different modes: the chat keys work everywhere, and the live-mode keys only
 * while a session is up. Labelling which is which saves the reader from
 * pressing Esc and wondering why nothing happened.
 */
const GROUPS: {
  title: string;
  hint?: string;
  items: { keys: string[]; label: string }[];
}[] = [
  {
    title: "Anywhere",
    items: [
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["⌘", "/"], label: "Command palette" },
      { keys: ["⌘", "F"], label: "Find in this conversation" },
      { keys: ["?"], label: "This list" },
      { keys: ["Esc"], label: "Close a panel or dialog" },
    ],
  },
  {
    title: "In a chat",
    items: [
      { keys: ["Enter"], label: "Send" },
      { keys: ["⇧", "Enter"], label: "Send without a new line" },
      { keys: ["⌘", "↵"], label: "Send (alternative)" },
      { keys: ["↑"], label: "Edit your last message" },
      { keys: ["⌘", "↵"], label: "Send — from the edit box" },
    ],
  },
  {
    title: "Slash commands",
    hint: "Type / in the composer",
    items: [
      { keys: ["/"], label: "Open the command list" },
      { keys: ["↑", "↓"], label: "Move through the list" },
      { keys: ["Tab"], label: "Fill in the highlighted command" },
      { keys: ["↵"], label: "Fill in and send" },
      { keys: ["Esc"], label: "Dismiss the list" },
    ],
  },
  {
    title: "Listening",
    hint: "While a thread is being read aloud",
    items: [
      { keys: ["Click", "stop"], label: "Stop reading" },
      { keys: ["Esc"], label: "Stop reading" },
    ],
  },
  {
    title: "While a reply is streaming",
    items: [
      { keys: ["Esc"], label: "Stop generating" },
      { keys: ["Click", "Stop"], label: "Stop generating" },
    ],
  },
  {
    title: "Live mode",
    hint: "Only while a live session is running",
    items: [
      { keys: ["Space"], label: "Interrupt Jarvis mid-reply" },
      { keys: ["Esc"], label: "End live mode" },
      { keys: ["M"], label: "Mute or unmute the mic" },
      { keys: ["?"], label: "This list" },
    ],
  },
];

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-white/15 bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px] leading-5 text-[#e9eaff]">
      {children}
    </kbd>
  );
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Live-mode keys apply only while a session is running.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {group.title}
              </h3>
              {group.hint && (
                <p className="mb-2 text-[11px] text-muted-foreground/70">
                  {group.hint}
                </p>
              )}
              <dl className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-4"
                  >
                    <dt className="text-sm text-foreground">{item.label}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <Key key={`${k}-${i}`}>{k}</Key>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className={cn("text-[11px] text-muted-foreground/70")}>
          Shortcuts stay out of the way while you are typing in a field.
        </p>
      </DialogContent>
    </Dialog>
  );
}