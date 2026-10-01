package com.abada.engine.core;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.core.ProcessToken.State;
import com.abada.engine.core.model.ParsedProcessDefinition;
import com.abada.engine.parser.AplParser;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The E2 token model: forks, joins, event races and resumption by token id. */
class ProcessInstanceTokenTest {

    /** A decision table that always writes {@code variable: true}; a pass-through step with an effect. */
    private static String flag(String id, String variable, String next) {
        return """
                    - id: %s
                      type: decision-table
                      rules:
                        - otherwise: { then: { %s: true } }
                      next: %s
                """.formatted(id, variable, next);
    }

    private static String work(String id, String next) {
        return """
                    - id: %s
                      type: engine-task
                      service: work
                      next: %s
                """.formatted(id, next);
    }

    private static ParsedProcessDefinition define(String nodes) {
        String source = """
                version: abada.io/v1
                metadata: { key: tokens, name: Tokens }
                flow:
                  entry: start
                  nodes:
                    - { id: start, type: webhook, next: fork }
                %s    - { id: done, type: end }
                """.formatted(nodes);
        return new AplParser("", false).parse(source.getBytes(StandardCharsets.UTF_8));
    }

    private static List<State> states(ProcessInstance instance) {
        return instance.getTokens().stream().map(ProcessToken::state).toList();
    }

    private static ProcessToken waitingAt(ProcessInstance instance, String activity) {
        return instance.getWaitingTokens().stream().filter(token -> token.activityId().equals(activity))
                .findFirst().orElseThrow();
    }

    @Test
    void branchesMeetingAtAJoinInTheSameCommandRunTheNodeAfterTheJoin() {
        ParsedProcessDefinition definition = define("""
                    - id: fork
                      type: inclusive
                      rules:
                        - if: "${path == 'C' || path == 'CD'}"
                          then: taskC
                        - if: "${path == 'D' || path == 'CD'}"
                          then: taskD
                """ + flag("taskC", "branchC", "rejoin") + flag("taskD", "branchD", "rejoin") + """
                    - { id: rejoin, type: inclusive, next: after }
                """ + flag("after", "joined", "done"));
        ProcessInstance instance = new ProcessInstance(definition);
        instance.putAllVariables(Map.of("path", "CD"));

        instance.advance();

        assertThat(instance.isCompleted()).isTrue();
        assertThat(instance.getVariables()).containsEntry("branchC", true).containsEntry("branchD", true)
                .as("the node after the join ran").containsEntry("joined", true);
        assertThat(states(instance)).containsExactly(State.COMPLETED, State.CONSUMED, State.CONSUMED);
    }

    @Test
    void aJoinResumesTheForkingTokenSoItsIdSurvivesTheFork() {
        ProcessInstance instance = new ProcessInstance(define("""
                    - { id: fork, type: parallel, branches: [a, b] }
                """ + work("a", "join") + work("b", "join") + """
                    - { id: join, type: parallel, next: after }
                """ + flag("after", "joined", "done")));
        String root = instance.getTokens().get(0).id();

        instance.advance();
        ProcessToken a = waitingAt(instance, "a");
        ProcessToken b = waitingAt(instance, "b");
        assertThat(List.of(a.parentTokenId(), b.parentTokenId(), a.scopeTokenId())).containsOnly(root);
        assertThat(instance.getTokens().get(0).state()).isEqualTo(State.FORKED);

        instance.advance(a.id());
        assertThat(instance.getVariables()).doesNotContainKey("joined");
        assertThat(instance.getJoinExpectedTokens()).containsEntry("join", 2);
        assertThat(instance.getJoinArrivedTokens()).containsEntry("join", Set.of(a.id()));
        assertThat(instance.getActiveTokens()).containsExactly("b");

        instance.advance(b.id());
        assertThat(instance.getVariables()).containsEntry("joined", true);
        assertThat(instance.isCompleted()).isTrue();
        ProcessToken rootToken = instance.getTokens().get(0);
        assertThat(rootToken.id()).isEqualTo(root);
        assertThat(rootToken.state()).isEqualTo(State.COMPLETED);
        assertThat(rootToken.activityId()).isEqualTo("done");
        assertThat(a.state()).isEqualTo(State.CONSUMED);
        assertThat(instance.getJoinExpectedTokens()).isEmpty();
    }

    @Test
    void nestedForksCloseInnerScopeFirst() {
        ProcessInstance instance = new ProcessInstance(define("""
                    - { id: fork, type: parallel, branches: [inner, b] }
                    - { id: inner, type: parallel, branches: [x, y] }
                """ + flag("x", "x", "innerJoin") + work("y", "innerJoin") + """
                    - { id: innerJoin, type: parallel, next: join }
                """ + work("b", "join") + """
                    - { id: join, type: parallel, next: after }
                """ + flag("after", "joined", "done")));
        instance.advance();
        assertThat(instance.getActiveTokens()).containsExactlyInAnyOrder("y", "b");

        instance.advance(waitingAt(instance, "y").id());
        assertThat(instance.getVariables()).doesNotContainKey("joined");
        instance.advance(waitingAt(instance, "b").id());

        assertThat(instance.getVariables()).containsEntry("x", true).containsEntry("joined", true);
        assertThat(instance.isCompleted()).isTrue();
    }

