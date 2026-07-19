# llmbda-ts

[![CI](https://github.com/schlpbch/lllmda-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/schlpbch/lllmda-ts/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/schlpbch/lllmda-ts/badges/coverage.json)](https://github.com/schlpbch/lllmda-ts/actions/workflows/ci.yml)

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
  dynamic-label.ts             — §3.2, labelDyn: an LLM-declared (not compile-time)
                               sensitivity tag still drives the implicit-flow check
  clear-isolation.ts           — §3.1, clear: proves quarantine's isolation is about
                               conversation HISTORY, not just labels
  camel-provenance-quarantine.ts — Appendix D.5, the CaMeL-style Sources×Readers
                               lattice exercised end to end (a second lattice
                               instance, not just the {U,S} running example)
  deep-label-confinement.ts    — regression test for the deepLabel fix in
                               labelDyn/labelTest/labelAssert/endorse; see
                               "Bugs this port found in itself" below
  prim-wrap-values.ts          — regression test for the wrapValues fix in
                               prim/binop; see "Bugs this port found in itself"
  recv-scope-isolation.ts      — regression test for the recv scope-leak fix;
                               see "Bugs this port found in itself"
  binop-prim-consistency.ts    — regression test for binop/prim consistency
                               (strip-before, wrap-after); see below
  camel-readers-flowsto.ts     — regression test for the camelLattice
                               confidentiality-direction fix; see below

test/run.ts    — runs every examples/*.ts as a pass/fail suite
```

## Bugs this port found in itself

More than once now — first while building the prelude module, then
during two rounds of a deliberate rule-by-rule audit against the paper's
formal semantics — tracing through the exact wording of a rule (or, in
one case, the exact first-principles meaning of a lattice's own
`flowsTo`) surfaced a real gap between what this port did and what the
paper requires. Every instance below was fixed, given a regression test
that was verified to actually fail against the pre-fix code before being
committed against the fixed version (not a rubber stamp), and is left
documented here rather than quietly squashed, because the pattern
connecting them is the
whole point: **the paper's semantics is substitution-based**
(`e[x := e′]`, §3), not environment-based, and every one of these bugs
is a different place where that translation dropped something the
substitution-based reading requires without ever raising a type error —
TypeScript happily compiles an environment lookup that forgets to rejoin
a label, or a helper that never sees the concrete lattice it needs.

### 1. Confinement: `var`/`field` not rejoining the ambient `pc` (found first)

Re-encountering a substituted value under a *raised* `pc` (e.g. inside a
secret-tainted `if` branch) implicitly rejoins the current `pc` via the
`⇓-Labelled`/`⇓-Lam` rules in the paper's substitution-based reading — an
artifact with no natural counterpart in an environment/closure
implementation. `var` lookup and record `.field` access both simply
returned the stored value unchanged, silently dropping exactly the taint
Confinement (Lemma 1, `pc ⊑ ℓ(V)`) guarantees can never be dropped. A
second instance of the same *implicit-flow-through-an-untaken-path* bug
class as the paper's own Fenton/Denning gadget (§1, §3.4) that `send`'s
no-high-upgrade check exists to close — reached through a closure
captured outside a tainted branch and called from inside one, rather
than through an assignment. Fixed in `evaluator.ts`'s `var` and `field`
cases, matching what `⇓-ArrayIndex` already did correctly.
Regression test: `examples/var-pc-confinement.ts`.

### 2. Four rules using a shallow label where the spec requires `deepLabel`

`⇓-LabelFlow`, `⇓-LabelTest`, `⇓-LabelAssert`, and `⇓-Endorse` all require
`flatten(V₁) = n:v₁`, where `n = deepLabel(V₁)` — the join of *every*
label nested anywhere inside the evaluated value, not just its own
top-level label. `send` and `prim` used the `deepLabel` helper already
defined in `evaluator.ts`; `labelDyn`, `labelTest`, `labelAssert`, and
`endorse` used the value's shallow `.label` instead. Concretely
demonstrable: a policy value built from a secretly-tainted sub-part
(e.g. one element of an array individually wrapped in a higher
`labelLit`) has that taint invisible to its own top-level label, so an
`assert` the spec requires to be refused (`n ⊑ pc` fails) instead
silently succeeded. A third instance of the same confinement-violation
class as bug 1, found this time by comparing every rule against the
paper's exact text rather than by an end-to-end attack scenario.
Regression test: `examples/deep-label-confinement.ts`.

### 3. `prim`/`binop` results missing `wrapValues`, crashing on field access

`⇓-Prim` requires a primitive's output to be passed through `wrapValues`,
which stamps `⊥` onto every nested record field / array element. Neither
`stripLabels` nor `Model.primEval` have access to a concrete `Lattice<L>`
to know what `⊥` actually is for a given run, so composite results (from
`recordUpdate` and `shape`, the two built-in primitives that return
records) ended up with nested fields carrying no *valid* label at all —
reading one of those fields back out unconditionally joins the
container's label with the field's, and joining with "no label" isn't
joining with the lattice's bottom (the join-identity element), it's a
`TypeError`. Not a leak — a crash — but a real availability bug and a
structural gap: `wrapValues` has to live in `evaluator.ts`, where `lat`
is actually in scope, not in the lattice-agnostic `model.ts` helpers.
Regression test: `examples/prim-wrap-values.ts`.

### 4. `binop` skipping the strip/wrap steps `prim` does right next to it

§B.1 defines `e1 ⊕ e2 ≜ prim "binop_⊕" [e1, e2]`, so `binop` and `prim`
must treat their argument identically. `prim` stripped labels before
calling `primEval` and wrapped the result after; `binop`, evaluated by
the same interpreter, did neither. Invisible with the packaged
`defaultPrimEval` (which ignores labels), but a real spec divergence and
an internal inconsistency between two cases in the same file, latent for
any primitive table that does inspect labels.
Regression test: `examples/binop-prim-consistency.ts`.

### 5. `recv` merging the caller's local scope into LLM-generated code

`⇓-Recv` evaluates a freshly-parsed response as `M.parse(r)[M.preludeEnv]`
— only prelude identifiers are substituted into it; nothing in the rule
gives a parsed response access to the calling program's own local
bindings. The interpreter instead evaluated the parsed response against
`mergeEnv(env, preludeEnv)` — the *caller's entire current environment*,
merged with the prelude. Since a `recv`'d response is by construction
attacker-influenceable content, a sufficiently expressive `Model.parse`
(a full LLMbda-syntax parser — exactly what an agent that "writes code"
as its plan needs, per §7.1's description of the paper's own Randori
agent) could resolve a bare variable reference in the response straight
to a same-named local binding of the calling program: a complete bypass
of the label system via name collision, not merely a mislabeling.
`defaultParse` (JSON-only) can't emit a `var` AST node, so no example
using it was ever exposed to this — the regression test exercises it
with a `parse` that can. Not a missing join, but an entire unintended
channel. Fixed by evaluating against `preludeEnv` alone.
Regression test: `examples/recv-scope-isolation.ts`.

### 6. `camelLattice`'s confidentiality direction inverted (`readersFlowsTo`)

Found in a second audit pass, this time over `lattice.ts` itself rather
than `evaluator.ts`: the CaMeL-style Sources×Readers lattice's
`readersFlowsTo` checked whether the *destination* label was
`unrestricted` before checking whether the *source* was. Two consequences,
one merely annoying and one a genuine leak:

- `flowsTo(⊥, restricted-label)` was `false` for every non-trivial
  restricted label — bottom, whose readers are `unrestricted`, failed to
  flow into any restricted destination at all, violating the basic
  join-semilattice law every label lattice must satisfy per §3.2
  (`∀l, ⊥ ⊑ l`). A fail-closed availability bug.
- Far more seriously, `flowsTo(restricted-label, ⊥)` was `true` — a
  value restricted to a small set of readers (e.g. `{alice}`) was
  allowed to flow into a fully `unrestricted`/public destination. That
  is precisely the confidentiality leak this whole calculus exists to
  prevent, reachable through the ordinary `send` no-high-upgrade check
  (§1/§3.4) — demonstrated directly: raising `pc` to an alice-only
  label and sending into an already-public conversation was silently
  allowed instead of refused.

Both directions traced to the same root cause (checking `b`'s kind before
`a`'s) and were fixed together, along with the associated lattice-law
sanity checks over a handful of representative labels, not just the
specific leak case.
Regression test: `examples/camel-readers-flowsto.ts`.

The honest framing, said once and still true after finding five more:
this is exactly the class of subtle divergence the original plan warned
"port the algorithm, not just the syntax" about. Two systematic audit
passes found five further instances beyond the first, spanning both
`evaluator.ts` (the rule implementations) and `lattice.ts` (a concrete
lattice instance's own internal correctness) — which is itself evidence
that *ad hoc* discovery (as bug 1 was) isn't enough, and there is no
guarantee even two passes were exhaustive. This is precisely why the
Lean development remains the actual source of truth for the security
theorem, not this repository.

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
pnpm run coverage    # same suite, instrumented with c8 (text + html report in coverage/)
pnpm run example:postcode
pnpm run example:retry
pnpm run example:leak
pnpm run example:confinement
pnpm run example:quarantine
pnpm run example:robust-endorse
pnpm run example:endorse
pnpm run example:camel-provenance
pnpm run example:dynamic-label
pnpm run example:clear-isolation
pnpm run example:deep-label-confinement
pnpm run example:prim-wrap-values
pnpm run example:recv-scope-isolation
pnpm run example:binop-prim-consistency
pnpm run example:camel-readers-flowsto
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
