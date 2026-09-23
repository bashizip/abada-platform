package com.abada.engine.cli;

import com.abada.engine.bpmn.migration.BpmnMigrationService;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;

/** Minimal product CLI; kept independent from the Spring server lifecycle. */
public final class AbadaCli {
    public static void main(String[] args) { System.exit(new AbadaCli().run(args, System.out, System.err)); }

    int run(String[] args, PrintStream out, PrintStream err) {
        if (args.length >= 3 && "expressions".equals(args[0]) && "check".equals(args[1])) {
            return checkExpressions(Path.of(args[2]), out, err);
        }
        if (args.length < 3 || !"bpmn".equals(args[0]) || !"migrate".equals(args[1])) {
            err.println("Usage: abada bpmn migrate <input.bpmn> [--output <output.bpmn>] [--report <report.json>]");
            err.println("       abada expressions check <file-or-directory>");
            return 2;
        }
        try {
            Path input = Path.of(args[2]);
            Path output = option(args, "--output", Path.of(args[2] + ".abada.bpmn"));
            Path report = option(args, "--report", Path.of(output + ".report.json"));
            var result = new BpmnMigrationService().migrate(Files.newInputStream(input));
            Files.writeString(output, result.migratedXml());
            Files.writeString(report, new ObjectMapper().writerWithDefaultPrettyPrinter().writeValueAsString(result.report()));
            out.println("Migrated BPMN: " + output);
            out.println("Compatibility report: " + report);
            return 0;
        } catch (Exception exception) {
            err.println("Migration failed: " + exception.getMessage());
            return 1;
        }
    }

    /**
     * Dry run for the CEL expression migration: reports every condition and
     * decision-table expression in APL or BPMN files that no longer compiles.
     * Exit code 0 when all compile, 1 when at least one does not.
     */
    int checkExpressions(Path root, PrintStream out, PrintStream err) {
        java.util.List<Path> files;
        try (var walk = Files.walk(root)) {
            files = walk.filter(Files::isRegularFile)
                    .filter(path -> { String n = path.toString(); return n.endsWith(".yaml") || n.endsWith(".yml")
                            || n.endsWith(".bpmn") || n.endsWith(".xml"); })
                    .sorted().toList();
        } catch (java.io.IOException exception) {
            err.println("Cannot read " + root + ": " + exception.getMessage());
            return 2;
        }
        int invalid = 0;
        int checked = 0;
        for (Path file : files) {
            com.abada.engine.core.model.ParsedProcessDefinition definition;
            try {
                byte[] source = Files.readAllBytes(file);
                definition = com.abada.engine.parser.AplParser.isAplSource(source)
                        ? new com.abada.engine.parser.AplParser("", false).parse(source)
                        : new com.abada.engine.parser.BpmnParser().parse(new java.io.ByteArrayInputStream(source));
            } catch (Exception notADefinition) {
                continue;
            }
            java.util.List<String[]> expressions = new java.util.ArrayList<>();
            definition.getSequenceFlows().stream().filter(f -> f.getConditionExpression() != null
                            && !f.getConditionExpression().isBlank())
                    .forEach(f -> expressions.add(new String[]{f.getSourceRef(), f.getConditionExpression()}));
            definition.getDecisionTables().values().forEach(table -> {
                table.inputs().stream().filter(i -> i.expr() != null && !i.expr().isBlank())
                        .forEach(i -> expressions.add(new String[]{table.id(), i.expr()}));
                table.rules().stream().filter(r -> !r.otherwise() && r.when() != null && !r.when().isBlank())
                        .forEach(r -> expressions.add(new String[]{table.id(), r.when()}));
            });
            for (String[] expression : expressions) {
                checked++;
                try {
                    com.abada.engine.expression.WorkflowExpressions.compile(expression[1]);
                } catch (com.abada.engine.expression.ExpressionCompileException exception) {
                    invalid++;
                    out.println(file + " [" + expression[0] + "] " + exception.getMessage());
                }
            }
        }
        out.println(checked + " expression(s) checked, " + invalid + " need migration to CEL");
        return invalid == 0 ? 0 : 1;
    }

    private Path option(String[] args, String name, Path fallback) {
        for (int i = 3; i < args.length - 1; i++) if (name.equals(args[i])) return Path.of(args[i + 1]);
        return fallback;
    }
}
