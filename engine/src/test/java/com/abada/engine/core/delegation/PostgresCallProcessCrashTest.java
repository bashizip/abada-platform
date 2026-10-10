package com.abada.engine.core.delegation;

import static com.abada.engine.core.delegation.PostgresCallProcessTest.PROJECT;
import static com.abada.engine.core.delegation.PostgresCallProcessTest.complete;
import static com.abada.engine.core.delegation.PostgresCallProcessTest.deployFixture;
import static com.abada.engine.core.delegation.PostgresCallProcessTest.events;
import static com.abada.engine.core.delegation.PostgresCallProcessTest.onlyChild;
import static com.abada.engine.core.delegation.PostgresCallProcessTest.runJobs;
import static com.abada.engine.core.delegation.PostgresCallProcessTest.startApplication;
import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.TimerJobCommandService;
import com.abada.engine.persistence.entity.JobEntity;
import com.abada.engine.persistence.repository.JobRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.context.ConfigurableApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The exit-demo core of E20a: the engine stops at every point of a call and,
 * restarted, ends with exactly one child, a parent resumed exactly once, and
 * no orphan. Two replicas running the resume job at once apply it once.
 */
@Testcontainers
class PostgresCallProcessCrashTest {
    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_call_crash").withUsername("abada").withPassword("abada");

    private static ConfigurableApplicationContext context;

    @BeforeAll
    static void start() {
        context = startApplication(POSTGRES, false);
        deployFixture(context, "call-fraud-check.apl.yaml");
        deployFixture(context, "call-refund.apl.yaml");
    }

    @AfterAll
    static void stop() {
        if (context != null) context.close();
    }

    @Test
    void aRestartAfterTheChildStartedKeepsOneChildAndResumesTheParentOnce() {
        String parent = startRefund("crash-1");
        restart();
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        String child = onlyChild(engine, parent);
        complete(context, "fraud.score", child, Map.of("verdict", "clean"));
        runJobs(context);
        runJobs(context);
        assertResumedOnce(parent, child);
    }

    @Test
    void aRestartBetweenTheChildsEndAndTheResumeJobResumesTheParentOnce() {
        String parent = startRefund("crash-2");
        String child = onlyChild(context.getBean(AbadaEngine.class), parent);
        complete(context, "fraud.score", child, Map.of("verdict", "clean"));
        assertThat(context.getBean(AbadaEngine.class).getProcessInstanceById(parent).getActiveTokens())
                .containsExactly("fraud_check");

        restart();
        runJobs(context);
        runJobs(context);
        assertResumedOnce(parent, child);
    }

    @Test
    void aResumeJobLeasedByACrashedReplicaIsRunOnceItsLeaseExpires() {
        String parent = startRefund("crash-3");
        String child = onlyChild(context.getBean(AbadaEngine.class), parent);
        complete(context, "fraud.score", child, Map.of("verdict", "clean"));
        JobEntity job = childDone(child);
        assertThat(context.getBean(TimerJobCommandService.class).claim(job.getId(), "crashed-replica", Instant.now()))
                .isTrue();

        restart();
        runJobs(context);                                   // The lease is still live: nothing happens yet.
        assertThat(context.getBean(AbadaEngine.class).getProcessInstanceById(parent).getActiveTokens())
                .containsExactly("fraud_check");
        JobRepository jobs = context.getBean(JobRepository.class);
        JobEntity leased = jobs.findById(job.getId()).orElseThrow();
        leased.setLeaseExpiresAt(Instant.now().minusSeconds(1));
        jobs.save(leased);
        runJobs(context);
        assertResumedOnce(parent, child);
    }

    @Test
    void twoReplicasRunningTheResumeJobAtOnceApplyItOnce() throws Exception {
        String parent = startRefund("crash-4");
        String child = onlyChild(context.getBean(AbadaEngine.class), parent);
        complete(context, "fraud.score", child, Map.of("verdict", "clean"));

        ConfigurableApplicationContext replica = startApplication(POSTGRES, false);
        try {
            CountDownLatch go = new CountDownLatch(1);
            ExecutorService pool = Executors.newFixedThreadPool(2);
            List<Future<?>> runs = List.of(
                    pool.submit(() -> { go.await(); runJobs(context); return null; }),
                    pool.submit(() -> { go.await(); runJobs(replica); return null; }));
            go.countDown();
            for (Future<?> run : runs) run.get();
            pool.shutdown();
        } finally {
            replica.close();
        }
        assertResumedOnce(parent, child);
    }

    @Test
    void withImmediateResumeTheParentMovesWithoutWaitingForThePoller() throws Exception {
        ConfigurableApplicationContext immediate = startApplication(POSTGRES, true);
        try {
            AbadaEngine engine = immediate.getBean(AbadaEngine.class);
            String parent = engine.startProcess(PROJECT, "refund_with_check", "alice",
                    Map.of("case_id", "fast", "amount", 3)).getId();
            String child = onlyChild(engine, parent);
            complete(immediate, "fraud.score", child, Map.of("verdict", "clean"));
            long deadline = System.currentTimeMillis() + 10_000;
            while (!engine.getProcessInstanceById(parent).getActiveTokens().contains("decide")
                    && System.currentTimeMillis() < deadline) {
                Thread.sleep(50);
            }
            assertThat(engine.getProcessInstanceById(parent).getActiveTokens()).containsExactly("decide");
        } finally {
            immediate.close();
        }
    }

    private static String startRefund(String caseId) {
        return context.getBean(AbadaEngine.class).startProcess(PROJECT, "refund_with_check", "alice",
                Map.of("case_id", caseId, "amount", 42)).getId();
    }

    private static void restart() {
        context.close();
        context = startApplication(POSTGRES, false);
    }

    private static JobEntity childDone(String child) {
        return context.getBean(JobRepository.class).findAll().stream()
                .filter(job -> job.getKind() == JobEntity.Kind.CHILD_DONE && child.equals(job.getRelatedInstanceId()))
                .findFirst().orElseThrow();
    }

    private static void assertResumedOnce(String parent, String child) {
        AbadaEngine engine = context.getBean(AbadaEngine.class);
        assertThat(engine.lineage(parent).children()).extracting(link -> link.instanceId()).containsExactly(child);
        assertThat(engine.getProcessInstanceById(parent).getActiveTokens()).containsExactly("decide");
        assertThat(events(context, parent).stream().filter("CHILD_COMPLETED"::equals)).hasSize(1);
        assertThat(context.getBean(JobRepository.class).findAll().stream()
                .filter(job -> job.getKind() == JobEntity.Kind.CHILD_DONE && child.equals(job.getRelatedInstanceId())))
                .singleElement().satisfies(job -> assertThat(job.getStatus()).isEqualTo(JobEntity.Status.COMPLETED));
    }
}
