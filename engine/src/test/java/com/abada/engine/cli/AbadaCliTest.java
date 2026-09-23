package com.abada.engine.cli;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class AbadaCliTest {
    @TempDir Path temp;

    @Test void migratesToExplicitOutputAndWritesMachineReadableReport() throws Exception {
        Path input = temp.resolve("source.bpmn");
        Path output = temp.resolve("native.bpmn");
        Path report = temp.resolve("report.json");
        Files.writeString(input, """
            <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="t">
            <bpmn:process id="p"><bpmn:startEvent id="s"/><bpmn:userTask id="t" camunda:assignee="alice"/><bpmn:endEvent id="e"/>
            <bpmn:sequenceFlow id="a" sourceRef="s" targetRef="t"/><bpmn:sequenceFlow id="b" sourceRef="t" targetRef="e"/></bpmn:process></bpmn:definitions>
            """);
        int exit = new AbadaCli().run(new String[]{"bpmn", "migrate", input.toString(), "--output",
                output.toString(), "--report", report.toString()}, new PrintStream(new ByteArrayOutputStream()), System.err);
        assertThat(exit).isZero();
        assertThat(Files.readString(output)).contains("abada:assignment");
        assertThat(Files.readString(report)).contains("detectedProfiles", "mappings");
    }

    @Test void expressionCheckReportsDefinitionsThatNeedMigration() throws Exception {
        Files.writeString(temp.resolve("ok.apl.yaml"), """
            version: abada.io/v1
            metadata:
              name: Ok Flow
            flow:
              entry: start
              nodes:
                - id: start
                  type: webhook
                  next: route
                - id: route
                  type: condition
                  rules:
                    - if: "${riskLevel == 'LOW' and approved}"
                      then: done
                    - else: done
                      then: done
                - id: done
                  type: end
            """);
        Files.writeString(temp.resolve("legacy.apl.yaml"), """
            version: abada.io/v1
            metadata:
              name: Legacy Flow
            flow:
              entry: start
              nodes:
                - id: start
                  type: webhook
                  next: route
                - id: route
                  type: condition
                  rules:
                    - if: "${amount === 5}"
                      then: done
                    - else: done
                      then: done
                - id: done
                  type: end
            """);
        var out = new ByteArrayOutputStream();
        int exit = new AbadaCli().run(new String[]{"expressions", "check", temp.toString()},
                new PrintStream(out), System.err);
        assertThat(exit).isEqualTo(1);
        assertThat(out.toString()).contains("legacy.apl.yaml [route]").doesNotContain("ok.apl.yaml [")
                .contains("2 expression(s) checked, 1 need migration");
    }
}
