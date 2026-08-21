# Camunda 7 compatibility profile

The `camunda-7` profile translates these directives into the canonical model:

| Directive | Canonical field |
| --- | --- |
| `camunda:assignee` | assignee expression |
| `camunda:candidateUsers` | candidate-user expressions |
| `camunda:candidateGroups` | candidate-group expressions |
| `camunda:formKey` | task `formKey` (logical key resolved to a project FORM resource) |

Comma-separated candidates are trimmed, empty entries removed, and exact duplicates removed in source order. `${...}` uses Abada expression semantics, not Camunda EL semantics. Existing supported `camunda:class`, `camunda:topic`, and candidate-starter directives remain operational.

Unsupported execution directives such as `camunda:delegateExpression` fail deployment. Metadata such as `camunda:formKey` is mapped to the canonical task form key; other unrecognized vendor metadata is a warning in compatibility mode and an error in strict mode.

