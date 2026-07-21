# Architecture

This document describes how the pieces of `src/` fit together at runtime.
For the theoretical background and the paper section each module
implements, see `README.md`; for repo-wide conventions, see `CLAUDE.md`;
for the reasoning behind individual design decisions, see `docs/adr/`.

## Big picture

The interpreter evaluates a single `Expr` AST (`ast.ts`) against a
labeled evaluation judgment `pc ⊢ conv, expr ⇓ conv′, value`
(`evaluator.ts`), where every intermediate value carries an
information-flow label drawn from a pluggable `Lattice<L>` (`lattice.ts`).
The only way the interpreter talks to an LLM is through an `Oracle`
(`oracle.ts`), and the only place that policy lives — how labels are
represented, how responses are parsed, what primitives exist — is a
`Model<L>` (`model.ts`) passed in by the caller.

```
              Model<L>            Oracle
           (parse/serialise/       (respond:
            primEval/toLabel)     history → string)
                  \                  /
                   \                /
                 evaluate(model, oracle, run,
                          pc, conv, expr, env)
                          |
                          v
                  EvalResult<L> = { conv, value }
```

`evaluate` is a pure recursive function of its arguments (modulo the
`Oracle` call, which is the one deliberately-impure boundary — see
"Where nondeterminism lives" below). Everything else — labels, the
conversation, the environment — is threaded explicitly rather than
mutated, mirroring the paper's judgment form directly.

## Data flow through one `evaluate` call

Every case in the big `switch` in `evaluator.ts` follows the same shape:

1. Recursively evaluate sub-expressions, left to right, **threading the
   conversation (`conv`) through each step** — a `send` inside the left
   operand of a `binop` must be visible to the right operand's `recv`.
2. Compute a result label by `join`-ing whichever input labels the
   paper's rule says are relevant (usually `pc` plus the labels of
   whatever was read).
3. Return `{ conv, value: { label, value } }` — never mutate anything
   the caller passed in.

This threading is why `evaluate`'s signature carries both `conv` (the
conversation being built up) and `env` (the lexical environment) as
separate parameters, and why `EvalResult<L>` bundles the possibly-updated
conversation with the produced value: the two evolve together but not in
lockstep — `record`/`array`/`binop` may call `send`/`recv` multiple times
across sibling sub-expressions and must propagate the conversation from
each into the next.

## The four things wired together at the top

| Piece | File | Role |
|---|---|---|
| `Lattice<L>` / `FactoredLattice<L,I,S>` | `lattice.ts` | Defines what a label *is* and how labels combine (`join`, `flowsTo`). Swappable — the `{U,S}`-powerset and CaMeL-style Sources×Readers lattices are both provided as drop-in instances. |
| `Model<L>` | `model.ts` | Glue between the calculus and the outside world: `parse`/`serialise` cross the Expr↔string boundary at every `send`/`recv`; `primEval` is the open primitive table; `toLabel`/`fromLabel` decode/encode labels as ordinary values so label literals can be constructed by object-language code. |
| `Oracle` | `oracle.ts` | The *only* thing that can produce nondeterminism (an LLM response). `scriptedOracle`/`ruleOracle` are test doubles; a production oracle is a thin wrapper around a real API call. |
| `evaluate` / `runProgram` | `evaluator.ts` | The semantics itself, plus the prelude-loading and top-level entry point. |

A caller assembles a `Model<L>` (usually `usLattice`/`usFactoredLattice`
plus `defaultParse`/`defaultSerialise`/`defaultPrimEval`) and an `Oracle`,
then calls `runProgram(model, oracle, pc, conv, program)`. See
`examples/postcode.ts` for the minimal version of this wiring.

## Where nondeterminism lives

`evaluate` never talks to a model directly. The `recv` case is the only
place `oracle.respond(history, callIndex)` is called (`evaluator.ts`,
`case "recv"`). This mirrors the paper's Burton's-pseudo-data trick
(§6): nondeterminism is pushed into an explicit argument (the oracle),
keeping the interpreter itself a pure function of `(model, oracle, run,
pc, conv, expr, env)`. Practically, this is what makes `send`/`recv`/
`fork`/`clear` unit-testable without a real LLM: `scriptedOracle` pins
one deterministic branch of the space of possible conversations.

`RunState.callIndex` (incremented on every `recv`) is threaded alongside
the oracle rather than derived from `conv.history.length`, because a
`fork` can call `recv` against a *snapshotted* conversation whose length
doesn't reflect how many oracle calls have actually happened in the run
— see `case "fork"`.

## The conversation as the security boundary

