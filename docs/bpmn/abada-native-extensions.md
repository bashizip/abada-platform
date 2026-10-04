# Abada-native BPMN extensions

Abada 1.0 uses the stable namespace `https://abada.io/schema/bpmn`. Schema evolution is expressed through `abada:metadata schemaVersion="1.0"`; the namespace URI does not change.

User-task assignment is placed below BPMN `extensionElements`:

```xml
<bpmn:extensionElements>
  <abada:assignment assignee="${request.owner}"
      candidateUsers="alice,bob" candidateGroups="finance" strategy="direct" />
</bpmn:extensionElements>
```

The parser also accepts nested `abada:assignee`, `abada:candidateUsers/abada:user`, and `abada:candidateGroups/abada:group` elements with `value` or `expression` attributes. Strategies are `direct` and `claim`. Unknown Abada elements are deployment errors.

## Decision tables (`abada:decisionTable`)

Abada 1.0 defines the deterministic counterweight to probabilistic agents:
inline decision tables carried by a `bpmn:businessRuleTask`. The engine
validates and executes them inside the workflow transaction, so a critical
decision never depends on a model's judgment — the table is the law, the agent
is the advice.

```xml
<bpmn:businessRuleTask id="CreditRules" name="Evaluate credit risk">
  <bpmn:extensionElements>
    <abada:decisionTable decisionKey="DMN_CREDIT_RISK_V1" hitPolicy="FIRST">
      <abada:input name="score" expr="${applicant.creditScore}" />
      <abada:input name="income" expr="${applicant.annualIncome}" />
      <abada:rule when="score >= 750 and income >= 60000">
        <abada:output name="riskLevel" value="LOW" />
        <abada:output name="autoApprove" value="true" />
      </abada:rule>
      <abada:rule when="score >= 600 and income >= 40000">
        <abada:output name="riskLevel" value="MEDIUM" />
        <abada:output name="autoApprove" value="false" />
      </abada:rule>
      <abada:rule otherwise="true">
        <abada:output name="riskLevel" value="HIGH" />
        <abada:output name="autoApprove" value="false" />
      </abada:rule>
    </abada:decisionTable>
  </bpmn:extensionElements>
</bpmn:businessRuleTask>
```

Each `abada:rule` carries a `when` JavaScript/ECMAScript condition evaluated
against the resolved input names (e.g. `score >= 750 and income >= 60000`).
Rules are evaluated in model order; the `hitPolicy` attribute accepts `FIRST`
(default), `UNIQUE` and `COLLECT`. `UNIQUE` fails the workflow when more than
one rule matches, while `COLLECT` merges the outputs of every matching rule.
Inputs are resolved from process variables, either by name or through a
`${...}` expression. When no rule matches, the single `otherwise="true"` rule
applies. When neither matches nor an `otherwise` rule exists, the workflow
transaction rolls back and the start/advance command fails loudly instead of
guessing. Applied rules are
recorded in activity history as `DECISION_TABLE_APPLIED` (identifiers and
variable names only — never values), with a matching outbox event.

Unknown Abada elements, invalid hit policies, duplicate `otherwise` rules and
unsupported `camunda:*` directives on the business rule task remain deployment
errors.

## Bounded loops (`abada:maxIterations`, `abada:onExhausted`)

Every cycle in a BPMN process must return to a flow node that declares how many
times it may run per pass:

```xml
<bpmn:userTask id="review" name="Review" abada:maxIterations="3"
    abada:onExhausted="escalate" camunda:candidateGroups="reviewers"/>
```

- `abada:maxIterations` (required on the node a cycle returns to): an integer
  from 1 to 1000. Without it, a process containing the cycle is rejected with
  `ABADA-BPMN-LOOP-001`.
- `abada:onExhausted` (optional): the id of the flow node to continue at when
  the limit is reached. It must leave the loop. Without it the engine stops the
  token and opens a `LOOP_EXHAUSTED` incident.
- The current pass is exposed as the process variable `<nodeId>_iteration`.

`standardLoopCharacteristics` and `multiInstanceLoopCharacteristics` are
rejected; model the repetition as a bounded cycle.


## Task service level (`abada:slaHours`, `abada:escalateTo`)

A user task may declare a service level in hours and the groups to add when it
is missed:

```xml
<bpmn:userTask id="review" name="Review the draft"
    camunda:candidateGroups="reviewers"
    abada:slaHours="4" abada:escalateTo="managers, directors"/>
```

When the hours pass with the task still open, the engine escalates it in
place: the task stays open and assigned as it was, the listed groups become
candidates too, and `TASK_SLA_BREACHED` is recorded in history and the outbox.
`abada:slaHours` must be a number between 0 (exclusive) and 8760;
`abada:escalateTo` requires it. The APL equivalent is `sla_hours` and
`escalate_to` (APL specification §2.6).

To stop the task instead, attach an interrupting timer boundary event; error
boundary events catch a worker-reported error code (or every error, plus the
last failed attempt, when they declare no code). Both are part of the
supported subset on user tasks and external service tasks; see
[bpmn-support.md](../reference/bpmn-support.md).

## Review outcomes (`abada:outcomes`, `abada:commentRequired`)

A user task may declare the decisions its reviewer chooses from:

```xml
<bpmn:userTask id="review" name="Review the draft"
    camunda:candidateGroups="reviewers"
    abada:outcomes="approve,reject" abada:commentRequired="reject"/>
<bpmn:exclusiveGateway id="decided" default="toPublish"/>
<bpmn:sequenceFlow id="toDraft" sourceRef="decided" targetRef="draft">
  <bpmn:conditionExpression>${review_outcome == 'reject'}</bpmn:conditionExpression>
</bpmn:sequenceFlow>
```

The task is then finished with a decision (`POST .../tasks/{taskId}/decision`)
instead of a plain completion. The engine accepts only a declared outcome,
requires a non-blank comment for the outcomes listed in
`abada:commentRequired`, and writes `<id>_outcome` and `<id>_comment`; the
exclusive gateway after the task routes on the outcome. `abada:outcomes` lists
2–6 distinct names (lowercase letters, digits, underscores, starting with a
letter). The APL equivalent is `outcomes` (APL specification §2.7).

