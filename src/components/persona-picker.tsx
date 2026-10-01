import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Check, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Which persona answers in *this* chat.
 *
 * The user's default lives in settings and applies everywhere; this overrides
 * it for a single conversation, so a research thread can run as an analyst
 * while a scratch chat stays plain without changing anything else.
 */
export function PersonaPicker({
  sessionId,
  personaId,
}: {
  sessionId: Id<"chatSessions">;
  personaId: Id<"personas"> | undefined;
}) {
  const list = useQuery(api.workspace.listPersonas);
  const setSessionPersona = useMutation(api.chats.setSessionPersona);

  const personas = list?.personas ?? [];
  const active = personas.find((p) => p._id === personaId);

  const choose = async (next: Id<"personas"> | null) => {
    try {
      await setSessionPersona({ sessionId, personaId: next });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch persona.");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          title="Persona for this chat"
        >
          <span aria-hidden>{active?.icon ?? <User className="size-3.5" />}</span>
          <span className="max-w-24 truncate">{active?.name ?? "Default"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Persona for this chat</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void choose(null)}>
          <User className="size-3.5" />
          <span className="flex-1">Default</span>
          {!personaId ? <Check className="size-3.5" /> : null}
        </DropdownMenuItem>
        {personas.length > 0 && <DropdownMenuSeparator />}
        {personas.map((persona) => (
          <DropdownMenuItem
            key={persona._id}
            onSelect={() => void choose(persona._id)}
          >
            <span aria-hidden>{persona.icon ?? "✨"}</span>
            <span className="flex-1 truncate">{persona.name}</span>
            {personaId === persona._id ? (
              <Check className="size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
        {personas.length === 0 && (
          <DropdownMenuItem disabled>
            No personas yet — create one in “How Jarvis works”
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}