`LabeledConversation<L>` (`evaluator.ts`) pairs a message history with a
single label — the join of every message ever sent into it. Three rules
gate access to it, and all three follow the same shape: check
`flowsTo(pc, conv.label)` *before* touching the conversation, then update
`conv.label` by joining in whatever new taint was introduced:

- **`send`** — checked in the outgoing direction: the current `pc` (plus
  the label of the value chosen to send) must flow to the conversation's
  label. This is the rule that closes the paper's Leak 1 (Fenton/Denning
  gadget, §3.4) — see `examples/fenton-denning-leak.ts`.
- **`recv`** — the parsed response is evaluated at `pc = conv.label`
  (not the caller's `pc`), so generated code automatically inherits the
  taint of the conversation it came from. This closes Leak 3 (§1) and is
  the Confinement property (`pc ⊑ ℓ(V)` always holds on the way out).
- **`clear`** — resets `history` to `[]` and re-labels the conversation
  at `pc`, so a cleared conversation can't be used to smuggle the old
  history's taint forward under a lower label.
- **`fork`** — doesn't gate the conversation at all; it *snapshots* it.
  `expr.body` evaluates against a copy of `conv`, and whatever it does
  (including `send`/`recv`/`clear`) is invisible to the caller, who gets
  back the *original* `conv` unchanged. This scoping mechanism is the
  entire implementation of `quarantine` (`prelude.ts`, §5.1) — sandboxing
  an untrusted sub-conversation is just running it inside a `fork`.

## Labels: representation vs. semantics

`lattice.ts` separates "what operations does a label support"
(`Lattice<L>`: `join`, `flowsTo`, `equals`, `bottom`, `show`) from any
particular representation. `evaluator.ts` only ever calls through this
interface — it has no idea whether `L` is a string-tag array
(`UsLabel`) or a `{sources, readers}` pair (`CamelLabel`). `endorse`
additionally requires `FactoredLattice<L,I,S>` (integrity × confidentiality
decomposition); `evaluator.ts`'s `asFactoredLattice` does a runtime
capability check (via checking for `toIntegrity`/`toConfidentiality`/
`pair`) rather than requiring every `Model<L>` to supply a factoring, so
models that never use `endorse` don't pay for it.

Labels attach to *every* value (`Labeled<L>` in `ast.ts`), not just to
top-level results. Records and arrays store their fields/elements as
`Value = Labeled<unknown>` rather than `Labeled<L>` — see the note in
`ast.ts` and the `asL<L>` cast in `evaluator.ts` — because threading `L`
through `BareValue` generically would infect every data-shape type for a
property (label homogeneity within one run) that's already guaranteed by
construction: a single `evaluate()` call always closes over one concrete
`Model<L>`.

## The prelude: object-language code, not host functions

`prelude.ts` defines `fix`, `quarantine`, `robust_endorse`, and
`bounded_endorse` as `Expr` values built from the same AST constructors
in `ast.ts` — not as TypeScript helper functions. `Model.preludeSource`
(`model.ts`) exposes these as a name→`Expr` map. `evaluator.ts`'s
`getPreludeEnv` evaluates each entry once per run (caching the result on
`RunState`, since prelude definitions are pure closures and don't touch
`conv` or the oracle), and the resulting `Env` is merged into scope both
for the top-level program (`runProgram`) and for every parsed `recv`
response (`case "recv"`) — mirroring §3.3's `M.preludeEnv` being visible
to LLM-generated code, not just to the program that started the run.

This has to be object-language code because agent-generated code (a
string an LLM returns, parsed by `Model.parse` into an `Expr`) can only
call things that are named bindings *in that Expr's environment* — a
plain TS function isn't reachable from parsed code at all.

## Adding a new evaluation rule

If you're extending the calculus with a new `Expr` variant:

1. Add the variant to the `Expr` union in `ast.ts`, plus a builder
   function alongside the existing ones (`v`, `lam`, `app`, ...).
2. Add a `case` to the `switch` in `evaluate` (`evaluator.ts`). Follow
   the existing pattern: thread `conv` through every recursive
   sub-evaluation in evaluation order, and label the result by `join`ing
   in whichever input labels are relevant per the rule you're porting.
3. If the case reads a value out of an existing structure (an
   environment, a record, an array — anything already-bound rather than
   freshly constructed), check whether it needs to re-join the ambient
   `pc`/container label the way `var`, `field`, and `index` do. See
   "Substitution semantics, not environments" in `CLAUDE.md` — this is
   the single most common way a new case can silently reintroduce the
   confinement bug that was already found and fixed once.
4. Add a regression example under `examples/` exercising the new rule
   (it's picked up automatically by `test/run.ts`).
