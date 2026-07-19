/**
 * Regression test for the `bounded_endorse` boolean-domain fix
 * (prelude.ts).
 *
 * §7.3's case study is explicit about what `bounded_endorse` is for in
 * practice: "the agent endorses booleans and category labels, which are
 * small-domain values". `boundedEndorseDef` built every domain entry as
 * a `str(...)` literal unconditionally, so comparing an in-domain
 * *boolean* value against it always failed on the scalar kind mismatch
 * (`scalarEq`, model.ts, requires `a.kind === b.kind`) — every boolean
 * silently fell through to the out-of-domain, still-untrusted branch, no
 * matter its value. Fail-closed (never over-trusts), so not a security
 * bug, but a real gap against the paper's own stated primary use case
 * for this construct.
 *
 * Fixed by building each domain entry with the scalar constructor
 * matching its actual JS type (`bool`/`num`/`str`) — also covers the
 * `number` branch of that fix (`domainScalarLit`'s `typeof value ===
 * "number"` case), otherwise unexercised since every other bounded_endorse
 * usage in this repo (booleans here, categories in
 * `quarantine-classify.ts`) sticks to one domain type.
 */
import { app, bool, labelLit, letIn, num, v } from "../src/ast.js";
import { U, usFactoredLattice } from "../src/lattice.js";
import { emptyConversation, runProgram } from "../src/evaluator.js";
import { defaultParse, defaultPrimEval, defaultSerialise, type Model } from "../src/model.js";
import { boundedEndorseDef } from "../src/prelude.js";
import { scriptedOracle } from "../src/oracle.js";

const preludeSource = new Map([
  ["bounded_endorse_bool", boundedEndorseDef([true])],
  ["bounded_endorse_status_code", boundedEndorseDef([200, 404, 500])],
]);

const model: Model<typeof usFactoredLattice.bottom> = {
  lattice: usFactoredLattice,
  parse: defaultParse,
  serialise: defaultSerialise,
  primEval: defaultPrimEval,
  toLabel: (val) => {
    if (val.kind === "array" && val.items.every((i) => i.value.kind === "string")) {
      return val.items.map((i) => (i.value as { kind: "string"; value: string }).value) as typeof usFactoredLattice.bottom;
    }
    return undefined;
  },
  fromLabel: (l) => ({ kind: "array", items: l.map((tag) => ({ label: usFactoredLattice.bottom, value: { kind: "string", value: tag } })) }),
  preludeSource,
};

async function checkInDomain() {
  const program = letIn("raw", labelLit(U, bool(true)), app(v("bounded_endorse_bool"), v("raw")));
  const result = await runProgram(model, scriptedOracle([]), usFactoredLattice.bottom, emptyConversation(usFactoredLattice.bottom), program);
  const isTrusted = !usFactoredLattice.equals(result.value.label, U);
  console.log(
    isTrusted ? "PASS" : "FAIL",
    "in-domain boolean `true` is washed to trusted: value =",
    JSON.stringify(result.value.value),
    "label =",
    usFactoredLattice.show(result.value.label),
  );
  if (!isTrusted) process.exit(1);
}

async function checkOutOfDomain() {
  const program = letIn("raw", labelLit(U, bool(false)), app(v("bounded_endorse_bool"), v("raw")));
  const result = await runProgram(model, scriptedOracle([]), usFactoredLattice.bottom, emptyConversation(usFactoredLattice.bottom), program);
  const stillUntrusted = usFactoredLattice.equals(result.value.label, U);
  console.log(
    stillUntrusted ? "PASS" : "FAIL",
    "out-of-domain boolean `false` (domain is [true]) passes through still untrusted: value =",
    JSON.stringify(result.value.value),
    "label =",
    usFactoredLattice.show(result.value.label),
  );
  if (!stillUntrusted) process.exit(1);
}

async function checkNumberDomain() {
  const program = letIn("raw", labelLit(U, num(404)), app(v("bounded_endorse_status_code"), v("raw")));
  const result = await runProgram(model, scriptedOracle([]), usFactoredLattice.bottom, emptyConversation(usFactoredLattice.bottom), program);
  const isTrusted = !usFactoredLattice.equals(result.value.label, U);
  console.log(
    isTrusted ? "PASS" : "FAIL",
    "in-domain number `404` is washed to trusted: value =",
    JSON.stringify(result.value.value),
    "label =",
    usFactoredLattice.show(result.value.label),
  );
  if (!isTrusted) process.exit(1);
}

async function main() {
  await checkInDomain();
  await checkOutOfDomain();
  await checkNumberDomain();
}

main();
