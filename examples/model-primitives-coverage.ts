/**
 * Coverage: several small, independent gaps in `model.ts`'s default
 * implementations that no other example happens to exercise —
 * `shapeOf` for kinds other than number/string, the arithmetic/
 * comparison `binopEval` cases beyond add/lt/eq, `toPlainJson`'s bare
 * scalar/array serialisation (every other example only ever sends a
 * string or a record), and `toStrOf`'s bool/number/string cases.
 */
import { array, binop, bool, letIn, nullLit, num, prim, record, send, str, v } from "../src/ast.js";
import { usLattice } from "../src/lattice.js";
import { emptyConversation, evaluate, newRunState } from "../src/evaluator.js";
import { defaultParse, defaultPrimEval, defaultSerialise, type Model } from "../src/model.js";
import { scriptedOracle } from "../src/oracle.js";
import { RuntimeError } from "../src/errors.js";
import type { Expr } from "../src/ast.js";

const model: Model<typeof usLattice.bottom> = {
  lattice: usLattice,
  parse: defaultParse,
  serialise: defaultSerialise,
  primEval: defaultPrimEval,
  toLabel: () => undefined,
  fromLabel: () => ({ kind: "record", fields: new Map() }),
};

async function run(name: string, program: Expr, check: (bv: unknown) => boolean) {
  const runState = newRunState();
  const result = await evaluate(model, scriptedOracle([]), runState, usLattice.bottom, emptyConversation(usLattice.bottom), program, new Map());
  const ok = check(result.value.value);
  console.log(ok ? "PASS" : "FAIL", `${name}:`, JSON.stringify(result.value.value));
  if (!ok) process.exit(1);
}

async function shapeOfAllKinds() {
  await run("shape(number)", prim("shape", num(1)), (bv: any) => bv.kind === "record");
  await run("shape(array)", prim("shape", array([num(1), num(2)])), (bv: any) => bv.kind === "record");
  await run("shape(record)", prim("shape", record([["a", num(1)]])), (bv: any) => bv.kind === "record");
  await run("shape(closure)", prim("shape", { kind: "lam", param: "x", body: v("x") }), (bv: any) => bv.kind === "record");
  await run("shape(bool)", prim("shape", bool(true)), (bv: any) => bv.kind === "record");
  await run("shape(null)", prim("shape", nullLit), (bv: any) => bv.kind === "record");
}

async function arithmeticOps() {
  await run("7 < 3", binop("<", num(7), num(3)), (bv: any) => bv.kind === "bool" && bv.value === false);
  await run("7 - 3", binop("-", num(7), num(3)), (bv: any) => bv.kind === "number" && bv.value === 4);
  await run("7 * 3", binop("*", num(7), num(3)), (bv: any) => bv.kind === "number" && bv.value === 21);
  await run("7 / 2", binop("/", num(7), num(2)), (bv: any) => bv.kind === "number" && bv.value === 3.5);
  await run("7 > 3", binop(">", num(7), num(3)), (bv: any) => bv.kind === "bool" && bv.value === true);
  await run("7 <= 3", binop("<=", num(7), num(3)), (bv: any) => bv.kind === "bool" && bv.value === false);
  await run("7 >= 7", binop(">=", num(7), num(7)), (bv: any) => bv.kind === "bool" && bv.value === true);
  // scalarEq: different kinds are unequal without reaching the "unsupported
  // operand types" throw; null equals null.
  await run("1 == '1' (different kinds)", binop("==", num(1), str("1")), (bv: any) => bv.kind === "bool" && bv.value === false);
  await run("null == null", binop("==", nullLit, nullLit), (bv: any) => bv.kind === "bool" && bv.value === true);
  // toStr(false) -- the falsy branch of toStrOf's ternary.
  await run("toStr(false)", prim("toStr", bool(false)), (bv: any) => bv.kind === "string" && bv.value === "false");
  // shapeOf's number "sign" ternary: negative and zero, not just positive.
  await run("shape(-1).sign", prim("shape", num(-1)), (bv: any) => bv.kind === "record");
  await run("shape(0).sign", prim("shape", num(0)), (bv: any) => bv.kind === "record");
}

