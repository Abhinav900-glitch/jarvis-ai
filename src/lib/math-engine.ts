// ---------------------------------------------------------------------------
// A small computer-algebra core for the calculator.
//
// Handwritten, dependency-free, and shared by nothing else, because the point
// of it is to be readable: a tokenizer, a precedence-climbing parser, an
// evaluator, a derivative, a power-rule integral, and a root finder. It is the
// difference between a calculator with four hardcoded equation shapes and one
// where "3x^2 - 2x + 1" is a legal thing to type.
//
// Deliberately numeric where exactness is not worth the code: definite
// integrals are adaptive Simpson, limits are sampled, roots of degree ≥ 3 are
// found by sign change and polished with bisection. Everything that *is* exact
// — arithmetic, differentiation, quadratic roots — stays exact.
// ---------------------------------------------------------------------------

export type MathNode =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^" | "%"; l: MathNode; r: MathNode }
  | { t: "neg"; x: MathNode }
  | { t: "fact"; x: MathNode }
  | { t: "fn"; name: string; args: MathNode[] };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  "π": Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
};

type FnImpl = { arity: number | "n"; f: (...args: number[]) => number };

const FUNCTIONS: Record<string, FnImpl> = {
  sin: { arity: 1, f: Math.sin },
  cos: { arity: 1, f: Math.cos },
  tan: { arity: 1, f: Math.tan },
  csc: { arity: 1, f: (x) => 1 / Math.sin(x) },
  sec: { arity: 1, f: (x) => 1 / Math.cos(x) },
  cot: { arity: 1, f: (x) => 1 / Math.tan(x) },
  asin: { arity: 1, f: Math.asin },
  acos: { arity: 1, f: Math.acos },
  atan: { arity: 1, f: Math.atan },
  atan2: { arity: 2, f: Math.atan2 },
  sinh: { arity: 1, f: Math.sinh },
  cosh: { arity: 1, f: Math.cosh },
  tanh: { arity: 1, f: Math.tanh },
  sqrt: { arity: 1, f: Math.sqrt },
  cbrt: { arity: 1, f: Math.cbrt },
  abs: { arity: 1, f: Math.abs },
  ln: { arity: 1, f: Math.log },
  log: { arity: 1, f: Math.log10 },
  log10: { arity: 1, f: Math.log10 },
  log2: { arity: 1, f: Math.log2 },
  exp: { arity: 1, f: Math.exp },
  floor: { arity: 1, f: Math.floor },
  ceil: { arity: 1, f: Math.ceil },
  round: { arity: 1, f: Math.round },
  trunc: { arity: 1, f: Math.trunc },
  sign: { arity: 1, f: Math.sign },
  hypot: { arity: "n", f: (...a) => Math.hypot(...a) },
  min: { arity: "n", f: (...a) => Math.min(...a) },
  max: { arity: "n", f: (...a) => Math.max(...a) },
  pow: { arity: 2, f: Math.pow },
  mod: { arity: 2, f: (a, b) => a % b },
  gcd: { arity: 2, f: (a, b) => gcd(Math.round(a), Math.round(b)) },
  lcm: { arity: 2, f: (a, b) => Math.abs(Math.round(a) * Math.round(b)) / (gcd(Math.round(a), Math.round(b)) || 1) },
  ncr: { arity: 2, f: (n, r) => gammaRatio(n, r) },
  npr: { arity: 2, f: (n, r) => gammaRatio(n, r) * factorial(Math.round(r)) },
};

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) {
    // Γ(n+1) via Lanczos, so 0.5! is an answer rather than an error.
    return gamma(n + 1);
  }
  if (n > 170) return Infinity;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

