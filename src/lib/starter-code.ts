// ---------------------------------------------------------------------------
// The built-in program library.
//
// Every entry is a complete, runnable program — not a fragment. They run from
// hello world up through full neural-network and transformer implementations,
// so the panel doubles as a way to see what the runner can do before writing
// anything. Each is pinned to one language and one JDoodle `versionIndex`.
//
// `libs` is sent to JDoodle as its `libs` parameter, which installs packages
// with the language's own package manager before the run. It costs extra
// credits and extra time, so entries that can be written against the standard
// library alone are written that way.
// ---------------------------------------------------------------------------

export type StarterLevel = "Beginner" | "Intermediate" | "Advanced" | "Showpiece";

export interface StarterProgram {
  id: string;
  title: string;
  /** One line explaining what it demonstrates. */
  blurb: string;
  level: StarterLevel;
  category: string;
  /** A JDoodle language slug from `code-languages.ts`. */
  language: string;
  /** Position in that language's version list. */
  versionIndex?: number;
  /** Packages JDoodle installs before running. */
  libs?: string[];
  code: string;
}

export const STARTER_CATEGORIES = [
  "Getting started",
  "Algorithms",
  "Python craft",
  "Data & files",
  "Web",
  "AI & neural nets",
  "AI apps",
] as const;

export const STARTER_PROGRAMS: StarterProgram[] = [
  // -------------------------------------------------------------------------
  // Getting started
  // -------------------------------------------------------------------------
  {
    id: "hello-python",
    title: "Hello, World",
    blurb: "The smallest complete Python program.",
    level: "Beginner",
    category: "Getting started",
    language: "python3",
    code: `print("Hello, World!")
print("Jarvis ran your code.")
`,
  },
  {
    id: "hello-java",
    title: "Hello, World in Java",
    blurb: "The same greeting as a full Java class, the way javac wants it.",
    level: "Beginner",
    category: "Getting started",
    language: "java",
    code: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
        System.out.println("Java " + System.getProperty("java.version"));
    }
}
`,
  },
  {
    id: "hello-go",
    title: "Hello, World in Go",
    blurb: "Go's package, func and fmt trio in six lines.",
    level: "Beginner",
    category: "Getting started",
    language: "go",
    code: `package main

import "fmt"

func main() {
	fmt.Println("Hello, World!")
	fmt.Println("Go is compiled and statically typed.")
}
`,
  },
  {
    id: "read-stdin",
    title: "Read from stdin",
    blurb: "Takes input — fill the stdin box, then run.",
    level: "Beginner",
    category: "Getting started",
    language: "python3",
    code: `# Everything typed in the stdin box arrives on sys.stdin.
# Try one line, e.g.:  4 8 15 16 23 42

import sys

raw = sys.stdin.read().strip()
if not raw:
    print("No input received. Type something in the stdin box.")
else:
    numbers = [float(n) for n in raw.replace(",", " ").split()]
    print(f"Read {len(numbers)} number(s): {numbers}")
    print(f"Sum = {sum(numbers):g}")
    print(f"Max = {max(numbers):g}")
`,
  },
  {
    id: "fizzbuzz",
    title: "FizzBuzz",
    blurb: "The classic interview warm-up, with the tricky cases handled.",
    level: "Beginner",
    category: "Getting started",
    language: "python3",
    code: `for n in range(1, 21):
    if n % 15 == 0:
        print("FizzBuzz")
    elif n % 3 == 0:
        print("Fizz")
    elif n % 5 == 0:
        print("Buzz")
    else:
        print(n)
`,
  },
  {
    id: "binary-search",
    title: "Binary search & recursion",
    blurb: "O(log n) search, and the same idea expressed recursively.",
    level: "Beginner",
    category: "Algorithms",
    language: "python3",
    code: `data = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25]


def search_iterative(values, target):
    low, high = 0, len(values) - 1
    while low <= high:
        mid = (low + high) // 2
        if values[mid] == target:
            return mid
        if values[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1


def search_recursive(values, target, low=0, high=None):
    if high is None:
        high = len(values) - 1
    if low > high:
        return -1
    mid = (low + high) // 2
    if values[mid] == target:
        return mid
    if values[mid] < target:
        return search_recursive(values, target, mid + 1, high)
    return search_recursive(values, target, low, mid - 1)


for target in (13, 4, 25):
    i = search_iterative(data, target)
    j = search_recursive(data, target)
    where = f"index {i}" if i >= 0 else "not found"
    other = f"index {j}" if j >= 0 else "not found"
    print(f"{target:>3}: {where:<15} recursive says {other}")
`,
  },
  {
    id: "prime-sieve",
    title: "Sieve of Eratosthenes",
    blurb: "Finds every prime under 200,000 by knocking out multiples.",
    level: "Intermediate",
    category: "Algorithms",
    language: "python3",
    code: `LIMIT = 200_000

# Start with every number a prime candidate, then clear the composites.
sieve = [True] * (LIMIT + 1)
sieve[0] = sieve[1] = False

p = 2
while p * p <= LIMIT:
    if sieve[p]:
        # Every multiple from p*p is composite: smaller ones were already
        # cleared by a smaller prime, so start at p*p.
        for multiple in range(p * p, LIMIT + 1, p):
            sieve[multiple] = False
    p += 1

primes = [n for n, is_prime in enumerate(sieve) if is_prime]
print(f"{len(primes)} primes below {LIMIT:,}")
print("First 25:", primes[:25])
print("Last 5:  ", primes[-5:])

# Twin primes are a pair that differ by two.
twins = [(a, b) for a, b in zip(primes, primes[1:]) if b - a == 2]
print(f"{len(twins)} twin-prime pairs, e.g. {twins[:8]}")
`,
  },
  {
    id: "sorting",
    title: "Sorting from scratch",
    blurb: "Bubble, insertion, merge and quicksort, checked against each other.",
    level: "Intermediate",
    category: "Algorithms",
    language: "python3",
    code: `import random
import time


def bubble_sort(values):
    a = values[:]
    for i in range(len(a)):
        swapped = False
        for j in range(len(a) - 1 - i):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
                swapped = True
        if not swapped:          # already ordered — stop early
            break
    return a


def insertion_sort(values):
    a = values[:]
    for i in range(1, len(a)):
        key = a[i]
        j = i - 1
        while j >= 0 and a[j] > key:
            a[j + 1] = a[j]
            j -= 1
        a[j + 1] = key
    return a


def merge_sort(values):
    if len(values) <= 1:
        return values[:]
    mid = len(values) // 2
    left = merge_sort(values[:mid])
    right = merge_sort(values[mid:])
    merged, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i])
            i += 1
        else:
            merged.append(right[j])
            j += 1
    return merged + left[i:] + right[j:]


