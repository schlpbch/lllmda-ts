# Security

## What this is

This is a **research reference implementation** of the LLMbda calculus
(Garby, Gordon & Sands, arXiv:2602.20064) — a formal calculus for
information-flow security in agentic LLM programs. It implements the
paper's operational semantics and tests the interpreter against the
paper's own examples.

## What this is not

**This code carries no formal security guarantee.** The paper's central
theorems (TIPNI, Insulated TIPNI, oracular correctness) are machine-checked
in Lean 4. This TypeScript port is not. It implements the same algorithm
and is regression-tested against known examples, but that is evidence of
correctness on those cases, not a proof of soundness or noninterference.

Do not deploy this code as a security component of any production system.
It is suitable for research, education, and experimentation only.

## Reporting issues

If you discover a bug or divergence from the paper's semantics, please open
a GitHub issue. Since this is not a hardened security product, there is no
private disclosure process — public issues are appropriate.

When reporting a bug, ideally include:
- A minimal test case (ideally as an `examples/*.ts`-style program)
- The expected vs. actual behavior
- Which paper rule or section the discrepancy affects (if applicable)

See the `examples/` directory for the regression-test format.
