# M2 — Real process shapes: task specifications

- Milestone: M2 (2026-10-19 → 2026-11-06), release `1.1.0-rc.1`
- Roadmap: [`roadmap.md`](roadmap.md)
- Audience: human contributors and coding agents. Execute one task per branch/PR.
  Read `AGENTS.md` first; its runtime invariants override anything here.

Every task lists **Goal**, **Files**, **Changes**, **Acceptance tests**,
**Invariants**, and **Out of scope**, as in [`m1-task-specs.md`](m1-task-specs.md).
`ENGINE` means `engine/src/main/java/com/abada/engine`, `ENGINE_TEST` means
`engine/src/test/java/com/abada/engine`.

## E1 — One APL contract ✅ done

**Goal.** APL is defined once, by the engine. Studio, automation and the E17
authoring work read the same machine-readable contract, and validation reports
every problem with its location instead of the first one.

**Files.** `engine/src/main/resources/apl/apl-v1.schema.json`,
`ENGINE/parser/{AplParser,AplSchema,AplVariables}.java`,
`ENGINE/apl/AplContractService.java`, `ENGINE/api/AplContractController.java`,
`ENGINE/security/SecurityConfig.java`, `ENGINE/dto/ProcessDefinitionDto.java`,
`studio/scripts/generate-apl-types.mts`, `studio/src/lib/apl/types.generated.ts`,
`studio/src/lib/{aplContract,agentModels}.ts`, `studio/src/lib/apl/issues.ts`,
`studio/src/features/designer/AplEditor.tsx`.

**Changes.**
- The JSON Schema (2020-12) is the structural contract: one `$defs` entry per
  node type, `additionalProperties: false`, the parser's bounds and defaults.
  The engine validates the root and then each node against its own type, so a
  wrong field yields one precise finding.
- Schema violations are `ABADA-APL-SCHEMA-001` **warnings** in 1.1.0-rc.x and
  become errors at 1.1.0. Semantic rejections stay `ABADA-APL-VALIDATION-001`
  errors.
- `AplParser` compiles each node independently and collects all errors, each
  with `elementId` and a JSON Pointer `path` (`BpmnValidationIssue.path`,
  additive). Policy (CEL) errors are anchored to their node.
- `metadata.variables` (deferred from T2): optional typed declarations. When
  present, an expression identifier that is neither declared nor written
  upstream is an `ABADA-APL-VARIABLE-001` warning. Decision-table `when`
  rules that read a non-input are always reported (they only see inputs at
  runtime).
- `GET /v1/apl/schema` (schema + allowed models + `x-abada-runtime`, ETag) and
  `POST /v1/apl/validate` (deployment pipeline, no persistence). Authenticated,
  no role.
- Spring builds `AplParser` from `abada.agent.allowed-models`.
- Studio types are generated from the schema and committed;
  `npm run verify:apl-types` fails the build on drift (replaces the
  `check-apl-parity` scraper). Studio validates through the engine and reads
  models and bounds from the served schema.

**Acceptance tests.**
- `AplSchemaConformanceTest`: schema node types equal `AplParser.SUPPORTED_TYPES`;
  every committed APL document (test fixtures, `examples/apl`, M1 demo) has zero
  schema findings; bounds agree with the parser at max and max+1; unknown fields
  and wrong types are warnings at the right path; errors in several nodes are
  all reported.
- `AplVariablesTest`: skipped without declarations; declared, upstream agent
  result and decision outputs resolve; downstream-only writes warn; non-input
  `when` warns; invalid declarations are errors.
- `AplContractControllerTest` (PostgreSQL Testcontainers): served models and
  ETag/304; validate returns every error with paths and writes no definition,
  history or outbox rows; the source is never logged; warnings keep a document
  valid and a deploy succeeds with them; >10 MiB is an issue; missing source
  is `400`.
- `SecurityAuthorizationContractTest`: missing, invalid, expired and forged
  proxy credentials get `401`; a user with no role may use both endpoints.
- `AplParserBeanTest`, `ProcessDefinitionDtoTest`, `OpenApiContractTest`.
- Studio: `parser.test.ts` (`else: <target>` shorthand), `issues.test.ts`,
  `aplContract.test.ts`; `npm run build` runs `verify:apl-types`.

**Invariants.** Validation never persists state or writes history. Warnings
never block deployment in the 1.1.0-rc line. The engine stays the authority;
Studio's model guard steps aside when the contract cannot be loaded.

**Out of scope.** Enforcing `metadata.variables` on start payloads; YAML line
and column numbers in issues; turning schema warnings into errors (1.1.0).