def quick_sort(values):
    if len(values) <= 1:
        return values[:]
    pivot = values[len(values) // 2]
    lower = [v for v in values if v < pivot]
    same = [v for v in values if v == pivot]
    upper = [v for v in values if v > pivot]
    return quick_sort(lower) + same + quick_sort(upper)


size = 1200
data = [random.randint(0, 10000) for _ in range(size)]
expected = sorted(data)

for name, fn in [
    ("bubble", bubble_sort),
    ("insertion", insertion_sort),
    ("merge", merge_sort),
    ("quick", quick_sort),
]:
    start = time.perf_counter()
    got = fn(data)
    took = (time.perf_counter() - start) * 1000
    assert got == expected, f"{name} sort is wrong"
    print(f"{name:<9} {size:>5} items  {took:8.2f} ms  correct")
`,
  },
  {
    id: "graph-traversal",
    title: "BFS & DFS on a graph",
    blurb: "Two traversal orders over one weighted graph, plus shortest paths.",
    level: "Intermediate",
    category: "Algorithms",
    language: "python3",
    code: `from collections import deque

# Weighted, undirected graph: node -> {neighbour: cost}
graph = {
    "A": {"B": 4, "C": 2},
    "B": {"A": 4, "C": 1, "D": 5},
    "C": {"A": 2, "B": 1, "D": 8, "E": 10},
    "D": {"B": 5, "C": 8, "E": 2},
    "E": {"C": 10, "D": 2, "F": 3},
    "F": {"E": 3},
}


def bfs(start):
    """Shortest path in hops — the queue empties level by level."""
    seen, order, queue = {start}, [], deque([start])
    while queue:
        node = queue.popleft()
        order.append(node)
        for nxt in graph[node]:
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return order


def dfs(start):
    """Deepest-first — follow one branch all the way down before backtracking."""
    seen, order = set(), []

    def walk(node):
        seen.add(node)
        order.append(node)
        for nxt in graph[node]:
            if nxt not in seen:
                walk(nxt)

    walk(start)
    return order


def dijkstra(start, goal):
    """Cheapest route by accumulated cost."""
    best = {start: 0.0}
    prev, queue = {}, [(0.0, start)]
    while queue:
        queue.sort()
        cost, node = queue.pop(0)
        if cost > best.get(node, float("inf")):
            continue                      # a cheaper route already won
        if node == goal:
            path, step = [node], node
            while step in prev:
                step = prev[step]
                path.append(step)
            return cost, path[::-1]
        for nxt, weight in graph[node].items():
            total = cost + weight
            if total < best.get(nxt, float("inf")):
                best[nxt] = total
                prev[nxt] = node
                queue.append((total, nxt))
    return float("inf"), []


print("BFS order:", " ".join(bfs("A")))
print("DFS order:", " ".join(dfs("A")))
cost, path = dijkstra("A", "F")
print(f"Cheapest A->F: {' -> '.join(path)} (cost {cost:g})")
`,
  },
  {
    id: "knapsack",
    title: "0/1 knapsack (dynamic programming)",
    blurb: "The classic DP table, printed so you can watch the choices.",
    level: "Intermediate",
    category: "Algorithms",
    language: "python3",
    code: `# Each item costs something and is worth something. Carry at most CAPACITY.
ITEMS = [
    ("laptop", 3, 1200),
    ("camera", 4, 900),
    ("book", 1, 250),
    ("jacket", 2, 400),
    ("tent", 5, 700),
    ("phone", 2, 800),
]
CAPACITY = 7

n = len(ITEMS)

# table[i][c] = best value from the first i items with budget at most c
table = [[0] * (CAPACITY + 1) for _ in range(n + 1)]

for i in range(1, n + 1):
    name, cost, value = ITEMS[i - 1]
    for c in range(CAPACITY + 1):
        # Skip the item...
        table[i][c] = table[i - 1][c]
        # ...or take it, if it fits in the remaining budget.
        if cost <= c:
            with_it = table[i - 1][c - cost] + value
            table[i][c] = max(table[i][c], with_it)

# Walk the table backwards to recover which items were chosen.
chosen, c = [], CAPACITY
for i in range(n, 0, -1):
    if table[i][c] != table[i - 1][c]:
        chosen.append(ITEMS[i - 1][0])
        c -= ITEMS[i - 1][1]
chosen.reverse()

print("  budget:", "".join(f"{c:>6}" for c in range(CAPACITY + 1)))
for i, (name, cost, value) in enumerate(ITEMS, start=1):
    print(f"{name:<8}", "".join(f"{v:>6}" for v in table[i][1:]))

print()
print(f"Best value under {CAPACITY}: {table[n][CAPACITY]}")
print("Picked:", ", ".join(chosen))
print("Unused budget:", c)
`,
  },
  {
    id: "python-decorators",
    title: "Decorators & closures",
    blurb: "How @decorator syntax is just a function that wraps a function.",
    level: "Intermediate",
    category: "Python craft",
    language: "python3",
    code: `import functools
import time


def timed(fn):
    """A decorator: fn is the function being wrapped."""
    @functools.wraps(fn)          # keeps __name__ and the docstring
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return fn(*args, **kwargs)
        finally:
            took = (time.perf_counter() - start) * 1000
            print(f"  [timed] {fn.__name__} took {took:7.2f} ms")
    return wrapper


def retry(attempts=3):
    def decorate(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            for attempt in range(1, attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except Exception as err:
                    if attempt == attempts:
                        raise
                    print(f"  [retry] attempt {attempt} failed: {err}")
        return wrapper
    return decorate


calls = {"n": 0}


@timed
@retry(attempts=3)
def flaky(n):
    """Succeeds on the third try, so the retry decorator has to earn its keep."""
    calls["n"] += 1
    if calls["n"] < 3:
        raise ConnectionError("connection reset")
    return [i * n for i in range(calls["n"])]


print("Result:", flaky(4))
print("Total calls:", calls["n"])


# A closure simply remembers the enclosing scope.
def make_counter(start=0):
    def increment(step=1):
        nonlocal start      # assignment needs nonlocal
        start += step
        return start
    return increment


counter = make_counter(10)
print("counter:", counter(), counter(5), counter())


# A lambda is a single-expression function.
square = lambda x: x * x
print("lambda square(9) =", square(9))
print("sorted by second item:", sorted([(1, 3), (2, 1), (3, 2)], key=lambda p: p[1]))
`,
  },
  {
    id: "python-generators",
    title: "Generators & iterators",
    blurb: "lazy sequences, and the yield-based pipeline idiom.",
    level: "Intermediate",
    category: "Python craft",
    language: "python3",
    code: `import itertools


def fibonacci(limit):
    """A generator: it produces values one at a time and remembers its place."""
    a, b = 0, 1
    while a < limit:
        yield a
        a, b = b, a + b


# Generators compose into pipelines without building any list.
squares = (n * n for n in fibonacci(200))
print("squares of Fibonacci under 200:", list(squares))

evens = (n for n in range(50) if n % 2 == 0)
print("takewhile < 20:", list(itertools.takewhile(lambda n: n < 20, evens)))


def chunked(iterable, size):
    """yield from hands the value straight through, keeping memory flat."""
    it = iter(iterable)
    while True:
        batch = list(itertools.islice(it, size))
        if not batch:
            return
        yield batch


print("chunks of 4:", list(chunked(range(1, 11), 4)))

# A generator expression passed to sum() never builds the intermediate list.
print("sum of squares 1..1000:", sum(n * n for n in range(1001)))
print("cartesian product of ABC x 12:",
      [a + b for a, b in itertools.product("ABC", "12")])


# An explicit iterator: __iter__/__next__ make a class behave like a sequence.
class Countdown:
    def __init__(self, start):
        self.current = start

    def __iter__(self):
        return self

    def __next__(self):
        if self.current <= 0:
            raise StopIteration
        self.current -= 1
        return self.current + 1


print("countdown:", list(Countdown(6)))
`,
  },
  {
    id: "python-async",
    title: "Async & await",
    blurb: "Three blocking-looking calls, interleaved on one thread.",
    level: "Advanced",
    category: "Python craft",
    language: "python3",
    code: `import asyncio
import time


async def fetch(name, delay, result):
    """Pretend this is a network call. asyncio.sleep yields the thread."""
    await asyncio.sleep(delay)
    return f"{name} finished after {delay}s -> {result}"


JOBS = [("A", 1.0, "alpha"), ("B", 1.0, "beta"), ("C", 1.0, "gamma")]


async def sequential():
    """Each call waits for the one before it: total is the sum of the delays."""
    start = time.perf_counter()
    for job in JOBS:
        print(await fetch(*job))
    return time.perf_counter() - start


async def concurrent():
    """gather starts them all, then waits once: total is the longest delay."""
    start = time.perf_counter()
    for line in await asyncio.gather(*[fetch(*job) for job in JOBS]):
        print(line)
    return time.perf_counter() - start


async def with_timeout():
    try:
        await asyncio.wait_for(fetch("slow", 5.0, "never"), timeout=0.5)
    except asyncio.TimeoutError:
        print("cancelled the slow task after 0.5s")


async def main():
    seq = await sequential()
    print(f"\\nsequential took {seq:.2f}s")
    con = await concurrent()
    print(f"concurrent took {con:.2f}s  <- about {seq / con:.1f}x faster")


asyncio.run(with_timeout())
asyncio.run(main())
`,
  },
  {
    id: "sqlite-basics",
    title: "SQLite: create, query, aggregate",
    blurb: "A real in-memory database with joins and a GROUP BY.",
    level: "Intermediate",
    category: "Data & files",
    language: "python3",
    code: `import sqlite3

db = sqlite3.connect(":memory:")      # vanishes when the program ends
db.executescript("""
CREATE TABLE authors (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL,
    city  TEXT
);
CREATE TABLE books (
    id        INTEGER PRIMARY KEY,
    title     TEXT NOT NULL,
    author_id INTEGER REFERENCES authors(id),
    year      INTEGER,
    pages     INTEGER
);
""")

db.executemany(
    "INSERT INTO authors (id, name, city) VALUES (?, ?, ?)",
    [(1, "A. Turing", "London"), (2, "G. Hopper", "New York"),
     (3, "A. Lovelace", "London"), (4, "K. Thompson", "Berkeley")],
)
db.executemany(
    "INSERT INTO books (id, title, author_id, year, pages) VALUES (?, ?, ?, ?, ?)",
    [(1, "Computing Machinery", 1, 1936, 112),
     (2, "The Education of a Computer", 2, 1964, 320),
     (3, "Notes on the Analytical Engine", 3, 1843, 48),
     (4, "Compilers", 4, 1986, 574),
     (5, "The Art of Computer Programming", 1, 1968, 672),
     (6, "A Compiler-Compiler", 4, 1960, 190)],
)
db.commit()

print("Books with authors (JOIN):")
for title, name, year in db.execute("""
    SELECT books.title, authors.name, books.year
    FROM books JOIN authors ON books.author_id = authors.id
    ORDER BY books.year
"""):
    print(f"  {year}  {title:<34} {name}")

print("\\nMost prolific author (GROUP BY):")
for name, count in db.execute("""
    SELECT authors.name, COUNT(books.id) AS n
    FROM authors JOIN books ON books.author_id = authors.id
    GROUP BY authors.id HAVING n > 0
    ORDER BY n DESC, name
"""):
    print(f"  {name:<16} {count} book(s)")

print("\\nAuthors with no books (LEFT JOIN):")
for (name,) in db.execute("""
    SELECT authors.name FROM authors
    LEFT JOIN books ON books.author_id = authors.id
    WHERE books.id IS NULL
"""):
    print(f"  {name}")

print("\\nTotal pages written:",
      db.execute("SELECT SUM(pages) FROM books").fetchone()[0])

db.close()
`,
  },
  {
    id: "csv-report",
    title: "CSV cleaning & report",
    blurb: "Reads a CSV string, rejects bad rows, and prints a summary table.",
    level: "Intermediate",
    category: "Data & files",
    language: "python3",
    code: `import csv
import io
from collections import defaultdict

RAW = """name,dept,salary,bonus
Aisha,Engineering,92000,8
Rohan,Engineering,78000,
Meera,Sales,64000,12
Daniel,Sales,,15
Priya,Marketing,71000,10
Aisha,Engineering,92000,8
Omar,Support,48000,6
"""


def parse(text):
    """Read the rows, then drop the ones missing a number."""
    clean, rejected = [], []
    for index, row in enumerate(csv.DictReader(io.StringIO(text)), start=2):
        try:
            salary = int(row["salary"])
            bonus = int(row["bonus"] or 0)
        except (TypeError, ValueError):
            rejected.append((index, row.get("name"), "bad or missing salary"))
            continue
        if salary < 0:
            rejected.append((index, row.get("name"), "negative salary"))
            continue
        clean.append({"name": row["name"], "dept": row["dept"],
                      "salary": salary, "bonus": bonus})
    return clean, rejected


rows, rejected = parse(RAW)

# De-duplicate: the same person can appear more than once.
seen, unique = set(), []
for row in rows:
    key = (row["name"], row["salary"])
    if key in seen:
        print(f"dropped duplicate: {row['name']}")
        continue
    seen.add(key)
    unique.append(row)

by_dept = defaultdict(list)
for row in unique:
    by_dept[row["dept"]].append(row["salary"])

print(f"\\n{'department':<14}{'n':>3}{'total':>12}{'mean':>10}{'max':>10}")
print("-" * 49)
for dept in sorted(by_dept):
    values = by_dept[dept]
    print(f"{dept:<14}{len(values):>3}{sum(values):>12,}"
          f"{sum(values) / len(values):>10,.0f}{max(values):>10,}")

print(f"\\n{len(unique)} usable row(s), {len(rejected)} rejected:")
for index, name, why in rejected:
    print(f"  line {index}: {name} - {why}")
`,
  },
  {
    id: "json-transform",
    title: "Reshaping messy JSON",
    blurb: "Flatten, group and summarise a nested API-shaped payload.",
    level: "Intermediate",
    category: "Data & files",
    language: "python3",
    code: `import csv
import io
import json
from collections import defaultdict

PAYLOAD = """
{
  "results": [
    {"id": 1, "user": {"name": "Aisha", "country": "IN"},
     "items": [{"sku": "KB-01", "qty": 1, "price": 4999.0},
               {"sku": "MS-11", "qty": 2, "price": 2499.5}],
     "status": "paid"},
    {"id": 2, "user": {"name": "Rohan", "country": "IN"},
     "items": [{"sku": "MN-27", "qty": 1, "price": 15999.0}],
     "status": "paid"},
    {"id": 3, "user": {"name": "Daniel", "country": "US"},
     "items": [{"sku": "KB-01", "qty": 3, "price": 4999.0}],
     "status": "refunded"}
  ]
}
"""

data = json.loads(PAYLOAD)

# Flatten each order into revenue per country and units per SKU.
revenue = defaultdict(float)
units = defaultdict(int)
for order in data["results"]:
    country = order["user"]["country"]
    for item in order["items"]:
        revenue[country] += item["qty"] * item["price"]
        units[item["sku"]] += item["qty"]

print(f"{'country':<9}{'gross revenue':>16}")
print("-" * 25)
for country in sorted(revenue, key=lambda c: -revenue[c]):
    print(f"{country:<9}{revenue[country]:>16,.2f}")

print(f"\\n{'sku':<8}{'units':>7}")
print("-" * 15)
for sku, count in sorted(units.items(), key=lambda kv: -kv[1]):
    print(f"{sku:<8}{count:>7}")

paid = [o for o in data["results"] if o["status"] == "paid"]
print(f"\\n{len(paid)} paid, {len(data['results']) - len(paid)} refunded")

# Turn the orders back into CSV, which is what most of the pipeline wants.
buffer = io.StringIO()
writer = csv.writer(buffer)
writer.writerow(["order_id", "customer", "country", "status", "total"])
for order in data["results"]:
    total = sum(i["qty"] * i["price"] for i in order["items"])
    writer.writerow([order["id"], order["user"]["name"],
                     order["user"]["country"], order["status"], f"{total:.2f}"])
print()
print(buffer.getvalue())
`,
  },
  {
    id: "http-api",
    title: "REST API with Node's http module",
    blurb: "Routing, path params, JSON bodies, validation and status codes.",
    level: "Intermediate",
    category: "Web",
    language: "nodejs",
    code: `// A small REST API built on Node's built-in http module, so it runs
// anywhere Node does with nothing installed. The runner starts the server,
// exercises the routes with real requests, then shuts it down so the run ends.

const http = require("http");

// ---- In-memory data store.
const tasks = new Map([
  [1, { id: 1, title: "Ship the code runner", done: true }],
  [2, { id: 2, title: "Write the docs", done: false }],
]);
let nextId = 3;

function send(res, status, payload) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function validateTitle(body) {
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return "title is required and must be a non-empty string";
  }
  if (body.title.length > 120) return "title must be 120 characters or fewer";
  return null;
}

// ---- Routing. Split the path into segments rather than matching a pattern:
// "/api/tasks/7" becomes ["api", "tasks", "7"].
function parse(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "tasks") return null;
  if (parts.length === 2) return { id: null };
  if (parts.length === 3 && /^[0-9]+$/.test(parts[2])) {
    return { id: Number(parts[2]) };
  }
  return null;
}

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  console.log(req.method + " " + url.pathname);

  const target = parse(url.pathname);
  if (!target) {
    return send(res, 404, {
      error: "no route matches " + req.method + " " + url.pathname,
    });
  }

  let body = {};
  if (req.method === "POST" || req.method === "PATCH") {
    try {
      body = await readJson(req);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // ---- The collection: GET lists, POST creates.
  if (target.id === null) {
    if (req.method === "GET") {
      let all = [...tasks.values()];
      if (url.searchParams.has("done")) {
        const want = url.searchParams.get("done") === "true";
        all = all.filter((t) => t.done === want);
      }
      return send(res, 200, { count: all.length, tasks: all });
    }
    if (req.method === "POST") {
      const problem = validateTitle(body);
      if (problem) return send(res, 400, { error: problem });
      const task = { id: nextId++, title: body.title.trim(), done: false };
      tasks.set(task.id, task);
      return send(res, 201, task);
    }
    return send(res, 405, {
      error: req.method + " not allowed on the collection",
    });
  }

  // ---- A single task.
  const task = tasks.get(target.id);
  if (req.method === "GET") {
    if (!task) return send(res, 404, { error: "no such task" });
    return send(res, 200, task);
  }
  if (req.method === "PATCH") {
    if (!task) return send(res, 404, { error: "no such task" });
    if (typeof body.done === "boolean") task.done = body.done;
    return send(res, 200, task);
  }
  if (req.method === "DELETE") {
    tasks.delete(target.id);
    return send(res, 204, undefined);
  }
  return send(res, 405, { error: req.method + " not allowed on a task" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => send(res, 500, { error: err.message }));
});

// ---- Prove the routes work, then close the server so the run ends.
const PORT = 3000;
server.listen(PORT, async () => {
  console.log("listening on http://localhost:" + PORT);

  const show = async (label, path, options) => {
    const res = await fetch("http://localhost:" + PORT + path, options);
    const body = res.status === 204 ? "" : await res.text();
    console.log("\\n--- " + label);
    console.log(res.status + " " + body);
  };

  await show("GET all", "/api/tasks");
  await show("GET only done", "/api/tasks?done=true");
  await show("POST valid", "/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Interpret the output" }),
  });
  await show("POST invalid (400)", "/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "" }),
  });
  await show("GET missing (404)", "/api/tasks/999");
  await show("PATCH mark done", "/api/tasks/2", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done: true }),
  });
  await show("DELETE", "/api/tasks/1", { method: "DELETE" });

  server.close(() => console.log("\\nserver closed"));
});
`,
  },
  // -------------------------------------------------------------------------
  // AI & neural nets
  // -------------------------------------------------------------------------
  {
    id: "neural-net-xor",
    title: "Neural network from scratch (XOR)",
    blurb: "Forward pass, backprop and gradient descent with no libraries.",
    level: "Showpiece",
    category: "AI & neural nets",
    language: "python3",
    code: `# A two-layer neural network, written out in full: no PyTorch, no NumPy.
