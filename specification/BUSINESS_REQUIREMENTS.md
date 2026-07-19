# Business Requirements Document (BRD): Provenance-Based Agent Security via the LLMbda Calculus

**Relationship to other documents in this folder:** `BUSINESS_ANALYSIS.md`
covers the problem statement, technology overview, and competitive
landscape — not repeated here. `USE_CASES.md` provides the scenario-level
detail each requirement below is traced to. This document formalises and
supersedes the draft requirements table in `BUSINESS_ANALYSIS.md` §9;
that section should be read as the earlier working draft, this document
as the current version.
**Status:** Draft v0.1, for stakeholder review. Not yet approved (see §11).

---

## 1. Purpose

Define the business requirements for adopting provenance-based,
information-flow-controlled agent security — as characterised by the
LLMbda calculus and validated against its named competitors — so that a
build/adopt/wait decision can be made on a documented basis rather than
informally.

## 2. Scope

**In scope:** Requirements for an agent execution environment that (a)
tracks the provenance/trust of data an LLM agent handles, (b) prevents
untrusted data from reaching privileged actions except through an
explicit, auditable override, and (c) does so without materially
reducing the agent's ability to complete legitimate tasks.

**Out of scope (see §8):** Selecting a specific vendor/implementation
(CaMeL vs. FIDES vs. a future LLMbda release vs. building in-house);
performance/latency engineering; general external tool/data-source I/O
beyond what is needed to validate the requirements below; content-based
attack classes outside information flow's reach (see BRule-4).

## 3. Audience

Security/risk engineering, product/agent engineering, compliance, and
whichever stakeholder ultimately owns the build/adopt/wait decision
described in `BUSINESS_ANALYSIS.md` §14.

## 4. Business Objectives

Restated from `BUSINESS_ANALYSIS.md` §8 for traceability:

- **BO-1:** Eliminate the security/utility trade-off current
  provenance-based systems force (enforcement should not materially
  reduce task completion).
- **BO-2:** Achieve architecture independence — the security guarantee
  must not depend on committing to one fixed agent-loop shape.
- **BO-3:** Make every exception to the default security policy explicit
  and auditable.
- **BO-4:** Obtain evidence of correctness stronger than "we ran a
  benchmark and it passed."

## 5. Business Rules

Rules that any candidate solution must satisfy; requirements in §6–7 are
how the rules get implemented and verified.

| ID | Rule |
|---|---|
| BRule-1 | Untrusted data MUST NOT influence a privileged action except through an explicit, audited override. |
| BRule-2 | An override (reclassification) MUST be scoped to a single declared dimension (e.g. trust/integrity) and MUST NOT implicitly weaken any other dimension (e.g. confidentiality). |
| BRule-3 | Every override MUST be individually attributable and reviewable after the fact (see UC-11). |
| BRule-4 | Business stakeholders MUST accept that information-flow control has an inherent ceiling: content whose legitimate meaning *is* the instruction (e.g. "read this file and follow its instructions") is outside what any provenance-based mechanism can distinguish from an attack — this is a semantic problem, not an engineering gap, and is common to every system reviewed in `BUSINESS_ANALYSIS.md` §6. |
| BRule-5 | A retry/repair loop around agent execution MUST NOT introduce an untracked channel that a party could iterate to extract information the enforcement mechanism would otherwise block (see UC-10). |

## 6. Functional Requirements

