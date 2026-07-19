import type { BareValue, Expr, Scalar } from "./ast.js";
import type { Lattice } from "./lattice.js";

/**
 * The model configuration — the TS analog of §3.3's PModel<L> structure,
 * minus the `weight` field (that's a probability-mass function used only
 * by the *proof*; the executable interpreter doesn't need it — see peval
 * in §6, which is exactly what we're porting).
 *
 * `parse`/`serialise` cross the boundary between the calculus's Expr AST
 * and the plain strings sent to/received from the LLM. `primEval` is the
 * open primitive table (§B.1) — arithmetic, string ops, shape/toStr, etc.
 */
export interface Model<L> {
  readonly lattice: Lattice<L>;
  /** Turn an LLM response string into an Expr to be evaluated. */
  parse(response: string): Expr;
  /** Turn a bare value into the string sent to the LLM. */
  serialise(value: BareValue): string;
  /** The open primitive table — §B.1's M.primEval. */
  primEval(name: string, arg: BareValue): BareValue;
  /** Decode a label from a bare value (§3.2/§3.3's M.toLabel). */
  toLabel(value: BareValue): L | undefined;
  /** Encode a label as a bare value (inverse of toLabel, for endorse targets etc). */
  fromLabel(label: L): BareValue;
  /** Bindings available to every recv'd program (§3.3's M.preludeEnv). */
  preludeSource?: ReadonlyMap<string, Expr>;
}

// -------------------- default JSON-ish parse/serialise --------------------
// A pragmatic starting point (§7.3 flags the lack of a stricter,
// grammar-constrained parser as future work — same caveat applies here).

export function defaultSerialise(value: BareValue): string {
  return JSON.stringify(toPlainJson(value));
}

function toPlainJson(value: BareValue): unknown {
  switch (value.kind) {
    case "null":
      return null;
    case "bool":
      return value.value;
    case "number":
      return value.value;
    case "string":
      return value.value;
    case "closure":
      return "<function>";
    case "record": {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of value.fields) obj[k] = toPlainJson(v.value);
      return obj;
    }
    case "array":
      return value.items.map((v) => toPlainJson(v.value));
  }
}

/**
 * The paper's `parse` turns a raw response into `[true, ok] | [false, error]`
 * (§2.1). We keep that convention: a parsed response is always wrapped as
 * a two-element array so agent code can branch on `.  [0]`.
 */
export function defaultParse(response: string): Expr {
  try {
    const json = JSON.parse(response);
    return { kind: "array", items: [{ kind: "scalar", value: { kind: "bool", value: true } }, jsonToExpr(json)] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      kind: "array",
      items: [
        { kind: "scalar", value: { kind: "bool", value: false } },
        { kind: "scalar", value: { kind: "string", value: message } },
      ],
    };
  }
}

function jsonToExpr(json: unknown): Expr {
  if (json === null) return { kind: "scalar", value: { kind: "null" } };
  if (typeof json === "boolean") return { kind: "scalar", value: { kind: "bool", value: json } };
  if (typeof json === "number") return { kind: "scalar", value: { kind: "number", value: json } };
  if (typeof json === "string") return { kind: "scalar", value: { kind: "string", value: json } };
  if (Array.isArray(json)) return { kind: "array", items: json.map(jsonToExpr) };
  if (typeof json === "object") {
    return {
      kind: "record",
      fields: Object.entries(json as Record<string, unknown>).map(
        ([k, v]) => [k, jsonToExpr(v)] as const,
      ),
    };
  }
  throw new Error(`jsonToExpr: unsupported JSON value ${String(json)}`);
}

// -------------------- default primitive table (§B.1) --------------------

function asScalar(v: BareValue): Scalar {
  if (
    v.kind === "null" ||
    v.kind === "bool" ||
    v.kind === "number" ||
    v.kind === "string"
  ) {
    return v;
  }
  throw new Error(`primEval: expected scalar, got ${v.kind}`);
}

