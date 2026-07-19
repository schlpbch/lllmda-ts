/**
 * Coverage: `runProgram`'s `baseEnv` parameter (evaluator.ts) — merged
 * with the prelude env so a caller can inject extra top-level bindings
 * alongside prelude entries. Every other example that calls `runProgram`
 * omits `baseEnv` (it defaults to an empty `Map`), so `mergeEnv`'s loop
 * body (iterating the second map's entries) never actually executes
 * anywhere else in this repo.
 */
import { v } from "../src/ast.js";
import { usLattice } from "../src/lattice.js";
import { emptyConversation, runProgram } from "../src/evaluator.js";
import { defaultParse, defaultPrimEval, defaultSerialise, type Model } from "../src/model.js";
import { scriptedOracle } from "../src/oracle.js";

const model: Model<typeof usLattice.bottom> = {
  lattice: usLattice,
  parse: defaultParse,
  serialise: defaultSerialise,
  primEval: defaultPrimEval,
  toLabel: () => undefined,
  fromLabel: () => ({ kind: "record", fields: new Map() }),
};

async function main() {
  const baseEnv = new Map([["injected", { label: usLattice.bottom, value: { kind: "string" as const, value: "from baseEnv" } }]]);
  const result = await runProgram(model, scriptedOracle([]), usLattice.bottom, emptyConversation(usLattice.bottom), v("injected"), baseEnv);
  const ok = result.value.value.kind === "string" && result.value.value.value === "from baseEnv";
  console.log(ok ? "PASS" : "FAIL", "runProgram's baseEnv binding is visible to the program:", JSON.stringify(result.value.value));
  if (!ok) process.exit(1);
}

main();
