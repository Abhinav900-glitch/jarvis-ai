// ---------------------------------------------------------------------------
// The cell that turns a Colab notebook into Jarvis's machine.
//
// Colab has no API and there is no key to paste anywhere: a notebook is a
// browser tab with a Python kernel, and nothing outside can call into it. So
// the worker is the notebook. Pasted into a cell and left running, it polls the
// deployment for work, runs it on the notebook's own interpreter, and reports
// back; anything the program writes is uploaded to `/artifact` from here, which
// is the path that survives a forty kilobyte deck.
//
// The code is generated rather than shipped as a file so the endpoint and the
// user's token arrive already filled in — the whole setup is copy, paste, run.
// It uses nothing outside the standard library, because a notebook that needs
// pip to start polling would defeat the point.
// ---------------------------------------------------------------------------

export interface ColabCellInput {
  /** The deployment's site origin, e.g. https://name-123.convex.site. */
  endpoint: string;
  /** The machine token from `machines.connect`. */
  token: string;
}

/** A Python string literal, safe for a value pasted into a notebook. */
function pyString(value: string): string {
  // JSON's string escaping is a subset of Python's, so a JSON literal is also a
  // valid Python one.
  return JSON.stringify(value);
}

export function colabWorkerCell({ endpoint, token }: ColabCellInput): string {
  return `# Jarvis · machine worker
# Paste this whole cell into a Colab notebook and run it. While it is running,
# Jarvis can run Python here, install packages with pip, and hand you any file
# the program writes. Keep the tab open — closing it is closing the computer.

import json, os, platform, shutil, subprocess, sys, tempfile, time
import urllib.error, urllib.parse, urllib.request

JARVIS = ${pyString(endpoint)}
TOKEN = ${pyString(token)}
MAX_FILE = 12 * 1024 * 1024


def ask(path, payload):
    request = urllib.request.Request(
        JARVIS + path,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "X-Jarvis-Token": TOKEN},
    )
    with urllib.request.urlopen(request, timeout=30) as reply:
        return json.loads(reply.read().decode("utf-8") or "{}")


def describe():
    parts = ["Python " + platform.python_version()]
    try:
        parts.append(platform.system() + " " + platform.machine())
        parts.append(str(os.cpu_count()) + " cores")
    except Exception:
        pass
    tool = shutil.which("nvidia-smi")
    if tool:
        try:
            found = subprocess.run(
                [tool, "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=10,
            ).stdout.strip()
            if found:
                parts.append(found.splitlines()[0])
        except Exception:
            pass
    return " · ".join(parts)


def upload(job, path, name):
    with open(path, "rb") as handle:
        data = handle.read()
    request = urllib.request.Request(
        job["artifactUrl"],
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/octet-stream",
            "X-Jarvis-Token": job["artifactToken"],
            "X-Jarvis-Name": urllib.parse.quote(name, safe=""),
        },
    )
    with urllib.request.urlopen(request, timeout=60) as reply:
        reply.read()


def written(work, script, started):
    # Only files this run produced: the notebook's own environment is not the
    # user's download list.
    for root, dirs, names in os.walk(work):
        if "pyvenv.cfg" in names:
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for name in names:
            path = os.path.join(root, name)
            if path == script or name.endswith(".pyc"):
                continue
            try:
                size = os.path.getsize(path)
                if size == 0 or size > MAX_FILE:
                    continue
                if os.path.getmtime(path) < started - 1:
                    continue
            except OSError:
                continue
            yield path, os.path.relpath(path, work)


def run(job):
    work = tempfile.mkdtemp(prefix="jarvis-")
    script = os.path.join(work, "program.py")
    with open(script, "w", encoding="utf-8") as handle:
        handle.write(job["source"])

    packages = job.get("packages") or []
    if packages:
        print("  installing " + ", ".join(packages) + " …", flush=True)
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-q", "--no-input"] + packages,
            capture_output=True, text=True, timeout=600,
        )

    started = time.time()
    output = ""
    error = ""
    failed = False
    timed_out = False
    code = 0
    try:
        done = subprocess.run(
            [sys.executable, script],
            input=job.get("stdin") or "",
            cwd=work,
            capture_output=True,
            text=True,
            timeout=(job.get("timeoutMs") or 90000) / 1000,
        )
        output = done.stdout or ""
        error = done.stderr or ""
        code = done.returncode
        failed = code != 0
    except subprocess.TimeoutExpired as expired:
        timed_out = True
        failed = True
        partial = expired.stdout or ""
        output = partial if isinstance(partial, str) else ""
        error = "Stopped after the time limit."

    if job.get("artifactUrl") and job.get("artifactToken"):
        for path, name in written(work, script, started):
            try:
                upload(job, path, name)
                print("  sent " + name, flush=True)
            except Exception as problem:
                print("  could not send " + name + ": " + str(problem), flush=True)

    return {
        "jobId": job["id"],
        "output": output,
        "error": error,
        "failed": failed,
        "timedOut": timed_out,
        "exitCode": code,
        "ms": int((time.time() - started) * 1000),
    }


INFO = describe()
print("Jarvis machine: " + INFO)
print("Connected to " + JARVIS + ". Waiting for work — leave this cell running.")

backoff = 2
while True:
    try:
        reply = ask("/machine/next", {"version": platform.python_version(), "platform": INFO})
    except urllib.error.HTTPError as problem:
        if problem.code in (400, 403):
            print("This machine token is no longer valid. Copy a fresh cell from Jarvis.")
            break
        print("  Jarvis is unreachable (" + str(problem) + "), retrying in " + str(backoff) + "s", flush=True)
        time.sleep(backoff)
        backoff = min(30, backoff * 2)
        continue
    except Exception as problem:
        print("  Jarvis is unreachable (" + str(problem) + "), retrying in " + str(backoff) + "s", flush=True)
        time.sleep(backoff)
        backoff = min(30, backoff * 2)
        continue

    backoff = 2
    job = reply.get("job")
    if not job:
        time.sleep(3)
        continue

    print("Running " + str(job["id"])[-6:] + " …", flush=True)
    try:
        answer = run(job)
    except Exception as problem:
        answer = {
            "jobId": job["id"],
            "output": "",
            "error": "The worker could not run this: " + str(problem),
            "failed": True,
            "timedOut": False,
            "exitCode": 1,
            "ms": 0,
        }
    try:
        ask("/machine/result", answer)
        print("  done", flush=True)
    except Exception as problem:
        print("  could not report the result: " + str(problem), flush=True)
`;
}
