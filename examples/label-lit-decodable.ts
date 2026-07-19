/**
 * Coverage: `decodeLiteralLabel`'s "successfully decoded via
 * `Model.toLabel`" branch (evaluator.ts). Every other example passes
 * `labelLit` a raw TS label constant (e.g. `S = ["S"]`) directly — that
 * isn't `BareValue`-shaped, so `model.toLabel` always returns `undefined`
 * for it and only the fallback path (treat the literal as already being
 * of type `L`) ever runs. This constructs a `labelLit` literal that
 * genuinely *is* a `BareValue` the model's `toLabel` can decode, to
 * exercise the decode-succeeds path for the first time.
 */
import { array, labelLit, str } from "../src/ast.js";
import { S, usLattice } from "../src/lattice.js";
import { emptyConversation, evaluate, newRunState } from "../src/evaluator.js";
import { defaultParse, defaultPrimEval, defaultSerialise, type Model } from "../src/model.js";
import { scriptedOracle } from "../src/oracle.js";

const model: Model<typeof usLattice.bottom> = {
  lattice: usLattice,
  parse: defaultParse,
  serialise: defaultSerialise,
  primEval: defaultPrimEval,
  toLabel: (v) => {
    if (v.kind === "array" && v.items.every((i) => i.value.kind === "string")) {
      return v.items.map((i) => (i.value as { kind: "string"; value: string }).value) as typeof usLattice.bottom;
    }
    return undefined;
  },
  fromLabel: (l) => ({ kind: "array", items: l.map((tag) => ({ label: usLattice.bottom, value: { kind: "string", value: tag } })) }),
};

async function main() {
  // A genuine BareValue literal ({kind:"array", items:[...]}) rather than
  // a raw TS array constant -- model.toLabel decodes this successfully.
  // Array items are Value-shaped ({label, value}), per ast.ts's BareValue.
  const decodableLiteral = {
    kind: "array" as const,
    items: [{ label: usLattice.bottom, value: { kind: "string" as const, value: "S" } }],
  };
  const program = labelLit(decodableLiteral, str("secret"));
  const run = newRunState();
  const result = await evaluate(model, scriptedOracle([]), run, usLattice.bottom, emptyConversation(usLattice.bottom), program, new Map());
  const ok = usLattice.equals(result.value.label, S);
  console.log(ok ? "PASS" : "FAIL", "labelLit with a toLabel-decodable BareValue literal produces label:", usLattice.show(result.value.label));
  if (!ok) process.exit(1);
}

main();
