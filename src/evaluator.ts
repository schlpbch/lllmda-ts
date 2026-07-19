import type { BareValue, Env, Expr, Labeled, Value } from "./ast.js";
import { SecurityError, RuntimeError } from "./errors.js";
import type { FactoredLattice } from "./lattice.js";
import type { Model } from "./model.js";
import type { Oracle } from "./oracle.js";

/**
 * Labeled conversation state — §3.2's `Conv(L) ≜ l : c`. The label is the
 * join of every message ever sent into this conversation; `history` is
 * the literal message list threaded to the model.
 */
export interface LabeledConversation<L> {
  readonly label: L;
  readonly history: ReadonlyArray<string>;
}

export function emptyConversation<L>(bottom: L): LabeledConversation<L> {
  return { label: bottom, history: [] };
}

export interface EvalResult<L> {
  readonly conv: LabeledConversation<L>;
  readonly value: Labeled<L>;
}

/**
 * Recv-call counter (mirrors §B.3's peval fuel/index argument, minus the
 * fuel — see README for why fuel isn't needed in TS), plus a lazily-
 * computed, cached prelude environment (§3.3's M.preludeEnv) shared
 * across every recv in a single run so prelude definitions are only
 * evaluated once, not re-evaluated on every LLM response.
 */
export interface RunState {
  callIndex: number;
  preludeEnvPromise?: Promise<Env>;
}

/**
 * Evaluate `expr` under program-counter label `pc`, conversation `conv`,
 * and variable environment `env`. This is the direct executable analog
 * of the judgment `pc ⊢ C, e ⇓ C′, V` (§3.3) — one case per rule, with
 * the two security-critical rules (send, recv) called out with comments
 * pointing at exactly which paper leak they close.
 */
