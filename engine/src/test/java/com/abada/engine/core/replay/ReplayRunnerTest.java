package com.abada.engine.core.replay;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.core.replay.ReplayRunner.AgentAnswer;
import com.abada.engine.core.replay.ReplayRunner.End;
import com.abada.engine.core.replay.ReplayRunner.Kind;
import com.abada.engine.core.replay.ReplayRunner.Step;
import com.abada.engine.parser.AplParser;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** E15: the walk uses the engine's own interpreter, in memory, and says plainly where it cannot go on. */
class ReplayRunnerTest {
    private final ReplayRunner runner = new ReplayRunner();

    private static ParsedProcessDefinition load(String fixture) throws Exception {
        return new AplParser().parse(Files.readAllBytes(Path.of("src/test/resources/apl/" + fixture)));
    }

    /** Hands out the scripted decisions per step, in order. */
    private static ReplayRunner.HumanDecisions decisions(Map<String, List<String>> script) {
        Map<String, Deque<String>> queues = new HashMap<>();
        script.forEach((step, values) -> queues.put(step, new ArrayDeque<>(values)));
        return step -> Optional.ofNullable(queues.getOrDefault(step, new ArrayDeque<>()).poll());
    }

    /** An agent that answers from a script and remembers what it was shown. */
    private static final class ScriptedAgent implements ReplayRunner.AgentPort {
        final Deque<Map<String, Object>> answers = new ArrayDeque<>();
        final List<Map<String, Object>> seen = new ArrayList<>();

        ScriptedAgent answer(Map<String, Object> variables) {
            answers.add(variables);
            return this;
        }

        @Override
        public AgentAnswer run(String activityId, com.abada.engine.core.model.AgentWorkDescriptor work,
                Map<String, Object> inputs) {
            seen.add(inputs);
            return new AgentAnswer(answers.poll(), work.model(), 100, 50, new BigDecimal("0.01"), false);
        }
    }

    @Test
    void anAgentThenAnApprovalCompletesAndTheReworkLoopFeedsTheAgentAgain() throws Exception {
        ParsedProcessDefinition definition = load("review-tracked.apl.yaml");
        ScriptedAgent agent = new ScriptedAgent().answer(Map.of("draft_result", "v1"))
                .answer(Map.of("draft_result", "v2"));

        var result = runner.run(definition, Map.of(), agent,
                decisions(Map.of("review", List.of("reject", "approve"))));

        assertThat(result.end()).isEqualTo(End.COMPLETED);
        assertThat(result.path()).containsExactly(
                new Step("draft", Kind.AGENT, "OK"), new Step("review", Kind.HUMAN, "reject"),
                new Step("draft", Kind.AGENT, "OK"), new Step("review", Kind.HUMAN, "approve"));
        assertThat(result.costUsd()).isEqualByComparingTo("0.02");
        // The second draft saw a placeholder in place of the comment, which is never kept.
        assertThat(agent.seen.get(1)).containsEntry("review_comment", ReplayRunner.COMMENT_PLACEHOLDER);
        assertThat(agent.seen.get(0)).containsEntry("review_comment", null);
    }

    @Test
    void aStepWithNoRecordedDecisionStopsTheWalkAtThatStep() throws Exception {
        var result = runner.run(load("review-tracked.apl.yaml"), Map.of(),
                new ScriptedAgent().answer(Map.of("draft_result", "v1")), decisions(Map.of()));
        assertThat(result.end()).isEqualTo(End.NEEDS_HUMAN);
        assertThat(result.stoppedAt()).isEqualTo("review");
        assertThat(result.path()).containsExactly(new Step("draft", Kind.AGENT, "OK"));
    }

    @Test
    void aRecordedOutcomeThatNoLongerExistsStopsTheWalkInsteadOfGuessing() throws Exception {
        var result = runner.run(load("review-tracked.apl.yaml"), Map.of(),
                new ScriptedAgent().answer(Map.of("draft_result", "v1")),
                decisions(Map.of("review", List.of("escalate-to-legal"))));
        assertThat(result.end()).isEqualTo(End.NEEDS_HUMAN);
        assertThat(result.reason()).contains("escalate-to-legal");
    }