function gamma(z: number): number {
  const g = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = g[0];
  for (let i = 1; i < 9; i++) x += g[i] / (z + i);
  const t = z + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function gammaRatio(n: number, r: number): number {
  return factorial(Math.round(n)) / (factorial(Math.round(r)) * factorial(Math.round(n - r)));
}

// ---------------------------------------------------------------------------
// Tokenizer + parser
// ---------------------------------------------------------------------------

type Token =
  | { k: "num"; v: number }
  | { k: "id"; v: string }
  | { k: "op"; v: string };

const OP_ALIASES: Record<string, string> = {
  "×": "*", "·": "*", "∗": "*", "÷": "/", "−": "-", "–": "-", "—": "-",
  "√": "sqrt", "π": "pi", "**": "^",
};

function normalize(input: string): string {
  let out = input.replace(/[×·∗÷−–—√π]|\*\*/g, (m) => OP_ALIASES[m] ?? m);
  out = out.replace(/\bmod\b/gi, "mod");
  return out;
}

function tokenize(input: string): Token[] {
  const src = normalize(input);
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new Error(`Bad number at ${i + 1}.`);
      tokens.push({ k: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ k: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/^%!(),=".includes(c)) {
      tokens.push({ k: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character “${c}”.`);
  }
  return tokens;
}

/**
 * Parse one expression. `variables` is the set of names that are variables
 * rather than implicit products of letters, so "xy" means x·y by default but a
 * declared "xy" stays one symbol.
 */
export function parse(input: string, variables: string[] = ["x", "y", "z", "t", "n"]): MathNode {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error("Type an expression first.");
  const known = new Set(variables);

  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.k === "op" && peek().v === v;

  const startsPrimary = (t: Token | undefined) =>
    t !== undefined && (t.k === "num" || t.k === "id" || (t.k === "op" && t.v === "("));

  function parseExpr(): MathNode {
    let left = parseTerm();
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].v as "+" | "-";
      left = { t: "bin", op, l: left, r: parseTerm() };
    }
    return left;
  }

  function parseTerm(): MathNode {
    let left = parseUnary();
    for (;;) {
      if (isOp("*") || isOp("/") || isOp("%")) {
        const op = tokens[pos++].v as "*" | "/" | "%";
        left = { t: "bin", op, l: left, r: parseUnary() };
      } else if (startsPrimary(peek())) {
        // Implicit multiplication: 2x, 3(x+1), (a)(b), 2 sin x
        left = { t: "bin", op: "*", l: left, r: parseUnary() };
      } else {
        return left;
      }
    }
  }

  function parseUnary(): MathNode {
    if (isOp("-")) { pos++; return { t: "neg", x: parseUnary() }; }
    if (isOp("+")) { pos++; return parseUnary(); }
    return parsePower();
  }

  function parsePower(): MathNode {
    const base = parsePostfix();
    if (isOp("^")) {
      pos++;
      // Right associative, and the exponent may be signed: 2^-3, 2^3^2.
      return { t: "bin", op: "^", l: base, r: parseUnary() };
    }
    return base;
  }

  function parsePostfix(): MathNode {
    let node = parsePrimary();
    while (isOp("!")) { pos++; node = { t: "fact", x: node }; }
    return node;
  }

  function parsePrimary(): MathNode {
    const tok = peek();
    if (!tok) throw new Error("The expression ends too early.");
    if (tok.k === "num") { pos++; return { t: "num", v: tok.v }; }
    if (tok.k === "op" && tok.v === "(") {
      pos++;
      const inner = parseExpr();
      if (!isOp(")")) throw new Error("Missing closing parenthesis.");
      pos++;
      return inner;
    }
    if (tok.k === "id") {
      pos++;
      const name = tok.v;
      const lower = name.toLowerCase();
      if (FUNCTIONS[lower]) {
        if (!isOp("(")) throw new Error(`${name} needs parentheses, e.g. ${name}(x).`);
        pos++;
        const args: MathNode[] = [parseExpr()];
        while (isOp(",")) { pos++; args.push(parseExpr()); }
        if (!isOp(")")) throw new Error(`Missing “)” after ${name}(…).`);
        pos++;
        const arity = FUNCTIONS[lower].arity;
        if (arity !== "n" && args.length !== arity) {
          throw new Error(`${name} takes ${arity} argument${arity === 1 ? "" : "s"}.`);
        }
        return { t: "fn", name: lower, args };
      }
      if (CONSTANTS[lower] !== undefined) return { t: "num", v: CONSTANTS[lower] };
      if (known.has(name) || name.length === 1) return { t: "var", name };
      // "xy" with no declared "xy" is x·y — the way it is written by hand.
      let node: MathNode | null = null;
      for (const ch of name) {
        const factor: MathNode =
          CONSTANTS[ch] !== undefined ? { t: "num", v: CONSTANTS[ch] } : { t: "var", name: ch };
        node = node === null ? factor : { t: "bin", op: "*", l: node, r: factor };
      }
      if (node === null) throw new Error(`Unknown symbol “${name}”.`);
      return node;
    }
    throw new Error(`Unexpected “${tok.k === "op" ? tok.v : "token"}”.`);
  }

  const node = parseExpr();
  if (pos !== tokens.length) {
    const leftover = tokens.slice(pos).map((t) => (t.k === "op" ? t.v : String(t.v))).join(" ");
    throw new Error(`Unexpected “${leftover}” after the expression.`);
  }
  return node;
}

/** Parse "lhs = rhs" as lhs − rhs. */
export function parseEquation(input: string, variables: string[] = ["x"]): MathNode {
  const parts = input.split("=");
  if (parts.length === 1) return parse(input, variables);
  if (parts.length > 2) throw new Error("Only one “=” is allowed.");
  return { t: "bin", op: "-", l: parse(parts[0], variables), r: parse(parts[1], variables) };
}

// ---------------------------------------------------------------------------
// Evaluate + render
// ---------------------------------------------------------------------------

/** The variable names actually used in the expression (functions excluded). */
export function variablesIn(node: MathNode): string[] {
  const out = new Set<string>();
  const walk = (n: MathNode) => {
    switch (n.t) {
      case "var": out.add(n.name); return;
      case "neg": case "fact": walk(n.x); return;
      case "bin": walk(n.l); walk(n.r); return;
      case "fn": n.args.forEach(walk); return;
      case "num": return;
    }
  };
  walk(node);
  return [...out];
}

export function evaluate(node: MathNode, vars: Record<string, number> = {}): number {
  switch (node.t) {
    case "num": return node.v;
    case "var": {
      const v = vars[node.name];
      if (v === undefined) throw new Error(`“${node.name}” has no value — enter one.`);
      return v;
    }
    case "neg": return -evaluate(node.x, vars);
    case "fact": return factorial(evaluate(node.x, vars));
    case "bin": {
      const l = evaluate(node.l, vars);
      const r = evaluate(node.r, vars);
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/":
          if (r === 0) throw new Error("Division by zero.");
          return l / r;
        case "%": return l % r;
        case "^": return Math.pow(l, r);
      }
      break;
    }
    case "fn": {
      const impl = FUNCTIONS[node.name];
      if (!impl) throw new Error(`Unknown function “${node.name}”.`);
      return impl.f(...node.args.map((a) => evaluate(a, vars)));
    }
  }
  throw new Error("Could not evaluate.");
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 4 };
const NEG_PREC = 3;
const FACT_PREC = 5;

function nodePrec(node: MathNode): number {
  if (node.t === "bin") return PREC[node.op];
  if (node.t === "neg") return NEG_PREC;
  if (node.t === "fact") return FACT_PREC;
  return 6;
}

/** Format a number without trailing noise: 0.5, not 0.5000000000001. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : Number.isNaN(n) ? "undefined" : "−∞";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const rounded = Number(n.toPrecision(12));
  if (Math.abs(rounded) !== 0 && (Math.abs(rounded) < 1e-6 || Math.abs(rounded) >= 1e12)) {
    return rounded.toExponential(6).replace(/\.?0+e/, "e");
  }
  return String(rounded);
}

export function toSource(node: MathNode, parentPrec = 0): string {
  const parentOp = node.t === "bin" ? node.op : null;
  const wrap = (child: MathNode, minPrec: number, right = false) => {
    const s = toSource(child, 0);
    const p = nodePrec(child);
    // A right operand of equal precedence needs brackets unless the operator is
    // associative and the same: a + (b + c) is a + b + c, but a / (b·c) is not
    // a / b·c — so `/` must keep its brackets or it silently changes meaning.
    const associativeSameOp =
      child.t === "bin" && child.op === parentOp && (parentOp === "+" || parentOp === "*");
    const need = p < minPrec || (right && p === minPrec && child.t === "bin" && !associativeSameOp);
    return need ? `(${s})` : s;
  };

  switch (node.t) {
    case "num":
      // Show the constants as symbols; they re-parse, and "e^x" beats
      // 2.71828182846^x in every line it appears.
      if (node.v === Math.E) return "e";
      if (node.v === Math.PI) return "π";
      return fmt(node.v);
    case "var": return node.name;
    case "neg": {
      const s = toSource(node.x, NEG_PREC);
      return parentPrec > NEG_PREC ? `(-${s})` : `-${s}`;
    }
    case "fact": {
      const s = toSource(node.x, FACT_PREC + 1);
      return parentPrec > FACT_PREC ? `(${s})!` : `${s}!`;
    }
    case "fn": return `${node.name}(${node.args.map((a) => toSource(a)).join(", ")})`;
    case "bin": {
      const p = PREC[node.op];
      const l = wrap(node.l, p, false);
      const r = wrap(node.r, p, true);
      const op = node.op === "*" ? "·" : node.op;
      const s = `${l}${node.op === "^" ? "^" : op === "·" ? "·" : ` ${op} `}${r}`;
      return p < parentPrec ? `(${s})` : s;
    }
  }
}

// ---------------------------------------------------------------------------
// Simplify
// ---------------------------------------------------------------------------

const hasVar = (node: MathNode, name?: string): boolean => {
  switch (node.t) {
    case "num": return false;
    case "var": return name === undefined ? true : node.name === name;
    case "neg": case "fact": return hasVar(node.x, name);
    case "bin": return hasVar(node.l, name) || hasVar(node.r, name);
    case "fn": return node.args.some((a) => hasVar(a, name));
  }
};

type NumNode = { t: "num"; v: number };

/** True for numeric nodes. A predicate, so it may narrow. */
const isNum = (node: MathNode): node is NumNode => node.t === "num";

/** "Is this the number v?" — a plain boolean, deliberately not a predicate:
 *  using a predicate here made later checks narrow to `never` once the numeric
 *  case had already been excluded by an earlier early return. */
const isNumValue = (node: MathNode, v: number): boolean =>
  node.t === "num" && Math.abs(node.v - v) < 1e-12;

export function simplify(node: MathNode): MathNode {
  const walk = (n: MathNode): MathNode => {
    switch (n.t) {
      case "num": case "var": return n;
      case "neg": {
        const x = walk(n.x);
        if (x.t === "num") return { t: "num", v: -x.v };
        if (x.t === "neg") return x.x;
        // −(2·cos x) reads as −2·cos x.
        if (x.t === "bin" && x.op === "*" && isNum(x.l)) {
          return { t: "bin", op: "*", l: { t: "num", v: -x.l.v }, r: x.r };
        }
        return { t: "neg", x };
      }
      case "fact": {
        const x = walk(n.x);
        if (isNum(x)) return { t: "num", v: factorial(x.v) };
        return { t: "fact", x };
      }
      case "fn": {
        const args = n.args.map(walk);
        // Fold only when the answer is a whole number: ln(e) → 1 and cos(0) → 1
        // are worth folding, ln(2) → 0.693 is information thrown away.
        // Wrapped, not passed by reference: every()'s index argument would be
        // read as the `v` to compare against.
        if (args.every((a) => isNum(a))) {
          try {
            const value = evaluate({ t: "fn", name: n.name, args });
            // Tolerance, not Number.isInteger: log10(100) lands on 2.0000000000000004.
            if (Math.abs(value - Math.round(value)) < 1e-12) return { t: "num", v: Math.round(value) };
          } catch {
            // domain error — leave it symbolic so the message survives
          }
        }
        return { t: "fn", name: n.name, args };
      }
      case "bin": {
        const l = walk(n.l);
        const r = walk(n.r);
        switch (n.op) {
          case "+":
            if (isNumValue(l, 0)) return r;
            if (isNumValue(r, 0)) return l;
            if (isNum(l) && isNum(r)) return { t: "num", v: l.v + r.v };
            break;
          case "-":
            if (isNumValue(r, 0)) return l;
            if (isNumValue(l, 0)) return { t: "neg", x: r };
            if (isNum(l) && isNum(r)) return { t: "num", v: l.v - r.v };
            break;
          case "*":
            if (isNumValue(l, 0) || isNumValue(r, 0)) return { t: "num", v: 0 };
            if (isNumValue(l, 1)) return r;
            if (isNumValue(r, 1)) return l;
            if (isNum(l) && isNum(r)) return { t: "num", v: l.v * r.v };
            // 2·(−cos x) is −2·cos x, and 3·2·x is 6·x.
            if (r.t === "neg") return walk({ t: "neg", x: { t: "bin", op: "*", l, r: r.x } });
            if (l.t === "neg") return walk({ t: "neg", x: { t: "bin", op: "*", l: l.x, r } });
            if (isNum(l) && r.t === "bin" && r.op === "*" && isNum(r.l)) {
              return walk({ t: "bin", op: "*", l: { t: "num", v: l.v * r.l.v }, r: r.r });
            }
            // 3·(x^3 / 3) is x^3: fold a constant into a numeric denominator so
            // integrals and derivatives read like the textbook, not the tree.
            if (isNum(l) && r.t === "bin" && r.op === "/" && isNum(r.r) && r.r.v !== 0) {
              const q = l.v / r.r.v;
              if (Number.isInteger(q)) {
                return walk({ t: "bin", op: "*", l: { t: "num", v: q }, r: r.l });
              }
            }
            // x·(1/x) is 1.
            if (r.t === "bin" && r.op === "/" && toSource(r.r) === toSource(l)) return walk(r.l);
            // -1 * x reads better as -x
            if (isNumValue(l, -1)) return { t: "neg", x: r };
            break;
          case "/":
            if (isNumValue(r, 1)) return l;
            if (isNumValue(l, 0)) return { t: "num", v: 0 };
            if (toSource(l) === toSource(r)) return { t: "num", v: 1 };
            // (u³ / 3) / 2 is u³ / 6.
            if (isNum(r) && l.t === "bin" && l.op === "/" && isNum(l.r)) {
              return walk({ t: "bin", op: "/", l: l.l, r: { t: "num", v: l.r.v * r.v } });
            }
            if (isNum(l) && isNum(r) && r.v !== 0) {
              const q = l.v / r.v;
              if (Number.isFinite(q)) return { t: "num", v: q };
            }
            break;
          case "^":
            if (isNumValue(r, 1)) return l;
            if (isNumValue(r, 0)) return { t: "num", v: 1 };
            if (isNum(l) && isNum(r)) return { t: "num", v: Math.pow(l.v, r.v) };
            break;
          case "%":
            if (isNum(l) && isNum(r) && r.v !== 0) return { t: "num", v: l.v % r.v };
            break;
        }
        return { t: "bin", op: n.op, l, r };
      }
    }
  };
  return walk(node);
}

// ---------------------------------------------------------------------------
// Differentiation
// ---------------------------------------------------------------------------

/** d/dv of `node`, or null when the rule is not in the table. */
export function differentiate(node: MathNode, v = "x"): MathNode | null {
  const d = (n: MathNode) => differentiate(n, v);
  const mul = (a: MathNode, b: MathNode): MathNode => ({ t: "bin", op: "*", l: a, r: b });
  const neg = (a: MathNode): MathNode => ({ t: "neg", x: a });
  const pow = (a: MathNode, b: MathNode): MathNode => ({ t: "bin", op: "^", l: a, r: b });
  const div = (a: MathNode, b: MathNode): MathNode => ({ t: "bin", op: "/", l: a, r: b });
  const num = (x: number): MathNode => ({ t: "num", v: x });
  const fn = (name: string, arg: MathNode): MathNode => ({ t: "fn", name, args: [arg] });

  switch (node.t) {
    case "num": return num(0);
    case "var": return num(node.name === v ? 1 : 0);
    case "neg": {
      const dx = d(node.x);
      return dx && neg(dx);
    }
    case "fact": return null;
    case "bin": {
      const dl = d(node.l);
      const dr = d(node.r);
      if (!dl || !dr) return null;
      switch (node.op) {
        case "+": return { t: "bin", op: "+", l: dl, r: dr };
        case "-": return { t: "bin", op: "-", l: dl, r: dr };
        case "*": return { t: "bin", op: "+", l: mul(dl, node.r), r: mul(node.l, dr) };
        case "/":
          return div(
            { t: "bin", op: "-", l: mul(dl, node.r), r: mul(node.l, dr) },
            pow(node.r, num(2)),
          );
        case "^": {
          const baseConst = !hasVar(node.l, v);
          const expConst = !hasVar(node.r, v);
          if (expConst) {
            // n·u^(n−1)·u'
            return mul(mul(node.r, pow(node.l, { t: "bin", op: "-", l: node.r, r: num(1) })), dl);
          }
          if (baseConst) {
            // u^v · ln u · v'
            return mul(mul(pow(node.l, node.r), fn("ln", node.l)), dr);
          }
          return null; // x^x and friends: numeric fallback in the UI
        }
        case "%": return null;
      }
      return null;
    }
    case "fn": {
      if (node.args.length !== 1) return null;
      const u = node.args[0];
      const du = d(u);
      if (!du) return null;
      const chain = (outer: MathNode) => mul(outer, du);
      switch (node.name) {
        case "sin": return chain(fn("cos", u));
        case "cos": return chain(neg(fn("sin", u)));
        case "tan": return chain(div(num(1), pow(fn("cos", u), num(2))));
        case "asin": return chain(div(num(1), fn("sqrt", { t: "bin", op: "-", l: num(1), r: pow(u, num(2)) })));
        case "acos": return chain(neg(div(num(1), fn("sqrt", { t: "bin", op: "-", l: num(1), r: pow(u, num(2)) }))));
        case "atan": return chain(div(num(1), { t: "bin", op: "+", l: num(1), r: pow(u, num(2)) }));
        case "sinh": return chain(fn("cosh", u));
        case "cosh": return chain(fn("sinh", u));
        case "tanh": return chain(div(num(1), pow(fn("cosh", u), num(2))));
        case "ln": return chain(div(num(1), u));
        case "log": case "log10": return chain(div(num(1), mul(u, num(Math.LN10))));
        case "log2": return chain(div(num(1), mul(u, num(Math.LN2))));
        case "sqrt": return chain(div(num(1), mul(num(2), fn("sqrt", u))));
        case "exp": return chain(fn("exp", u));
        case "abs": return chain(fn("sign", u));
        default: return null;
      }
    }
  }
}

/** Central difference, for derivatives the symbolic table cannot reach. */
export function numericDerivative(f: (x: number) => number, at: number): number {
  const h = Math.max(1e-6, Math.abs(at) * 1e-7);
  return (f(at + h) - f(at - h)) / (2 * h);
}

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

/** a·v + b, or null when the expression is not linear in v. */
function linearIn(node: MathNode, v: string): { a: number; b: number } | null {
  const coeffs = polynomialCoefficients(node, v);
  if (!coeffs || coeffs.length > 2) return null;
  const a = coeffs[1] ?? 0;
  if (a === 0) return null;
  return { a, b: coeffs[0] ?? 0 };
}

/** Antiderivative by the power rule and the handful of standard forms. */
export function integrate(node: MathNode, v = "x"): MathNode | null {
  const num = (x: number): MathNode => ({ t: "num", v: x });
  const fn = (name: string, arg: MathNode): MathNode => ({ t: "fn", name, args: [arg] });
  const mul = (a: MathNode, b: MathNode): MathNode => ({ t: "bin", op: "*", l: a, r: b });
  const div = (a: MathNode, b: MathNode): MathNode => ({ t: "bin", op: "/", l: a, r: b });
  const pow = (a: MathNode, b: MathNode): MathNode => ({ t: "bin", op: "^", l: a, r: b });

  switch (node.t) {
    case "num": return mul(node, { t: "var", name: v });
    case "var":
      if (node.name !== v) return mul(node, { t: "var", name: v });
      return div(pow({ t: "var", name: v }, num(2)), num(2));
    case "neg": {
      const inner = integrate(node.x, v);
      return inner && { t: "neg", x: inner };
    }
    case "bin": {
      if (node.op === "+" || node.op === "-") {
        const l = integrate(node.l, v);
        const r = integrate(node.r, v);
        return l && r ? { t: "bin", op: node.op, l, r } : null;
      }
      if (node.op === "*" && !hasVar(node.r, v)) {
        const inner = integrate(node.l, v);
        return inner && mul(node.r, inner);
      }
      if (node.op === "*" && !hasVar(node.l, v)) {
        const inner = integrate(node.r, v);
        return inner && mul(node.l, inner);
      }
      if (node.op === "/" && !hasVar(node.r, v)) {
        const inner = integrate(node.l, v);
        return inner && div(inner, node.r);
      }
      if (node.op === "^" && !hasVar(node.r, v)) {
        // Substitution for a linear base: ∫(2x+3)² dx = (2x+3)³ / 6.
        const lin = linearIn(node.l, v);
        if (!lin) return null;
        const n = evaluate(node.r);
        if (Math.abs(n + 1) < 1e-12) {
          return div(fn("ln", { t: "fn", name: "abs", args: [node.l] }), num(lin.a));
        }
        return div(div(pow(node.l, num(n + 1)), num(n + 1)), num(lin.a));
      }
      return null;
    }
    case "fn": {
      if (node.args.length !== 1) return null;
      const u = node.args[0];
      if (!hasVar(u, v)) return mul(node, { t: "var", name: v });
      // Linear arguments only: sin(2x) substitutes cleanly, sin(x²) does not.
      const lin = linearIn(u, v);
      if (!lin) return null;
      const a = num(lin.a);
      switch (node.name) {
        case "sin": return div({ t: "neg", x: fn("cos", u) }, a);
        case "cos": return div(fn("sin", u), a);
        case "exp": return div(fn("exp", u), a);
        case "sqrt": return div(mul(num(2), pow(u, num(1.5))), mul(num(3), a));
        default: return null;
      }
    }
    case "fact": return null;
  }
}

export function definiteIntegral(f: (x: number) => number, a: number, b: number): number {
  const simpson = (lo: number, hi: number, fa: number, fm: number, fb: number, depth: number): number => {
    const m = (lo + hi) / 2;
    const lm = (lo + m) / 2;
    const rm = (m + hi) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const whole = ((hi - lo) / 6) * (fa + 4 * fm + fb);
    const left = ((m - lo) / 6) * (fa + 4 * flm + fm);
    const right = ((hi - m) / 6) * (fm + 4 * frm + fb);
    if (depth <= 0 || Math.abs(left + right - whole) < 1e-12 * Math.max(1, Math.abs(left + right))) {
      return left + right + (left + right - whole) / 15;
    }
    return simpson(lo, m, fa, flm, fm, depth - 1) + simpson(m, hi, fm, frm, fb, depth - 1);
  };
  const fa = f(a), fb = f(b), fm = f((a + b) / 2);
  if (![fa, fb, fm].every(Number.isFinite)) throw new Error("The function is undefined somewhere in the interval.");
  return simpson(a, b, fa, fm, fb, 40);
}

export function limitAt(f: (x: number) => number, at: number): number {
  // Direct substitution first — usually the answer, and exact when it is.
  try {
    const direct = f(at);
    if (Number.isFinite(direct)) return direct;
  } catch {
    // Undefined at the point (0/0, ln 0): fall through to sampling.
  }
  // Sample symmetrically at two widths and extrapolate. The widths are 1e-5
  // rather than 1e-12 on purpose: below about 1e-8 a difference like
  // cos(h) − 1 loses every significant digit to cancellation, so a limit
  // computed at a tiny h is less accurate, not more.
  const sample = (dir: -1 | 1, h: number) => {
    try {
      const val = f(at + dir * h);
      return Number.isFinite(val) ? val : NaN;
    } catch {
      return NaN;
    }
  };
  const h1 = 1e-5;
  const h2 = 5e-6;

  const l1 = sample(-1, h1), l2 = sample(-1, h2);
  const r1 = sample(1, h1), r2 = sample(1, h2);
  const bothSides = [l1, r1].every(Number.isFinite) && [l2, r2].every(Number.isFinite);

  if (bothSides) {
    const avg1 = (l1 + r1) / 2;
    const avg2 = (l2 + r2) / 2;
    // Richardson: the symmetric average has an O(h²) error, so this cancels it.
    const value = (4 * avg2 - avg1) / 3;
    if (Math.abs(l1 - r1) > 1e-3 * Math.max(1, Math.abs(avg1))) {
      throw new Error(
        `One-sided limits disagree (${fmt(l1)} from the left, ${fmt(r1)} from the right) — no two-sided limit.`,
      );
    }
    return value;
  }

  // One side only (domain boundary): extrapolate that side linearly.
  const oneSided = (v1: number, v2: number) => (Number.isFinite(v2) ? 2 * v2 - v1 : v1);
  const leftVal = Number.isFinite(l1) ? oneSided(l1, l2) : NaN;
  const rightVal = Number.isFinite(r1) ? oneSided(r1, r2) : NaN;
  if (!Number.isFinite(leftVal) && !Number.isFinite(rightVal)) {
    throw new Error("No finite limit found here.");
  }
  return Number.isFinite(leftVal) ? leftVal : rightVal;
}

// ---------------------------------------------------------------------------
// Polynomials and roots
// ---------------------------------------------------------------------------

/** Coefficients [c0, c1, c2, …] if the expression is a polynomial in `v`. */
export function polynomialCoefficients(node: MathNode, v = "x"): number[] | null {
  const add = (a: number[], b: number[], sign = 1) => {
    const out = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + sign * (b[i] ?? 0));
    return trim(out);
  };
  const convolve = (a: number[], b: number[]) => {
    const out = new Array<number>(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
    return trim(out);
  };
  const trim = (c: number[]) => {
    const out = [...c];
    while (out.length > 1 && Math.abs(out[out.length - 1]) < 1e-12) out.pop();
    return out;
  };

  const walk = (n: MathNode, depth: number): number[] | null => {
    if (depth > 12) return null;
    switch (n.t) {
      case "num": return [n.v];
      case "var": return n.name === v ? [0, 1] : [NaN];
      case "neg": {
        const c = walk(n.x, depth + 1);
        return c && c.map((x) => -x);
      }
      case "bin": {
        const l = walk(n.l, depth + 1);
        const r = walk(n.r, depth + 1);
        if (!l || !r) return null;
        if (n.op === "+") return add(l, r);
        if (n.op === "-") return add(l, r, -1);
        if (n.op === "*") {
          if (l.length === 1) return r.map((x) => x * l[0]);
          if (r.length === 1) return l.map((x) => x * r[0]);
          return convolve(l, r);
        }
        if (n.op === "/") {
          if (r.length !== 1 || r[0] === 0) return null;
          return l.map((x) => x / r[0]);
        }
        if (n.op === "^") {
          if (r.length !== 1 || !Number.isInteger(r[0]) || r[0] < 0 || r[0] > 8) return null;
          let acc = [1];
          for (let i = 0; i < r[0]; i++) acc = convolve(acc, l);
          return acc;
        }
        return null;
      }
      case "fn": return null;
      case "fact": return null;
    }
  };

  const coeffs = walk(node, 0);
  if (!coeffs || coeffs.some((c) => !Number.isFinite(c))) return null;
  return trim(coeffs);
}

export type Root = { re: number; im: number };

export function realRoots(coeffs: number[]): Root[] {
  const c = [...coeffs];
  while (c.length > 1 && Math.abs(c[c.length - 1]) < 1e-12) c.pop();
  const deg = c.length - 1;
  if (deg <= 0) return [];

  if (deg === 1) return [{ re: -c[0] / c[1], im: 0 }];

  if (deg === 2) {
    const [a0, a1, a2] = c;
    const disc = a1 * a1 - 4 * a2 * a0;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return [
        { re: (-a1 + s) / (2 * a2), im: 0 },
        { re: (-a1 - s) / (2 * a2), im: 0 },
      ].sort((p, q) => p.re - q.re);
    }
    const re = -a1 / (2 * a2);
    const im = Math.sqrt(-disc) / (2 * a2);
    return [
      { re, im: Math.abs(im) },
      { re, im: -Math.abs(im) },
    ];
  }

  // Degree ≥ 3: sign-change scan plus bisection polishing.
  const f = (x: number) => c.reduce((s, k, i) => s + k * Math.pow(x, i), 0);
  const roots: Root[] = [];
  const steps = 8000;
  const lo = -60, hi = 60;
  let prevX = lo;
  let prevY = f(lo);
  for (let i = 1; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps;
    const y = f(x);
    if (Math.abs(y) < 1e-9) {
      roots.push({ re: x, im: 0 });
    } else if (prevY * y < 0) {
      let a = prevX, b = x, fa = prevY;
      for (let k = 0; k < 80; k++) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
      }
      roots.push({ re: (a + b) / 2, im: 0 });
    }
    prevX = x;
    prevY = y;
  }
  const deduped: Root[] = [];
  for (const r of roots) {
    if (!deduped.some((d) => Math.abs(d.re - r.re) < 1e-6)) deduped.push(r);
  }
  return deduped.sort((p, q) => p.re - q.re);
}

/** Expand products of sums and small integer powers of sums. */
/** Render a coefficient list as cₙvⁿ + … + c₀, dropping zero terms. */
export function polynomialToSource(coeffs: number[], v = "x"): string {
  const terms: string[] = [];
  for (let i = coeffs.length - 1; i >= 0; i--) {
    const c = coeffs[i];
    if (Math.abs(c) < 1e-12) continue;
    const magnitude = fmt(Math.abs(c));
    const body = i === 0 ? magnitude : i === 1 ? (Math.abs(c) === 1 ? v : `${magnitude}${v}`) : Math.abs(c) === 1 ? `${v}^${i}` : `${magnitude}${v}^${i}`;
    if (terms.length === 0) terms.push(c < 0 ? `-${body}` : body);
    else terms.push(`${c < 0 ? "-" : "+"} ${body}`);
  }
  return terms.length === 0 ? "0" : terms.join(" ");
}

export function expand(node: MathNode): MathNode {
  const num = (x: number): MathNode => ({ t: "num", v: x });
  const walk = (n: MathNode): MathNode => {
    if (n.t === "neg") return { t: "neg", x: walk(n.x) };
    if (n.t === "fn") return { t: "fn", name: n.name, args: n.args.map(walk) };
    if (n.t !== "bin") return n;
    const l = walk(n.l);
    const r = walk(n.r);
    if (n.op === "*") {
      if (l.t === "bin" && (l.op === "+" || l.op === "-")) {
        return walk({ t: "bin", op: l.op, l: { t: "bin", op: "*", l: l.l, r }, r: { t: "bin", op: "*", l: l.r, r } });
      }
      if (r.t === "bin" && (r.op === "+" || r.op === "-")) {
        return walk({ t: "bin", op: r.op, l: { t: "bin", op: "*", l, r: r.l }, r: { t: "bin", op: "*", l, r: r.r } });
      }
      return { t: "bin", op: "*", l, r };
    }
    if (n.op === "^" && r.t === "num" && Number.isInteger(r.v) && r.v >= 2 && r.v <= 6) {
      if (l.t === "bin" && (l.op === "+" || l.op === "-")) {
        let acc: MathNode = l;
        for (let i = 1; i < r.v; i++) acc = { t: "bin", op: "*", l: acc, r: l };
        return walk(acc);
      }
      return { t: "bin", op: "^", l, r: num(r.v) };
    }
    return { t: "bin", op: n.op, l, r };
  };
  return simplify(walk(node));
}

// ---------------------------------------------------------------------------
// One entry point the UI can call
// ---------------------------------------------------------------------------

export type AlgebraMode = "evaluate" | "derivative" | "integral" | "limit" | "solve" | "expand";

export interface AlgebraRequest {
  input: string;
  mode: AlgebraMode;
  variable?: string;
  value?: number;
  from?: number;
  to?: number;
}

export interface AlgebraOutput {
  mode: AlgebraMode;
  /** The expression as parsed, normalised into readable form. */
  display: string;
  /** Primary answer, already formatted. */
  answer: string;
  /** Secondary lines: other roots, derivative, antiderivative, the value. */
  detail: { label: string; value: string }[];
  steps: string[];
}

const VAR_LIST = ["x", "y", "z", "t", "n", "a", "b", "u", "k"];

export function computeAlgebra(req: AlgebraRequest): AlgebraOutput {
  const v = req.variable?.trim() || "x";
  const vars = [...VAR_LIST, v];
  const steps: string[] = [];
  const detail: { label: string; value: string }[] = [];

  const equation = req.mode === "solve";
  const node = equation ? parseEquation(req.input, vars) : parse(req.input, vars);
  const display = toSource(simplify(node));

  if (req.mode === "solve") {
    const coeffs = polynomialCoefficients(node, v);
    if (!coeffs) throw new Error(`That is not a polynomial in ${v} — solve handles algebraic equations, e.g. 3${v}^2 - 2${v} + 1 = 0.`);
    const roots = realRoots(coeffs);
    steps.push(`Moved everything to one side: ${display} = 0`);
    steps.push(`Collected: ${polynomialToSource(coeffs, v)} = 0`);
    if (roots.length === 0) {
      return { mode: req.mode, display, answer: "No real solutions", detail, steps };
    }
    steps.push(`Degree ${coeffs.length - 1} → ${roots.length} real root${roots.length === 1 ? "" : "s"}.`);
    const real = roots.filter((r) => Math.abs(r.im) < 1e-9);
    const complex = roots.filter((r) => Math.abs(r.im) >= 1e-9);
    const lines = [...real.map((r) => `${v} = ${fmt(r.re)}`), ...complex.map((r) => `${v} = ${fmt(r.re)} ± ${fmt(Math.abs(r.im))}i`)];
    return {
      mode: req.mode,
      display,
      answer: lines[0] ?? "No real solutions",
      detail,
      steps: [...steps, ...lines.slice(1).map((l, i) => `Root ${i + 2}: ${l}`)],
    };
  }

  if (req.mode === "derivative") {
    const symbolic = differentiate(node, v);
    if (symbolic) {
      const simplified = simplify(symbolic);
      detail.push({ label: "Unsimplified", value: toSource(symbolic) });
      if (req.value !== undefined) {
        detail.push({ label: `f′(${fmt(req.value)})`, value: fmt(evaluate(simplified, { [v]: req.value })) });
      }
      steps.push(`Differentiated term by term with the sum, product, quotient and chain rules.`);
      return { mode: req.mode, display, answer: `d/d${v} ${display} = ${toSource(simplified)}`, detail, steps };
    }
    // No rule matched: fall back to a numeric derivative.
    const f = (x: number) => evaluate(node, { [v]: x });
    const at = req.value ?? 0;
    const d = numericDerivative(f, at);
    steps.push("No closed form in the rule table — differentiated numerically.");
    return { mode: req.mode, display, answer: `d/d${v} ≈ ${fmt(d)} at ${v} = ${fmt(at)}`, detail, steps };
  }

  if (req.mode === "integral") {
    const f = (x: number) => evaluate(node, { [v]: x });
    if (req.from !== undefined && req.to !== undefined) {
      const value = definiteIntegral(f, req.from, req.to);
      steps.push(`Adaptive Simpson over [${fmt(req.from)}, ${fmt(req.to)}].`);
      const anti = integrate(node, v);
      if (anti) {
        detail.push({ label: "Antiderivative", value: `${toSource(simplify(anti))} + C` });
        detail.push({ label: "By F(b) − F(a)", value: fmt(evaluate(anti, { [v]: req.to }) - evaluate(anti, { [v]: req.from })) });
      }
      return {
        mode: req.mode,
        display,
        answer: `∫ from ${fmt(req.from)} to ${fmt(req.to)} ≈ ${fmt(value)}`,
        detail,
        steps,
      };
    }
    const anti = integrate(node, v);
    if (!anti) throw new Error("No antiderivative in the rule table — add bounds to integrate numerically.");
    steps.push("Applied the power rule, linearity and the standard forms.");
    return { mode: req.mode, display, answer: `∫ ${display} d${v} = ${toSource(simplify(anti))} + C`, detail, steps };
  }

  if (req.mode === "limit") {
    const at = req.value ?? 0;
    // 0/0 and ∞/∞ are the cases sampling handles worst, so peel them off with
    // l'Hôpital first — the derivative table already exists, and this turns
    // (cos x − 1)/x² from −0.50000004 into exactly −1/2.
    let subject = node;
    for (let pass = 0; pass < 3; pass++) {
      if (subject.t !== "bin" || subject.op !== "/") break;
      const at0 = (n: MathNode) => {
        try { return evaluate(n, { [v]: at }); } catch { return NaN; }
      };
      const top = at0(subject.l);
      const bottom = at0(subject.r);
      const indeterminate =
        !Number.isFinite(top) || !Number.isFinite(bottom) ||
        (Math.abs(top) < 1e-12 && Math.abs(bottom) < 1e-12);
      if (!indeterminate) break;
      const dt = differentiate(subject.l, v);
      const db = differentiate(subject.r, v);
      if (!dt || !db) break;
      subject = simplify({ t: "bin", op: "/", l: dt, r: db });
      steps.push(`0/0 at ${v} = ${fmt(at)} → l'Hôpital: ${toSource(subject)}`);
    }
    const f = (x: number) => evaluate(subject, { [v]: x });
    const value = limitAt(f, at);
    if (steps.length === 0) steps.push(`Approached ${v} = ${fmt(at)} from both sides.`);
    return { mode: req.mode, display, answer: `limit as ${v} → ${fmt(at)} = ${fmt(value)}`, detail, steps };
  }

  if (req.mode === "expand") {
    const expanded = expand(node);
    const coeffs = polynomialCoefficients(expanded, v);
    steps.push("Distributed products over sums, then collected like terms.");
    if (coeffs) {
      // A polynomial reads far better collected: x^2 - 1, not x·x - x + x - 1.
      detail.push({ label: "Degree", value: String(coeffs.length - 1) });
      detail.push({ label: "Factored form of the original", value: display });
      return { mode: req.mode, display, answer: polynomialToSource(coeffs, v), detail, steps };
    }
    return { mode: req.mode, display, answer: toSource(expanded), detail, steps };
  }

  // evaluate
  const used = variablesIn(node);
  if (used.length > 1) {
    throw new Error(`That expression uses ${used.join(", ")} — Evaluate takes one variable (${v}).`);
  }
  const assigned: Record<string, number> = {};
  if (used.length === 1) {
    if (req.value === undefined) {
      throw new Error(`Give ${used[0]} a value, or switch to Expand / Solve.`);
    }
    assigned[used[0]] = req.value;
  }
  const value = evaluate(node, assigned);
  steps.push(used.length === 1 ? `${display} with ${used[0]} = ${fmt(req.value!)}.` : `${display}.`);
  return { mode: req.mode, display, answer: fmt(value), detail, steps };
}

export const OPERATOR_HINTS: { label: string; insert: string; title: string }[] = [
  { label: "+", insert: "+", title: "Add" },
  { label: "−", insert: "-", title: "Subtract" },
  { label: "×", insert: "*", title: "Multiply" },
  { label: "÷", insert: "/", title: "Divide" },
  { label: "^", insert: "^", title: "Power" },
  { label: "%", insert: "%", title: "Modulo" },
  { label: "!", insert: "!", title: "Factorial" },
  { label: "√", insert: "sqrt(", title: "Square root" },
  { label: "π", insert: "pi", title: "Pi" },
  { label: "e", insert: "e", title: "Euler's number" },
  { label: "sin", insert: "sin(", title: "Sine" },
  { label: "cos", insert: "cos(", title: "Cosine" },
  { label: "tan", insert: "tan(", title: "Tangent" },
  { label: "ln", insert: "ln(", title: "Natural log" },
  { label: "log", insert: "log(", title: "Log base 10" },
  { label: "abs", insert: "abs(", title: "Absolute value" },
  { label: "exp", insert: "exp(", title: "e to the power" },
  { label: "C(n,r)", insert: "ncr(", title: "Combinations" },
  { label: "P(n,r)", insert: "npr(", title: "Permutations" },
  { label: "gcd", insert: "gcd(", title: "Greatest common divisor" },
  { label: "( )", insert: "()", title: "Parentheses" },
];