export async function evaluate<L>(
  model: Model<L>,
  oracle: Oracle,
  run: RunState,
  pc: L,
  conv: LabeledConversation<L>,
  expr: Expr,
  env: Env,
): Promise<EvalResult<L>> {
  const lat = model.lattice;

  switch (expr.kind) {
    // ---------------- core lambda calculus (§3.1) ----------------

    case "var": {
      // The paper's semantics is substitution-based (§3: e[x := e′]), not
      // environment-based. Re-encountering a substituted value under a
      // RAISED pc (e.g. inside a tainted `if` branch) implicitly rejoins
      // the current pc via ⇓-Labelled/⇓-Lam's pc-wrapping. An
      // environment lookup that just hands back the stored value
      // unchanged silently drops that join — a second instance of the
      // same implicit-flow bug class as the Fenton/Denning gadget the
      // `send` rule blocks, just reached via a closure captured outside
      // a tainted branch and called from inside one, instead of via an
      // assignment. See test/var-pc-confinement.ts for the regression
      // test that specifically exercises this.
      const bound = env.get(expr.name);
      if (!bound) throw new RuntimeError(`unbound variable: ${expr.name}`);
      const b = bound as Labeled<L>;
      return { conv, value: { label: lat.join(pc, b.label), value: b.value } };
    }

    case "lam": {
      // ⇓-Lam: return the closure, labeled with the current pc.
      return {
        conv,
        value: { label: pc, value: { kind: "closure", param: expr.param, body: expr.body, env } },
      };
    }

    case "app": {
      // ⇓-App: evaluate fn, then arg, then run the body at the *closure's*
      // label (not the caller's pc) — this is what makes a tainted
      // function's body execute at a tainted pc regardless of who calls it.
      const f = await evaluate(model, oracle, run, pc, conv, expr.fn, env);
      if (f.value.value.kind !== "closure") {
        throw new RuntimeError(`application of a non-function (${f.value.value.kind})`);
      }
      const a = await evaluate(model, oracle, run, pc, f.conv, expr.arg, env);
      const closure = f.value.value;
      const bodyEnv = new Map(closure.env);
      bodyEnv.set(closure.param, a.value);
      return evaluate(model, oracle, run, f.value.label, a.conv, closure.body, bodyEnv);
    }

    // ---------------- conversation primitives (§3.1) ----------------

    case "send": {
      const p = await evaluate(model, oracle, run, pc, conv, expr.prompt, env);
      const n = deepLabel(lat, p.value);
      // ⇓-Send: the no-high-upgrade check. This is the rule that closes
      // the paper's Leak 1 (Fenton/Denning gadget, §1/§3.4): a write is
      // only allowed if the current pc flows to the conversation's own
      // label. Get this check wrong (or drop it) and an implicit flow
      // through an untaken branch silently escapes tracking, exactly
      // like CaMeL's `rich = False` example.
      if (!lat.flowsTo(pc, p.conv.label)) {
        throw new SecurityError(
          `send: pc ${lat.show(pc)} does not flow to conversation label ${lat.show(p.conv.label)}`,
        );
      }
      const serialised = model.serialise(p.value.value);
      const newLabel = lat.join(p.conv.label, n);
      return {
        conv: { label: newLabel, history: [...p.conv.history, serialised] },
        value: { label: pc, value: { kind: "record", fields: new Map() } }, // pc : {}
      };
    }

    case "recv": {
      if (!lat.flowsTo(pc, conv.label)) {
        throw new SecurityError(
          `recv: pc ${lat.show(pc)} does not flow to conversation label ${lat.show(conv.label)}`,
        );
      }
      const callIndex = run.callIndex++;
      const response = await oracle.respond(conv.history, callIndex);
      const newConv: LabeledConversation<L> = {
        label: conv.label,
        history: [...conv.history, response],
      };
      const parsedExpr = model.parse(response);
      const preludeEnv = await getPreludeEnv(model, oracle, run);
      // ⇓-Recv: the parsed response is evaluated at pc = conv.label — the
      // conversation's OWN label, not whatever pc the caller of `recv`
      // happened to be running at. This is the rule that closes Leak 3
      // (§1): generated code inherits the taint of the conversation it
      // came from automatically, with no special-casing of `parse` and
      // no way for an adversarial response to escape its source label
      // (Confinement, Lemma 1: pc ⊑ ℓ(V) always holds on the way out).
      //
      // Deliberately evaluated against `preludeEnv` alone, NOT
      // `mergeEnv(env, preludeEnv)`. The paper's rule is
      // `M.parse(r)[M.preludeEnv]` (§3.3) — only prelude identifiers are
      // substituted into a freshly-parsed response. The calling
      // program's own local bindings (`env`) must stay invisible to
      // LLM-generated code; otherwise a response that happens to
      // reference a name colliding with a caller-local variable (e.g. a
      // full LLMbda-syntax parser emitting a bare `var` node) resolves
      // straight to that binding's value — a complete bypass of the
      // label system via name collision, not merely a mislabeling. See
      // examples/recv-scope-isolation.ts for the regression test.
      return evaluate(model, oracle, run, newConv.label, newConv, parsedExpr, preludeEnv);
    }

    case "fork": {
      // ⇓-Fork: snapshot conv, run expr.body against it, then return the
      // ORIGINAL conv to the caller — whatever expr.body did to the
      // conversation is invisible outside the fork. This is the entire
      // mechanism behind `quarantine` (§5.1): sandboxing is just scoping.
      const inner = await evaluate(model, oracle, run, pc, conv, expr.body, env);
      return { conv, value: inner.value };
    }

    case "clear": {
      if (!lat.flowsTo(pc, conv.label)) {
        throw new SecurityError(
          `clear: pc ${lat.show(pc)} does not flow to conversation label ${lat.show(conv.label)}`,
        );
      }
      return {
        conv: { label: pc, history: [] },
        value: { label: pc, value: { kind: "record", fields: new Map() } },
      };
    }

    // ---------------- labels and tests (§3.2) ----------------

    case "labelLit": {
      const l = decodeLiteralLabel(model, expr.label);
      const inner = await evaluate(model, oracle, run, lat.join(pc, l), conv, expr.expr, env);
      return { conv: inner.conv, value: { label: lat.join(l, inner.value.label), value: inner.value.value } };
    }

    case "labelDyn": {
      const l1 = await evaluate(model, oracle, run, pc, conv, expr.labelExpr, env);
      const decoded = model.toLabel(l1.value.value);
      if (decoded === undefined) throw new RuntimeError("labelDyn: e1 value is not a valid label");
      // ⇓-LabelFlow: n = deepLabel(V1), the join of every label nested
      // anywhere inside the label-describing value — not just its own
      // shallow/top-level label. A label literal built from tainted
      // sub-parts (e.g. an array whose individual elements are
      // separately labelLit'd) must have that taint counted here, or it
      // silently escapes the pc-raise this rule exists to perform.
      const targetPc = lat.join(pc, lat.join(deepLabel(lat, l1.value), decoded));
      const inner = await evaluate(model, oracle, run, targetPc, l1.conv, expr.expr, env);
      return { conv: inner.conv, value: inner.value };
    }

    case "labelTest": {
      const policy = await evaluate(model, oracle, run, pc, conv, expr.policy, env);
      const decoded = model.toLabel(policy.value.value);
      if (decoded === undefined) throw new RuntimeError("labelTest: e1 value is not a valid label");
      // ⇓-LabelTest: n = deepLabel(V1) — see the identical note in
      // labelDyn above; the policy value's deep taint, not just its
      // shallow label, must raise pc for evaluating the tested data.
      const n = deepLabel(lat, policy.value);
      const data = await evaluate(model, oracle, run, lat.join(pc, n), policy.conv, expr.expr, env);
      const b = lat.flowsTo(data.value.label, decoded);
      // Result is labeled at pc ⊔ n ⊔ l — the *policy threshold*, not the
      // tested data's own label (§3.4). This is what makes the boolean
      // result usable for branching without the branch itself becoming
      // as tainted as the data being tested.
      return {
        conv: data.conv,
        value: { label: lat.join(pc, lat.join(n, decoded)), value: { kind: "bool", value: b } },
      };
    }

    case "labelAssert": {
      const policy = await evaluate(model, oracle, run, pc, conv, expr.policy, env);
      const decoded = model.toLabel(policy.value.value);
      if (decoded === undefined) throw new RuntimeError("labelAssert: e1 value is not a valid label");
      // ⇓-LabelAssert: n = deepLabel(V1) — a policy threshold assembled
      // from secretly-tainted sub-parts must itself be treated as
      // secret-influenced (n ⊑ pc below), or a secret can determine
      // which policy gets checked without the check itself ever firing.
      const n = deepLabel(lat, policy.value);
      if (!lat.flowsTo(n, pc)) {
        throw new SecurityError(`assert: policy label ${lat.show(n)} does not flow to pc ${lat.show(pc)}`);
      }
      const data = await evaluate(model, oracle, run, pc, policy.conv, expr.expr, env);
      if (!lat.flowsTo(data.value.label, decoded)) {
        throw new SecurityError(
          `assert: value labeled ${lat.show(data.value.label)} does not flow to required ${lat.show(decoded)}`,
        );
      }
      return { conv: data.conv, value: { label: pc, value: { kind: "record", fields: new Map() } } };
    }

    // ---------------- endorsement (§5.2) ----------------

    case "endorse": {
      const factoredLat = asFactoredLattice(model);
      if (!factoredLat) {
        throw new RuntimeError(
          "endorse: the current model's lattice does not implement FactoredLattice — " +
            "endorse requires toIntegrity/toConfidentiality/pair (see lattice.ts)",
        );
      }
      const e1 = await evaluate(model, oracle, run, pc, conv, expr.target, env);
      // ⇓-Endorse: n = deepLabel(V1) — see the identical note in
      // labelDyn/labelTest/labelAssert above.
      const n = deepLabel(lat, e1.value);
      const l1 = model.toLabel(e1.value.value);
      if (l1 === undefined) throw new RuntimeError("endorse: e1 value is not a valid label");
      const e2 = await evaluate(model, oracle, run, lat.join(pc, n), e1.conv, expr.expr, env);
      const l2 = e2.value.label;
      // ⇓-Endorse: result integrity comes from the TARGET label (l1),
      // result confidentiality comes from the VALUE's own label (l2) —
      // endorse can only ever weaken integrity, never confidentiality.
      // This is what Insulated TIPNI (Theorem 2) is a statement about.
      const combined = factoredLat.pair(factoredLat.toIntegrity(l1), factoredLat.toConfidentiality(l2));
      const resultLabel = lat.join(pc, combined);
      return { conv: e2.conv, value: { label: resultLabel, value: e2.value.value } };
    }

    // ---------------- JSON-style data (§B.1) ----------------

    case "scalar":
      return { conv, value: { label: pc, value: expr.value } };

    case "record": {
      let c = conv;
      const fields = new Map<string, Labeled<L>>();
      for (const [name, fieldExpr] of expr.fields) {
        const r = await evaluate(model, oracle, run, pc, c, fieldExpr, env);
        c = r.conv;
        fields.set(name, r.value);
      }
      return { conv: c, value: { label: pc, value: { kind: "record", fields } } };
    }

    case "array": {
      let c = conv;
      const items: Labeled<L>[] = [];
      for (const itemExpr of expr.items) {
        const r = await evaluate(model, oracle, run, pc, c, itemExpr, env);
        c = r.conv;
        items.push(r.value);
      }
      return { conv: c, value: { label: pc, value: { kind: "array", items } } };
    }

    case "field": {
      const o = await evaluate(model, oracle, run, pc, conv, expr.obj, env);
      if (o.value.value.kind !== "record") throw new RuntimeError(`field access on non-record`);
      const f = o.value.value.fields.get(expr.name);
      if (!f) throw new RuntimeError(`no such field: ${expr.name}`);
      // ⇓-FieldAccess joins the record's own label (l1) into the
      // extracted field's label, the same way ⇓-ArrayIndex joins the
      // array's and index's labels into the extracted element below —
      // this was previously missing here, silently dropping the
      // record's own taint on every `.field` read.
      const fl = asL<L>(f);
      return { conv: o.conv, value: { label: lat.join(o.value.label, fl.label), value: fl.value } };
    }

    case "index": {
      const o = await evaluate(model, oracle, run, pc, conv, expr.obj, env);
      if (o.value.value.kind !== "array") throw new RuntimeError(`index access on non-array`);
      const i = await evaluate(model, oracle, run, pc, o.conv, expr.idx, env);
      if (i.value.value.kind !== "number") throw new RuntimeError(`index must be a number`);
      const idx = i.value.value.value;
      if (idx < 0 || idx >= o.value.value.items.length) {
        throw new RuntimeError(`index out of bounds: ${idx}`);
      }
      const elem = asL<L>(o.value.value.items[idx]!);
      return {
        conv: i.conv,
        value: { label: lat.join(o.value.label, lat.join(i.value.label, elem.label)), value: elem.value },
      };
    }

    case "prim": {
      const a = await evaluate(model, oracle, run, pc, conv, expr.arg, env);
      const stripped = stripLabels(a.value.value);
      const result = model.primEval(expr.name, stripped);
      // ⇓-Prim requires the result be passed through wrapValues, which
      // stamps ⊥ onto every nested record field / array element —
      // primEval's own well-formedness obligation is to return a
      // completely label-free term, but neither stripLabels nor
      // Model.primEval have access to a concrete Lattice<L> to know what
      // "label-free" (⊥) actually is for this run, so that stamping has
      // to happen here, where `lat` is in scope. Skipping this step
      // leaves nested fields with no valid label at all, which crashes
      // the next `field`/`index` access into the result (see
      // examples/prim-wrap-values.ts).
      const wrapped = wrapValues(lat, result);
      return { conv: a.conv, value: { label: lat.join(pc, deepLabel(lat, a.value)), value: wrapped } };
    }

    // ---------------- derived forms (desugared here, not at parse time) ----------------

    case "let": {
      const bound = await evaluate(model, oracle, run, pc, conv, expr.value, env);
      const newEnv = new Map(env);
      newEnv.set(expr.name, bound.value);
      return evaluate(model, oracle, run, pc, bound.conv, expr.body, newEnv);
    }

    case "if": {
      const c = await evaluate(model, oracle, run, pc, conv, expr.cond, env);
      if (c.value.value.kind !== "bool") throw new RuntimeError("if: condition is not a boolean");
      // NOTE: branching raises pc by the condition's own label for the
      // duration of the chosen branch — this is standard secure
      // multi-execution / implicit-flow tracking (Denning & Denning) and
      // is what a `send` inside a tainted `if` will be checked against.
      const branchPc = lat.join(pc, c.value.label);
      return evaluate(model, oracle, run, branchPc, c.conv, c.value.value.value ? expr.then : expr.else, env);
    }

    case "binop": {
      // §B.1: e1 ⊕ e2 ≜ prim "binop_⊕" [e1, e2] — this case must treat
      // the packed-array argument identically to how `case "prim"`
      // treats its own argument (strip before calling primEval, wrap
      // the result after), or a custom Model.primEval that legitimately
      // inspects labels sees differently-shaped input depending on
      // whether the caller wrote `prim(...)` or used `⊕` sugar.
      const l = await evaluate(model, oracle, run, pc, conv, expr.left, env);
      const r = await evaluate(model, oracle, run, pc, l.conv, expr.right, env);
      const opName = binopPrimName(expr.op);
      const arg: BareValue = {
        kind: "array",
        items: [
          { label: l.value.label, value: l.value.value },
          { label: r.value.label, value: r.value.value },
        ],
      };
      const stripped = stripLabels(arg);
      const result = model.primEval(opName, stripped);
      const wrapped = wrapValues(lat, result);
      return {
        conv: r.conv,
        value: { label: lat.join(pc, lat.join(l.value.label, r.value.label)), value: wrapped },
      };
    }
  }
}

