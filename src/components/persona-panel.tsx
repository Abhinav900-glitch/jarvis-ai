import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Pencil, Plus, Sparkles, Trash2, User } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

/**
 * How Jarvis should work.
 *
 * Two independent controls, deliberately kept apart:
 *
 * - INSTRUCTIONS are one block of free text that applies everywhere. "Always
 *   reply in Hindi", "never use bullet points", "cite the file and line". This
 *   is what most people reach for, so it gets the first tab.
 * - PERSONAS are reusable characters ("concise", "teacher") that can be pinned
 *   to one chat, so a research chat can run as an analyst while a scratch chat
 *   stays plain.
 *
 * Neither can talk Jarvis out of the safety rules in the base prompt — they are
 * appended to it, never merged into it.
 */

const MAX_INSTRUCTIONS = 4000;
const MAX_PERSONA_INSTRUCTIONS = 2000;

/**
 * The instructions editor.
 *
 * Its own component so the textarea's draft is created when the dialog opens
 * and thrown away when it closes — which is what "unsaved edits disappear" has
 * always meant in every other app, without an effect writing state back.
 */
function InstructionsEditor({
  value,
  saveSettings,
  activePersonaId,
}: {
  value: string;
  saveSettings: ReturnType<typeof useMutation<typeof api.workspace.saveSettings>>;
  activePersonaId: Id<"personas"> | null;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings({
        customInstructions: draft.slice(0, MAX_INSTRUCTIONS),
        activePersonaId,
      });
      toast.success("Instructions saved — they apply from your next message.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <Label htmlFor="jarvis-instructions" className="text-sm font-medium">
        Standing instructions
      </Label>
      <Textarea
        id="jarvis-instructions"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={9}
        maxLength={MAX_INSTRUCTIONS}
        placeholder={
          "Examples:\n• Reply in Hinglish, keeping technical terms in English.\n• Never use bullet points — write in paragraphs.\n• When you write code, always show a runnable example first.\n• Cite the source for every factual claim."
        }
        className="resize-y text-sm"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {draft.length} / {MAX_INSTRUCTIONS}
        </span>
        <span>Applies to new messages in every chat.</span>
      </div>
      <Button onClick={() => void save()} disabled={draft === value || saving}>
        {saving ? "Saving…" : "Save instructions"}
      </Button>
    </div>
  );
}

interface Persona {
  _id: Id<"personas">;
  name: string;
  instructions: string;
  icon?: string | undefined;
}

interface Starter {
  name: string;
  icon: string;
  instructions: string;
}

export function PersonaPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useQuery(api.workspace.getSettings);
  const list = useQuery(api.workspace.listPersonas);
  const saveSettings = useMutation(api.workspace.saveSettings);
  const savePersona = useMutation(api.workspace.savePersona);
  const deletePersona = useMutation(api.workspace.deletePersona);

  const [editingId, setEditingId] = useState<Id<"personas"> | null>(null);
  const [personaName, setPersonaName] = useState("");
  const [personaEmoji, setPersonaEmoji] = useState("");
  const [personaBody, setPersonaBody] = useState("");

  const personas: Persona[] = list?.personas ?? [];
  const starters: Starter[] = list?.starters ?? [];

  const setActive = async (personaId: Id<"personas"> | null) => {
    try {
      await saveSettings({
        customInstructions: settings?.customInstructions ?? undefined,
        activePersonaId: personaId,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch persona.");
    }
  };

  const startNew = (starter?: Starter) => {
    setEditingId(null);
    setPersonaName(starter?.name ?? "");
    setPersonaEmoji(starter?.icon ?? "✨");
    setPersonaBody(starter?.instructions ?? "");
  };

  const startEdit = (persona: Persona) => {
    setEditingId(persona._id);
    setPersonaName(persona.name);
    setPersonaEmoji(persona.icon ?? "✨");
    setPersonaBody(persona.instructions);
  };

  const submitPersona = async () => {
    try {
      await savePersona({
        name: personaName,
        icon: personaEmoji,
        instructions: personaBody,
        personaId: editingId ?? undefined,
      });
      toast.success(editingId ? "Persona updated." : "Persona saved.");
      setEditingId(null);
      setPersonaName("");
      setPersonaBody("");
      setPersonaEmoji("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save persona.");
    }
  };

  const remove = async (persona: Persona) => {
    try {
      await deletePersona({ personaId: persona._id });
      toast.success(`Deleted “${persona.name}”.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete persona.");
    }
  };

  const activeId = settings?.activePersonaId ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            How Jarvis works for you
          </DialogTitle>
          <DialogDescription>
            Saved instantly and applied to every reply. Changes to the safety
            rules are not possible — and not intended.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="instructions">
          <TabsList className="w-full">
            <TabsTrigger value="instructions" className="flex-1">
              Instructions
            </TabsTrigger>
            <TabsTrigger value="personas" className="flex-1">
              Personas
            </TabsTrigger>
          </TabsList>

          <TabsContent value="instructions" className="pt-4">
            <InstructionsEditor
              value={settings?.customInstructions ?? ""}
              saveSettings={saveSettings}
              activePersonaId={settings?.activePersonaId ?? null}
            />
          </TabsContent>

          <TabsContent value="personas" className="space-y-4 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                A persona is a reusable way of answering. Switch it on for a
                whole chat, or pin it to one message.
              </p>
              <Button size="sm" variant="outline" onClick={() => startNew()}>
                <Plus className="size-3.5" /> New
              </Button>
            </div>

            <ul className="space-y-1.5">
              <li
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  activeId === null
                    ? "border-primary/50 bg-primary/5"
                    : "border-border"
                }`}
              >
                <User className="size-4 text-muted-foreground" />
                <span className="flex-1">Default</span>
                {activeId === null ? (
                  <Check className="size-4 text-primary" />
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => void setActive(null)}
                  >
                    Use
                  </Button>
                )}
              </li>

              {personas.map((persona) => (
                <li
                  key={persona._id}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    activeId === persona._id
                      ? "border-primary/50 bg-primary/5"
                      : "border-border"
                  }`}
                >
                  <span aria-hidden className="text-base">
                    {persona.icon ?? "✨"}
                  </span>
                  <span className="flex-1 truncate">{persona.name}</span>
                  {activeId === persona._id ? (
                    <Check className="size-4 text-primary" />
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => void setActive(persona._id)}
                    >
                      Use
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Edit persona"
                    onClick={() => startEdit(persona)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Delete persona"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void remove(persona)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>

            {personas.length === 0 && (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                No personas yet — start from one below, or write your own.
              </p>
            )}

            <Separator />

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Start from a template
              </p>
              <div className="flex flex-wrap gap-1.5">
                {starters.map((starter) => (
                  <button
                    key={starter.name}
                    onClick={() => startNew(starter)}
                    className="rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent"
                  >
                    {starter.icon} {starter.name}
                  </button>
                ))}
              </div>
            </div>

            {(personaName || personaBody) && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex gap-2">
                  <Input
                    value={personaEmoji}
                    onChange={(e) => setPersonaEmoji(e.target.value.slice(0, 2))}
                    className="w-14 text-center"
                    placeholder="✨"
                    aria-label="Persona icon"
                  />
                  <Input
                    value={personaName}
                    onChange={(e) => setPersonaName(e.target.value)}
                    placeholder="Name, e.g. “Concise”"
                    aria-label="Persona name"
                  />
                </div>
                <Textarea
                  value={personaBody}
                  onChange={(e) => setPersonaBody(e.target.value)}
                  rows={4}
                  maxLength={MAX_PERSONA_INSTRUCTIONS}
                  placeholder="What should this persona do?"
                  aria-label="Persona instructions"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startNew()}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void submitPersona()}
                    disabled={!personaName.trim() || !personaBody.trim()}
                  >
                    {editingId ? "Save changes" : "Create persona"}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