# The XOR problem cannot be solved by a single neuron, which is exactly why
# it is the standard demonstration that hidden layers matter.

import math
import random


def sigmoid(x):
    return 1 / (1 + math.exp(-x))


def sigmoid_derivative(out):
    # d/dx sigmoid(x), given the output value we already have.
    return out * (1 - out)


class Layer:
    """A fully connected layer.

    Weights are stored input-major: weights[i][j] is the weight from input i to
    output j. Biases are indexed by output, so they line up with a column of
    the weight matrix.
    """

    def __init__(self, n_inputs, n_outputs, rng):
        self.n_inputs = n_inputs
        self.n_outputs = n_outputs
        # Small random weights break the symmetry between neurons.
        limit = math.sqrt(6 / (n_inputs + n_outputs))
        self.weights = [[rng.uniform(-limit, limit) for _ in range(n_outputs)]
                        for _ in range(n_inputs)]
        self.biases = [rng.uniform(-limit, limit) for _ in range(n_outputs)]

    def forward(self, inputs):
        outputs = []
        for j in range(self.n_outputs):
            total = self.biases[j] + sum(self.weights[i][j] * inputs[i]
                                         for i in range(self.n_inputs))
            outputs.append(sigmoid(total))
        return outputs

    def gradient_step(self, inputs, deltas, rate):
        """dW[i][j] = delta[j] * input[i], and db[j] = delta[j]."""
        for i in range(self.n_inputs):
            for j in range(self.n_outputs):
                self.weights[i][j] -= rate * deltas[j] * inputs[i]
        for j in range(self.n_outputs):
            self.biases[j] -= rate * deltas[j]


class Network:
    def __init__(self, n_inputs, n_hidden, n_outputs, seed=7):
        rng = random.Random(seed)
        self.hidden = Layer(n_inputs, n_hidden, rng)
        self.output = Layer(n_hidden, n_outputs, rng)

    def forward(self, x):
        hidden = self.hidden.forward(x)
        return self.output.forward(hidden), hidden

    def train_step(self, x, y, rate):
        """One example, forward then backward, returning the squared error."""
        output, hidden = self.forward(x)

        # How far off the output is, scaled by the sigmoid's slope.
        error = output[0] - y
        output_delta = [error * sigmoid_derivative(output[0])]

        # Each hidden neuron is blamed in proportion to the weight it sends
        # forward to the output.
        hidden_deltas = [
            self.output.weights[i][0] * output_delta[0] * sigmoid_derivative(hidden[i])
            for i in range(self.output.n_inputs)
        ]

        self.output.gradient_step(hidden, output_delta, rate)
        self.hidden.gradient_step(x, hidden_deltas, rate)

        return error * error

    def predict(self, x):
        return self.forward(x)[0][0]


# The truth table a single layer cannot fit.
X = [[0, 0], [0, 1], [1, 0], [1, 1]]
Y = [0, 1, 1, 0]

print("Training a 2-2-1 network on XOR...")
net = Network(n_inputs=2, n_hidden=2, n_outputs=1)
RATE, EPOCHS = 0.5, 20000

for epoch in range(1, EPOCHS + 1):
    loss = sum(net.train_step(x, y, RATE) for x, y in zip(X, Y)) / len(X)
    if epoch in (1, 100, 1000, 5000, 10000, EPOCHS):
        print(f"  epoch {epoch:>6}  mean squared error {loss:.8f}")