// -------------------- helpers --------------------

/**
 * Runtime + type-level check that a model's lattice is factored (§5.2).
 * Returns the lattice narrowed to FactoredLattice<L, I, S>, or undefined
 * if it isn't — `endorse` uses this instead of assuming every model
 * supports reclassification.
 */
function asFactoredLattice<L>(model: Model<L>): FactoredLattice<L, unknown, unknown> | undefined {
  const lat = model.lattice as unknown as Record<string, unknown>;
  if (typeof lat["toIntegrity"] === "function" && typeof lat["toConfidentiality"] === "function" && typeof lat["pair"] === "function") {
    return model.lattice as unknown as FactoredLattice<L, unknown, unknown>;
  }
  return undefined;
}

/** deepLabel(V) — the join of every label occurring anywhere inside V, §3.3. */
function deepLabel<L>(lat: import("./lattice.js").Lattice<L>, v: Labeled<L>): L {
  let acc = v.label;
  const visit = (bv: BareValue): void => {
    if (bv.kind === "record") for (const f of bv.fields.values()) { const fl = asL<L>(f); acc = lat.join(acc, fl.label); visit(fl.value); }
    if (bv.kind === "array") for (const it of bv.items) { const il = asL<L>(it); acc = lat.join(acc, il.label); visit(il.value); }
  };
  visit(v.value);
  return acc;
}

