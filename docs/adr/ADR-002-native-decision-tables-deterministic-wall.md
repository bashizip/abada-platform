# ADR-002: Native Decision Tables as the Deterministic Wall

- Status: Accepted and implemented (engine runtime + Studio compiler, 2026-08)
- Date: 2026-08-07
- Target: Abada 1.0 runtime core; enables the 1.1 agentic workflow track
- Related: `bpmn/abada-native-extensions.md`, `reference/bpmn-support.md`,
  `reference/runtime-semantics.md`, `development/studio-app-spec.md`

## Context

Abada's 1.1 product goal is to demonstrate agentic workflows as durable
consumers of the BPMN runtime. Agents are probabilistic: the same prompt can
produce different answers, and a wrong answer inside a governed workflow is a
compliance and audit problem, not just a quality problem.

In the classic BPMN ecosystem, **DMN (Decision Model and Notation)** is the
deterministic counterpart of the execution flow: pure business rules and
decision tables ("if credit score > 75 and income > 50k then rate = 5%") that
separate decision logic from process flow. In an AI-native model, DMN must not
be thrown away — it must be **reinvented as the deterministic counterweight to
probabilistic agents**. Decisions that matter (tax rates, credit outcomes,
export permits, policy classifications) must be reproducible from a deployed
artifact, not re-derived from a model call.

Before this ADR, two gaps existed:

1. **The engine had no native decision-table construct.** A
   `bpmn:businessRuleTask` was rejected at deployment, and the Studio emitted
   decision tables as an external `abada:dmn` service task. That meant a
   decision executed *outside* the workflow transaction, through the
   external-worker path: no rollback atomicity with workflow state, a second
   execution authority, and no first-class audit record.
2. **The Studio simulated execution.** The Run panel walked a fake walkthrough
   with random timers instead of executing on the engine, so authors could not
   see real decision outcomes before shipping a workflow.

## Decision

Adopt a **native, in-transaction deterministic decision-table extension** as
the engine-side "law" that constrains probabilistic agents (the "advice"):

- **Native BPMN extension.** A `bpmn:businessRuleTask` is supported only when
  it carries an inline `abada:decisionTable` extension in the stable Abada
  namespace `https://abada.io/schema/bpmn` (`abada:input`, `abada:rule`,
  `abada:output`). A business rule task without the extension is rejected at
  deployment, loudly, with a stable validation code.
- **In-transaction execution.** The decision table is evaluated inside the
  mutation transaction that advances the process (`DecisionTableEvaluator`),
  with inputs resolved from instance variables via `${...}` expressions.
  Outputs are written to instance variables and the whole step commits or
  rolls back atomically with workflow state, history and outbox records.
- **Deterministic semantics.** Rules evaluate in model order against resolved
  inputs. Hit policies are `FIRST`, `UNIQUE` and `COLLECT` only. An
  `otherwise` rule is the explicit fallback; if no rule matches and no
  `otherwise` exists, execution **fails loudly** instead of guessing.
- **Auditable.** Every application is recorded as a `DECISION_TABLE_APPLIED`
  history event carrying the stable `decisionKey`, matched rule indexes, and
  input/output names — never the sensitive values themselves.
- **Secure parsing.** The extension is read with a hardened, namespace-aware
  DOM parser (`DecisionTableXml`) that disables DTDs, external entities and
  XInclude.
- **Studio compiles the native construct.** The Studio compiler emits
  `bpmn:businessRuleTask` + `abada:decisionTable` directly (no external
  worker), and the transpiler reads it back losslessly (round-trip fidelity),
  keeping a legacy fallback for pre-Phase-2 `abada:dmn` documents.

The doctrine is: **the table is the law, agents are the advice.** A critical
decision is fully reproducible and auditable from the deployed table; an agent
may recommend, but the workflow's deterministic rules decide.

## Alternatives considered

- **Delegate decisions to an external DMN engine** (Camunda DMN, Drools,
  independent rule service): rejected. It introduces a second execution
  authority, an extra runtime dependency, cross-system consistency windows,
  and turns an in-transaction decision into an at-least-once external side
  effect.
- **Keep decisions in the agent** (confidence-threshold gating): rejected.
  Probabilistic by construction, not reproducible from the deployed model, and
  unsuitable for governed/compliance outcomes.
- **Keep the `abada:dmn` external service task** (status quo ante): rejected.
  Execution happened outside the transaction via the external-worker path,
  with no rollback atomicity and no first-class audit.
- **Accept any `bpmn:businessRuleTask` without a table**: rejected. An
  ambiguous model must be refused during deployment, consistent with the
  BPMN support contract.
- **Support full DMN 1.3** (FEEL, boxed expressions, literal expressions):
  deferred. The subset (inputs, ordered rules, otherwise, three hit policies,
  typed outputs) covers the governed-decision cases the 1.1 agentic track
  needs; extending later is additive.

## Consequences

- **Engine**: `DecisionTableXml`, `DecisionTableEvaluator`,
  `DecisionTableMeta` and the in-transaction wiring in `AbadaEngine`; business
  rule tasks without the extension now fail deployment; `DECISION_TABLE_APPLIED`
  history records; PostgreSQL Testcontainers coverage
  (`DecisionTableRuntimeTest`), including rollback on evaluation failure.
- **Studio**: the compiler/transpiler gain a native decision-table round trip;
  `hitPolicy` narrowed to the engine-supported `FIRST | UNIQUE | COLLECT` and
  the `PRIORITY` option removed from the property inspector; shared helpers
  (`normalizeTableInputs`, `resolveRuleOutcome`) keep the vision's YAML shape
  and the flattened form in sync.
- **Contract docs updated**: `bpmn-support.md` (business rule task row),
  `runtime-semantics.md` (decision-table semantics), `abada-native-extensions.md`
  (extension schema).
- **Operations**: authors can now prove a decision end-to-end from the Studio
  Run panel — deploy, start, and observe the outputs written in-transaction.
- **Boundaries kept honest**: this does not claim DMN compliance; it is a
  tested, documented subset. Agent outputs remain at-least-once external work.
