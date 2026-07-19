/**
 * Coverage: `endorse`'s `RuntimeError` when the current model's lattice
 * doesn't implement `FactoredLattice` (§5.2 requires the factoring
 * `L ≅ I×S` for `endorse` to be well-defined at all). Every other example
 * that uses `endorse` — directly or via `robust_endorse`/`bounded_endorse`
 * — supplies `usFactoredLattice` or `camelLattice`, both already factored,
 * so this check has never fired. `asFactoredLattice` (evaluator.ts)
 * duck-types the lattice by checking for `toIntegrity`/`toConfidentiality`/
 * `pair`; a plain `Lattice<L>` — like `usLattice` itself, used directly
 * rather than through its factored wrapper — has none of them.
 */
import { endorse, str, labelLit } from "../src/ast.js";
import { S, usLattice } from "../src/lattice.js";
import { emptyConversation, evaluate, newRunState } from "../src/evaluator.js";
import { defaultParse, defaultPrimEval, defaultSerialise, type Model } from "../src/model.js";
import { scriptedOracle } from "../src/oracle.js";
import { RuntimeError } from "../src/errors.js";

// usLattice is a plain Lattice<L> -- no toIntegrity/toConfidentiality/pair.
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
  const program = endorse(labelLit(S, str("target")), str("value"));
  const run = newRunState();
  try {
    await evaluate(model, scriptedOracle([]), run, usLattice.bottom, emptyConversation(usLattice.bottom), program, new Map());
    console.error("FAIL: expected a RuntimeError but endorse succeeded against an unfactored lattice");
    process.exit(1);
  } catch (e) {
    const ok = e instanceof RuntimeError && e.message.includes("does not implement FactoredLattice");
    console.log(ok ? "PASS" : "FAIL", "endorse refuses cleanly against a plain Lattice<L>:", e instanceof Error ? e.message : e);
    if (!ok) process.exit(1);
  }
}

main();