/**
 * Cast a Labeled<unknown> sub-value (as stored inside records/arrays,
 * see the Value alias in ast.ts) up to Labeled<L> for the current run.
 * Sound because every value flowing through a single `evaluate` call
 * shares the same Model<L> and therefore the same concrete label type —
 * the `unknown` on stored sub-values only exists to avoid infecting
 * BareValue with a generic parameter it doesn't otherwise need.
 */
function asL<L>(v: Value): Labeled<L> {
  return v as unknown as Labeled<L>;
}

/** stripLabels(V) — erase every label annotation, recursively, §3.3. */
function stripLabels(bv: BareValue): BareValue {
  if (bv.kind === "record") {
    const fields = new Map<string, unknown>();
    for (const [k, f] of bv.fields) fields.set(k, { label: undefined, value: stripLabels((f as Labeled<unknown>).value) });
    return { kind: "record", fields: fields as never };
  }
  if (bv.kind === "array") {
    return { kind: "array", items: bv.items.map((it) => ({ label: undefined, value: stripLabels(it.value) })) as never };
  }
  return bv;
}

/**
 * wrapValues(e) — §B.1: lift the label-free output of a primitive back
 * into the labelled-value grammar, stamping ⊥ onto every record field
 * and array element, however deeply nested; scalars are left unchanged.
 * The stamps are neutral (⊥ ⊔ l = l), so they record no taint of their
 * own — this exists only so nested fields have a *valid* label of the
 * concrete type L at all (stripLabels erases to a placeholder that
 * isn't a real L), not to encode any information.
 */
