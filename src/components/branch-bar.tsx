import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { GitBranch, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Branch switcher.
 *
 * Editing or regenerating forks the conversation instead of destroying what
 * came after. This bar is the way back: pick which line you are reading, and
 * the transcript swaps to it.
 *
 * Only shown when a chat actually has branches — a bar reading "Original" over
 * a straight-line conversation is noise.
 */

export function BranchBar({
  sessionId,
  activeBranchId,
  onSelect,
  onNewBranch,
}: {
  sessionId: Id<"chatSessions">;
  activeBranchId: Id<"chatBranches"> | null;
  onSelect: (branchId: Id<"chatBranches"> | null) => void;
  /** Fork from the newest message — the "try something different" gesture. */
  onNewBranch: () => void;
}) {
  const branches =
    useQuery(api.branches.listBranches, { sessionId }) ?? [];
  const deleteBranch = useMutation(api.branches.deleteBranch);

  // The main line is always present; only real branches are worth a tab.
  const real = branches.filter((b) => b._id !== null);
  if (real.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border/60 px-4 py-1.5">
      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />

      {branches.map((branch) => {
        const id = branch._id as Id<"chatBranches"> | null;
        const active = (activeBranchId ?? null) === id;
        return (
          <div key={id ?? "original"} className="group/branch flex items-center">
            <button
              onClick={() => onSelect(id)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${
                active
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              }`}
            >
              {branch.name}
              <span className="ml-1.5 opacity-60">{branch.messageCount}</span>
            </button>
            {id && (
              <button
                onClick={() => {
                  void deleteBranch({ branchId: id })
                    .then(() => {
                      if (activeBranchId === id) onSelect(null);
                      toast.success("Branch deleted.");
                    })
                    .catch((err: unknown) =>
                      toast.error(
                        err instanceof Error ? err.message : "Could not delete.",
                      ),
                    );
                }}
                className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover/branch:opacity-100"
                title="Delete branch"
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        );
      })}

      <Button
        size="sm"
        variant="ghost"
        className="ml-auto shrink-0 h-7 text-xs"
        onClick={onNewBranch}
      >
        <Plus className="size-3" /> Branch
      </Button>
    </div>
  );
}

/**
 * The "+ Branch" menu, exposed as a dropdown so the caller can attach it to a
 * specific message rather than always forking at the newest one.
 */
export function BranchMenu({
  sessionId,
  messageId,
}: {
  sessionId: Id<"chatSessions">;
  messageId: Id<"chatMessages">;
}) {
  const forkBranch = useMutation(api.branches.forkBranch);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Branch from this message"
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <GitBranch className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            void forkBranch({ sessionId, atMessageId: messageId })
              .then(() => toast.success("Branched. The original is untouched."))
              .catch((err: unknown) =>
                toast.error(err instanceof Error ? err.message : "Could not branch."),
              );
          }}
        >
          <GitBranch className="size-3.5" />
          Branch from here
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
