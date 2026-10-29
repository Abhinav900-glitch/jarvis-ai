import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDecryptedTitles } from "@/lib/use-e2e";
import { useRenameSession } from "@/lib/messages";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The chat list, grouped into projects.
 *
 * A project is only a name and a colour, and that is on purpose: it is a place
 * to put a conversation, not a second product. Chats with no project are still
 * listed, at the bottom, under "Unfiled" — nothing is ever hidden by being
 * unorganised, and deleting a folder unfiles its chats rather than deleting
 * them.
 */

const PROJECT_COLORS = [
  "#38bdf8",
  "#a78bfa",
  "#f472b6",
  "#fb923c",
  "#4ade80",
  "#facc15",
  "#2dd4bf",
  "#f87171",
];

interface Project {
  _id: Id<"projects">;
  name: string;
  color?: string | undefined;
  icon?: string | undefined;
  chatCount: number;
}

function FolderHeader({
  name,
  color,
  count,
  collapsed,
  onToggle,
  menu,
}: {
  name: string;
  color?: string | undefined;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  menu?: React.ReactNode;
}) {
  return (
    <div className="group/folder flex items-center gap-1 px-1">
      <button
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
      >
        {collapsed ? (
          <ChevronRight className="size-3 shrink-0" />
        ) : (
          <ChevronDown className="size-3 shrink-0" />
        )}
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color ?? "#64748b" }}
        />
        <span className="truncate">{name}</span>
        <span className="text-[10px] font-normal opacity-60">{count}</span>
      </button>
      {menu}
    </div>
  );
}