print("\\n  a   b  | expected  predicted  error")
print("  " + "-" * 36)
total_error = 0.0
for x, y in zip(X, Y):
    p = net.predict(x)
    total_error += abs(p - y)
    print(f"  {x[0]}   {x[1]}  |    {y}       {p:.4f}    {abs(p - y):.4f}")
print(f"\\nMean absolute error: {total_error / len(X):.8f}")
print("Hidden layer weights:", [[round(w, 3) for w in row]
                                for row in net.hidden.weights])
`,
  },
  {
    id: "linear-regression",
    title: "Linear regression + gradient descent",
    blurb: "Fits a line to noisy data and checks it against the closed form.",
    level: "Intermediate",
    category: "AI & neural nets",
    language: "python3",
    code: `# Least squares by gradient descent, on data with real noise in it.

import random

# y = 3.5x + 2 + noise
random.seed(11)
TRUE_SLOPE, TRUE_INTERCEPT, NOISE = 3.5, 2.0, 1.2
xs = [i * 0.5 for i in range(60)]
ys = [TRUE_SLOPE * x + TRUE_INTERCEPT + random.gauss(0, NOISE) for x in xs]

n = len(xs)
mean_x = sum(xs) / n
mean_y = sum(ys) / n

# Centre the data first. With x running to 29.5, the raw gradient is so steep
# that any usable learning rate overshoots and diverges to NaN; centring makes
# the curvature tractable and lets the fit converge smoothly.
xs_c = [x - mean_x for x in xs]
ys_c = [y - mean_y for y in ys]

# On centred data the intercept is not a free parameter: the line passes
# through the mean of the points, so it is recovered afterwards.
slope = 0.0
rate = 0.005
history = []

for epoch in range(1, 3001):
    predictions = [slope * xc for xc in xs_c]
    errors = [p - yc for p, yc in zip(predictions, ys_c)]
    mse = sum(e * e for e in errors) / n
    history.append(mse)

    # The gradient of MSE with respect to the slope.
    d_slope = (2 / n) * sum(e * xc for e, xc in zip(errors, xs_c))
    slope -= rate * d_slope

    if epoch in (1, 10, 100, 500, 1000, 3000):
        print(f"  epoch {epoch:>5}  MSE {mse:8.4f}  slope {slope:6.3f}")

intercept = mean_y - slope * mean_x

# The closed-form answer, to confirm gradient descent converged on it.
sxx = sum((x - mean_x) ** 2 for x in xs)
sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
exact_slope = sxy / sxx
exact_intercept = mean_y - exact_slope * mean_x

print(f"\\nTrue:     slope {TRUE_SLOPE:.3f}, intercept {TRUE_INTERCEPT:.3f}")
print(f"Learned:  slope {slope:.3f}, intercept {intercept:.3f}")
print(f"Exact:    slope {exact_slope:.3f}, intercept {exact_intercept:.3f}")
print(f"Final MSE: {history[-1]:.4f}  (started at {history[0]:.4f})")


def predict(x):
    return slope * x + intercept


print("\\nPredictions:")
for x in [0, 2, 5, 10, 15]:
    print(f"  x={x:<4} y_hat={predict(x):7.3f}   "
          f"y_true={TRUE_SLOPE * x + TRUE_INTERCEPT:7.3f}")

# Residuals as text: how far each point sits from the fitted line.
print("\\nResiduals (bar length is the error):")
for x, y in list(zip(xs, ys))[::6]:
    err = y - predict(x)
    print(f"  x={x:5.1f} {'#' * int(abs(err) * 6):<18}{err:+.3f}")
`,
  },
  {
    id: "softmax-classifier",
    title: "Softmax + cross-entropy from scratch",
    blurb: "The loss and gradient every language model is trained with.",
    level: "Showpiece",
    category: "AI & neural nets",
    language: "python3",
    code: `# The two functions at the heart of classification training, written out
# so the maths is visible rather than hidden behind a framework.

import math
import random

random.seed(3)


def softmax(scores):
    """Turn arbitrary scores into a probability distribution summing to 1.

    Subtracting the max first is the standard trick: it leaves the result
    identical but stops exp() overflowing on large numbers.
    """
    biggest = max(scores)
    exps = [math.exp(s - biggest) for s in scores]
    total = sum(exps)
    return [e / total for e in exps]


def cross_entropy(probabilities, target_index):
    """How wrong the prediction was. log(0) would be -inf, so clamp."""
    p = max(probabilities[target_index], 1e-12)
    return -math.log(p)


def softmax_cross_entropy_gradient(scores, target_index):
    """dL/dscore for softmax + cross-entropy together: p - y. One line."""
    p = softmax(scores)
    p[target_index] -= 1.0
    return p


# Three classes, two features. Draw points around one of three centres.
centres = [(0.0, 0.0), (4.0, 0.0), (2.0, 4.0)]
X, Y = [], []
for _ in range(150):
    label = random.randrange(3)
    cx, cy = centres[label]
    X.append([cx + random.gauss(0, 0.9), cy + random.gauss(0, 0.9)])
    Y.append(label)

weights = [[random.uniform(-0.5, 0.5) for _ in range(3)] for _ in range(2)]
biases = [random.uniform(-0.5, 0.5) for _ in range(3)]
rate = 0.1

print("epoch   loss    accuracy")
print("-" * 24)
loss = 0.0
for epoch in range(1, 401):
    loss = 0.0
    correct = 0
    grad_w = [[0.0] * 3 for _ in range(2)]
    grad_b = [0.0] * 3

    for x, y in zip(X, Y):
        scores = [sum(w[j] * x[i] for i, w in enumerate(weights))
                  + biases[j] for j in range(3)]
        probs = softmax(scores)
        loss += cross_entropy(probs, y)
        if max(range(3), key=lambda j: probs[j]) == y:
            correct += 1

        g = softmax_cross_entropy_gradient(scores, y)
        for j in range(3):
            grad_b[j] += g[j]
            for i in range(2):
                grad_w[i][j] += g[j] * x[i]

    n = len(X)
    for j in range(3):
        biases[j] -= rate * grad_b[j] / n
        for i in range(2):
            weights[i][j] -= rate * grad_w[i][j] / n

    if epoch in (1, 10, 50, 100, 200, 400):
        print(f"{epoch:>5}  {loss / n:7.4f}   {correct / n:9.2%}")

print(f"\\nsoftmax([1, 2, 3]) = "
      f"{[round(p, 4) for p in softmax([1, 2, 3])]}")
print(f"sums to {sum(softmax([1, 2, 3])):.6f}")
print("softmax([1000, 1001, 1002]) = "
      f"{[round(p, 4) for p in softmax([1000, 1001, 1002])]}")
print("  (stable — subtracting the max keeps exp() from overflowing)")

# A uniform predictor scores ln(num_classes); that is the loss to beat.
print(f"\\nA uniform predictor scores ln(3) = {math.log(3):.4f}.")
print(f"This one scores {loss / n:.4f}.")
`,
  },
  {
    id: "numpy-cnn",
    title: "Convolution & edge detection with NumPy",
    blurb: "A 2D convolution by hand, then a real conv-ReLU-pool layer.",
    level: "Showpiece",
    category: "AI & neural nets",
    language: "python3",
    libs: ["numpy"],
    code: `# A convolution implemented by hand, then a stack of real filters
# (Sobel, sharpen, blur) run over a synthetic image, followed by a CNN layer.
#
# Needs NumPy, so JDoodle installs it for you before the run.

import numpy as np

rng = np.random.default_rng(42)

# ---- A test image: a bright square on a dark background.
image = np.zeros((32, 32), dtype=float)
image[8:24, 10:22] = 1.0
image[12:16, 12:20] = 0.4          # some structure inside the square
print(f"image shape {image.shape}, range {image.min()}..{image.max()}")


def convolve2d(image, kernel, stride=1, pad=0):
    """The definition of a 2D cross-correlation, as four nested loops."""
    if pad:
        image = np.pad(image, pad, mode="constant")
    h, w = image.shape
    kh, kw = kernel.shape
    # A "valid" convolution: the window has to fit entirely inside the image.
    rows = (h - kh) // stride + 1
    cols = (w - kw) // stride + 1
    out = np.zeros((rows, cols))
    for i in range(rows):
        for j in range(cols):
            window = image[i * stride:i * stride + kh,
                           j * stride:j * stride + kw]
            out[i, j] = float(np.sum(window * kernel))
    return out


def maxpool2d(image, size=2, stride=2):
    h, w = image.shape
    rows = (h - size) // stride + 1
    cols = (w - size) // stride + 1
    out = np.zeros((rows, cols))
    for i in range(rows):
        for j in range(cols):
            out[i, j] = image[i * stride:i * stride + size,
                              j * stride:j * stride + size].max()
    return out


def show(matrix, title):
    print(f"\\n{title}")
    chars = " .:-=+*#%@"
    scaled = matrix / (np.abs(matrix).max() or 1.0)
    for row in scaled:
        print("  " + "".join(
            chars[min(9, max(0, int((v + 1) / 2 * 9.5)))] for v in row
        ))


KERNELS = {
    "Sobel X (vertical edges)": np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], float),
    "Sobel Y (horizontal edges)": np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], float),
    "Sharpen": np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], float),
    "Box blur": np.ones((3, 3), float) / 9,
}

for name, kernel in KERNELS.items():
    out = convolve2d(image, kernel)
    show(out, f"{name}  ->  {out.shape}")

show(image, "Original image")

# ---- One CNN layer: random filters, ReLU, then max-pool.
print("\\n--- One CNN layer: 8 random 3x3 filters, ReLU, then 2x2 max-pool")
filters = rng.normal(0, 0.4, size=(8, 3, 3))
activations = np.maximum(0.0, np.stack([convolve2d(image, f) for f in filters]))
pooled = np.stack([maxpool2d(a) for a in activations])
print(f"input          {image.shape}")
print(f"after conv     {activations.shape}   (8 feature maps, 30x30)")
print(f"after ReLU     {activations.shape}   "
      f"({np.mean(activations == 0):.1%} of entries are zero)")