    @Test
    void anExhaustedLoopTakesItsRouteTheWayTheEngineDoes() throws Exception {
        ScriptedAgent agent = new ScriptedAgent();
        for (int i = 0; i < 3; i++) agent.answer(Map.of("draft_result", "v" + i));
        var result = runner.run(load("review-tracked.apl.yaml"), Map.of(), agent,
                decisions(Map.of("review", List.of("reject", "reject", "reject"), "escalate", List.of("done"))));
        assertThat(result.end()).isEqualTo(End.COMPLETED);
        assertThat(result.path()).extracting(Step::activityId)
                .containsExactly("draft", "review", "draft", "review", "draft", "review", "escalate");
    }

    @Test
    void lowConfidenceTakesItsBoundaryAndAnEngineTaskIsNotRun() throws Exception {
        ParsedProcessDefinition definition = load("agent-contract.apl.yaml");
        Map<String, Object> inputs = Map.of("lead", Map.of("companySize", 40));

        // Confident answer: the walk reaches the engine task, which only a worker can run.
        var confident = runner.run(definition, inputs, new ScriptedAgent().answer(
                Map.of("lead_priority", Map.of("priority", "HIGH", "_confidence", 95))), decisions(Map.of()));
        assertThat(confident.end()).isEqualTo(End.NEEDS_EXTERNAL);
        assertThat(confident.stoppedAt()).isEqualTo("crm");
        assertThat(confident.lastConfidence()).isEqualTo(95.0);

        // Unsure answer: the engine routes it to the reviewer through on_low_confidence.
        var unsure = runner.run(definition, inputs, new ScriptedAgent().answer(
                Map.of("lead_priority", Map.of("priority", "LOW", "_confidence", 40))),
                decisions(Map.of("review", List.of("completed"))));
        assertThat(unsure.end()).isEqualTo(End.COMPLETED);
        assertThat(unsure.path()).containsExactly(new Step("classify", Kind.AGENT, "LOW_CONFIDENCE"),
                new Step("review", Kind.HUMAN, "completed"));
    }

    @Test
    void anAgentThatFailsOrAnswersOffContractFailsTheCaseWithItsReason() throws Exception {
        ParsedProcessDefinition definition = load("review-tracked.apl.yaml");
        var failed = runner.run(definition, Map.of(), (step, work, in) -> { throw new IllegalStateException("quota"); },
                decisions(Map.of()));
        assertThat(failed.end()).isEqualTo(End.FAILED);
        assertThat(failed.reason()).contains("agent call failed").contains("quota");

        var wrongShape = runner.run(definition, Map.of(), new ScriptedAgent().answer(Map.of("other", "x")),
                decisions(Map.of()));
        assertThat(wrongShape.end()).isEqualTo(End.FAILED);
        assertThat(wrongShape.reason()).contains("INVALID_OUTPUT");
    }

    @Test
    void agentsWithToolsAreFlaggedBecauseTheirToolsAreNotRun() throws Exception {
        String source = Files.readString(Path.of("src/test/resources/apl/review-tracked.apl.yaml"))
                .replace("      reviewed_by:", "      tools: [crm/get_customer]\n      reviewed_by:");
        var result = runner.run(new AplParser().parse(source.getBytes()), Map.of(),
                new ScriptedAgent().answer(Map.of("draft_result", "v1")), decisions(Map.of()));
        assertThat(result.toolsSkipped()).containsExactly("draft");
    }

    @Test
    void anAgentThatReadsFilesStopsTheReplayInsteadOfAnsweringWithoutThem() throws Exception {
        ParsedProcessDefinition definition = load("agent-file-guard.apl.yaml");
        ScriptedAgent agent = new ScriptedAgent().answer(Map.of("lecture", Map.of("payroll", 1)));
        var result = runner.run(definition, Map.of("doc_ref", Map.of("fileId", "f-1")), agent, decisions(Map.of()));
        assertThat(result.end()).isEqualTo(End.NEEDS_EXTERNAL);
        assertThat(result.reason()).contains("reads files");
        assertThat(agent.seen).as("the model is never called without the document").isEmpty();
    }
}