function wrapValues<L>(lat: import("./lattice.js").Lattice<L>, bv: BareValue): BareValue {
  if (bv.kind === "record") {
    const fields = new Map<string, Labeled<L>>();
    for (const [k, f] of bv.fields) {
      const fv = asL<L>(f).value;
      fields.set(k, { label: lat.bottom, value: wrapValues(lat, fv) });
    }
    return { kind: "record", fields: fields as never };
  }
  if (bv.kind === "array") {
    return {
      kind: "array",
      items: bv.items.map((it) => ({ label: lat.bottom, value: wrapValues(lat, asL<L>(it).value) })) as never,
    };
  }
  return bv;
}

function binopPrimName(op: string): string {
  // §B.1's binop grammar is `+ | − | × | ÷ | mod | = | < | > | ≤ | ≥`
  // ("mod" was missing here entirely — a genuine primitive from the
  // paper's grammar that this port's BinOp type admits constructing but
  // that always threw "unsupported binop" when evaluated). "!=" isn't in
  // that grammar at all — the paper defines it as a *derived form*,
  // `e1 ≠ e2 ≜ if (e1 = e2) then false else true` (§B.1) — but this
  // port's BinOp type includes it as if it were a primitive, and it had
  // the exact same "always throws" gap. Implemented here as a direct
  // primitive (binop_neq) rather than literally desugaring through `if`,
  // since negating an already-computed equality doesn't need `if`'s
  // pc-raising machinery: the result's label is pc ⊔ ℓ(left) ⊔ ℓ(right)
  // either way, identically to every other binop.
  const table: Record<string, string> = {
    "+": "binop_add",
    "-": "binop_sub",
    "*": "binop_mul",
    "/": "binop_div",
    "%": "binop_mod",
    "==": "binop_eq",
    "!=": "binop_neq",
    "<": "binop_lt",
    ">": "binop_gt",
    "<=": "binop_le",
    ">=": "binop_ge",
  };
  const name = table[op];
  if (!name) throw new RuntimeError(`unsupported binop: ${op}`);
  return name;
}

