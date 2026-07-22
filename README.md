# LLMbdaJS

[![CI](https://github.com/schlpbch/LLMbdaJS/actions/workflows/ci.yml/badge.svg)](https://github.com/schlpbch/LLMbdaJS/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/schlpbch/LLMbdaJS/badges/coverage.json)](https://github.com/schlpbch/LLMbdaJS/actions/workflows/ci.yml)

A TypeScript reference implementation of the **LLMbda calculus** by
[Zachary Garby](https://zacgarby.co.uk/),
[Andrew D Gordon](https://AndrewDGordon.github.io), and
[David Sands](https://www.cse.chalmers.se/~dave/Homepage_David_Sands/Home.html)
and presented in their paper
[_"The LLMbda Calculus: AI Agents, Conversations, and Information Flow"_](https://arxiv.org/abs/2602.20064)
(arXiv:2602.20064, July 2026).

## The LLMbda in a Nutshell

The LLMbda is an **untyped call-by-value lambda calculus** that makes
provenance-based defense both expressible and provably sound, without committing
to an architecture. It adds the **operational core of agentic systems as
first-class constructs**: prompt-response conversations that can be forked and
cleared, code generation, and dynamic information-flow control in which every
value carries a label that every reduction propagates. Isolation becomes a
policy a program expresses, and reclassification an explicit, auditable
construct.

The central result is a **termination-insensitive probabilistic noninterference
(TIPNI) theorem** over the whole calculus, including code-generating agents,
with an insulated variant that holds even when the attacker chooses all
untrusted inputs. The verified interpreter is itself the harness that calls the
model and the first LLM agent harness whose executable is the subject of
machine-checked security theorems, so every agent inherits the guarantee.

## What this Implementation Intends to Be

An executable interpreter for the calculus's operational semantics: labeled
lambda calculus + first-class conversation primitives (`send`, `recv`, `fork`,
`clear`) + dynamic information-flow labels (`l : e`, `e1 ? e2`, `assert`,
`endorse`).

It follows the paper's §3/§5/§B big-step rules, evaluation-rule by
evaluation-rule. Each rule in `src/evaluator.ts` is commented with the paper
section it implements.

## What this is **Not**

**This port carries no formal guarantee.**

The paper's central results:

- Theorem 1: **Termination-insensitive probabilistic noninterference
(TIPNI) theorem (TIPNI)**,
- Theorem 2 **Insulated TIPNI**,
- Theorem 3 **Oracular Correctness**

are machine-checked in the paper's Lean 4 development. Porting the _algorithm_
to TypeScript does not port the _proof_.

What this repo tries instead: implement the same evaluation rules so the same
_inputs_ produce the same _outputs_ as the paper's interpreter (spot-checked
against the paper's own worked examples in `examples/`, including its named leak
example and a positive `endorse` test).

## Project Principles

The development of this port is guided by eight principles documented in
[`CONSTITUTION.md`](CONSTITUTION.md). Please read it to understand:

- How fidelity to the paper's formal text is maintained
- Why claims about what the interpreter does or doesn't guarantee are carefully
  hedged
- How regressions are caught (regression tests proven to fail first)
- How gaps between the paper and the port are documented, not hidden

## Structure

```text
src/
  ast.ts         — Expr/Value AST + TS-native builder functions (§3.1, §3.2, §B.1)
  lattice.ts     — Lattice<L>/FactoredLattice<L,I,S> + the {U,S}-powerset and
                   CaMeL-style Sources×Readers instances (§3.2, §5.2, Appendix D.5)
  model.ts       — parse/serialise/primEval/toLabel config (§3.3, §B.1)
  oracle.ts      — the Oracle abstraction (§6) — pure evaluator, injectable nondeterminism
  evaluator.ts   — the actual big-step semantics, rule by rule
  prelude.ts     — fix/quarantine/robust_endorse/bounded_endorse (§C.5, §5.1, §E.2, §E.3)
                   as real object-language closures, not host TS functions
  errors.ts      — SecurityError vs RuntimeError

examples/        — one file per worked scenario or regression test, each run by `test/run.ts`
                   as a pass/fail suite. Covers the paper's own examples (postcode extraction,
                   retry loops, the Fenton/Denning leak, quarantine + endorse, the CaMeL-style
                   lattice) plus a regression test per bug found and fixed during rule-by-rule
                   audits against the paper's formal semantics.
```

## Design choices worth knowing about

Each design choice below has a detailed
[Architecture Decision Record](docs/adr/README.md) explaining the reasoning and
alternatives considered.

- **`quarantine`/`robust_endorse`/`bounded_endorse` are object-language
  closures** (`prelude.ts`), not host TS functions — agent-generated code can
  only call names bound in the object language's environment. `bounded_endorse`
  is a builder rather than a bare `Expr` because its trust domain must be a
  fixed, static list baked in at construction time (§E.3 — a runtime-computed
  domain forfeits the log₂n leakage bound).
- **No `weight`/probability tracking, no "fuel" argument.** Both are artifacts
  of the paper's Lean-side proof machinery (probabilistic big-step semantics,
  termination proofs) the executable interpreter doesn't need.
- **Labels are homogeneous per run.** `BareValue`'s record/array fields store
  `Labeled<unknown>` rather than threading `L` through every data shape — sound
  since a single `evaluate()` call always uses one concrete `Model<L>`, asserted
  via a single `asL<L>()` cast where it matters.
- **`endorse` requires a `FactoredLattice`**, checked at evaluation time
  (`RuntimeError`, not a type error) rather than in `Model<L>`'s type.
- **Default `parse`/`serialise` is naive JSON** (`JSON.parse` with a try/catch)
  — the paper's §7.3 flags the lack of a grammar-constrained parser as a real
  utility cost; a real deployment should replace this.

## Running it

```bash
pnpm install
pnpm run build     # full strict tsc build, checks src/ only
pnpm test           # runs every examples/*.ts, reports pass/fail
pnpm run coverage    # same suite, instrumented with c8 (text + html report in coverage/)
pnpm run example:<name>   # run one example directly, e.g. example:postcode
```

See `package.json` for the full list of `example:*` scripts (one per file in
`examples/`).

## Where this Could Go

Roughly in order of how much they'd actually buy you:

1. **A "Randori"-style agent harness** (§7.1) — practice against a mock world
   state, then regenerate and run for real — proving the port is usable for
   something, not just faithful to the semantics.
2. **Property-based testing for TIPNI-adjacent claims** (`fast-check`): generate
   `∼ₘ`-related program pairs and check their traces are compatible under a
   scripted oracle — real evidence, never a proof, but also a good way to hunt
   for further undiscovered divergences.
3. **A conformance-vector harness against the Lean `peval`** — diffing this
   interpreter's output against Lean-side
   `(program, oracle) → (conversation, value)` triples on shared test programs.
   Given the bugs already found by hand, probably the highest-value item on this
   list.
4. **A real `Oracle` backed by an actual LLM API** — currently only
   `scriptedOracle`/`ruleOracle` (test doubles) exist; a production oracle is a
   thin adapter.

## Where this Currently does not Go

Porting to another programming language (like Python, Rust or Haskell). While
this would be fun endeavors, getting this implementation complete and correct
shall be the current focus.

## Legalese

Copyright, 2026 - Andreas Schlapbach
