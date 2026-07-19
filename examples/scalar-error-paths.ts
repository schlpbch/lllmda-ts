/**
 * Coverage: the "obviously ill-typed program" error paths that every
 * example so far has sidestepped by construction — `app` on a
 * non-closure, `field`/`index` on the wrong container kind or with a
 * malformed accessor, `if` on a non-boolean condition, and
 * `labelDyn`/`labelTest`/`labelAssert`/`endorse` given a label-position
 * value their model's `toLabel` can't decode. Each of these is a clean,
 * expected `RuntimeError` (not a crash, not a security refusal) that
 * this repo's own examples never happened to trigger — every other
 * example's `toLabel` is written to successfully decode whatever label
 * literal that example actually uses.
 */
import { array, endorse, field, ifThenElse, index, labelAssert, labelDyn, labelTest, num, record, str } from "../src/ast.js";
import { usFactoredLattice, usLattice } from "../src/lattice.js";
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

// A FactoredLattice model whose toLabel also always fails to decode --
// needed for endorse's "not a valid label" branch specifically, since
// endorse checks for a FactoredLattice *before* it ever calls toLabel
// (see examples/endorse-unfactored-lattice.ts for that earlier check).
const factoredModel: Model<typeof usFactoredLattice.bottom> = {
  lattice: usFactoredLattice,
  parse: defaultParse,
  serialise: defaultSerialise,
  primEval: defaultPrimEval,
  toLabel: () => undefined,
  fromLabel: () => ({ kind: "record", fields: new Map() }),
};

async function expectRuntimeError(name: string, program: Expr, messageContains: string, useModel: Model<any> = model) {
  const run = newRunState();
  try {
    await evaluate(useModel, scriptedOracle([]), run, useModel.lattice.bottom, emptyConversation(useModel.lattice.bottom), program, new Map());
    console.error(`FAIL: ${name} — expected a RuntimeError but the program completed`);
    process.exit(1);
  } catch (e) {
    const ok = e instanceof RuntimeError && e.message.includes(messageContains);
    console.log(ok ? "PASS" : "FAIL", `${name}:`, e instanceof Error ? e.message : e);
    if (!ok) process.exit(1);
  }
}

async function main() {
  await expectRuntimeError("apply a non-function", { kind: "app", fn: num(1), arg: num(2) }, "application of a non-function");
  await expectRuntimeError("field access on non-record", field(str("not a record"), "x"), "field access on non-record");
  await expectRuntimeError("access a missing field", field(record([["a", num(1)]]), "b"), "no such field: b");
  await expectRuntimeError("index into a non-array", index(str("not an array"), num(0)), "index access on non-array");
  await expectRuntimeError("index with a non-number", index(array([num(1)]), str("zero")), "index must be a number");
  await expectRuntimeError("if on a non-boolean condition", ifThenElse(num(1), num(2), num(3)), "if: condition is not a boolean");
  await expectRuntimeError("labelDyn with an undecodable label value", labelDyn(str("not a label"), num(1)), "labelDyn: e1 value is not a valid label");
  await expectRuntimeError("labelTest with an undecodable policy value", labelTest(str("not a label"), num(1)), "labelTest: e1 value is not a valid label");
  await expectRuntimeError("labelAssert with an undecodable policy value", labelAssert(str("not a label"), num(1)), "labelAssert: e1 value is not a valid label");
  await expectRuntimeError("endorse with an undecodable target value", endorse(str("not a label"), num(1)), "endorse: e1 value is not a valid label", factoredModel);
}

main();