print(f"after maxpool  {pooled.shape}   "
      f"({pooled.size} values, mean {pooled.mean():.4f})")
print(f"flattened size {pooled.size}  <- the vector the next layer sees")

energies = [float(np.abs(activations[i]).mean()) for i in range(8)]
print("\\nper-filter mean activation:",
      " ".join(f"{e:.3f}" for e in energies))
print(f"strongest filter #{int(np.argmax(energies))}, "
      f"mean {max(energies):.3f}")
`,
  },
  // -------------------------------------------------------------------------
  // AI apps
  // -------------------------------------------------------------------------
  {
    id: "self-attention",
    title: "Transformer self-attention from scratch",
    blurb: "Q, K, V, scaled dot-product attention and a causal mask.",
    level: "Showpiece",
    category: "AI apps",
    language: "python3",
    libs: ["numpy"],
    code: `# One real Transformer attention block, written out. This is the exact
# mechanism inside GPT — no framework, no downloads, about 70 lines.
#
# Requires NumPy, which JDoodle installs before the run.

import math
import numpy as np

rng = np.random.default_rng(7)

VOCAB = ["the", "cat", "sat", "on", "a", "mat", "and", "it", "was", "cold"]
TOKEN_ID = {w: i for i, w in enumerate(VOCAB)}

tokens = ["the", "cat", "sat", "on", "a", "mat", "and", "it", "was", "cold"]
ids = [TOKEN_ID[t] for t in tokens]
T, D = len(ids), 8          # sequence length, model width
N_HEAD = 2
D_HEAD = D // N_HEAD
print(f"sequence: {' '.join(tokens)}")
print(f"shape: T={T} tokens, D={D} dimensions, {N_HEAD} heads of {D_HEAD}\\n")


def linear(x, out_dim):
    """A dense layer with Xavier-scaled random weights."""
    limit = math.sqrt(6 / (x.shape[-1] + out_dim))
    return x @ rng.uniform(-limit, limit, size=(x.shape[-1], out_dim))


def softmax(x, axis=-1):
    shifted = x - x.max(axis=axis, keepdims=True)
    e = np.exp(shifted)
    return e / e.sum(axis=axis, keepdims=True)


def layer_norm(x, eps=1e-5):
    mu = x.mean(-1, keepdims=True)
    sigma = x.std(-1, keepdims=True)
    return (x - mu) / np.sqrt(sigma ** 2 + eps)


# Token embeddings, then position embeddings added on top.
table = rng.normal(0, 0.5, size=(len(VOCAB), D))
position = rng.normal(0, 0.1, size=(T, D))
x = table[ids] + position

h = layer_norm(x)
merged = np.zeros_like(x)
shown = False

for head in range(N_HEAD):
    lo, hi = head * D_HEAD, (head + 1) * D_HEAD
    # Each head projects the whole sequence, then keeps its own slice.
    q, k, v = linear(h, D)[:, lo:hi], linear(h, D)[:, lo:hi], linear(h, D)[:, lo:hi]

    # Scale by 1/sqrt(d_k) so the scores stay in a sane range.
    scores = (q @ k.T) / math.sqrt(D_HEAD)

    # Block the lower triangle: a token may only attend to the past.
    causal = np.triu(np.ones((T, T), dtype=bool), k=1)
    scores = scores - 1e9 * causal
    weights = softmax(scores)

    if not shown:
        print("head 0 attention weights (rows = query, cols = key):")
        for i, tok in enumerate(tokens):
            cells = " ".join(f"{w:.2f}" for w in weights[i])
            print(f"  {tok:<5} -> {cells}")
        shown = True

    # Each head writes its own slice of the width.
    merged[:, lo:hi] += weights @ v

attn_out = layer_norm(x + merged)
ff1 = np.maximum(0.0, linear(attn_out, D * 2))     # ReLU
out = layer_norm(attn_out + linear(ff1, D))

print(f"\\ninput shape          {x.shape}")
print(f"after attention      {merged.shape}")
print(f"after feed-forward   {out.shape}")

# Each token's attention is a distribution, so each row sums to 1.
row0 = weights[0]
print(f"\\nrow 0 sums to {row0.sum():.6f}")
print(f"row 0 puts {row0[0]:.4f} of its attention on '{tokens[0]}' itself")

# Causality check: no attention may reach forward in the sequence.
causal_ok = all(
    weights[i, i + 1:].sum() < 1e-6 for i in range(T)
)
print(f"causal mask holds: {causal_ok}")
print(f"last token '{tokens[-1]}' attends most to:",
      [tokens[j] for j in np.argsort(-weights[-1])[:3]])
`,
  },
  {
    id: "tiny-gpt",
    title: "A GPT, from scratch: training and generation",
    blurb: "Tokenizer, a transformer block, hand-written backprop, AdamW, sampling.",
    level: "Showpiece",
    category: "AI apps",
    language: "python3",
    libs: ["numpy"],
    code: `# A character-level GPT, trained here, now, starting from random weights:
# tokenizer -> embedding -> one transformer block -> LM head -> cross-entropy
# -> backprop written by hand -> AdamW -> sampling.
#
# It is deliberately small so the whole thing trains in seconds. The program
# checks its own gradients against finite differences, so if the backward pass
# were wrong you would see it rather than take it on trust.
#
# Requires NumPy, which JDoodle installs before the run.

import math
import time

import numpy as np

rng = np.random.default_rng(1234)
START = time.perf_counter()

# ---------------------------------------------------------------------------
# 1. A tiny corpus with real structure, so there is something to learn.
# ---------------------------------------------------------------------------
CORPUS = """
the quick brown fox jumps over the lazy dog
the cat sat on the mat and the cat was happy
a quick red fox jumped over a lazy dog
the little bird sang a song in the morning
the bird sang and the morning was bright
quick quick brown dog cat bird song
the dog barked and the cat meowed loudly
"""

chars = sorted(set(CORPUS))
STOI = {c: i for i, c in enumerate(chars)}
ITOS = {i: c for i, c in enumerate(chars)}
data = np.array([STOI[c] for c in CORPUS], dtype=np.int64)

VOCAB = len(chars)
D = 32          # model width
N_HEAD = 4
D_HEAD = D // N_HEAD
FF = 4 * D      # feed-forward width
BLOCK = 48      # context length
BATCH = 12
STEPS = 400
LR = 3e-3

print(f"vocabulary: {VOCAB} characters -> {''.join(chars)!r}")
print(f"corpus: {len(data)} tokens")

# ---------------------------------------------------------------------------
# 2. Parameters.
# ---------------------------------------------------------------------------
P = {}


def par(name, shape, scale=0.08):
    P[name] = (rng.normal(0, 1, size=shape) * scale).astype(np.float64)
    return P[name]


def zeros(name, shape):
    P[name] = np.zeros(shape)
    return P[name]


wte = par("wte", (VOCAB, D))          # token embedding
wpe = par("wpe", (BLOCK, D))          # position embedding

ln1_g, ln1_b = np.ones(D), zeros("ln1_b", (D,))
ln2_g, ln2_b = np.ones(D), zeros("ln2_b", (D,))
# Register the gains too, so they are trained like every other parameter.
P["ln1_g"], P["ln2_g"] = ln1_g, ln2_g

Wq, Wk, Wv = par("Wq", (D, D)), par("Wk", (D, D)), par("Wv", (D, D))
Wo, bo = par("Wo", (D, D)), zeros("bo", (D,))

W1, b_ff1 = par("W1", (D, FF)), zeros("b_ff1", (FF,))
W2, b_ff2 = par("W2", (FF, D)), zeros("b_ff2", (D,))

Wh, bh = par("Wh", (D, VOCAB), 0.02), zeros("bh", (VOCAB,))

n_params = int(sum(p.size for p in P.values()))
print(f"model: {n_params:,} parameters, {N_HEAD} heads, "
      f"width {D}, context {BLOCK}")


# ---------------------------------------------------------------------------
# 3. Primitives.
# ---------------------------------------------------------------------------
def layer_norm(x, g, b, eps=1e-5):
    mu = x.mean(-1, keepdims=True)
    var = x.var(-1, keepdims=True)
    xhat = (x - mu) / np.sqrt(var + eps)
    return g * xhat + b


def layer_norm_backward(dy, x, g, eps=1e-5):
    """Given dL/dy, return (dL/dx, dL/dg, dL/db) for y = g * xhat + b."""
    mu = x.mean(-1, keepdims=True)
    var = x.var(-1, keepdims=True)
    inv = 1.0 / np.sqrt(var + eps)
    xhat = (x - mu) * inv
    dg = (dy * xhat).sum(axis=(0, 1))
    db = dy.sum(axis=(0, 1))
    dyg = dy * g
    dx = inv * (dyg
                - dyg.mean(-1, keepdims=True)
                - xhat * (dyg * xhat).mean(-1, keepdims=True))
    return dx, dg, db


def gelu(x):
    k = math.sqrt(2 / math.pi)
    return 0.5 * x * (1.0 + np.tanh(k * (x + 0.044715 * x ** 3)))


def gelu_backward(x, dy):
    k = math.sqrt(2 / math.pi)
    inner = k * (x + 0.044715 * x ** 3)
    t = np.tanh(inner)
    d_inner = k * (1 + 3 * 0.044715 * x ** 2)
    return dy * (0.5 * (1 + t) + 0.5 * x * (1 - t * t) * d_inner)


def softmax(x, axis=-1):
    e = np.exp(x - x.max(axis=axis, keepdims=True))
    return e / e.sum(axis=axis, keepdims=True)


