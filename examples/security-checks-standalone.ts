/**
 * Coverage: `recv`'s and `clear`'s *own* `SecurityError` checks
 * (§3.3's `pc ⊑ lc` side condition on both rules), triggered standalone.
 * Every existing leak example (`fenton-denning-leak.ts`,
 * `deep-label-confinement.ts`, `camel-readers-flowsto.ts`, ...) raises
 * `pc` and then attempts a `send`, so `send`'s check is always the one
 * that fires first — `recv` and `clear` have the identical shape of
 * check, but nothing exercises them independently.
 *
 * Also covers `scriptedOracle` correctly refusing with a clean
 * `RuntimeError` (not a plain, unclassified `Error`) when a program
 * calls `recv` more times than responses were scripted for.
 */
import { clear as clearExpr, labelLit, recv } from "../src/ast.js";
import { S, usLattice } from "../src/lattice.js";
import { emptyConversation, evaluate, newRunState } from "../src/evaluator.js";
import { defaultParse, defaultPrimEval, defaultSerialise, type Model } from "../src/model.js";
import { scriptedOracle } from "../src/oracle.js";
import { SecurityError, RuntimeError } from "../src/errors.js";
import type { Expr } from "../src/ast.js";

const model: Model<typeof usLattice.bottom> = {
  lattice: usLattice,
  parse: defaultParse,
  serialise: defaultSerialise,
  primEval: defaultPrimEval,
  toLabel: () => undefined,
  fromLabel: () => ({ kind: "record", fields: new Map() }),
};

async function expectSecurityError(name: string, program: Expr, ruleName: string) {
  const run = newRunState();
  try {
    await evaluate(model, scriptedOracle(["{}"]), run, usLattice.bottom, emptyConversation(usLattice.bottom), program, new Map());
    console.error(`FAIL: ${name} — expected a SecurityError but the program completed`);
    process.exit(1);
  } catch (e) {
    const ok = e instanceof SecurityError && e.message.startsWith(`${ruleName}:`);
    console.log(ok ? "PASS" : "FAIL", `${name}:`, e instanceof Error ? e.message : e);
    if (!ok) process.exit(1);
  }
}

async function testRecvStandalone() {
  // pc raised to [S] with the conversation still at bottom -- recv's own
  // check must refuse before it ever reads the oracle's history.
  await expectSecurityError("recv refuses when pc is secret-raised over an untainted conversation", labelLit(S, recv), "recv");
}

async function testClearStandalone() {
  // Same shape, for clear.
  await expectSecurityError("clear refuses when pc is secret-raised over an untainted conversation", labelLit(S, clearExpr), "clear");
}

async function testOracleExhaustion() {
  const run = newRunState();
  try {
    await evaluate(model, scriptedOracle([]), run, usLattice.bottom, emptyConversation(usLattice.bottom), recv, new Map());
    console.error("FAIL: expected a RuntimeError from an exhausted scriptedOracle");
    process.exit(1);
  } catch (e) {
    const ok = e instanceof RuntimeError && e.message.includes("no response scripted");
    console.log(ok ? "PASS" : "FAIL", "exhausted scriptedOracle throws a clean RuntimeError:", e instanceof Error ? e.message : e);
    if (!ok) process.exit(1);
  }
}

async function main() {
  await testRecvStandalone();
  await testClearStandalone();
  await testOracleExhaustion();
}

main();
