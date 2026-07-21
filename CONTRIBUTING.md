# Contributing

Thanks for your interest in contributing to LLMbdaJS!

## Building and testing

```bash
pnpm install
pnpm run build               # tsc -p tsconfig.json — strict build, checks src/ only
pnpm run typecheck           # tsc -p tsconfig.examples.json — typechecks src/+examples/+test/
pnpm test                    # node --import tsx test/run.ts — runs every examples/*.ts as pass/fail
pnpm run coverage            # same suite, instrumented with c8 (text + html report in coverage/)
pnpm run example:<name>      # run one example directly, e.g. pnpm run example:postcode
```

All of these commands must pass in CI before your changes can be merged. The
project enforces 100% statement/function/line coverage and a full typecheck
(see `CONSTITUTION.md` Article 7).

## Key principles

Before proposing a change, please read `CONSTITUTION.md` — it states the
non-negotiable principles this project is developed under. The most important
ones for contributors:

- **Article 1 (paper fidelity):** Any change to `src/evaluator.ts` or
  `src/lattice.ts` must match the paper's exact rule text, not just "look
  reasonable." If you're porting a new rule or fixing an existing one, cite
  the exact paper section.
- **Article 3 (regression tests):** Every bug fix ships with a test that
  fails against the pre-fix code and passes against the fix. This isn't
  optional — it's how the project has found eight real divergences from the
  spec that code review alone missed.
- **Article 7 (coverage):** Your changes must maintain 100% statement/
  function/line coverage. If new code is uncovered, add an example to
  `examples/` that exercises it; if it's genuinely unreachable, document
  why.

## Design decisions

See `docs/adr/` for the reasoning behind the architecture and major design
choices (why quarantine/endorse/fix are object-language closures, why
there's no weight tracking, etc.). These decisions have trade-offs — read
the ADRs before proposing a change that would revisit them.

## Questions?

If you're stuck, open an issue or reach out — the project is small and
maintains a detailed git history explaining the reasoning behind both
features and fixes.