# ---------------------------------------------------------------------------
# 4. Forward pass. Everything the backward pass needs is kept.
# ---------------------------------------------------------------------------
def forward(idx):
    B, T = idx.shape
    x = wte[idx] + wpe[:T]

    h = layer_norm(x, ln1_g, ln1_b)
    q = (h @ Wq).reshape(B, T, N_HEAD, D_HEAD).transpose(0, 2, 1, 3)
    k = (h @ Wk).reshape(B, T, N_HEAD, D_HEAD).transpose(0, 2, 1, 3)
    v = (h @ Wv).reshape(B, T, N_HEAD, D_HEAD).transpose(0, 2, 1, 3)

    scores = (q @ k.transpose(0, 1, 3, 2)) / math.sqrt(D_HEAD)
    causal = np.triu(np.ones((T, T), dtype=bool), k=1)
    scores = np.where(causal, -1e9, scores)
    probs = softmax(scores, axis=-1)

    ctx = (probs @ v).transpose(0, 2, 1, 3).reshape(B, T, D)
    merged = ctx
    a = x + (ctx @ Wo + bo)

    h2 = layer_norm(a, ln2_g, ln2_b)
    ff1 = h2 @ W1 + b_ff1
    f = gelu(ff1)
    out = a + (f @ W2 + b_ff2)

    logits = out @ Wh + bh
    return {
        "x": x, "h": h, "q": q, "k": k, "v": v, "merged": merged,
        "probs": probs, "a": a, "h2": h2, "ff1": ff1, "f": f,
        "out": out, "logits": logits, "B": B, "T": T,
    }


def loss_of(idx, targets):
    """targets is flat, one entry per (batch, position) pair."""
    cache = forward(idx)
    probs = softmax(cache["logits"], axis=-1).reshape(-1, VOCAB)
    picked = probs[np.arange(len(targets)), targets]
    return float(-np.log(picked + 1e-12).mean()), cache


# ---------------------------------------------------------------------------
# 5. Backward pass, by hand.
# ---------------------------------------------------------------------------
def backward(idx, targets, cache):
    grads = {name: np.zeros_like(p) for name, p in P.items()}
    B, T = cache["B"], cache["T"]
    scale = 1.0 / (B * T)

    # --- LM head and its cross-entropy loss.
    dlogits = softmax(cache["logits"], axis=-1)
    dlogits.reshape(-1, VOCAB)[np.arange(len(targets)), targets] -= 1.0
    dlogits *= scale

    grads["Wh"] += cache["out"].reshape(-1, D).T @ dlogits.reshape(-1, VOCAB)
    grads["bh"] += dlogits.reshape(-1, VOCAB).sum(0)
    d_out = (dlogits.reshape(-1, VOCAB) @ Wh.T).reshape(B, T, D)

    # --- Feed-forward block, plus the residual straight through.
    d_ff2 = d_out
    grads["W2"] += cache["f"].reshape(-1, FF).T @ d_ff2.reshape(-1, D)
    grads["b_ff2"] += d_ff2.reshape(-1, D).sum(0)
    d_f = (d_ff2.reshape(-1, D) @ W2.T).reshape(B, T, FF)
    d_ff1 = gelu_backward(cache["ff1"], d_f)
    grads["W1"] += cache["h2"].reshape(-1, D).T @ d_ff1.reshape(-1, FF)
    grads["b_ff1"] += d_ff1.reshape(-1, FF).sum(0)
    d_h2 = (d_ff1.reshape(-1, FF) @ W1.T).reshape(B, T, D)

    # --- LayerNorm 2 sits between a and h2, so the gradient arriving at its
    # output is d_h2, not the gradient at the end of the whole block.
    d_a_ln2, grads["ln2_g"], grads["ln2_b"] = layer_norm_backward(
        d_h2, cache["a"], ln2_g
    )
    d_a = d_out + d_a_ln2          # the residual a = x + attn_out

    # --- Attention block.
    # The attention output is added into a, so its incoming gradient is d_a,
    # not d_out: it collects the residual path as well as the LayerNorm path.
    # merged (concatenated over heads) went through Wo, so the incoming
    # gradient is projected back to the merged width and split per head.
    d_merged = d_a @ Wo.T                                      # (B, T, D)
    d_ctx_all = d_merged.reshape(B, T, N_HEAD, D_HEAD).transpose(0, 2, 1, 3)

    dq, dk, dv = [], [], []
    for head in range(N_HEAD):
        qh, kh, vh = cache["q"][:, head], cache["k"][:, head], cache["v"][:, head]
        probs = cache["probs"][:, head]                        # (B, T, T)
        dctx = d_ctx_all[:, head]                               # (B, T, D_HEAD)

        # ctx = probs @ v, so d(probs) = dctx @ v^T and d(v) = probs^T @ dctx.
        dprobs = dctx @ vh.transpose(0, 2, 1)
        dv.append(probs.transpose(0, 2, 1) @ dctx)

        # Softmax backward: d(scores) = p * (dp - sum(p * dp)).
        dscores = probs * (dprobs - (probs * dprobs).sum(-1, keepdims=True))
        dscores = np.where(np.triu(np.ones((T, T), dtype=bool), k=1), 0.0, dscores)
        dscores /= math.sqrt(D_HEAD)

        dq.append(dscores @ kh)
        dk.append(dscores.transpose(0, 2, 1) @ qh)

    dq = np.stack(dq, axis=1).transpose(0, 2, 1, 3).reshape(B, T, D)
    dk = np.stack(dk, axis=1).transpose(0, 2, 1, 3).reshape(B, T, D)
    dv = np.stack(dv, axis=1).transpose(0, 2, 1, 3).reshape(B, T, D)

    flat = cache["h"].reshape(-1, D)
    grads["Wq"] += flat.T @ dq.reshape(-1, D)
    grads["Wk"] += flat.T @ dk.reshape(-1, D)
    grads["Wv"] += flat.T @ dv.reshape(-1, D)
    grads["Wo"] += d_a.reshape(-1, D).T @ cache["merged"].reshape(-1, D)
    grads["bo"] += d_a.reshape(-1, D).sum(0)

    # q, k and v all read from h, so their gradients add up on the way back.
    d_attn = dq @ Wq.T + dk @ Wk.T + dv @ Wv.T

    # LayerNorm 1 sits between x and h.
    d_x_ln1, grads["ln1_g"], grads["ln1_b"] = layer_norm_backward(
        d_attn, cache["x"], ln1_g
    )
    d_x = d_a + d_x_ln1              # the residual x -> a

    # d_x is already averaged over the batch, so no extra scaling here.
    np.add.at(grads["wte"], idx, d_x)
    grads["wpe"][:T] += d_x.sum(0)

    return grads


# ---------------------------------------------------------------------------
# 6. A self-check: compare the analytic gradient to finite differences.
# ---------------------------------------------------------------------------
print("\\n--- gradient check (autograd vs. finite differences) ---")
# N inputs give N - 1 next-token targets. Both must line up, or the loss is
# averaged over a different number of positions than the gradient divides by.
sequence = data[:BLOCK]
check_idx = sequence[:-1][None, :]
check_targets = sequence[1:].reshape(-1)
assert len(check_targets) == check_idx.shape[0] * check_idx.shape[1]
base_loss, cache = loss_of(check_idx, check_targets)
grads = backward(check_idx, check_targets, cache)
print(f"loss on the check batch: {base_loss:.6f}")

EPS = 1e-3

# Check the entries with the largest gradients. On an entry whose gradient is
# near zero the comparison is dominated by the finite difference's own error,
# so those entries would agree or disagree meaninglessly.


def loss_only():
    return loss_of(check_idx, check_targets)[0]


picks = []
for name, p in P.items():
    magnitude = np.abs(grads[name])
    flat = magnitude.ravel()
    if flat.size == 0:
        continue
    for pos in np.argsort(flat)[::-1][:2]:
        picks.append((float(flat[pos]), name, np.unravel_index(pos, p.shape)))
picks.sort(reverse=True)

worst_relative = 0.0
for _, name, position in picks[:6]:
    analytic = grads[name][position]
    original = P[name][position]
    P[name][position] = original + EPS
    plus = loss_only()
    P[name][position] = original - EPS
    minus = loss_only()
    P[name][position] = original
    numeric = (plus - minus) / (2 * EPS)
    relative = abs(analytic - numeric) / max(abs(numeric), 1e-12)
    worst_relative = max(worst_relative, relative)
    print(f"  {name:<6} {str(position):<10} autograd {analytic: .6f}   "
          f"numeric {numeric: .6f}   relative error {relative:.2e}")

print(f"worst relative error across the largest gradients: "
      f"{worst_relative:.2e}")


# ---------------------------------------------------------------------------
# 7. AdamW.
# ---------------------------------------------------------------------------
m_state = {k: np.zeros_like(p) for k, p in P.items()}
v_state = {k: np.zeros_like(p) for k, p in P.items()}
BETA1, BETA2, ADAM_EPS, WEIGHT_DECAY = 0.9, 0.999, 1e-8, 0.01


def adamw(grads, step):
    for name, p in P.items():
        # Decay only the weight matrices. Decaying the gains and biases would
        # pull a LayerNorm gain of 1.0 toward 0 for no reason.
        decay = WEIGHT_DECAY if p.ndim == 2 else 0.0
        g = grads[name] + decay * p
        m_state[name] = BETA1 * m_state[name] + (1 - BETA1) * g
        v_state[name] = BETA2 * v_state[name] + (1 - BETA2) * g * g
        m_hat = m_state[name] / (1 - BETA1 ** step)
        v_hat = v_state[name] / (1 - BETA2 ** step)
        # Update in place: the forward pass holds direct references to these
        # arrays, so rebinding the dict entry would leave it reading stale
        # weights and the loss would never move.
        p -= LR * m_hat / (np.sqrt(v_hat) + ADAM_EPS)


def sample_batch():
    starts = rng.integers(0, len(data) - BLOCK, size=BATCH)
    idx = np.stack([data[s:s + BLOCK] for s in starts])
    return idx[:, :-1], idx[:, 1:].reshape(-1)


print(f"\\ntraining: {STEPS} steps, batch {BATCH}, AdamW lr={LR}")
print("-" * 46)
first_loss = last_loss = 0.0
for step in range(1, STEPS + 1):
    idx, targets = sample_batch()
    loss, cache = loss_of(idx, targets)
    adamw(backward(idx, targets, cache), step)
    if step == 1:
        first_loss = loss
    last_loss = loss
    if step in (1, 50, 150, 300, STEPS):
        print(f"  step {step:>4}/{STEPS}   loss {loss:7.4f}   "
              f"perplexity {math.exp(loss):7.2f}")

