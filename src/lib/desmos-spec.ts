// ---------------------------------------------------------------------------
// Desmos ```desmos block parsing — pure, no React.
//
// ```desmos
// mode: graphing | 3d | scientific | geometry   (default: graphing)
// zoom: <number>                                (optional)
// expressions:
// y = x^2
// y = 2x + 1
// ```
// ---------------------------------------------------------------------------

export interface DesmosSpec {
  mode: "graphing" | "3d" | "scientific" | "geometry" | "fourfunction";
  zoom?: number;
  expressions: string[];
}

export function parseDesmosSpec(source: string): DesmosSpec {
  const lines = source.trim().split("\n");
  const spec: DesmosSpec = { mode: "graphing", expressions: [] };

  let inExpressions = false;
  const looksLikeExpr = (s: string) =>
    /^[a-zA-Z0-9_()\\^{}[\]=+\-*/.,\s|<>]+$/.test(s) && /[=,(]|\b(x|y|z|t|sin|cos|tan|ln|log|sqrt|pi|e)\b/.test(s);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!inExpressions) {
      // Accept `four-function`, `four function`, `FourFunction` etc. for the
      // basic calculator mode.
      const modeMatch = /^mode\s*:\s*([a-z0-9\-_ ]+)$/i.exec(line);
      if (modeMatch) {
        const m = modeMatch[1].toLowerCase().replace(/[\s_-]+/g, "");
        if (m === "graphing" || m === "3d" || m === "scientific" || m === "geometry" || m === "fourfunction") {
          spec.mode = m;
          continue;
        }
      }
      const zoomMatch = /^zoom\s*:\s*(\d+(?:\.\d+)?)\s*$/i.exec(line);
      if (zoomMatch) {
        spec.zoom = parseFloat(zoomMatch[1]);
        continue;
      }
      if (/^expressions\s*:\s*$/i.test(line)) {
        inExpressions = true;
        continue;
      }
      // Tolerant: an unprefixed line that looks like an expression counts too.
      if (looksLikeExpr(line)) {
        spec.expressions.push(line);
      }
    } else {
      // Only genuine expressions — a stray prose line (any language) must be
      // skipped, never fed to Desmos.
      if (looksLikeExpr(line)) spec.expressions.push(line);
    }
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Desmos input → LaTeX, so the plotted functions render as real math.
// ---------------------------------------------------------------------------

const FUNCTION_NAME_RE =
  /\b(sin|cos|tan|sec|csc|cot|arcsin|arccos|arctan|sinh|cosh|tanh|ln|log|exp)\b(?=\s*\()/g;

/** Replace `word(...)` with replacement(matching-inner-content), balancing parens. */
function replaceBalanced(input: string, word: string, build: (arg: string) => string): string {
  const re = new RegExp(`\\b${word}\\s*\\(`, "g");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    out += input.slice(last, m.index);
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < input.length && depth > 0) {
      if (input[i] === "(") depth++;
      else if (input[i] === ")") depth--;
      if (depth > 0) i++;
    }
    out += build(input.slice(m.index + m[0].length, i));
    last = i + 1; // skip the closing paren
  }
  out += input.slice(last);
  return out;
}

/** `^` / `_` followed by one token → braced group: `x^2` → `x^{2}`, `x^(n+1)` → `x^{n+1}`. */
function braceScripts(tex: string): string {
  let out = "";
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "^" || ch === "_") {
      out += ch;
      i++;
      if (tex[i] === "(") {
        let depth = 1;
        let j = i + 1;
        while (j < tex.length && depth > 0) {
          if (tex[j] === "(") depth++;
          else if (tex[j] === ")") depth--;
          if (depth > 0) j++;
        }
        out += `{${tex.slice(i + 1, j)}}`;
        i = j;
      } else if (tex[i] === "{") {
        let depth = 1;
        let j = i + 1;
        while (j < tex.length && depth > 0) {
          if (tex[j] === "{") depth++;
          else if (tex[j] === "}") depth--;
          if (depth > 0) j++;
        }
        out += tex.slice(i, j + 1);
        i = j;
      } else if (i < tex.length) {
        out += `{${tex[i]}}`;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Plain Desmos input (e.g. `y = x^2`) → LaTeX (e.g. `y = x^{2}`) so the
 * function list renders through KaTeX. If the string already contains LaTeX
 * commands (Desmos-canonical expressions), it is used as-is.
 */
export function expressionToTex(src: string): string {
  const trimmed = src.trim();
  if (/\\[a-zA-Z]+/.test(trimmed)) return trimmed;
  let tex = trimmed;
  tex = replaceBalanced(tex, "sqrt", (a) => `\\sqrt{${a}}`);
  // Pipes first — then abs() produces the same form without re-triggering it.
  tex = tex.replace(/\|([^|]+)\|/g, "\\left|$1\\right|");
  tex = replaceBalanced(tex, "abs", (a) => `\\left|${a}\\right|`);
  tex = tex.replace(FUNCTION_NAME_RE, "\\$1");
  tex = tex.replace(/<=/g, "\\le").replace(/>=/g, "\\ge");
  tex = braceScripts(tex);
  tex = tex.replace(/\(/g, "\\left(").replace(/\)/g, "\\right)");
  tex = tex.replace(/\*/g, "\\cdot ");
  return tex;
}