| ID | Title | Description | Priority | Source | Use Case(s) | Acceptance Criteria | Status |
|---|---|---|---|---|---|---|---|
| FR-1 | Provenance labelling | Every value handled by the agent MUST carry a label describing its trust/provenance, propagated automatically through every operation, without requiring the developer to remember to propagate it manually. | Must | Paper §3.2–3.3 | UC-1–UC-8 | A value derived (via any language construct: field access, arithmetic, function application, etc.) from a labelled input carries a label at least as restrictive as its inputs', verified by test. | Met (by proof, Theorem 1) |
| FR-2 | Sink-side policy assertion | A trust-asserting action MUST be able to declare a required label and refuse execution if the supplied data does not satisfy it. | Must | Paper §3.4 | UC-3, UC-4, UC-8 | Attempting the action with data that does not satisfy the label raises a distinguishable security error rather than silently proceeding or crashing ambiguously. | Met — `SecurityError` distinct from `RuntimeError` (`src/errors.ts`) |
| FR-3 | Isolated sub-conversations | The system MUST support running a sub-task (e.g. classification of untrusted content) in an isolated context that (a) does not see prior conversation history unless explicitly needed, and (b) does not let its own history leak back to the caller. | Must | Paper §3.1, §5.1 | UC-3, UC-7 | A forked+cleared sub-call's observed history contains no prior turns; the outer conversation is unaffected by the sub-call's `send`/`recv` activity. | Met — `examples/clear-isolation.ts` |
| FR-4 | Explicit, scoped override (endorse) | The system MUST provide a mechanism to override a policy on a specific value, scoped to one label dimension, that cannot be silently chained (endorsing an already-endorsed value must fail). | Must | Paper §5.2, App. E.2 | UC-5 | Endorsing a value changes only the targeted dimension (verified: confidentiality is unaffected by an integrity-only endorse); a second endorsement on the same value is refused. | Met — `examples/endorse.ts`, `examples/robust-endorse-cascade.ts` |
| FR-5 | Enforcement over agent-generated code | The provenance/policy guarantee MUST hold for code the agent itself writes and executes at runtime, not only for a fixed, developer-authored control flow. | Must | Paper §1 contribution (2), §4 | UC-2, UC-8 | A dynamically generated and executed program is subject to the same label propagation and refusal behaviour as statically authored code. | Met (by proof) — this is the specific capability the paper demonstrates competing systems lack a soundness theorem for |
| FR-6 | Implicit-flow resistance | Branching on a labelled condition MUST propagate that label to actions taken inside the branch, including on paths not taken by any single run, so a secret cannot escape via an untaken-branch assignment. | Must | Paper §1, §3.4 | UC-9 | The Fenton/Denning-style gadget (secret-conditioned branch assigning to a variable only on the untaken path) is refused when the tainted path attempts a privileged action. | Met — `examples/fenton-denning-leak.ts`, `examples/var-pc-confinement.ts` |
| FR-7 | Runtime-declared labels | The system MUST support labels that are computed/decoded from data at runtime (e.g. a model's own sensitivity declaration), enforced identically to compile-time labels. | Should | Paper §3.2 | UC-6 | A dynamically decoded label raises the ambient enforcement context exactly as a literal label would, verified by test. | Met — `examples/dynamic-label.ts` |
| FR-8 | Multi-dimensional provenance | The system MUST support provenance/label lattices richer than a single trusted/untrusted bit (e.g. distinguishing which of several sources data came from, independent of who may read it). | Should | Paper Appendix D.5 | UC-4 | A sink can require a specific source among several, distinct from a separate readers/confidentiality requirement; both are independently enforceable. | Met — `examples/camel-provenance-quarantine.ts` |
| FR-9 | Retry/repair loop containment | Any retry or repair loop around agent execution MUST run inside the tracked/enforced boundary, not as an external, untracked wrapper. | Must | Paper §1 (second motivating example), §7.1 | UC-2, UC-10 | An adversarial retry scenario (repeatedly probing the same task/policy outcome) does not leak more than the calculus's stated termination-insensitive bound. | **Gap** — UC-2's positive case is demonstrated; no adversarial regression example exists yet in this repository (see `USE_CASES.md` UC-10) |
| FR-10 | Tool library extensibility | Adding a new tool/data source MUST require only labelling that tool's inputs/outputs correctly, without re-verifying the rest of the system. | Should | Paper §7.1, §9 | UC-12 | A new tool with correct labels participates correctly in existing enforcement without code changes elsewhere. | Partially demonstrated — pattern present in `src/prelude.ts`; not exercised by a dedicated example |
| FR-11 | End-to-end tool-integrated agent scenario | The system MUST support a realistic multi-tool task (e.g. reading external data and conditionally executing a high-consequence action) end-to-end. | Must (for production adoption) | Paper §7 | UC-8 | A task requiring both an untrusted read and a trust-gated write completes correctly when the data is legitimately trustworthy (post-endorsement where applicable) and is refused when it is not. | **Gap** — demonstrated in the paper's own Randori/AgentDojo evaluation, not in this repository (external tool I/O is explicitly out of scope for the current port — see NFR-2) |

## 7. Non-Functional Requirements

| ID | Title | Description | Priority | Source | Acceptance Criteria | Status |
|---|---|---|---|---|---|---|
| NFR-1 | Utility parity under enforcement | Enabling enforcement MUST NOT materially reduce legitimate task-completion rate versus an unprotected baseline. | Must | Paper §7.3 (Table 1) | Task-completion rate with enforcement on is within the confidence interval of an unprotected baseline on a representative benchmark. | Reported met on one benchmark (AgentDojo banking, 3 models, source paper's own evaluation); not yet independently reproduced by the adopting organisation |
| NFR-2 | External I/O integration | The system MUST integrate with real external tools and data sources (files, web, APIs), not only in-program functions. | Must (for production) | Paper §9 (stated limitation) | A representative external integration (e.g. a real file or HTTP read) is exercised end-to-end under enforcement. | **Gap** — explicitly out of scope in the current formalisation and in this repository's port |
| NFR-3 | Error-handling ergonomics | The system SHOULD provide error handling / retry ergonomics comparable to unprotected agent frameworks, so developers are not disproportionately burdened by adopting enforcement. | Should | Paper §7.3 (stated disadvantage) | Common runtime errors (not just information-flow errors) can be caught and handled within agent-authored code without escaping enforcement. | **Gap** — flagged by the paper's own authors as a concrete weakness |
| NFR-4 | Independent auditability of the reference artifact | The exact artifact a correctness proof is stated about MUST be available for independent review before being relied on for a compliance claim. | Must (for compliance use) | `BUSINESS_ANALYSIS.md` §11 R-2 | The proof-carrying implementation (or an equivalent, independently reviewable one) can be inspected by the adopting organisation's own security reviewers. | **Not met** — not publicly released at time of writing; this repository's TypeScript port is explicitly non-authoritative (see NFR-4a) |
| NFR-4a | Non-authoritative port disclosure | Any derivative implementation used for prototyping (including this repository) MUST clearly disclaim that it does not carry the formal guarantee, to prevent it being mistaken for a compliance-bearing artifact. | Must | `BUSINESS_ANALYSIS.md` §14 recommendation 3 | The port's own documentation states this without qualification. | Met — see `README.md`, "What this is **not**" |
| NFR-5 | Enforcement latency measurement | The performance overhead of enforcement MUST be measured against baseline agent latency before a production capacity/cost decision is made. | Must (before production) | Not addressed in the source paper (identified gap) | A latency benchmark exists comparing enforced vs. unenforced execution of a representative task. | **Gap** — not measured in the source material; net-new requirement from this analysis |
| NFR-6 | Endorsement audit logging | Every use of an override/reclassification mechanism MUST be logged in a form suitable for after-the-fact compliance review (actor/plan, target value, target label, timestamp). | Must (for compliance use) | Derived from BRule-3, UC-11 | An auditor can enumerate every override in a given period and its justification without re-running the agent. | **Gap** — no structured audit logging exists in the source paper's description or in this repository |
| NFR-7 | Semantic-attack expectation setting | Any security communication to stakeholders MUST state plainly that information-flow control does not, and cannot, defend against content whose legitimate meaning is itself the malicious instruction. | Must | BRule-4 | Security documentation/marketing for the adopted solution explicitly scopes this limitation rather than implying blanket protection. | Open — a communication/process requirement, not a technical one |

## 8. Out of Scope

- Selecting between LLMbda, CaMeL, FIDES, LBAC/TypeGuard, or tacit as the
  adopted solution — this document defines requirements a decision should
  be checked against, not the decision itself.
- Performance/cost engineering beyond establishing the NFR-5 baseline.
- General-purpose external tool/data-source I/O modelling (NFR-2) as a
  design exercise — flagged as a prerequisite for production use, not
  undertaken here.
- Defence against attacks outside information flow's threat model
  (model manipulation via legitimate-looking content, model weight
  attacks, supply-chain compromise of the model provider) — see BRule-4.
- Legal/licensing review of any specific artifact's release terms, once
  one becomes available.

## 9. Assumptions and Constraints

Carried forward from `BUSINESS_ANALYSIS.md` §10–§11 (A1–A4, R-1–R-7);
not restated here to avoid drift between documents. Read that section
alongside this one.

## 10. Requirements Traceability Matrix

| Use Case | Functional Requirements | Non-Functional Requirements |
|---|---|---|
| UC-1 | FR-1, FR-3 | NFR-1 |
| UC-2 | FR-5, FR-9 | NFR-1, NFR-3 |
| UC-3 | FR-2, FR-3, FR-4 | NFR-1 |
| UC-4 | FR-1, FR-2, FR-8 | — |
| UC-5 | FR-4 | NFR-6 |
| UC-6 | FR-1, FR-7 | — |
| UC-7 | FR-3 | — |
| UC-8 | FR-2, FR-5, FR-11 | NFR-1, NFR-2, NFR-5 |
| UC-9 | FR-6 | — |
| UC-10 | FR-9 | — |
| UC-11 | FR-4 | NFR-6 |
| UC-12 | FR-10 | — |

Every functional requirement traces to at least one use case; every use
case traces to at least one requirement. Requirements with no
corresponding "Demonstrated" repository evidence in `USE_CASES.md`
(FR-9, FR-11, NFR-2, NFR-5, NFR-6) are the current gap list for any
adopting organisation's own evaluation plan.

## 11. Acceptance Criteria for This Phase (Requirement-Gathering Exit)

This document, together with `BUSINESS_ANALYSIS.md` and `USE_CASES.md`,
is ready to exit the requirement-gathering phase when:

- [ ] Stakeholders listed in §3 have reviewed and signed off (§12).
- [ ] The build/adopt/wait decision in `BUSINESS_ANALYSIS.md` §14 has been
      made and recorded.
- [ ] Gaps FR-9, FR-11, NFR-2, NFR-5, NFR-6 have an owner and a plan
      (build, defer, or accept as permanent out-of-scope), even if the
      plan is "revisit next quarter."
- [ ] BRule-4 (the semantic-attack ceiling) has been explicitly
      communicated to and acknowledged by whichever stakeholder will make
      external security claims based on this work.

## 12. Approval / Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Security/risk engineering | _TBD_ | _Pending_ | |
| Product/agent engineering | _TBD_ | _Pending_ | |
| Compliance | _TBD_ | _Pending_ | |
| Business sponsor | _TBD_ | _Pending_ | |

## 13. Revision History

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-19 | Initial draft, derived from `BUSINESS_ANALYSIS.md` and `USE_CASES.md`. |

## 14. Glossary

See `BUSINESS_ANALYSIS.md` §15 — not duplicated here.