async function directJsonParsing() {
  // jsonToExpr's own branches (null/number/string/array/object at the TOP
  // level of a parsed response) -- every example so far only ever parses
  // a string or object response, never a bare null/number/array response.
  const cases: Array<[string, string]> = [
    ["null", "null"],
    ["number", "42"],
    ["array", "[1,2,3]"],
  ];
  for (const [name, json] of cases) {
    const expr = defaultParse(json);
    const ok = expr.kind === "array" && expr.items.length === 2 && expr.items[0]!.value.kind === "bool" && (expr.items[0]!.value as any).value === true;
    console.log(ok ? "PASS" : "FAIL", `defaultParse top-level ${name}:`, JSON.stringify(expr));
    if (!ok) process.exit(1);
  }
}

async function serialiseBareScalarsAndArrays() {
  // Every other example only ever `send`s a string or a record -- send a
  // bare number, boolean, null, and array directly to exercise
  // toPlainJson's other cases.
  const runState = newRunState();
  const program = letIn(
    "_1", send(num(42)),
    letIn("_2", send(bool(true)),
      letIn("_3", send(nullLit),
        send(array([num(1), str("two")])))),
  );
  const result = await evaluate(model, scriptedOracle([]), runState, usLattice.bottom, emptyConversation(usLattice.bottom), program, new Map());
  const ok = JSON.stringify(result.conv.history) === JSON.stringify(["42", "true", "null", '[1,"two"]']);
  console.log(ok ? "PASS" : "FAIL", "bare scalar/array send serialises correctly:", JSON.stringify(result.conv.history));
  if (!ok) process.exit(1);
}

async function toStrCases() {
  await run("toStr(true)", prim("toStr", bool(true)), (bv: any) => bv.kind === "string" && bv.value === "true");
  await run("toStr(42)", prim("toStr", num(42)), (bv: any) => bv.kind === "string" && bv.value === "42");
  await run("toStr('hi')", prim("toStr", str("hi")), (bv: any) => bv.kind === "string" && bv.value === "hi");
  await run("toStr(null)", prim("toStr", nullLit), (bv: any) => bv.kind === "string" && bv.value === "null");
  // Non-scalars (records, arrays, closures) collapse to the empty string
  // (toStrOf's default case) rather than throwing.
  await run("toStr(record)", prim("toStr", record([["a", num(1)]])), (bv: any) => bv.kind === "string" && bv.value === "");
}

async function primEvalErrorPaths() {
  const run_ = newRunState();
  const cases: Array<[string, Expr, string]> = [
    ["recordUpdate with the wrong argument shape", prim("recordUpdate", array([num(1), str("field")])), "expected [record, field, value]"],
    ["recordUpdate on a non-record", prim("recordUpdate", array([num(1), str("field"), num(2)])), "recordUpdate: not a record"],
    ["recordUpdate with a non-scalar field name", prim("recordUpdate", array([record([]), array([]), num(2)])), "primEval: expected scalar"],
    ["recordUpdate with a non-string field name", prim("recordUpdate", array([record([]), num(1), num(2)])), "field name must be a string"],
    ["an unknown primitive name", prim("totallyMadeUp", num(1)), 'unknown primitive "totallyMadeUp"'],
    // Bypass the `binop` AST node (which always builds a proper 2-element
    // array) to exercise binopEval's own argument-shape guard directly.
    ["binop_add called with a malformed argument", prim("binop_add", num(1)), "expected a 2-element array argument"],
    ["binop_add on unsupported operand types", prim("binop_add", array([bool(true), bool(false)])), "unsupported operand types"],
    ["an unknown binop_* operator", prim("binop_frobnicate", array([num(1), num(2)])), "unknown operator"],
    ["arithmetic on a non-number operand", prim("binop_sub", array([str("x"), num(1)])), "expected number, got string"],
  ];
  for (const [name, program, messageContains] of cases) {
    try {
      await evaluate(model, scriptedOracle([]), run_, usLattice.bottom, emptyConversation(usLattice.bottom), program, new Map());
      console.error(`FAIL: ${name} — expected a RuntimeError but the program completed`);
      process.exit(1);
    } catch (e) {
      const ok = e instanceof RuntimeError && e.message.includes(messageContains);
      console.log(ok ? "PASS" : "FAIL", `${name}:`, e instanceof Error ? e.message : e);
      if (!ok) process.exit(1);
    }
  }
}

async function main() {
  await shapeOfAllKinds();
  await arithmeticOps();
  await directJsonParsing();
  await serialiseBareScalarsAndArrays();
  await toStrCases();
  await primEvalErrorPaths();
}

main();