export function defaultPrimEval(name: string, arg: BareValue): BareValue {
  switch (name) {
    case "toStr":
      return { kind: "string", value: toStrOf(arg) };
    case "shape":
      return shapeOf(arg);
    case "recordUpdate": {
      if (arg.kind !== "array" || arg.items.length !== 3) {
        throw new Error("primEval recordUpdate: expected [record, field, value]");
      }
      const [recV, fieldV, valV] = arg.items;
      if (recV!.value.kind !== "record") throw new Error("recordUpdate: not a record");
      const fieldName = asScalar(fieldV!.value);
      if (fieldName.kind !== "string") throw new Error("recordUpdate: field name must be a string");
      const fields = new Map(recV!.value.fields);
      fields.set(fieldName.value, valV!);
      return { kind: "record", fields };
    }
    default: {
      if (name.startsWith("binop_")) return binopEval(name.slice("binop_".length), arg);
      throw new Error(`primEval: unknown primitive "${name}"`);
    }
  }
}

function toStrOf(v: BareValue): string {
  switch (v.kind) {
    case "null":
      return "null";
    case "bool":
      return v.value ? "true" : "false";
    case "number":
      return String(v.value);
    case "string":
      return v.value;
    default:
      return "";
  }
}

function shapeOf(v: BareValue): BareValue {
  const rec = (fields: Array<readonly [string, BareValue]>): BareValue => ({
    kind: "record",
    fields: new Map(fields.map(([k, val]) => [k, { label: undefined, value: val }])),
  });
  switch (v.kind) {
    case "number":
      return rec([
        ["type", { kind: "string", value: "number" }],
        ["sign", { kind: "string", value: v.value < 0 ? "negative" : v.value > 0 ? "positive" : "zero" }],
      ]);
    case "string":
      return rec([
        ["type", { kind: "string", value: "string" }],
        ["length", { kind: "number", value: v.value.length }],
      ]);
    case "array":
      return rec([
        ["type", { kind: "string", value: "array" }],
        ["length", { kind: "number", value: v.items.length }],
      ]);
    case "record":
      return rec([
        ["type", { kind: "string", value: "record" }],
        [
          "fields",
          { kind: "array", items: [...v.fields.keys()].map((k) => ({ label: undefined, value: { kind: "string", value: k } as BareValue })) },
        ],
      ]);
    case "closure":
      return rec([["type", { kind: "string", value: "function" }]]);
    case "bool":
      return rec([["type", { kind: "string", value: "boolean" }]]);
    case "null":
      return rec([["type", { kind: "string", value: "null" }]]);
  }
}

function binopEval(op: string, arg: BareValue): BareValue {
  if (arg.kind !== "array" || arg.items.length !== 2) {
    throw new Error(`primEval binop_${op}: expected a 2-element array argument`);
  }
  const a = arg.items[0]!.value;
  const b = arg.items[1]!.value;
  switch (op) {
    case "add":
      if (a.kind === "number" && b.kind === "number") return { kind: "number", value: a.value + b.value };
      if (a.kind === "string" && b.kind === "string") return { kind: "string", value: a.value + b.value };
      if (a.kind === "array" && b.kind === "array") return { kind: "array", items: [...a.items, ...b.items] };
      throw new Error("binop_add: unsupported operand types");
    case "sub":
      return { kind: "number", value: numOf(a) - numOf(b) };
    case "mul":
      return { kind: "number", value: numOf(a) * numOf(b) };
    case "div":
      return { kind: "number", value: numOf(a) / numOf(b) };
    case "mod":
      return { kind: "number", value: numOf(a) % numOf(b) };
    case "lt":
      return { kind: "bool", value: numOf(a) < numOf(b) };
    case "gt":
      return { kind: "bool", value: numOf(a) > numOf(b) };
    case "le":
      return { kind: "bool", value: numOf(a) <= numOf(b) };
    case "ge":
      return { kind: "bool", value: numOf(a) >= numOf(b) };
    case "eq":
      return { kind: "bool", value: scalarEq(a, b) };
    case "neq":
      return { kind: "bool", value: !scalarEq(a, b) };
    default:
      throw new Error(`binop_${op}: unknown operator`);
  }
}
function numOf(v: BareValue): number {
  if (v.kind !== "number") throw new Error(`expected number, got ${v.kind}`);
  return v.value;
}
function scalarEq(a: BareValue, b: BareValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "number" && b.kind === "number") return a.value === b.value;
  if (a.kind === "string" && b.kind === "string") return a.value === b.value;
  if (a.kind === "bool" && b.kind === "bool") return a.value === b.value;
  if (a.kind === "null" && b.kind === "null") return true;
  throw new Error("binop_eq: unsupported operand types (only scalars are comparable)");
}
