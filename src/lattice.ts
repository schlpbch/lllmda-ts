/**
 * Label lattices — §3.2 and §5.2.
 *
 * The paper's theorems are proved for an *arbitrary* join-semilattice, and
 * §5.2's endorse construct additionally requires the lattice to factor as
 * a product I × S (integrity × confidentiality). We mirror that generality
 * with two interfaces rather than hardcoding the {U,S}-powerset example,
 * so the CaMeL-style Sources×Readers lattice (Appendix D.5) is a drop-in
 * second instance, not a rewrite.
 */

export interface Lattice<L> {
  readonly bottom: L;
  join(a: L, b: L): L;
  /** a ⊑ b — "a may flow to b" */
  flowsTo(a: L, b: L): boolean;
  equals(a: L, b: L): boolean;
  show(a: L): string;
}

export interface FactoredLattice<L, I, S> extends Lattice<L> {
  toIntegrity(l: L): I;
  toConfidentiality(l: L): S;
  pair(i: I, s: S): L;
}

// ==================================================================
// The paper's running example: powerset of {U, S} (§3.2)
//   [] ⊏ ["U"], [] ⊏ ["S"], ["U"] ⊏ ["U","S"], ["S"] ⊏ ["U","S"]
// Represented as a readonly string tag set. We keep it sorted+deduped
// on construction so `equals`/`show` are simple string comparisons.
// ==================================================================

export type UsLabel = ReadonlyArray<"U" | "S" | "E">; // E = endorsed-bit, §E.2

const norm = (tags: ReadonlyArray<string>): ReadonlyArray<"U" | "S" | "E"> =>
  Array.from(new Set(tags)).sort() as Array<"U" | "S" | "E">;

export const usLattice: Lattice<UsLabel> = {
  bottom: [],
  join: (a, b) => norm([...a, ...b]),
  flowsTo: (a, b) => a.every((t) => b.includes(t)),
  equals: (a, b) => a.length === b.length && a.every((t) => b.includes(t)),
  show: (a) => `[${a.join(",")}]`,
};

export const U: UsLabel = ["U"];
export const S: UsLabel = ["S"];
export const US: UsLabel = ["U", "S"];
export const BOTTOM: UsLabel = [];

/**
 * Factor the {U,S,E}-powerset lattice as integrity × confidentiality so
 * `endorse` (§5) can be defined generically. Integrity = whether U/E tags
 * are present; confidentiality = whether S is present. This is the
 * concrete instance used by §E.2's "robust endorsement" (the E bit).
 */
export type Integrity = ReadonlyArray<"U" | "E">;
export type Confidentiality = ReadonlyArray<"S">;

export const usFactoredLattice: FactoredLattice<UsLabel, Integrity, Confidentiality> = {
  ...usLattice,
  toIntegrity: (l) => norm(l.filter((t) => t === "U" || t === "E")) as Integrity,
  toConfidentiality: (l) => norm(l.filter((t) => t === "S")) as Confidentiality,
  pair: (i, s) => norm([...i, ...s]),
};

// ==================================================================
// CaMeL-style Sources × Readers lattice (Appendix D.5) — a second
// instance to demonstrate the abstraction isn't tied to the toy
// {U,S} example. `only(src)` taints by a finite set of source names;
// `any` is ⊤ (accepts any taint). Readers restrict who may read.
// ==================================================================

export type Sources = { kind: "only"; sources: ReadonlySet<string> } | { kind: "any" };
export type Readers =
  | { kind: "unrestricted" }
  | { kind: "restricted"; readers: ReadonlySet<string> };
export type CamelLabel = { sources: Sources; readers: Readers };

const sourcesJoin = (a: Sources, b: Sources): Sources => {
  if (a.kind === "any" || b.kind === "any") return { kind: "any" };
  return { kind: "only", sources: new Set([...a.sources, ...b.sources]) };
};
const sourcesFlowsTo = (a: Sources, b: Sources): boolean => {
  if (b.kind === "any") return true;
  if (a.kind === "any") return false;
  return [...a.sources].every((s) => b.sources.has(s));
};
const readersJoin = (a: Readers, b: Readers): Readers => {
  if (a.kind === "unrestricted") return b;
  if (b.kind === "unrestricted") return a;
  return { kind: "restricted", readers: new Set([...a.readers].filter((r) => b.readers.has(r))) };
};
const readersFlowsTo = (a: Readers, b: Readers): boolean => {
  // "a may flow to b" for reader-sets: readers(b) must be a subset of
  // readers(a) — b must not be more permissive than a (fewer readers =
  // more restrictive = higher in the confidentiality order). `unrestricted`
  // stands for the universal reader set, so it is always a valid *source*
  // (readers(b) ⊆ universal, for any b — public data may flow anywhere)
  // but never a valid non-trivial *destination* from a restricted source
  // (the universal set is never a subset of a smaller, finite one — a
  // restricted/secret value must not be allowed to flow into an
  // unrestricted/public context). Check `a` first: an `unrestricted`
  // source must short-circuit to true before an `unrestricted`
  // destination is checked, or bottom (whose readers are unrestricted)
  // fails to flow to every other label, violating the basic lattice law
  // ∀l, ⊥ ⊑ l — and, far more seriously, checking `b` first previously
  // let a `restricted` (secret) value flow into an `unrestricted`
  // (public) destination, a genuine confidentiality leak.
  if (a.kind === "unrestricted") return true;
  if (b.kind === "unrestricted") return false;
  return [...b.readers].every((r) => a.readers.has(r));
};

export const camelLattice: FactoredLattice<CamelLabel, Sources, Readers> = {
  bottom: { sources: { kind: "only", sources: new Set() }, readers: { kind: "unrestricted" } },
  join: (a, b) => ({
    sources: sourcesJoin(a.sources, b.sources),
    readers: readersJoin(a.readers, b.readers),
  }),
  flowsTo: (a, b) => sourcesFlowsTo(a.sources, b.sources) && readersFlowsTo(a.readers, b.readers),
  equals: (a, b) =>
    JSON.stringify([...toSortedSources(a.sources)]) === JSON.stringify([...toSortedSources(b.sources)]) &&
    JSON.stringify(readersToJson(a.readers)) === JSON.stringify(readersToJson(b.readers)),
  show: (a) => `{sources: ${sourcesShow(a.sources)}, readers: ${readersShow(a.readers)}}`,
  toIntegrity: (l) => l.sources,
  toConfidentiality: (l) => l.readers,
  pair: (sources, readers) => ({ sources, readers }),
};

function toSortedSources(s: Sources): string[] {
  return s.kind === "any" ? ["*any*"] : [...s.sources].sort();
}
function readersToJson(r: Readers): unknown {
  return r.kind === "unrestricted" ? "*" : [...r.readers].sort();
}
function sourcesShow(s: Sources): string {
  return s.kind === "any" ? "any" : `only(${[...s.sources].join(",")})`;
}
function readersShow(r: Readers): string {
  return r.kind === "unrestricted" ? "unrestricted" : `restricted(${[...r.readers].join(",")})`;
}
