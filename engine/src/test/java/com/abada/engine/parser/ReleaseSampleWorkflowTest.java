package com.abada.engine.parser;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.core.model.assignment.AssignmentStrategy;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ReleaseSampleWorkflowTest {

    @Test
    void releaseApprovalSampleUsesSupportedCanonicalAssignment() throws Exception {
        Path sample = Path.of(System.getProperty("user.dir"), "..", "release", "samples", "approval.bpmn")
                .normalize();

        try (InputStream source = Files.newInputStream(sample)) {
            var process = new BpmnParser().parse(source);
            var assignment = process.getUserTask("review").getAssignment();

            assertThat(process.getId()).isEqualTo("approval-quickstart");
            assertThat(assignment.strategy()).isEqualTo(AssignmentStrategy.CLAIM);
            assertThat(assignment.candidateGroups()).extracting(expression -> expression.source())
                    .containsExactly("customers");
        }
    }
}
