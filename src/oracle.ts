/**
 * Oracle abstraction — §6.
 *
 * The paper's peval interpreter is a pure function of an oracle
 * `o : ℕ → List String → String`: at each `recv`, instead of sampling,
 * it looks up the oracle's answer for that call-index and conversation
 * history (Burton's "pseudo-data" trick — push nondeterminism into an
 * argument, keep the interpreter pure). In production the oracle is a
 * thin wrapper around a real LLM call; in tests it's a scripted table,
 * which is what makes the security-critical rules unit-testable without
 * ever touching a real model.
 *
 * We don't reproduce Theorem 3 (oracular correctness) — that's a
 * measure-theoretic statement about a canonical product measure over the
 * *space* of oracles, and isn't something TypeScript's type system can
 * state, let alone prove. What we keep is the actual engineering pattern
 * the theorem is *about*: the evaluator never talks to a model directly.
 */
import { RuntimeError } from "./errors.js";

export interface Oracle {
  /**
   * Produce the next LLM response given the conversation history so far.
   * `callIndex` is the 0-based index of this recv within the run — kept
   * explicit (rather than just relying on `history.length`) because a
   * scripted test oracle may want to respond differently to identical
   * histories on different calls (e.g. "fail twice, then succeed").
   */
  respond(history: ReadonlyArray<string>, callIndex: number): Promise<string>;
}

/**
 * A scripted oracle for tests: a fixed list of canned responses, returned
 * in order regardless of history. This is the direct analog of fixing a
 * single oracle `o` in the paper's worked examples (§B.3.1) — it pins one
 * branch of the probabilistic tree so a run is fully deterministic and
 * replayable.
 */
export function scriptedOracle(responses: ReadonlyArray<string>): Oracle {
  let i = 0;
  return {
    async respond(_history, callIndex) {
      if (callIndex >= responses.length) {
        // Plain Error here would break the same invariant fixed in
        // model.ts's defaultPrimEval (see README/CLAUDE.md's audit
        // history): every ordinary, expected failure evaluate() can
        // produce should be a RuntimeError, distinguishable from a
        // SecurityError policy refusal.
        throw new RuntimeError(
          `scriptedOracle: no response scripted for call #${callIndex} ` +
            `(only ${responses.length} scripted)`,
        );
      }
      const r = responses[callIndex]!;
      i++;
      void i;
      return r;
    },
  };
}

/**
 * A rule-based oracle for tests that need to react to *what was asked*
 * rather than just call order — e.g. the retry-loop example (§2.2, §C.1)
 * where later prompts embed the previous error message and the oracle
 * needs to eventually "fix" its answer.
 */
export function ruleOracle(
  rule: (history: ReadonlyArray<string>, callIndex: number) => string,
): Oracle {
  return { async respond(history, callIndex) {
    return rule(history, callIndex);
  } };
}