export function ProjectSidebar({
  activeId,
  onSelect,
  onNewChat,
}: {
  activeId: Id<"chatSessions"> | null;
  onSelect: (sessionId: Id<"chatSessions">) => void;
  onNewChat: () => void;
}) {
  const projectsQuery = useQuery(api.projects.listProjects);
  const sessionsQuery = useQuery(api.chats.listSessions);
  // Stable while loading, so the grouping memo does not rebuild every render.
  const sessions = useMemo(() => sessionsQuery ?? [], [sessionsQuery]);
  // Pinned chats sort above live ones inside their group; archived chats leave
  // the groups entirely and are listed once, under "Archived".
  const activeSessions = useMemo(
    () =>
      sessions
        .filter((s) => !s.archivedAt)
        .sort(
          (a, b) =>
            Number(!!b.pinned) - Number(!!a.pinned) ||
            b.updatedAt - a.updatedAt,
        ),
    [sessions],
  );
  const archivedSessions = useMemo(
    () => sessions.filter((s) => s.archivedAt),
    [sessions],
  );
  const createProject = useMutation(api.projects.createProject);
  const updateProject = useMutation(api.projects.updateProject);
  const deleteProject = useMutation(api.projects.deleteProject);
  const assignSessions = useMutation(api.projects.assignSessions);
  const deleteSession = useMutation(api.chats.deleteSession);
  const setSessionPinned = useMutation(api.chats.setSessionPinned);
  const setSessionArchived = useMutation(api.chats.setSessionArchived);
  const duplicateSession = useMutation(api.chats.duplicateSession);
  // Titles are ciphertext at rest, so every rename goes through the hook that
  // seals it with the user's key before it reaches the network.
  const renameSession = useRenameSession();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [colorDraft, setColorDraft] = useState(PROJECT_COLORS[0]);
  const [editingId, setEditingId] = useState<Id<"projects"> | null>(null);
  const [renameFor, setRenameFor] = useState<Id<"chatSessions"> | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);

  const projects: Project[] = projectsQuery?.projects ?? [];
  // Titles are ciphertext in the database — see `useDecryptedTitles`.
  const titleOf = useDecryptedTitles(sessions);

  const grouped = useMemo(() => {
    const byProject = new Map<Id<"projects">, Id<"chatSessions">[]>();
    const unfiled: Id<"chatSessions">[] = [];
    for (const session of activeSessions) {
      if (session.projectId && byProject.has(session.projectId)) {
        byProject.get(session.projectId)!.push(session._id);
      } else if (session.projectId) {
        byProject.set(session.projectId, [session._id]);
      } else {
        unfiled.push(session._id);
      }
    }
    return { byProject, unfiled };
  }, [activeSessions]);

  const openDialog = (project?: Project) => {
    setEditingId(project?._id ?? null);
    setNameDraft(project?.name ?? "");
    setColorDraft(project?.color ?? PROJECT_COLORS[0]);
    setDialogOpen(true);
  };

  const submit = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    try {
      if (editingId) {
        await updateProject({ projectId: editingId, name, color: colorDraft });
        toast.success("Project renamed.");
      } else {
        await createProject({ name, color: colorDraft });
        toast.success(`“${name}” created.`);
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save project.");
    }
  };

  const removeProject = async (project: Project) => {
    try {
      const affected = await deleteProject({ projectId: project._id });
      toast.success(
        affected > 0
          ? `Deleted. ${affected} ${affected === 1 ? "chat" : "chats"} moved to Unfiled.`
          : "Project deleted.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete project.");
    }
  };

  const submitRename = async () => {
    const title = renameDraft.trim();
    if (!renameFor || !title) return;
    try {
      await renameSession({ sessionId: renameFor, title });
      setRenameFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename chat.");
    }
  };

  const togglePin = (session: (typeof sessions)[number]) => {
    void setSessionPinned({
      sessionId: session._id,
      pinned: !session.pinned,
    }).catch(() => toast.error("Could not update the pin."));
  };

  const toggleArchive = async (session: (typeof sessions)[number]) => {
    const archiving = !session.archivedAt;
    try {
      await setSessionArchived({ sessionId: session._id, archived: archiving });
      // Archiving the chat that is open would leave its transcript on screen
      // with no way back to it from the sidebar, so start a fresh one.
      if (archiving && activeId === session._id) onNewChat();
      toast.success(archiving ? "Chat archived." : "Chat restored.");
    } catch {
      toast.error("Could not archive chat.");
    }
  };

  const duplicate = async (session: (typeof sessions)[number]) => {
    try {
      const id = await duplicateSession({ sessionId: session._id });
      toast.success("Chat duplicated.");
      onSelect(id);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not duplicate chat.",
      );
    }
  };

  const renderRow = (session: (typeof sessions)[number]) => (
    <li key={session._id} className="group/chat relative">
      <button
        onClick={() => onSelect(session._id)}
        className={`flex w-full items-center gap-1.5 rounded-md px-3 py-2 pr-8 text-left text-sm transition-colors ${
          activeId === session._id
            ? "bg-accent font-medium"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        }`}
      >
        {session.pinned && !session.archivedAt && (
          <Pin className="size-3 shrink-0 text-amber-500/80" />
        )}
        <span className="truncate">{titleOf(session)}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover/chat:opacity-100"
            title="Chat options"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() => {
              setRenameDraft(titleOf(session));
              setRenameFor(session._id);
            }}
          >
            <Pencil className="size-3.5" />
            Rename chat
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void duplicate(session)}>
            <Copy className="size-3.5" />
            Duplicate chat
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => togglePin(session)}>
            <Pin className="size-3.5" />
            {session.pinned ? "Unpin chat" : "Pin to top"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void toggleArchive(session)}>
            {session.archivedAt ? (
              <ArchiveRestore className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
            {session.archivedAt ? "Restore chat" : "Archive chat"}
          </DropdownMenuItem>
          {!session.archivedAt && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() =>
                  void assignSessions({
                    projectId: null,
                    sessionIds: [session._id],
                  })
                }
              >
                Unfiled
              </DropdownMenuItem>
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project._id}
                  onSelect={() =>
                    void assignSessions({
                      projectId: project._id,
                      sessionIds: [session._id],
                    })
                  }
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: project.color ?? "#64748b" }}
                  />
                  {project.name}
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => {
              void deleteSession({ sessionId: session._id });
              if (activeId === session._id) onNewChat();
            }}
          >
            <Trash2 className="size-3.5" />
            Delete chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );

  const sections = [
    ...projects.map((project) => ({
      key: project._id as string,
      project,
      rows: grouped.byProject.get(project._id) ?? [],
    })),
    {
      key: "unfiled",
      project: null as Project | null,
      rows: grouped.unfiled,
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1 px-2 pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 justify-start gap-2 text-sm"
          onClick={onNewChat}
        >
          <Plus className="size-4" /> New chat
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="New project"
          onClick={() => openDialog()}
        >
          <FolderPlus className="size-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-2 py-2">
        {sections.map((section) => {
          const isUnfiled = section.key === "unfiled";
          if (
            isUnfiled &&
            section.rows.length === 0 &&
            projects.length === 0 &&
            archivedSessions.length === 0
          ) {
            return (
              <p
                key={section.key}
                className="px-3 py-2 text-xs text-muted-foreground"
              >
                No chats yet
              </p>
            );
          }
          if (isUnfiled && section.rows.length === 0) return null;

          const isCollapsed = collapsed[section.key] ?? false;
          const name = section.project?.name ?? "Unfiled";
          const color = section.project?.color;

          return (
            <section key={section.key}>
              <FolderHeader
                name={name}
                color={color}
                count={section.rows.length}
                collapsed={isCollapsed}
                onToggle={() =>
                  setCollapsed((prev) => ({
                    ...prev,
                    [section.key]: !isCollapsed,
                  }))
                }
                menu={
                  section.project ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="rounded p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover/folder:opacity-100"
                          title="Project options"
                        >
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => openDialog(section.project!)}
                        >
                          <Pencil className="size-3.5" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => void removeProject(section.project!)}
                        >
                          <Trash2 className="size-3.5" />
                          Delete project
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : undefined
                }
              />
              {!isCollapsed && (
                <ul className="space-y-0.5">
                  {section.rows.map((id) => {
                    const session = sessions.find((s) => s._id === id);
                    return session ? renderRow(session) : null;
                  })}
                </ul>
              )}
            </section>
          );
        })}

        {archivedSessions.length > 0 && (
          <section className="pt-1">
            <FolderHeader
              name="Archived"
              color="#64748b"
              count={archivedSessions.length}
              collapsed={!archivedOpen}
              onToggle={() => setArchivedOpen((v) => !v)}
            />
            {!archivedOpen && (
              <ul className="space-y-0.5">
                {archivedSessions.map((session) => renderRow(session))}
              </ul>
            )}
          </section>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingId ? "Rename project" : "New project"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="e.g. Thesis, Work, Side project"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Colour</Label>
              <div className="flex flex-wrap gap-1.5">
                {PROJECT_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setColorDraft(color)}
                    className={`size-6 rounded-full transition-transform ${
                      colorDraft === color
                        ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background"
                        : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={`Colour ${color}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={!nameDraft.trim()}>
              {editingId ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameFor !== null}
        onOpenChange={(open) => {
          if (!open) setRenameFor(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            placeholder="Chat name"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRename();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameFor(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitRename()} disabled={!renameDraft.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
