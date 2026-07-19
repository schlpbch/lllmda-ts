# llmbda-ts

[![CI](https://github.com/schlpbch/lllmda-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/schlpbch/lllmda-ts/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

A TypeScript reference implementation of the **LLMbda calculus** — Garby,
Gordon & Sands, *"The LLMbda Calculus: AI Agents, Conversations, and
Information Flow"* (arXiv:2602.20064, July 2026).

## What this is

An executable interpreter for the calculus's operational semantics:
labeled lambda calculus + first-class conversation primitives (`send`,
`recv`, `fork`, `clear`) + dynamic information-flow labels (`l : e`,
`e1 ? e2`, `assert`, `endorse`). It closely follows the paper's §3/§5/§B
big-step rules, evaluation-rule by evaluation-rule, and each rule in
`src/evaluator.ts` is commented with the paper section it implements and
— for the two security-critical rules — which of the paper's three named
leaks (§1) it closes.

## What this is **not**

**This port carries no formal guarantee.** The paper's central results —
Theorem 1 (TIPNI), Theorem 2 (Insulated TIPNI), Theorem 3 (oracular
correctness) — are machine-checked in the paper's ~42,500-line Lean 4
development. Porting the *algorithm* to TypeScript does not port the
*proof*. TypeScript's type system cannot express "for all programs,
secrets don't leak" — that's a semantic property of the interpreter's
runtime behavior, not something a type checker can verify.

What this repo does instead, honestly:

- Implements the same evaluation rules, so the same *inputs* produce the
  same *outputs* as the paper's interpreter (spot-checked against the
  paper's own worked examples — see `examples/`).
- Includes regression tests for the paper's own named leak examples
  (`examples/fenton-denning-leak.ts` is the §3.4 Fenton/Denning gadget;
  it asserts the interpreter *rejects* it, which is the specific bug the
  paper's `send` rule exists to close).
- Includes a positive test that `endorse` cannot be used to declassify
  (`examples/endorse.ts`) — a spot-check of Theorem 2's substance, not a
  proof of it.

If you need the actual noninterference guarantee, that guarantee lives
in the paper's Lean development, not here. A credible next step for this
repo (not yet done) is property-based testing — generate `∼ₘ`-related
program pairs and check their traces are compatible under a mock oracle
with known response distributions — which gives you *evidence*, never a
proof. See "Where this could go" below.

## Structure

```
src/
  ast.ts        — Expr/Value AST + TS-native builder functions (§3.1, §3.2, §B.1)
  lattice.ts     — Lattice<L>/FactoredLattice<L,I,S> + the {U,S}-powerset and
                   CaMeL-style Sources×Readers instances (§3.2, §5.2, Appendix D.5)
  model.ts       — parse/serialise/primEval/toLabel config (§3.3, §B.1)
  oracle.ts      — the Oracle abstraction (§6) — pure evaluator, injectable nondeterminism
  evaluator.ts   — the actual big-step semantics, rule by rule
  prelude.ts     — fix/quarantine/robust_endorse/bounded_endorse (§C.5, §5.1, §E.2, §E.3)
                   as real object-language closures, not host TS functions (see below)
  errors.ts      — SecurityError vs RuntimeError

examples/
  postcode.ts               — §2.1, exercising fork + prompt end to end
  retry-loop.ts              — §2.2, exercising fix + multi-turn oracle sequencing
  fenton-denning-leak.ts     — §3.4, the send rule's no-high-upgrade check
  var-pc-confinement.ts      — regression test for a real bug found and fixed during
                               this port; see "A bug this port found in itself" below
  endorse.ts                  — §5.1/§E.5, endorse's integrity-only reclassification
  quarantine-classify.ts      — §5.1, full flow: quarantine + bounded_endorse gating
                               a trust-asserting sink
  robust-endorse-cascade.ts   — §E.2, proves endorsement cascades are blocked

test/run.ts    — runs every examples/*.ts as a pass/fail suite
```

## A bug this port found in itself

While building the prelude module, tracing through §3's `⇓-App` rule
carefully surfaced a real semantic gap: **the paper's semantics is
substitution-based** (`e[x := e′]`, §3), not environment-based. When a
value gets substituted into a body that runs under a *raised* `pc` (e.g.
inside a secret-tainted `if` branch), re-encountering that value during
evaluation implicitly re-joins the current `pc` via the `⇓-Labelled`/
`⇓-Lam` rules — a substitution-calculus artifact with no natural
counterpart in an environment/closure implementation.

This port originally used environments (the standard, practical way to
implement a substitution-based calculus without literal substitution),
and `var` lookup / record `.field` access both simply returned the
stored value unchanged — silently dropping exactly the taint the
paper's Confinement lemma (`pc ⊑ ℓ(V)`, Lemma 1) guarantees can never be
dropped. It's a second instance of the same *implicit-flow-through-an-
untaken-path* bug class as the paper's own Fenton/Denning gadget (§1,
§3.4) that the `send` rule exists to close — just reached through a
closure captured outside a tainted branch and called from inside one,
rather than through an assignment.

**Both sites are fixed** (`evaluator.ts`, `var` and `field` cases now
join the ambient `pc` / container label into the returned value, the
same way `⇓-ArrayIndex` already correctly did). `examples/var-pc-
confinement.ts` is the regression test, and — to make sure it's a real
test and not a rubber stamp — it was verified to actually fail against
the pre-fix code before being committed against the fixed version.

The honest framing: this is exactly the class of subtle divergence the
original plan warned "port the algorithm, not just the syntax" about,
and it's worth keeping in mind that other, still-undiscovered instances
of the same pattern may exist elsewhere in this port. This is precisely
why the Lean development remains the actual source of truth for the
security theorem, not this repository.

## Design choices worth knowing about

- **`quarantine`/`robust_endorse`/`bounded_endorse` are object-language
  closures, not host TS functions.** They need to be callable from
  *agent-generated* code — an LLM response that gets parsed and
  evaluated can only call things visible as named bindings in the
  object language's environment, which a plain TS helper function isn't.
  `prelude.ts` builds them as `Expr` closures registered in
  `Model.preludeSource`, merged into scope for every `recv` (mirroring
  §3.3's `M.preludeEnv`) and for the top-level program via `runProgram`.
  `bounded_endorse` is a builder function rather than a bare `Expr`
  because its trust domain must be a fixed, static list baked in at
  construction time — per §E.3, a domain computed at runtime forfeits
  the log₂n leakage bound the construct is justified by.
- **No `weight`/probability tracking.** The paper's `PModel` carries a
  `weight` field used only by the *proof* (the probabilistic big-step
  semantics, §3.3). The executable interpreter (`peval`, §6) doesn't need
  it, and neither does this port — we implement the deterministic,
  oracle-driven reading of the semantics, which is what actually runs in
  production on the Lean side too.
- **No "fuel" argument.** Lean's `peval` threads a decreasing fuel
  parameter because Lean requires a termination proof for every
  function. TypeScript has no such requirement; ordinary recursion is
  fine. If you're worried about a runaway agent looping forever, that's
  a step-budget you'd add for operational safety, not something the
  semantics requires.
- **Labels are homogeneous per run.** `BareValue`'s record/array fields
  store `Labeled<unknown>` rather than threading the label type
  parameter `L` through every data shape. This is sound because a single
  `evaluate()` call always uses one concrete `Model<L>`, and is asserted
  via a single `asL<L>()` cast at the two/three points where it matters
  (`evaluator.ts`) rather than infecting `BareValue` with a generic
  parameter it doesn't otherwise need.
- **`endorse` requires a `FactoredLattice`.** If your `Model<L>.lattice`
  only implements `Lattice<L>`, `endorse` throws a `RuntimeError` at
  evaluation time (not a type error — this is a natural place where a
  stricter `Model<FactoredLattice<L,I,S>>` signature could push the
  check to compile time instead, at the cost of forcing *every* model to
  supply a factoring even if it never uses `endorse`).
- **Default `parse`/`serialise` is naive JSON.** The paper's §7.3 flags
  the lack of a grammar-constrained parser as a real utility cost (LLMs
  frequently emit syntactically-almost-valid output); the same caveat
  applies here more sharply, since `defaultParse` is just `JSON.parse`
  with a try/catch. A real deployment should replace this with something
  closer to the paper's actual grammar (Appendix C.5's `syntax_summary`)
  or a constrained-decoding setup.

## Running it

```bash
pnpm install
pnpm run build     # full strict tsc build, checks src/ only
pnpm test           # runs every examples/*.ts, reports pass/fail
pnpm run example:postcode
pnpm run example:retry
pnpm run example:leak
pnpm run example:confinement
pnpm run example:quarantine
pnpm run example:robust-endorse
```

## Where this could go

Roughly in order of how much they'd actually buy you:

1. **A "randori"-style agent harness** (§7.1) — practice against a mock
   world state, then regenerate and run for real — as a worked example,
   since that's the part that would prove the port is actually usable
   for something, not just faithful to the semantics.
2. **Property-based testing for TIPNI-adjacent claims**, using
   `fast-check`: generate `∼ₘ`-related program pairs (same shape,
   differing only in subterms labeled above `m`) and check their traces
   are compatible under a scripted oracle with known distributions. This
   is real evidence, never a proof — document it as exactly that. Given
   the confinement bug found above, this would also be a genuinely
   useful way to hunt for further undiscovered divergences from the
   paper's semantics, not just a TIPNI sanity check.
3. **A conformance-vector harness against the Lean `peval`** — if the
   Lean side can dump `(program, oracle script) → (final conversation,
   value)` triples, diffing this interpreter's output against them on
   shared test programs is a much stronger check than either side's
   tests alone, and is conceptually the same kind of cross-runtime
   correspondence-checking as NIccola/JPiccola certificate portability,
   just certifying *this port* against its Lean reference instead of
   certifying NL-vs-typed-protocol equivalence. Given that a real bug
   was found by hand during this port, this is probably the highest-
   value remaining item on this list.
4. **A real `Oracle` backed by an actual LLM API** — currently only
   `scriptedOracle`/`ruleOracle` (test doubles) exist; a production
   oracle is a thin adapter, genuinely the easiest item on this list.
