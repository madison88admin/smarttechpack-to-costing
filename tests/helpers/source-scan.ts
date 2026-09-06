// Shared source-scanning helpers for the source-level CI guards.
//
// All three operate on raw TypeScript text and are comment- and string-aware:
// comments are blanked (line numbers preserved) and positions inside string /
// template literals are marked so scanners never match code that lives in a
// comment or a string.

// Blanks comments (preserving newlines) and marks positions inside string and
// template literals.
export function sanitize(text: string): { code: string; inString: boolean[] } {
  const n = text.length;
  const out: string[] = new Array(n);
  const inString = new Array(n).fill(false);
  let i = 0;
  type State = "code" | "dq" | "sq" | "tpl" | "line" | "block";
  let state: State = "code";
  let interp = 0; // ${...} depth inside a template literal
  while (i < n) {
    const ch = text[i];
    const nx = text[i + 1];
    if (state === "line") {
      out[i] = ch === "\n" ? "\n" : " ";
      i++;
      if (ch === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      if (ch === "*" && nx === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        state = "code";
      } else {
        out[i] = " ";
        i++;
      }
      continue;
    }
    if (state === "dq" || state === "sq") {
      out[i] = ch;
      inString[i] = true;
      if (ch === "\\") {
        if (i + 1 < n) {
          out[i + 1] = text[i + 1];
          inString[i + 1] = true;
        }
        i += 2;
        continue;
      }
      if ((state === "dq" && ch === '"') || (state === "sq" && ch === "'")) state = "code";
      i++;
      continue;
    }
    if (state === "tpl") {
      out[i] = ch;
      inString[i] = true;
      if (ch === "\\") {
        if (i + 1 < n) {
          out[i + 1] = text[i + 1];
          inString[i + 1] = true;
        }
        i += 2;
        continue;
      }
      if (ch === "$" && nx === "{") {
        interp++;
        out[i + 1] = "{";
        inString[i + 1] = true;
        i += 2;
        continue;
      }
      if (ch === "}" && interp > 0) {
        interp--;
        i++;
        continue;
      }
      if (ch === "`" && interp === 0) state = "code";
      i++;
      continue;
    }
    // code state
    if (ch === '"') {
      state = "dq";
      out[i] = ch;
      inString[i] = true;
      i++;
    } else if (ch === "'") {
      state = "sq";
      out[i] = ch;
      inString[i] = true;
      i++;
    } else if (ch === "`") {
      state = "tpl";
      out[i] = ch;
      inString[i] = true;
      i++;
    } else if (ch === "/" && nx === "/") {
      state = "line";
      i += 2;
    } else if (ch === "/" && nx === "*") {
      state = "block";
      i += 2;
    } else {
      out[i] = ch;
      i++;
    }
  }
  return { code: out.join(""), inString };
}

// Extracts the argument list of a call whose opening paren sits at `open`.
// Handles nested (), [], {}, strings, and template interpolations.
export function extractArgs(code: string, open: number): string {
  let depth = 0;
  let i = open;
  type State = "code" | "dq" | "sq" | "tpl";
  let state: State = "code";
  let interp = 0;
  for (; i < code.length; i++) {
    const ch = code[i];
    const nx = code[i + 1];
    if (state === "dq" || state === "sq") {
      if (ch === "\\") {
        i++;
        continue;
      }
      if ((state === "dq" && ch === '"') || (state === "sq" && ch === "'")) state = "code";
      continue;
    }
    if (state === "tpl") {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "$" && nx === "{") {
        interp++;
        i++;
        continue;
      }
      if (ch === "}" && interp > 0) {
        interp--;
        continue;
      }
      if (ch === "`" && interp === 0) state = "code";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      state = ch as State;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return code.slice(open + 1);
}

// Splits on `sep` at nesting depth zero, respecting strings and templates.
export function splitTopLevel(value: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  type State = "code" | "dq" | "sq" | "tpl";
  let state: State = "code";
  let interp = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const nx = value[i + 1];
    if (state === "dq" || state === "sq") {
      cur += ch;
      if (ch === "\\") {
        cur += value[i + 1] ?? "";
        i++;
      } else if ((state === "dq" && ch === '"') || (state === "sq" && ch === "'")) state = "code";
      continue;
    }
    if (state === "tpl") {
      cur += ch;
      if (ch === "\\") {
        cur += value[i + 1] ?? "";
        i++;
      } else if (ch === "$" && nx === "{") {
        interp++;
        cur += "{";
        i++;
      } else if (ch === "}" && interp > 0) {
        interp--;
      } else if (ch === "`" && interp === 0) state = "code";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      state = ch as State;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// Finds the string-literal elements of an array literal expression.
export function arrayElements(arrayExpr: string): string[] {
  const elements: string[] = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arrayExpr)) !== null) {
    elements.push((m[1] ?? m[2] ?? "").replace(/\\(['"\\])/g, "$1"));
  }
  return elements;
}

export type ConstArrayDecl = {
  name: string;
  /** Full text between `const NAME` and the closing `;` (or end of statement). */
  declaration: string;
  /** Type annotation between the name and `=`, without the type name being required. */
  typeAnnotation: string;
  /** The array literal expression (everything between the brackets). */
  arrayExpr: string;
  elements: string[];
  line: number;
};

// Finds module-level (top-of-file / block-depth-zero) `const NAME = [...]`
// string-array declarations. Function-local and nested-block arrays are
// skipped — vocabulary duplication lives at module scope.
export function findModuleConstArrays(code: string, inString: boolean[]): ConstArrayDecl[] {
  const out: ConstArrayDecl[] = [];
  // depth at each position (braces only, outside strings/comments)
  const depthAt = new Int32Array(code.length);
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    depthAt[i] = depth;
    if (inString[i]) continue;
    const ch = code[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
  }

  const declRe = /\bconst\s+([A-Za-z_$][\w$]*)(\s*:\s*([^{};=]+?))?\s*=\s*(\[)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(code)) !== null) {
    if (inString[m.index]) continue;
    if (depthAt[m.index] !== 0) continue; // function-local / nested-block arrays are not vocabulary declarations
    const open = m.index + m[0].length - 1;
    const name = m[1];
    const typeAnnotation = (m[3] ?? "").trim();
    const arrayExpr = extractArgs(code, open);
    const elements = arrayElements(arrayExpr);
    if (elements.length === 0) continue;
    out.push({
      name,
      declaration: code.slice(m.index, open + arrayExpr.length + 2),
      typeAnnotation,
      arrayExpr,
      elements,
      line: code.slice(0, m.index).split("\n").length
    });
  }
  return out;
}