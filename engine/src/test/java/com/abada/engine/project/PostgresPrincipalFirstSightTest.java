package com.abada.engine.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import com.abada.engine.util.DatabaseTestHelper;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * A user's first sign-in sends several requests at once, and each one observes the
 * principal. Under PostgreSQL they must all succeed and leave exactly one row, instead
 * of the losers failing on {@code uq_principal_issuer_subject} with a 500.
 */
@Testcontainers
class PostgresPrincipalFirstSightTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_principals").withUsername("abada").withPassword("abada");

    private static final String ISSUER = "http://keycloak.test/realms/abada";
    private static final int CONCURRENT_REQUESTS = 8;

    @Test
    void concurrentFirstSightsOfOnePrincipalAllSucceedWithOneRow() throws Exception {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            PrincipalService service = context.getBean(PrincipalService.class);
            PrincipalRepository principals = context.getBean(PrincipalRepository.class);

            for (int round = 0; round < 5; round++) {
                String subject = "subject-" + round;
                CountDownLatch start = new CountDownLatch(1);
                ExecutorService pool = Executors.newFixedThreadPool(CONCURRENT_REQUESTS);
                try {
                    List<Future<PrincipalEntity>> results = new ArrayList<>();
                    for (int i = 0; i < CONCURRENT_REQUESTS; i++) {
                        results.add(pool.submit(() -> {
                            start.await();
                            return service.observe(ISSUER, subject, "alice", PrincipalEntity.Type.HUMAN);
                        }));
                    }
                    start.countDown();
                    Set<String> ids = new java.util.HashSet<>();
                    for (Future<PrincipalEntity> result : results) {
                        ids.add(result.get(30, TimeUnit.SECONDS).getId());
                    }

                    assertThat(ids).as("every request resolves to the same principal").hasSize(1);
                    assertThat(principals.findByIssuerAndSubjectId(ISSUER, subject))
                            .hasValueSatisfying(p -> assertThat(p.getId()).isEqualTo(ids.iterator().next()));
                } finally {
                    pool.shutdownNow();
                }
            }

            Set<String> subjects = principals.findAll().stream()
                    .filter(p -> ISSUER.equals(p.getIssuer()))
                    .map(PrincipalEntity::getSubjectId)
                    .collect(Collectors.toSet());
            assertThat(subjects).hasSize(5);
        }
    }

    @Test
    void aLaterSightingUpdatesTheExistingPrincipal() {
        try (ConfigurableApplicationContext context = startApplication()) {
            context.getBean(DatabaseTestHelper.class).cleanup();
            PrincipalService service = context.getBean(PrincipalService.class);

            PrincipalEntity first = service.observe(ISSUER, "subject-x", "bob", PrincipalEntity.Type.HUMAN);
            PrincipalEntity again = service.observe(ISSUER, "subject-x", "bob.renamed", PrincipalEntity.Type.HUMAN);

            assertThat(again.getId()).isEqualTo(first.getId());
            assertThat(again.getUsername()).isEqualTo("bob.renamed");
            // PostgreSQL keeps microseconds; the JVM clock may carry nanoseconds.
            assertThat(again.getFirstSeenAt()).isCloseTo(first.getFirstSeenAt(), within(1, ChronoUnit.MILLIS));
            assertThat(again.getLastSeenAt()).isAfterOrEqualTo(first.getLastSeenAt().truncatedTo(ChronoUnit.MILLIS));
        }
    }

    private static ConfigurableApplicationContext startApplication() {
        List<String> properties = List.of(
                "server.port=0",
                "spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                "spring.datasource.username=" + POSTGRES.getUsername(),
                "spring.datasource.password=" + POSTGRES.getPassword(),
                "spring.datasource.driver-class-name=org.postgresql.Driver",
                "spring.datasource.hikari.maximum-pool-size=10",
                "spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect",
                "spring.jpa.hibernate.ddl-auto=validate",
                "spring.jpa.open-in-view=false",
                "spring.flyway.enabled=true",
                "spring.task.scheduling.enabled=false",
                "abada.outbox.dispatcher.enabled=false",
                "abada.security.mode=disabled",
                "otel.sdk.disabled=true",
                "management.tracing.enabled=false",
                "management.otlp.metrics.export.enabled=false");
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(context,
                        properties.toArray(String[]::new)))
                .run("--spring.profiles.active=test");
    }
}