export function mergeEnv(a: Env, b: Env): Env {
  const merged = new Map(a);
  for (const [k, v] of b) merged.set(k, v);
  return merged;
}

/**
 * Evaluate every entry of `model.preludeSource` (§3.3's M.preludeEnv) to
 * an actual value — e.g. `fix`'s definition evaluates to a closure,
 * `quarantine`'s definition evaluates to a closure, etc — and cache the
 * resulting Env on `run` so it's computed once per run, not re-evaluated
 * on every recv. Prelude definitions are evaluated at the lattice's
 * bottom label and against an empty conversation: they're pure
 * definitions (typically bare lambdas, or applications that build one,
 * like the Y-combinator), so evaluating them never touches conv and
 * never calls the oracle — but the oracle is threaded through anyway in
 * case a future prelude entry legitimately needs one.
 */
export async function getPreludeEnv<L>(model: Model<L>, oracle: Oracle, run: RunState): Promise<Env> {
  if (!run.preludeEnvPromise) {
    run.preludeEnvPromise = (async () => {
      const env = new Map<string, Labeled<unknown>>();
      if (!model.preludeSource) return env;
      for (const [name, bodyExpr] of model.preludeSource) {
        const result = await evaluate(
          model,
          oracle,
          run,
          model.lattice.bottom,
          emptyConversation(model.lattice.bottom),
          bodyExpr,
          env, // later prelude entries may reference earlier ones by name
        );
        env.set(name, result.value);
      }
      return env;
    })();
  }
  return run.preludeEnvPromise;
}

/**
 * Convenience entry point: builds the prelude env once, merges it with
 * `baseEnv` (baseEnv bindings win on name collisions), and evaluates
 * `program` against it. This is what user code should call instead of
 * `evaluate()` directly when the model has a preludeSource — the
 * top-level program gets prelude access the same way LLM-generated code
 * does inside `recv`, rather than only the latter.
 */
export async function runProgram<L>(
  model: Model<L>,
  oracle: Oracle,
  pc: L,
  conv: LabeledConversation<L>,
  program: Expr,
  baseEnv: Env = new Map(),
): Promise<EvalResult<L>> {
  const run = newRunState();
  const preludeEnv = await getPreludeEnv(model, oracle, run);
  const env = mergeEnv(preludeEnv, baseEnv);
  return evaluate(model, oracle, run, pc, conv, program, env);
}

function decodeLiteralLabel<L>(model: Model<L>, label: unknown): L {
  const decoded = model.toLabel(label as BareValue);
  if (decoded !== undefined) return decoded;
  // Fall back: treat the literal as already being of type L (the common
  // case when building ASTs directly in TS with e.g. labelLit(S, ...)).
  return label as L;
}

export function newRunState(): RunState {
  return { callIndex: 0 };
}
