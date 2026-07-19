/**
 * Coverage: the `Sources: {kind: "any"}` case of `camelLattice`
 * (Appendix D.5) and joining two *different* restricted reader-sets
 * together — neither is exercised by `camel-provenance-quarantine.ts`
 * or `camel-readers-flowsto.ts`, which only ever use `{kind: "only",
 * ...}` sources and single-reader-set values. Also calls
 * `camelLattice.equals(...)` directly, which no example calls at all.
 *
 * `sources: any` models "could have come from anywhere" (the top of the
 * sources/integrity axis) — it flows into a sink that accepts any
 * source, but a sink that requires a *specific* source must refuse it,
 * since "any" carries no guarantee about where the data actually came
 * from.
 */
import { camelLattice, type CamelLabel } from "../src/lattice.js";

function label(sources: CamelLabel["sources"], readers: CamelLabel["readers"]): CamelLabel {
  return { sources, readers };
}

function main() {
  const anySource = label({ kind: "any" }, { kind: "unrestricted" });
  const webOnly = label({ kind: "only", sources: new Set(["web"]) }, { kind: "unrestricted" });

  let ok = true;

  // any-sourced data flows into a sink that accepts any source.
  const flowsIntoAny = camelLattice.flowsTo(anySource, anySource);
  console.log(flowsIntoAny ? "PASS" : "FAIL", "any-sourced data flows into an any-accepting sink");
  ok = ok && flowsIntoAny;

  // any-sourced data must NOT flow into a sink requiring a specific source.
  const blockedFromSpecific = !camelLattice.flowsTo(anySource, webOnly);
  console.log(blockedFromSpecific ? "PASS" : "FAIL", "any-sourced data is refused by a source-specific sink");
  ok = ok && blockedFromSpecific;

  // joining anything with an any-sourced label produces an any-sourced result.
  const joinedWithAny = camelLattice.join(anySource, webOnly);
  const joinIsAny = joinedWithAny.sources.kind === "any";
  console.log(joinIsAny ? "PASS" : "FAIL", "joining with an any-sourced label produces an any-sourced result");
  ok = ok && joinIsAny;

  // show() on an any-sourced label.
  const anyShown = camelLattice.show(anySource).includes("any");
  console.log(anyShown ? "PASS" : "FAIL", "show() renders an any-sourced label:", camelLattice.show(anySource));
  ok = ok && anyShown;

  // joining two DIFFERENT restricted reader sets intersects them.
  const aliceOnly = label({ kind: "only", sources: new Set() }, { kind: "restricted", readers: new Set(["alice", "bob"]) });
  const bobOnly = label({ kind: "only", sources: new Set() }, { kind: "restricted", readers: new Set(["bob", "carol"]) });
  const joined = camelLattice.join(aliceOnly, bobOnly);
  const joinedReaders = joined.readers.kind === "restricted" ? [...joined.readers.readers].sort() : [];
  const joinIsIntersection = JSON.stringify(joinedReaders) === JSON.stringify(["bob"]);
  console.log(joinIsIntersection ? "PASS" : "FAIL", "joining two restricted reader-sets intersects them:", joinedReaders);
  ok = ok && joinIsIntersection;

  // flowsTo between two DIFFERENT restricted reader-sets directly (not via join).
  const carolOnly = label({ kind: "only", sources: new Set() }, { kind: "restricted", readers: new Set(["carol"]) });
  const restrictedFlowsToRestricted = !camelLattice.flowsTo(aliceOnly, carolOnly);
  console.log(
    restrictedFlowsToRestricted ? "PASS" : "FAIL",
    "a value restricted to {alice,bob} does not flow to a sink restricted to {carol}",
  );
  ok = ok && restrictedFlowsToRestricted;

  // equals: reflexive, and distinguishes different reader sets.
  const reflexive = camelLattice.equals(aliceOnly, aliceOnly);
  const distinguishes = !camelLattice.equals(aliceOnly, bobOnly);
  console.log(reflexive && distinguishes ? "PASS" : "FAIL", "equals is reflexive and distinguishes different labels");
  ok = ok && reflexive && distinguishes;

  // equals over an any-sourced label and an unrestricted-readers label.
  const anyEqualsSelf = camelLattice.equals(anySource, anySource);
  const bottomEqualsSelf = camelLattice.equals(camelLattice.bottom, camelLattice.bottom);
  console.log(
    anyEqualsSelf && bottomEqualsSelf ? "PASS" : "FAIL",
    "equals handles any-sourced and unrestricted-readers labels",
  );
  ok = ok && anyEqualsSelf && bottomEqualsSelf;

  console.log(ok ? "\nPASS" : "\nFAIL", "- camelLattice any-source and reader-intersection/equals behave correctly");
  if (!ok) process.exit(1);
}

main();
