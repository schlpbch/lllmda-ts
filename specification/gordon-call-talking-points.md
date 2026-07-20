# Talking Points — Call with Andy Gordon

## Time: Tuesday, 11:00 to 11:30 CEST

Tone: Curious, humble, and respectful. I want to learn from Andy Gordon, and to
engage in a meaningful discussion with a potentially long-term collaborator.

---

## Opening (5 min)

- About myself: My day job is a enterprise/solution architect at Swiss Federal
  Railways (SBB) working with +25 teams on business critical systems with ~20
  years of experience. I have a PHD in (applied) machine learning and a master's
  in computer science.

  In my master's thesis I worked on Picolla, a pure compositions language under
  the supervision of Prof. Nierstrasz. I have a long-standing interest in
  programming languages, type systems, and formal methods.

- When not at work, I've started to read and write papers on one hand on Machine
  Learning and on the other hand on applying formal methods to agentic
  protocols.

- Starting point: "Typing a Multi-Language Intermediate Code" (with Don Syme,
  POPL '01) — read the Microsoft Research Report and cited it in my own master's
  thesis on JPicolla.

- To quite some degree, the appendix reminded me of a stack based VM like the
  JVM, and the calculus reminded me of the JPicolla VM. I have a PoC
  implementation of the calculus in JS/TS that I would like to discuss with you.

---

## 1. Competitive/comparative landscape (~4 min)

- The paper directly demonstrates two concrete gaps in **CaMeL**: an
  untaken-branch implicit-flow leak, and an untracked retry-loop bit-leak
  channel. Ask how confident he is those hold up under scrutiny/pushback from
  the **CaMeL** authors.

- FIDES deliberately doesn't track control-flow-carried secrets. Ask if he sees
  that as a reasonable engineering trade-off or a real weakness.

- LBAC/TypeGuard and tacit take a static-typing/capability route instead of
  dynamic IFC. Ask whether he sees these as competitors, or as solving a
  genuinely different problem that could combine with LLMbda later.

## 2. Questions about the calculus (~4 min)

- What if the discrete Untrusted vs Trusted Principal are e.g. likelihoods or
  probabilities rather than booleans? Does the calculus still work, or is that a
  fundamentally different problem? The fundamental question is to get the
  labeling wright IMHO, and then the calculus should work with any labeling
  scheme.

- In how far is information leakage through termination equivalent to examining
  the current continuation?

- Inter-agent vs intra-agent information flow. In my paper I tried to look at an
  agent as a black box, and only looked at the information flow between agents.
  In the calculus, the agent is not a black box, and the information flow within
  an agent is also tracked. Could this somehow be unified, or is that a
  fundamentally different problem?

## 2. `endorse` misuse (~8 min)

- Insulated TIPNI proves the override stays scoped to one axis — but nothing
  stops an agent plan from calling `endorse` when it shouldn't.

- Both of Randori's successful attacks trace back to this.

- **Ask:** Is there a design pattern (plan-time-only endorsement, harness-level
  restriction) they'd actually recommend, or is this still open?

---

## 3. Where the calculus goes next (~9 min)

- Tool I/O modeling is the paper's own stated gap (NFR-2) — Am I correctly
  assuming that monadic I/O is what you have in mind, or is there a more
  specific design pattern you have in mind?

- Ask how they see LLMbda relating to the static-typing camp (LBAC/ TypeGuard,
  tacit) — genuinely complementary, or is one discipline going to subsume the
  other over time?

---

## Close (2 min)

- Would you kindly provide me access to the LEAN test set. I just finished a PoC
  of a VM in JS/TS that tries to run the LLMBda calculus as specified in the
  paper by Andy Gordon. I now have 100% test coverage (using 29 examples), thus
  the implementation in it self is sound. However I do not know whether it
  implements your test set, test set being a implicit specification of the
  calculus as well. I would like to run the test set against my implementation
  to see whether it is complete as well.

- Looking for a mentor and affiliation. Lack of bo

---