    @Test
    void anEventRaceInsideABranchCountsAsOneStreamAtTheJoin() {
        ProcessInstance instance = new ProcessInstance(define("""
                    - { id: fork, type: parallel, branches: [race, b] }
                    - id: race
                      type: event-gateway
                      events:
                        - { type: message-catch, message: Paid, next: join }
                        - { type: timer, duration: PT1H, next: join }
                """ + work("b", "join") + """
                    - { id: join, type: parallel, next: after }
                """ + flag("after", "joined", "done")));
        instance.advance();
        assertThat(instance.getActiveTokens()).containsExactlyInAnyOrder("race_e0", "race_e1", "b");
        ProcessToken message = waitingAt(instance, "race_e0");
        ProcessToken timer = waitingAt(instance, "race_e1");

        ProcessInstance.EventRace race = instance.eventRace(message.id());
        assertThat(race.loserTokenIds()).containsExactly(timer.id());
        assertThat(race.loserActivityIds()).containsExactly("race_e1");

        instance.advance(message.id());
        assertThat(message.state()).isEqualTo(State.CONSUMED);
        assertThat(timer.state()).isEqualTo(State.CANCELLED);
        assertThat(instance.getActiveTokens()).containsExactly("b");

        instance.advance(waitingAt(instance, "b").id());
        assertThat(instance.getVariables()).containsEntry("joined", true);
        assertThat(instance.isCompleted()).isTrue();
    }

    @Test
    void twoTokensWaitingAtTheSameActivityResumeByTheirOwnId() {
        ProcessInstance instance = new ProcessInstance(define("""
                    - { id: fork, type: parallel, branches: [a, b] }
                """ + flag("a", "a", "work") + flag("b", "b", "work") + work("work", "done")));
        instance.advance();
        List<ProcessToken> waiting = instance.getWaitingTokens();
        assertThat(waiting).extracting(ProcessToken::activityId).containsExactly("work", "work");

        instance.advance(waiting.get(1).id());

        assertThat(instance.getWaitingTokens()).containsExactly(waiting.get(0));
        assertThat(instance.isCompleted()).isFalse();
        instance.advance(waiting.get(0).id());
        assertThat(instance.isCompleted()).isTrue();
    }

    @Test
    void aBranchThatEndsInsideTheForkNoLongerCountsTowardTheJoin() {
        ProcessInstance instance = new ProcessInstance(define("""
                    - { id: fork, type: parallel, branches: [a, gate] }
                """ + work("a", "join") + """
                    - id: gate
                      type: condition
                      rules:
                        - if: "${stop == true}"
                          then: stopped
                        - else: join
                    - { id: stopped, type: end }
                    - { id: join, type: parallel, next: after }
                """ + flag("after", "joined", "done")));
        instance.putAllVariables(Map.of("stop", true));
        instance.advance();

        instance.advance(waitingAt(instance, "a").id());

        assertThat(instance.getVariables()).containsEntry("joined", true);
        assertThat(instance.isCompleted()).isTrue();
    }

