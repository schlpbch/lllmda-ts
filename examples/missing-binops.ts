/**
 * Regression test for the missing `mod`/`!=` binop fix (evaluator.ts,
 * model.ts).
 *
 * §B.1's binop grammar is `⊕ ::= + | − | × | ÷ | mod | = | < | > | ≤ | ≥`
 * — `mod` is a genuine primitive operator in the paper's own grammar.
 * This port's `BinOp` type (ast.ts) admits constructing `binop("%", ...)`
 * (and, separately, `binop("!=", ...)` — not in the paper's primitive
 * grammar at all, but present in this port's type as if it were one,
 * where the paper instead defines `≠` as a *derived form*:
 * `e1 ≠ e2 ≜ if (e1 = e2) then false else true`). Both were wired into
 * the AST type but nowhere else — `evaluator.ts`'s `binopPrimName` had no
 * entry for either, so *any* use of `%` or `!=` threw
 * `RuntimeError: unsupported binop: %` (or `!=`) unconditionally,
 * regardless of operands. Not a security issue (fails loudly, not
 * silently), but a real completeness gap relative to the paper's own
 * grammar, found the same way as the confinement bugs: by checking every
 * construct this port's type system admits against what the paper
 * actually specifies for it.
 */
import { binop, bool, num } from "../src/ast.js";
import { usLattice } from "../src/lattice.js";
import { emptyConversation, evaluate, newRunState } from "../src/evaluator.js";
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

async function check(name: string, expr: ReturnType<typeof binop>, expectedKind: "number" | "bool", expectedValue: number | boolean) {
  const run = newRunState();
  const result = await evaluate(model, scriptedOracle([]), run, usLattice.bottom, emptyConversation(usLattice.bottom), expr, new Map());
  const bv = result.value.value;
  const ok = bv.kind === expectedKind && bv.value === expectedValue;
  console.log(ok ? "PASS" : "FAIL", `${name}:`, JSON.stringify(bv));
  if (!ok) process.exit(1);
}

async function main() {
  await check("7 % 3", binop("%", num(7), num(3)), "number", 1);
  await check("true != false", binop("!=", bool(true), bool(false)), "bool", true);
  await check("5 != 5", binop("!=", num(5), num(5)), "bool", false);
}

main();