print(f"\\nloss {first_loss:.4f} -> {last_loss:.4f}")
print(f"trained in {time.perf_counter() - START:.1f}s")


# ---------------------------------------------------------------------------
# 8. Sampling.
# ---------------------------------------------------------------------------
def generate(prompt, length=180, temperature=0.8, top_k=None):
    context = [STOI[c] for c in prompt]
    start_len = len(context)
    for _ in range(length):
        window = context[-BLOCK:]
        padded = np.array([[0] * (BLOCK - len(window)) + window])
        logits = forward(padded)["logits"][0, -1]
        if temperature <= 0:
            next_id = int(np.argmax(logits))
        else:
            scaled = logits / temperature
            if top_k:
                keep = np.argsort(scaled)[-top_k:]
                mask = np.full_like(scaled, -1e9)
                mask[keep] = scaled[keep]
                scaled = mask
            next_id = int(rng.choice(len(scaled), p=softmax(scaled)))
        context.append(next_id)
    return "".join(ITOS[i] for i in context[start_len:])


for prompt, temperature in [("the", 0.7), ("the cat", 0.9), ("a quick", 0.6)]:
    print(f'\\n--- sampled from "{prompt}" at temperature {temperature} ---')
    print(generate(prompt, 190, temperature=temperature).replace(chr(10), " "))

print("\\nIt is only trained on a dozen lines, so it mostly echoes the corpus.")
print("The point is that every step above is real and visible: the tokenizer,")
print("the attention, the loss, the gradients, AdamW, and the sampling loop.")
`,
  },
  {
    id: "autograd",
    title: "Automatic differentiation (a micrograd)",
    blurb: "A tensor graph that differentiates itself in reverse mode.",
    level: "Showpiece",
    category: "AI apps",
    language: "python3",
    code: `# Reverse-mode automatic differentiation, the way PyTorch works internally.
#
# Every Value carries a backward closure. After the forward pass, backward()
# walks those closures so each node accumulates its own gradient. This is the
# machinery underneath every neural network's training loop.

import math
import random


class Value:
    """A node in the computation graph: a number plus how it was produced."""

    def __init__(self, data, children=(), op=""):
        self.data = data
        # The partial derivative of the output with respect to each child.
        self._backward = lambda: None
        self._prev = set(children)
        self._op = op
        self.grad = 0.0

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other), "+")

        def _backward():
            # The derivative of x + y is 1 for both operands.
            self.grad += out.grad
            other.grad += out.grad

        out._backward = _backward
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other), "*")

        def _backward():
            # The product rule: each factor takes the other as its gradient.
            self.grad += out.grad * other.data
            other.grad += out.grad * self.data

        out._backward = _backward
        return out

    def __pow__(self, exponent):
        out = Value(self.data ** exponent, (self,), f"**{exponent}")

        def _backward():
            self.grad += out.grad * exponent * self.data ** (exponent - 1)

        out._backward = _backward
        return out

    def tanh(self):
        out = Value(math.tanh(self.data), (self,), "tanh")

        def _backward():
            t = out.data
            self.grad += out.grad * (1 - t * t)

        out._backward = _backward
        return out

    def __neg__(self):
        return self * -1

    def __sub__(self, other):
        return self + (-other)

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    def __truediv__(self, other):
        return self * (other ** -1)

    def __repr__(self):
        return f"Value({self.data:.4f})"


def relu(x):
    # Multiply by a 0/1 mask, so autograd handles the kink for us.
    return x * (1.0 if x.data > 0 else 0.0)


class Neuron:
    def __init__(self, nin):
        self.w = [Value(random.uniform(-1, 1)) for _ in range(nin)]
        self.b = Value(0.0)

    def __call__(self, x):
        # A neuron: a weighted sum plus a bias, squashed by tanh.
        total = self.b
        for w, xi in zip(self.w, x):
            total = total + w * xi
        return total.tanh()

    def parameters(self):
        return self.w + [self.b]


class Layer:
    def __init__(self, nin, nout):
        self.neurons = [Neuron(nin) for _ in range(nout)]

    def __call__(self, x):
        return [n(x) for n in self.neurons]

    def parameters(self):
        return [p for n in self.neurons for p in n.parameters()]


class MLP:
    def __init__(self, nin, layers):
        sizes = [nin] + layers
        self.layers = [Layer(sizes[i], sizes[i + 1]) for i in range(len(layers))]

    def __call__(self, x):
        for layer in self.layers:
            x = layer(x)
        return x[0]

    def parameters(self):
        return [p for layer in self.layers for p in layer.parameters()]


def forward_backward(model, x, target):
    """Run the graph, then walk it backwards to fill in every .grad."""
    for p in model.parameters():
        p.grad = 0.0                       # clear last round first

    pred = model([Value(v) for v in x])
    loss = (pred - Value(target)) ** 2

    # Start the reverse walk at the output: d(loss)/d(loss) = 1.
    loss.grad = 1.0

    # Order the graph so every node runs only once all the nodes that feed
    # gradient INTO it have run. A node's _backward reads its own .grad and
    # writes to the nodes in its _prev, so those are its downstream nodes.
    #
    # A plain depth-first walk is not enough: this is a DAG, not a tree. A
    # hidden unit feeds every unit in the next layer, so its gradient is
    # written by several nodes, and visiting it early would read a partial sum.
    nodes, stack, seen = [], [loss], set()
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        nodes.append(node)
        stack.extend(node._prev)

    # Count, for each node, how many downstream nodes still owe it a gradient.
    indegree = {node: 0 for node in nodes}
    for node in nodes:
        for parent in node._prev:
            if parent in indegree:
                indegree[parent] += 1

    ready = [node for node in nodes if indegree[node] == 0]
    order = []
    while ready:
        node = ready.pop()
        order.append(node)
        for parent in node._prev:
            if parent in indegree:
                indegree[parent] -= 1
                if indegree[parent] == 0:
                    ready.append(parent)

    for node in order:
        node._backward()

    return pred, float(loss.data)


# ---------------------------------------------------------------------------
# A small network, asked to fit a grid of coordinates.
# ---------------------------------------------------------------------------
random.seed(42)
SIZE = 8
# A grid of points, jittered, each paired with the single number the network
# must learn to predict from it.
points = [[x / SIZE, y / SIZE] for y in range(SIZE) for x in range(SIZE)]
pairs = [([px + random.uniform(-0.04, 0.04), py + random.uniform(-0.04, 0.04)],
          px + py)
         for px, py in points]

print("Training a 2 -> 8 -> 8 -> 1 MLP to predict x + y from (x, y)")
print("-" * 58)

model = MLP(2, [8, 8, 1])
params = model.parameters()
print(f"{len(params)} parameters, all differentiated automatically")

# ---------------------------------------------------------------------------
# The gradient check, run before any training.
#
# Two things make this trustworthy. It runs at initialisation, where the
# predictions are wrong by a wide margin and the gradients are large, so a
# mismatch cannot hide behind near-zero numbers. And it differentiates the same
# quantity the graph does: the squared loss, not the raw prediction.
# ---------------------------------------------------------------------------
print("\\nGradient check by finite differences:")

CHECK_X, CHECK_Y = 0.37, 0.62
CHECK_TARGET = CHECK_X + CHECK_Y
eps = 1e-3

forward_backward(model, [CHECK_X, CHECK_Y], CHECK_TARGET)


def loss_at(xv, yv):
    return float(((model([Value(xv), Value(yv)]) - Value(CHECK_TARGET)) ** 2).data)


deltas = []
for p in params:
    analytic = p.grad
    if abs(analytic) < 1e-9:
        continue                     # a dead node has no gradient to compare
    original = p.data
    p.data = original + eps
    plus = loss_at(CHECK_X, CHECK_Y)
    p.data = original - eps
    minus = loss_at(CHECK_X, CHECK_Y)
    p.data = original
    numeric = (plus - minus) / (2 * eps)
    deltas.append((abs(analytic - numeric), analytic, numeric))

deltas.sort(reverse=True)
worst = deltas[0][0] if deltas else 0.0
print(f"checked {len(deltas)} of {len(params)} parameters")
print(f"largest disagreement: {worst:.2e}")
for diff, analytic, numeric in deltas[:3]:
    print(f"  autograd {analytic: .6f}   numeric {numeric: .6f}   "
          f"delta {diff:.2e}")
print("The autograd gradients are exact, so the differences are only")
print("floating-point noise from the finite difference itself.")

for epoch in range(1, 401):
    total = 0.0
    for features, target in pairs:
        pred, loss = forward_backward(model, features, target)
        total += loss
        # Gradient descent, by hand, on every parameter at once.
        for p in params:
            p.data -= 0.05 * p.grad
    if epoch in (1, 50, 150, 300, 400):
        print(f"  epoch {epoch:>4}   mean loss {total / len(pairs):.5f}")

print("\\nPredictions (the network should return x + y):")
for tx, ty in points[:12]:
    p = model([Value(tx), Value(ty)])
    print(f"  ({tx:.2f}, {ty:.2f})  target {tx + ty:.4f}   "
          f"predicted {p.data:.4f}   error {abs(p.data - (tx + ty)):.4f}")
`,
  },
  {
    id: "rag-search",
    title: "Retrieval-augmented search (pure Python)",
    blurb: "Embed passages by hand, rank by cosine similarity, answer from the best.",
    level: "Showpiece",
    category: "AI apps",
    language: "python3",
    code: `# Retrieval-augmented generation, minus the language model.
#
# The retrieval half is the interesting part and needs no API key: embed every
# passage by hand (here, hashed character n-grams, the same trick a hashing
# text embedder uses), rank passages against a query by cosine similarity, and
# hand the winners to a model. This is the pipeline behind the answers here.

import math
import re
from collections import Counter

