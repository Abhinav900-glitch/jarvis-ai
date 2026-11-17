// ---------------------------------------------------------------------------
// GenHack — the code-writing room.
//
// A terminal-themed surface with one loop: plan, write a batch, check it, write
// the next batch. Autopilot keeps that loop running without input, and every
// file it writes is checked before it appears here, so the count on screen is
// the count of files that survived the checker.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCode2,
  Loader2,
  Pause,
  Play,
  Terminal,
  Trash2,
  Zap,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { checkProject } from "@/lib/genhack/check";
import { STACK_IDS } from "@/lib/genhack/blueprint";
import { STACK_LABELS, type StackId } from "@/lib/genhack/types";
import { zipFiles } from "@/lib/pptx/zip";

const SIZES = [60, 120, 240];

const ACCENT = "#b6f24a";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

export default function GenHack() {
  const projects = useQuery(api.genhack.list, {});
  const startProject = useAction(api.genhack.start);
  const stepProject = useAction(api.genhack.step);
  const removeProject = useMutation(api.genhack.remove);

  const [selectedId, setSelectedId] = useState<Id<"genhackProjects"> | null>(null);
  const data = useQuery(api.genhack.get, selectedId ? { projectId: selectedId } : "skip");

  const [brief, setBrief] = useState("");
  const [stack, setStack] = useState<StackId>("react");
  const [target, setTarget] = useState(120);
  const [aiAssist, setAiAssist] = useState(false);

  const [building, setBuilding] = useState(false);
  const [autopilot, setAutopilot] = useState(true);
  const [stepping, setStepping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const steppingRef = useRef(false);

  const files = useMemo(() => data?.files ?? [], [data]);
  const project = data?.project ?? null;

  const checks = useMemo(
    () =>
      checkProject(
        files.map((file) => ({ path: file.path, content: file.content })),
        // Paths planned but not yet written are pending, not broken.
        { expected: data?.project.paths ?? [] },
      ),
    [files, data?.project.paths],
  );

  const issuesByPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const issue of checks.issues) {
      if (issue.severity !== "error") continue;
      map.set(issue.path, (map.get(issue.path) ?? 0) + 1);
    }
    return map;
  }, [checks]);

  const tree = useMemo(() => {
    const folders = new Map<string, typeof files>();
    for (const file of files) {
      const cut = file.path.indexOf("/");
      const folder = cut === -1 ? "." : file.path.slice(0, cut);
      const bucket = folders.get(folder) ?? [];
      bucket.push(file);
      folders.set(folder, bucket);
    }
    return [...folders.entries()];
  }, [files]);

  const current = files.find((file) => file.path === openPath) ?? files[0] ?? null;

  const runStep = useCallback(async () => {
    if (!selectedId || steppingRef.current) return;
    steppingRef.current = true;
    setStepping(true);
    try {
      await stepProject({ projectId: selectedId, limit: 10 });
      setError(null);
    } catch (err) {
      setAutopilot(false);
      setError(err instanceof Error ? err.message : "Writing stopped.");
    } finally {
      steppingRef.current = false;
      setStepping(false);
    }
  }, [selectedId, stepProject]);

  // Autopilot: the loop keeps writing without a click. Stopping is deliberate —
  // a failure turns it off so a broken provider cannot spin forever.
  useEffect(() => {
    if (!project || project.status === "done" || !autopilot || stepping) return;
    const timer = window.setTimeout(() => void runStep(), 400);
    return () => window.clearTimeout(timer);
  }, [project, autopilot, stepping, runStep]);

  const build = async () => {
    if (!brief.trim() || building) return;
    setBuilding(true);
    setError(null);
    setOpenPath(null);
    try {
      const created = await startProject({ brief, stack, targetFiles: target, aiAssist });
      if (created) setSelectedId(created._id);
      setAutopilot(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the project.");
    } finally {
      setBuilding(false);
    }
  };

  const download = async () => {
    if (!project || files.length === 0 || zipping) return;
    setZipping(true);
    setError(null);
    try {
      const encoder = new TextEncoder();
      const bytes = await zipFiles(
        files.map((file) => ({
          path: project.name + "/" + file.path,
          data: encoder.encode(file.content),
        })),
      );
      // Copy into a plain ArrayBuffer: Blob rejects a view whose buffer type is
      // not narrowed to ArrayBuffer under the current DOM lib.
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const blob = new Blob([buffer], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = project.name + ".zip";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the zip.");
    } finally {
      setZipping(false);
    }
  };

  const percent = project && project.total > 0 ? Math.round((project.written / project.total) * 100) : 0;

  return (
    <main className="min-h-screen bg-[#07080a] text-[#e7e9ee]" style={{ fontFamily: MONO }}>
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#07080a]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-5 py-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 rounded border border-white/10 px-2 py-1 text-[11px] text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft className="size-3" /> jarvis
          </Link>
          <div className="flex items-baseline gap-2">
            <Terminal className="size-4" style={{ color: ACCENT }} />
            <span className="text-sm font-semibold tracking-[0.22em]">GENHACK</span>
            <span className="hidden text-[10px] text-white/40 sm:inline">
              offline project writer · every file checked
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {project ? (
              <>
                <button
                  onClick={() => setAutopilot((value) => !value)}
                  disabled={project.status === "done"}
                  className="inline-flex items-center gap-1.5 rounded border border-white/15 px-2.5 py-1.5 text-[11px] transition-colors hover:border-white/40 disabled:opacity-40"
                >
                  {autopilot && project.status !== "done" ? (
                    <Pause className="size-3" />
                  ) : (
                    <Play className="size-3" />
                  )}
                  {project.status === "done" ? "complete" : autopilot ? "autopilot on" : "resume"}
                </button>
                <button
                  onClick={() => void download()}
                  disabled={zipping || files.length === 0}
                  className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: ACCENT }}
                >
                  {zipping ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                  zip
                </button>
              </>
            ) : null}
          </div>
        </div>
        {project ? (
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-1 px-5 pb-2 text-[10px] text-white/45">
            <span className="text-white/70">{project.name}</span>
            <span>
              {project.written}/{project.total} files
            </span>
            <span>
              {project.writtenLines}/{project.totalLines} lines
            </span>
            <span>{project.stack}</span>
            {project.aiFiles > 0 ? (
              <span style={{ color: ACCENT }}>{project.aiFiles} ai · {project.engine}</span>
            ) : null}
            <span className={checks.errors > 0 ? "text-[#ff6b6b]" : "text-white/45"}>
              {checks.errors} errors · {checks.warnings} warnings
            </span>
          </div>
        ) : null}
        {project ? (
          <div className="h-[2px] w-full bg-white/5">
            <div
              className="h-full transition-[width] duration-500"
              style={{ width: percent + "%", background: ACCENT }}
            />
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="mx-auto mt-3 flex max-w-[1400px] items-start gap-2 border border-[#ff6b6b]/40 bg-[#ff6b6b]/10 px-3 py-2 text-[11px] text-[#ff9b9b]">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mx-auto grid max-w-[1400px] gap-4 px-5 py-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Left rail: the brief, the plan, and the folder list. */}
        <aside className="space-y-3">
          <div className="border border-white/10 bg-[#0b0d11]">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/40">
              <Zap className="size-3" style={{ color: ACCENT }} /> brief
            </div>
            <div className="space-y-2 p-3">
              <textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                rows={3}
                placeholder="A bookings dashboard for a hotel group"
                className="w-full resize-none border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] leading-relaxed outline-none placeholder:text-white/25 focus:border-white/30"
              />
              <div className="flex flex-wrap gap-1">
                {STACK_IDS.map((id) => (
                  <button
                    key={id}
                    onClick={() => setStack(id)}
                    className="border px-2 py-1 text-[10px] transition-colors"
                    style={{
                      borderColor: stack === id ? ACCENT : "rgba(255,255,255,0.12)",
                      color: stack === id ? ACCENT : "rgba(255,255,255,0.55)",
                    }}
                    title={STACK_LABELS[id]}
                  >
                    {id}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                {SIZES.map((size) => (
                  <button
                    key={size}
                    onClick={() => setTarget(size)}
                    className="border px-2 py-1 text-[10px] transition-colors"
                    style={{
                      borderColor: target === size ? ACCENT : "rgba(255,255,255,0.12)",
                      color: target === size ? ACCENT : "rgba(255,255,255,0.55)",
                    }}
                  >
                    {size} files
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[10px] text-white/50">
                <input
                  type="checkbox"
                  checked={aiAssist}
                  onChange={(event) => setAiAssist(event.target.checked)}
                  className="size-3 accent-[#b6f24a]"
                />
                let AI upgrade files (needs a key; offline still works)
              </label>
              <button
                onClick={() => void build()}
                disabled={building || !brief.trim()}
                className="flex w-full items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: ACCENT }}
              >
                {building ? <Loader2 className="size-3 animate-spin" /> : <Terminal className="size-3" />}
                {building ? "planning…" : "write project"}
              </button>
            </div>
          </div>

          <div className="border border-white/10 bg-[#0b0d11]">
            <div className="border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/40">
              recent
            </div>
            <div className="max-h-44 overflow-auto p-2">
              {(projects ?? []).length === 0 ? (
                <p className="px-1 py-2 text-[10px] text-white/30">Nothing yet.</p>
              ) : (
                (projects ?? []).map((entry) => (
                  <div key={entry._id} className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setSelectedId(entry._id);
                        setOpenPath(null);
                        setAutopilot(entry.status !== "done");
                      }}
                      className="flex-1 truncate px-1 py-1 text-left text-[11px] transition-colors hover:text-white"
                      style={{ color: selectedId === entry._id ? ACCENT : "rgba(255,255,255,0.6)" }}
                    >
                      {entry.name}
                      <span className="ml-1 text-[9px] text-white/30">
                        {entry.written}/{entry.total}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        void removeProject({ projectId: entry._id });
                        if (selectedId === entry._id) setSelectedId(null);
                      }}
                      className="p-1 text-white/25 transition-colors hover:text-[#ff6b6b]"
                      aria-label="Delete project"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* Right: the file tree and the code. */}
        {project ? (
          <section className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="max-h-[70vh] overflow-auto border border-white/10 bg-[#0b0d11]">
              {tree.map(([folder, entries]) => (
                <div key={folder}>
                  <div className="sticky top-0 flex items-center justify-between bg-[#0b0d11] px-2.5 py-1.5 text-[9px] uppercase tracking-widest text-white/35">
                    <span>{folder === "." ? "root" : folder}</span>
                    <span>{entries.length}</span>
                  </div>
                  {entries.map((entry) => {
                    const bad = issuesByPath.get(entry.path) ?? 0;
                    const active = current?.path === entry.path;
                    const relative = folder === "." ? entry.path : entry.path.slice(folder.length + 1);
                    return (
                      <button
                        key={entry.path}
                        onClick={() => setOpenPath(entry.path)}
                        className="flex w-full items-center gap-1 px-2.5 py-[3px] text-left text-[10px] transition-colors"
                        style={{
                          background: active ? "rgba(182,242,74,0.08)" : "transparent",
                          color: active ? ACCENT : "rgba(255,255,255,0.6)",
                        }}
                        title={entry.path + " — " + entry.role}
                      >
                        <FileCode2 className="size-2.5 shrink-0 opacity-40" />
                        <span className="truncate">{relative}</span>
                        {bad > 0 ? (
                          <span className="ml-auto shrink-0 text-[9px] text-[#ff6b6b]">{bad}</span>
                        ) : entry.source === "ai" ? (
                          <span className="ml-auto shrink-0 text-[9px]" style={{ color: ACCENT }}>
                            ai
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
              {stepping ? (
                <div className="flex items-center gap-1.5 px-2.5 py-2 text-[10px] text-white/30">
                  <Loader2 className="size-3 animate-spin" /> writing…
                </div>
              ) : null}
            </div>

            <div className="min-w-0 border border-white/10 bg-[#0b0d11]">
              {current ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 text-[10px] text-white/45">
                    <span className="text-white/75">{current.path}</span>
                    <span className="text-white/25">{current.language}</span>
                    <span className="text-white/30">{current.role}</span>
                    <span className="ml-auto flex items-center gap-1">
                      {(issuesByPath.get(current.path) ?? 0) === 0 ? (
                        <CheckCircle2 className="size-3" style={{ color: ACCENT }} />
                      ) : (
                        <AlertTriangle className="size-3 text-[#ff6b6b]" />
                      )}
                      {issuesByPath.get(current.path) ?? 0}
                    </span>
                  </div>
                  <pre className="max-h-[62vh] overflow-auto px-3 py-2 text-[11px] leading-[1.55]">
                    <code>
                      {current.content.split("\n").map((line, index) => (
                        <div key={index} className="flex">
                          <span className="mr-3 w-8 shrink-0 select-none text-right text-white/20">
                            {index + 1}
                          </span>
                          <span className="whitespace-pre-wrap break-words text-white/80">{line || " "}</span>
                        </div>
                      ))}
                    </code>
                  </pre>
                </>
              ) : (
                <div className="p-6 text-[11px] text-white/35">No files written yet.</div>
              )}
            </div>

            {checks.issues.length > 0 ? (
              <div className="md:col-span-2 border border-white/10 bg-[#0b0d11]">
                <div className="border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/40">
                  checks · first {Math.min(checks.issues.length, 8)}
                </div>
                <ul className="divide-y divide-white/5">
                  {checks.issues.slice(0, 8).map((issue, index) => (
                    <li key={index} className="flex gap-2 px-3 py-1.5 text-[10px]">
                      <span
                        style={{ color: issue.severity === "error" ? "#ff6b6b" : "#f2a54a" }}
                        className="shrink-0 uppercase"
                      >
                        {issue.severity}
                      </span>
                      <span className="truncate text-white/60">{issue.path}</span>
                      {issue.line ? <span className="text-white/30">:{issue.line}</span> : null}
                      <span className="ml-auto truncate text-white/50">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="border border-dashed border-white/15 bg-[#0b0d11] p-8">
            <h1 className="text-2xl font-semibold tracking-tight">
              Write a whole project<span style={{ color: ACCENT }}>_</span>
            </h1>
            <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-white/50">
              GenHack plans the file tree, then writes it a batch at a time — 100+ files, 1000+ lines,
              with a checker on every file. No internet is required: the generator is local, so it keeps
              writing on its own while you are away.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["offline", "the plan and every template file are generated locally"],
                ["checked", "brackets, JSON, and every relative import are verified as written"],
                ["shipped", "download the whole tree as a zip, or keep it here"],
              ].map(([title, detail]) => (
                <div key={title} className="border border-white/10 p-3">
                  <p className="text-[11px] font-semibold" style={{ color: ACCENT }}>
                    {title}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/45">{detail}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[10px] text-white/30">
              Choose a stack and a size on the left, describe the product, then press write project.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
