/**
 * Coverage: `labelTest` (§3.2/§3.4's `e1 ? e2` — "test: labelled value e2
 * may flow to label e1, or not"). Every other example in this repo
 * exercises `labelAssert` (the blocking form) but none exercise the
 * *test* form at all — this is the first.
 *
 * ⇓-LabelTest's defining property (§3.4): the boolean result is labeled
 * at `pc ⊔ n ⊔ l` — the level of the *policy threshold being tested
 * against* — not at the tested data's own label `l′`. This is what makes
 * the result usable for a subsequent branch without that branch itself
 * becoming as tainted as the data under test; if the result carried the
 * data's own label instead, testing a secret would immediately taint
 * everything downstream, defeating the point of testing before deciding
 * whether to touch it at all.
 */
import { array, bool, labelLit, labelTest, letIn, str, v } from "../src/ast.js";
import { S, U, US, usLattice } from "../src/lattice.js";
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

const tagArray = (tags: ReadonlyArray<string>) => array(tags.map(str));

async function testSatisfiedPolicy() {
  // ["S"] : "secret" flows to policy ["U","S"] -- test should be true.
  const program = labelTest(tagArray(US), labelLit(S, str("secret")));
  const run = newRunState();
  const result = await evaluate(model, scriptedOracle([]), run, usLattice.bottom, emptyConversation(usLattice.bottom), program, new Map());
  const ok = result.value.value.kind === "bool" && result.value.value.value === true;
  console.log(ok ? "PASS" : "FAIL", "[S] flows to [U,S] policy: result =", JSON.stringify(result.value.value));
  if (!ok) process.exit(1);
}

async function testViolatedPolicy() {
  // ["S"] : "secret" does NOT flow to policy ["U"] -- test should be false.
  const program = labelTest(tagArray(U), labelLit(S, str("secret")));
  const run = newRunState();
  const result = await evaluate(model, scriptedOracle([]), run, usLattice.bottom, emptyConversation(usLattice.bottom), program, new Map());
  const ok = result.value.value.kind === "bool" && result.value.value.value === false;
  console.log(ok ? "PASS" : "FAIL", "[S] does not flow to [U] policy: result =", JSON.stringify(result.value.value));
  if (!ok) process.exit(1);
}

async function testResultLabelIsThePolicyThreshold() {
  // The result must be labeled at the POLICY's level (U here), not the
  // tested SECRET data's own level -- testing must not itself leak.
  const program = letIn("b", labelTest(tagArray(U), labelLit(S, bool(true))), v("b"));
  const run = newRunState();
  const result = await evaluate(model, scriptedOracle([]), run, usLattice.bottom, emptyConversation(usLattice.bottom), program, new Map());
  const isPolicyLabeled = usLattice.equals(result.value.label, U);
  const isDataLabeled = usLattice.equals(result.value.label, S);
  console.log(
    isPolicyLabeled && !isDataLabeled ? "PASS" : "FAIL",
    "test result is labeled at the policy threshold [U], not the tested data's own label [S]: label =",
    usLattice.show(result.value.label),
  );
  if (!isPolicyLabeled || isDataLabeled) process.exit(1);
}

async function main() {
  await testSatisfiedPolicy();
  await testViolatedPolicy();
  await testResultLabelIsThePolicyThreshold();
}

main();
