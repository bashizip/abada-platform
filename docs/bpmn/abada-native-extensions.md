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