    /**
     * A join with no fork in scope is a merge: after an exclusive choice only one
     * path is taken, so the merge fires once no other token can still reach it
     * (strict BPMN would leave a parallel merge waiting forever).
     */
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"parallel", "inclusive"})
    void aMergeAfterAnExclusiveChoiceFiresWithTheOnePathTaken(String mergeType) {
        ProcessInstance instance = new ProcessInstance(define("""
                    - id: fork
                      type: condition
                      rules:
                        - if: "${fast == true}"
                          then: a
                        - else: b
                """ + flag("a", "a", "merge") + flag("b", "b", "merge") + """
                    - { id: merge, type: %s, next: after }
                """.formatted(mergeType) + flag("after", "merged", "done")));
        instance.putAllVariables(Map.of("fast", true));

        instance.advance();

        assertThat(instance.getVariables()).containsEntry("a", true).doesNotContainKey("b")
                .containsEntry("merged", true);
        assertThat(instance.isCompleted()).isTrue();
    }

    @Test
    void aLoopWithoutWaitStatesIsBoundedByItsMaxIterations() {
        ProcessInstance instance = new ProcessInstance(define("""
                    - id: fork
                      type: decision-table
                      rules:
                        - otherwise: { then: { spin: true } }
                      loop: { max_iterations: 3, on_exhausted: after }
                      next: again
                    - id: again
                      type: condition
                      rules:
                        - if: "${spin == true}"
                          then: fork
                        - else: done
                """ + flag("after", "stopped", "done")));

        instance.advance();

        assertThat(instance.isCompleted()).isTrue();
        assertThat(instance.getVariables()).containsEntry("fork_iteration", 3).containsEntry("stopped", true);
        assertThat(instance.takeLoopExhaustions()).singleElement()
                .satisfies(exhausted -> assertThat(exhausted.routedTo()).isEqualTo("after"));
    }

    @Test
    void anExhaustedLoopWithoutRouteStopsItsTokenInTheIncidentState() {
        ProcessInstance instance = new ProcessInstance(define("""
                    - id: fork
                      type: decision-table
                      rules:
                        - otherwise: { then: { spin: true } }
                      loop: { max_iterations: 2 }
                      next: again
                    - id: again
                      type: condition
                      rules:
                        - if: "${spin == true}"
                          then: fork
                        - else: done
                """));

        instance.advance();

        assertThat(instance.isCompleted()).isFalse();
        assertThat(instance.getTokens().get(0).state()).isEqualTo(State.INCIDENT);
        assertThat(instance.getTokens().get(0).activityId()).isEqualTo("fork");
        assertThat(instance.takeLoopExhaustions()).singleElement()
                .satisfies(exhausted -> assertThat(exhausted.routedTo()).isNull());
    }

    @Test
    void enteringAnInnerLoopForwardStartsANewPass() {
        ProcessInstance instance = new ProcessInstance(define("""
                    - id: fork
                      type: decision-table
                      rules:
                        - otherwise: { then: { outerPass: true } }
                      loop: { max_iterations: 3, on_exhausted: done }
                      next: inner
                    - id: inner
                      type: engine-task
                      service: work
                      loop: { max_iterations: 2, on_exhausted: done }
                      next: innerGate
                    - id: innerGate
                      type: condition
                      rules:
                        - if: "${innerAgain == true}"
                          then: inner
                        - else: outerGate
                    - id: outerGate
                      type: condition
                      rules:
                        - if: "${outerAgain == true}"
                          then: fork
                        - else: done
                """));
        instance.putAllVariables(Map.of("innerAgain", true, "outerAgain", false));
        instance.advance();
        instance.advance(waitingAt(instance, "inner").id());
        assertThat(instance.getVariables()).containsEntry("inner_iteration", 2);

        // Leave the inner loop and take the outer one: the inner step is
        // entered forward again, so its count restarts.
        instance.putAllVariables(Map.of("innerAgain", false, "outerAgain", true));
        instance.advance(waitingAt(instance, "inner").id());

        assertThat(instance.getVariables()).containsEntry("fork_iteration", 2).containsEntry("inner_iteration", 1);
        assertThat(waitingAt(instance, "inner").loopCounter()).isEqualTo(1);
    }

    @Test
    void cancellingAnInstanceCancelsEveryLiveToken() {
        ProcessInstance instance = new ProcessInstance(define("""
                    - { id: fork, type: parallel, branches: [a, b] }
                """ + work("a", "join") + work("b", "join") + """
                    - { id: join, type: parallel, next: done }
                """));
        instance.advance();

        instance.setActiveTokens(List.of());

        assertThat(states(instance)).containsOnly(State.CANCELLED);
        assertThat(instance.getActiveTokens()).isEmpty();
        assertThat(instance.getJoinExpectedTokens()).isEmpty();
    }

    @Test
    void preV23StateIsRebuiltIntoForkScopesAndEventRaces() {
        ParsedProcessDefinition definition = define("""
                    - { id: fork, type: parallel, branches: [a, race] }
                """ + work("a", "join") + """
                    - id: race
                      type: event-gateway
                      events:
                        - { type: message-catch, message: Paid, next: join }
                        - { type: timer, duration: PT1H, next: join }
                    - { id: join, type: parallel, next: after }
                """ + flag("after", "joined", "done"));
        ProcessInstance instance = new ProcessInstance(definition);
        // rc.8 state: branch `a` already arrived at the join, the race still waits.
        List<String> warnings = instance.restoreLegacyTokens(List.of("race_e0", "race_e1"),
                Map.of("join", 2), Map.of("join", Set.of("a")));

        assertThat(warnings).isEmpty();
        assertThat(states(instance)).containsExactly(State.FORKED, State.ARRIVED, State.EVENT_WAIT,
                State.WAITING, State.WAITING);
        assertThat(instance.getTokens().get(0).activityId()).isEqualTo("fork");
        assertThat(instance.getActiveTokens()).containsExactly("race_e0", "race_e1");

        // A pre-V23 subscription resumes by activity id.
        instance.advance("race_e1");

        assertThat(instance.getVariables()).containsEntry("joined", true);
        assertThat(instance.isCompleted()).isTrue();
    }

    @Test
    void inconsistentPreV23JoinStateIsConvertedWithAWarning() {
        ProcessInstance instance = new ProcessInstance(define("""
                    - { id: fork, type: parallel, branches: [a, b] }
                """ + work("a", "join") + work("b", "join") + """
                    - { id: join, type: parallel, next: done }
                """));

        List<String> warnings = instance.restoreLegacyTokens(List.of("b"), Map.of("join", 3), Map.of());

        assertThat(warnings).singleElement().asString().contains("join 'join' expected 3");
        assertThat(instance.getActiveTokens()).containsExactly("b");
    }
}
