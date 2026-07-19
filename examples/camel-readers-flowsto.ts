/**
 * Regression test for the `camelLattice.readersFlowsTo` fix (lattice.ts).
 *
 * `readersFlowsTo` had its confidentiality direction inverted: it checked
 * whether the *destination* was `unrestricted` before checking whether the
 * *source* was, which meant:
 *
 *   1. `flowsTo(⊥, restricted)` was `false` — bottom, whose readers are
 *      `unrestricted`, failed to flow into ANY restricted destination,
 *      violating the basic join-semilattice law the paper requires of
 *      every label lattice (§3.2: "we assume a set of labels drawn from a
 *      join-semi-lattice... with... bottom"): `∀l, ⊥ ⊑ l`.
 *   2. Far more seriously, `flowsTo(restricted, ⊥)` was `true` — a value
 *      restricted to a small set of readers (e.g. {alice}) was allowed to
 *      flow into a fully `unrestricted`/public destination. That is
 *      exactly the confidentiality leak this whole calculus exists to
 *      prevent, reachable through the ordinary `send` no-high-upgrade
 *      check (§1/§3.4) — the same rule the paper's own Fenton/Denning
 *      example and examples/fenton-denning-leak.ts exercise, just via the
 *      CaMeL-style Sources×Readers lattice (Appendix D.5) instead of the
 *      {U,S} running example.
 *
 * Both directions are checked here, plus the general bottom law over a
 * handful of representative labels (not just the specific leak case).
 */
import { send, str } from "../src/ast.js";
import { camelLattice, type CamelLabel } from "../src/lattice.js";
import { evaluate, newRunState, type LabeledConversation } from "../src/evaluator.js";
import { defaultParse, defaultPrimEval, defaultSerialise, type Model } from "../src/model.js";
import { scriptedOracle } from "../src/oracle.js";
import { SecurityError } from "../src/errors.js";

const model: Model<CamelLabel> = {
  lattice: camelLattice,
  parse: defaultParse,
  serialise: defaultSerialise,
  primEval: defaultPrimEval,
  toLabel: () => undefined,
  fromLabel: () => ({ kind: "record", fields: new Map() }),
};

const restrictedToAlice: CamelLabel = { sources: { kind: "only", sources: new Set() }, readers: { kind: "restricted", readers: new Set(["alice"]) } };
const publicUnrestricted: CamelLabel = { sources: { kind: "only", sources: new Set() }, readers: { kind: "unrestricted" } };

async function testBottomLaw() {
  const samples: CamelLabel[] = [
    camelLattice.bottom,
    publicUnrestricted,
    restrictedToAlice,
    { sources: { kind: "only", sources: new Set() }, readers: { kind: "restricted", readers: new Set() } },
    { sources: { kind: "any" }, readers: { kind: "unrestricted" } },
    { sources: { kind: "only", sources: new Set(["db"]) }, readers: { kind: "restricted", readers: new Set(["alice", "bob"]) } },
  ];
  const violations = samples.filter((s) => !camelLattice.flowsTo(camelLattice.bottom, s));
  const ok = violations.length === 0;
  console.log(
    ok ? "PASS" : "FAIL (LATTICE LAW VIOLATED)",
    "bottom flows to every sampled label:",
    ok ? "confirmed" : violations.map((v) => camelLattice.show(v)).join(", "),
  );
  if (!ok) process.exit(1);
}

async function testSecretCannotFlowToPublic() {
  // pc raised to "alice-only"; the conversation is already fully public.
  // Sending alice-only-tainted data into it must be refused.
  const conv: LabeledConversation<CamelLabel> = { label: publicUnrestricted, history: [] };
  const run = newRunState();
  try {
    await evaluate(model, scriptedOracle([]), run, restrictedToAlice, conv, send(str("alice-only secret value")), new Map());
    console.error("FAIL (REAL LEAK): alice-only-tainted pc was allowed to send into a public conversation");
    process.exit(1);
  } catch (e) {
    if (e instanceof SecurityError) {
      console.log("PASS: send correctly refused alice-only data flowing into a public conversation:");
      console.log("  ->", e.message);
    } else {
      console.error("FAIL: expected a SecurityError, got:", e);
      process.exit(1);
    }
  }
}

async function testPublicCanFlowToRestricted() {
  // The inverse must still work: a public (bottom) pc sending into an
  // already-restricted conversation is completely unremarkable.
  const conv: LabeledConversation<CamelLabel> = { label: restrictedToAlice, history: [] };
  const run = newRunState();
  const result = await evaluate(model, scriptedOracle([]), run, camelLattice.bottom, conv, send(str("public value")), new Map());
  console.log("PASS: public pc can still send into an already-restricted conversation. new conv label:", camelLattice.show(result.conv.label));
}

async function main() {
  await testBottomLaw();
  await testSecretCannotFlowToPublic();
  await testPublicCanFlowToRestricted();
}

main();