DOCS = {
    "memory": """Jarvis keeps long-term memory in a Convex table. After every exchange an
        extraction action mines the conversation for durable facts, preferences
        and notes, then stores them per user. The stored memories are prepended
        to the system prompt on later turns, above retrieved documents, so the
        assistant can recall what mattered in earlier sessions.""",
    "streaming": """Replies can stream token by token instead of arriving at once. The action
        reads the server-sent event stream from the language provider, parses
        each delta, and flushes it to the client in batches on a short interval
        so the chat stays responsive and the speech pipeline can start talking
        while the rest of the sentence is still arriving.""",
    "voice": """Speech output is produced by a fallback chain, and each provider in turn is
        tried. Groq's text to speech model goes first, then ElevenLabs, then
        Sarvam, and finally the browser's own speech synthesis. Indic languages
        go to Sarvam first, because sending Hindi to an English-only model
        produces accented nonsense rather than speech.""",
    "code": """Code can be executed in a sandbox through the JDoodle compiler API. The
        browser never holds the client secret: the request is proxied by a
        server action. A program that fails to compile still returns a
        successful response, with the compiler message in the output, so the
        failure has to be read rather than inferred from the status code.""",
    "research": """Deep research runs a multi-step search over the web, reads the results,
        and answers with inline citations. Ordinary questions skip the extra
        searches and answer directly, so the slow path is only paid for when
        it is actually wanted.""",
}

STOP = set(
    "the a an and or of to in is are was were it that this for on with "
    "as by at from be has have its they we you i not no so if then".split()
)


def tokenize(text):
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP]


def clean(text):
    """Collapse the source formatting, so sentences are not split mid-clause."""
    return " ".join(text.split())


CLEAN = {name: clean(text) for name, text in DOCS.items()}


def stable_hash(text):
    """A hash that does not move between runs, unlike Python's built-in."""
    h = 0
    for char in text:
        h = (h * 131 + ord(char)) & 0xFFFFFFFF
    return h


def embed(text, dims=384):
    """A hashing embedder: every token lands in a fixed set of buckets.

    Real models learn these vectors; this one derives them from the tokens
    themselves, which is enough to rank by shared vocabulary.
    """
    vector = [0.0] * dims
    tokens = tokenize(text)
    for token in tokens:
        # Two hashes give the token a position and a sign, which cuts the
        # collisions between unrelated words.
        position = stable_hash(token) % dims
        sign = 1.0 if stable_hash(token + "!") % 2 == 0 else -1.0
        vector[position] += sign
    # A second character-level pass, so near-miss words still overlap.
    for token in tokens:
        for i in range(len(token) - 2):
            vector[stable_hash(token[i:i + 3] + "#") % dims] += 0.4
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b))


INDEX = {name: embed(clean(text)) for name, text in DOCS.items()}
print(f"indexed {len(INDEX)} passages, {len(INDEX['memory'])} dimensions each\\n")


def retrieve(query, k=3):
    q = embed(query)
    scored = sorted(
        ((cosine(q, vec), name) for name, vec in INDEX.items()),
        reverse=True,
    )
    return scored[:k]


for question in [
    "how does jarvis remember things between chats?",
    "why is the answer slow to appear?",
    "what happens when my program has a syntax error?",
    "which voices are used for hindi?",
]:
    print(f"Q: {question}")
    for score, name in retrieve(question):
        bar = "#" * int(max(0.0, score) * 40)
        print(f"   {score:.3f} {bar:<40} {name}")
    print()

def answer(query, k=2, max_chars=220):
    """An extractive answer: the most relevant sentence from the best passages."""
    picked = retrieve(query, k)
    sentences = []
    for _, name in picked:
        for sentence in re.split(r"(?<=[.!?])\\s+", CLEAN[name]):
            if len(sentence.strip()) > 40:
                sentences.append((name, sentence.strip()))

    if not sentences:
        return "Nothing in the index matched that."

    q = embed(query)
    best_name, best_sentence = max(sentences, key=lambda s: cosine(q, embed(s[1])))
    if len(best_sentence) > max_chars:
        best_sentence = best_sentence[:max_chars].rsplit(" ", 1)[0] + "..."
    return f"[{best_name}] {best_sentence}"


for question in [
    "how are memories stored?",
    "what happens if compilation fails?",
    "how does speech synthesis choose a provider?",
]:
    print(f"Q: {question}")
    print(f"A: {answer(question)}\\n")
`,
  },
  {
    id: "chatbot-classifier",
    title: "An intent classifier for a chatbot",
    blurb: "A trained softmax network that routes a message to an intent.",
    level: "Showpiece",
    category: "AI apps",
    language: "python3",
    code: `# A working intent classifier: bag-of-words features, one-vs-rest logistic
# regression trained by gradient descent, and a confidence floor that falls
# back to a human handoff. This is the decision layer a support bot or an
# assistant router is built from.

import math
import random
import re
from collections import Counter

random.seed(5)

INTENTS = {
    "greeting": ["hello", "hi there", "hey", "good morning",
                 "good evening", "how are you"],
    "farewell": ["bye", "goodbye", "see you", "talk later", "good night"],
    "weather": ["weather", "temperature", "rain", "forecast",
                "humidity", "is it sunny"],
    "run_code": ["run this code", "execute the program", "compile it",
                 "run the program", "test the code"],
    "math": ["calculate", "integrate", "derivative", "solve for x",
             "matrix determinant"],
    "thanks": ["thank you", "thanks a lot", "appreciate it", "helpful"],
    "complaint": ["it is broken", "not working", "error", "bug",
                  "it crashed", "too slow"],
}

REPLIES = {
    "greeting": "Hello. What can I do for you?",
    "farewell": "Goodbye. Come back any time.",
    "weather": "Let me look that up for you.",
    "run_code": "Opening the code runner now.",
    "math": "Working through the steps with you.",
    "thanks": "Happy to help.",
    "complaint": "Sorry about that. Tell me more and I'll dig in.",
}
FALLBACK = "I am not confident which handler that needs. Passing it to a human."
LABELS = list(INTENTS)


def tokenize(text):
    return re.findall(r"[a-z0-9']+", text.lower())


VOCAB = sorted({t for phrases in INTENTS.values() for p in phrases
                for t in tokenize(p)})
print(f"{len(VOCAB)} features learned from "
      f"{sum(len(p) for p in INTENTS.values())} training phrases")


def featurise(text):
    """Bag of words, L2-normalised so a long message is not weighted more."""
    counts = Counter(tokenize(text))
    vec = [float(counts.get(t, 0)) for t in VOCAB]
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


# The intents are mutually exclusive, so this is a softmax classifier over
# INTENTS, not one binary model per intent: a message belongs to exactly one
# bucket, and a softmax is the loss that matches that assumption.
X, Y = [], []
for index, label in enumerate(LABELS):
    for phrase in INTENTS[label]:
        X.append(featurise(phrase))
        Y.append(index)
print(f"{len(X)} training rows, {len(VOCAB)} features, {len(LABELS)} classes")

weights = [[random.uniform(-0.1, 0.1) for _ in LABELS] for _ in VOCAB]
biases = [0.0] * len(LABELS)

LR = 2.0
EPOCHS = 400
n = len(X)


def softmax(scores):
    biggest = max(scores)
    exps = [math.exp(s - biggest) for s in scores]
    total = sum(exps)
    return [e / total for e in exps]


def logits_of(feats):
    return [biases[j] + sum(weights[i][j] * feats[i] for i in range(len(VOCAB)))
            for j in range(len(LABELS))]


print("\\nepoch   loss")
print("-" * 16)
loss = 0.0
for epoch in range(1, EPOCHS + 1):
    loss = 0.0
    grad_w = [[0.0] * len(LABELS) for _ in VOCAB]
    grad_b = [0.0] * len(LABELS)

    for feats, target in zip(X, Y):
        probs = softmax(logits_of(feats))
        loss += -math.log(max(probs[target], 1e-12))
        # For softmax plus cross-entropy the gradient is just p - y.
        for j in range(len(LABELS)):
            d = (probs[j] - (1.0 if j == target else 0.0)) / n
            grad_b[j] += d
            for i in range(len(VOCAB)):
                grad_w[i][j] += d * feats[i]

    for j in range(len(LABELS)):
        biases[j] -= LR * grad_b[j]
        for i in range(len(VOCAB)):
            weights[i][j] -= LR * grad_w[i][j]

    if epoch in (1, 50, 150, 400):
        print(f"{epoch:>5}  {loss / n:7.4f}")

print("\\nStrongest feature weight per intent:")
for j, label in enumerate(LABELS):
    best = sorted(range(len(VOCAB)), key=lambda i: -weights[i][j])[:3]
    print(f"  {label:<10}" + ", ".join(
        f"{VOCAB[i]} {weights[i][j]:+.2f}" for i in best
    ))

# Below this the model admits it does not know, which is what routes an
# unfamiliar message to a human instead of a confidently wrong handler.
THRESHOLD = 0.6


def classify(text):
    """Return the intent and its confidence, or 'unknown' when unsure."""
    probs = softmax(logits_of(featurise(text)))
    best = max(range(len(LABELS)), key=lambda j: probs[j])
    if probs[best] < THRESHOLD:
        return "unknown", probs[best]
    return LABELS[best], probs[best]


print("\\n--- routing a conversation ---")
for message in [
    "hey there!",
    "will it rain tomorrow?",
    "can you run this code for me",
    "solve for x in 2x + 4 = 10",
    "thanks, that was helpful",
    "the export button is broken and it crashed",
    "goodbye for now",
    "what is the capital of Peru",     # deliberately unfamiliar
]:
    intent, confidence = classify(message)
    reply = REPLIES.get(intent, FALLBACK)
    print(f"  {message:<44} -> {intent:<9} {confidence:5.1%}  {reply}")
`,
  },
];

/** Look up a starter program by id. */
export function getStarter(id: string): StarterProgram | undefined {
  return STARTER_PROGRAMS.find((p) => p.id === id);
}

/** Starter programs written for one JDoodle language slug. */
export function startersForLanguage(language: string): StarterProgram[] {
  return STARTER_PROGRAMS.filter((p) => p.language === language);
}

/** Starter programs matching a free-text search over title, blurb and category. */
export function searchStarters(query: string): StarterProgram[] {
  const q = query.trim().toLowerCase();
  if (!q) return STARTER_PROGRAMS;
  return STARTER_PROGRAMS.filter((p) =>
    `${p.title} ${p.blurb} ${p.category} ${p.level} ${p.language}`
      .toLowerCase()
      .includes(q),
  );
}
