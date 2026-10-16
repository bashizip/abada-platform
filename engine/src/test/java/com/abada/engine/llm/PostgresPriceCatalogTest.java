package com.abada.engine.llm;

import static org.assertj.core.api.Assertions.assertThat;

import com.abada.engine.AbadaEngineApplication;
import com.abada.engine.persistence.repository.AiRefreshStateRepository;
import com.abada.engine.persistence.repository.ModelCatalogPriceRepository;
import com.abada.engine.persistence.repository.ModelPriceRepository;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The price catalog under the PostgreSQL authority: the shipped snapshot is
 * imported once, a refresh adds a row only when a price changes, an
 * administrator's price always wins, and a single replica refreshes at a time.
 */
@Testcontainers
class PostgresPriceCatalogTest {

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("abada_price_catalog").withUsername("abada").withPassword("abada");

    @Test
    void modelIdsFromProvidersAndTheCatalogShareOneKey() {
        assertThat(ModelCatalogService.key("google/gemini-3.8-flash")).isEqualTo("gemini-3-8-flash");
        assertThat(ModelCatalogService.key("gemini-3.8-flash")).isEqualTo("gemini-3-8-flash");
        assertThat(ModelCatalogService.key("models/gemini-3.8-flash")).isEqualTo("gemini-3-8-flash");
        assertThat(ModelCatalogService.key("anthropic/claude-sonnet-5.5:batch")).isEqualTo("claude-sonnet-5-5");
        assertThat(ModelCatalogService.key("claude-sonnet-5-5-20261001")).isEqualTo("claude-sonnet-5-5");
    }

    @Test
    void theSnapshotIsImportedOnceAndPricesCallsWithoutAnAdministratorPrice() {
        try (ConfigurableApplicationContext context = startApplication("abada.ai.price-catalog.enabled=false")) {
            ModelCatalogPriceRepository catalog = context.getBean(ModelCatalogPriceRepository.class);
            ModelCatalogService service = context.getBean(ModelCatalogService.class);
            long imported = catalog.count();
            assertThat(imported).as("the shipped snapshot").isGreaterThan(100);

            service.importSnapshot();
            assertThat(catalog.count()).as("imported once, even when asked again").isEqualTo(imported);

            ModelPriceService prices = context.getBean(ModelPriceService.class);
            String model = catalog.findAll().stream().filter(row -> row.getModel().startsWith("google/gemini"))
                    .findFirst().orElseThrow().getModel();
            String bare = model.substring("google/".length());
            assertThat(prices.cost(bare, 1_000_000, 0, Instant.now()).unpriced()).isFalse();
            assertThat(prices.effective(List.of(bare))).singleElement().satisfies(price -> {
                assertThat(price.source()).isEqualTo(ModelPriceService.PriceSource.CATALOG);
                assertThat(price.catalogModel()).isEqualTo(model);
                assertThat(price.catalogSource()).isEqualTo(ModelCatalogService.SNAPSHOT_SOURCE);
            });
            assertThat(prices.cost("no-such-model-anywhere", 10, 10, Instant.now()).unpriced()).isTrue();
        }
    }

    @Test
    void aRefreshAddsOnlyChangedPricesAndAnAdministratorPriceWins() {
        try (ConfigurableApplicationContext context = startApplication("abada.ai.price-catalog.enabled=false")) {
            ModelCatalogService service = context.getBean(ModelCatalogService.class);
            ModelCatalogPriceRepository catalog = context.getBean(ModelCatalogPriceRepository.class);
            ModelPriceService prices = context.getBean(ModelPriceService.class);
            Instant first = Instant.parse("2027-01-01T00:00:00Z");
            Instant second = Instant.parse("2027-02-01T00:00:00Z");
            var price = new AiProviderGateway.CatalogPrice("acme/acme-chat-1.5", new BigDecimal("1"), new BigDecimal("2"));

            assertThat(service.record(List.of(price), first, "catalog:test")).isEqualTo(1);
            assertThat(service.record(List.of(price), second, "catalog:test")).as("unchanged").isZero();
            var raised = new AiProviderGateway.CatalogPrice("acme/acme-chat-1.5", new BigDecimal("3"), new BigDecimal("4"));
            assertThat(service.record(List.of(raised), second, "catalog:test")).isEqualTo(1);
            assertThat(catalog.findByModelOrderByEffectiveFromDesc("acme/acme-chat-1.5")).hasSize(2);

            // The price in effect at the time of the call, never a later one.
            assertThat(prices.priceAt("acme-chat-1.5", first.plusSeconds(1)).orElseThrow().inputPerMillion())
                    .isEqualByComparingTo("1");
            assertThat(prices.priceAt("acme-chat-1.5", second.plusSeconds(1)).orElseThrow().inputPerMillion())
                    .isEqualByComparingTo("3");

            prices.add("acme-chat-1.5", null, new BigDecimal("0.5"), new BigDecimal("0.6"), first);
            assertThat(prices.priceAt("acme-chat-1.5", second.plusSeconds(1)).orElseThrow().inputPerMillion())
                    .as("an administrator's price wins over a newer catalog price").isEqualByComparingTo("0.5");
            context.getBean(ModelPriceRepository.class).deleteAll();
        }
    }

    @Test
    void theModelsOwnVendorIsPreferredWhenNamesCollide() {
        try (ConfigurableApplicationContext context = startApplication("abada.ai.price-catalog.enabled=false")) {
            ModelCatalogService service = context.getBean(ModelCatalogService.class);
            Instant at = Instant.parse("2027-03-01T00:00:00Z");
            service.record(List.of(
                    new AiProviderGateway.CatalogPrice("vendor-a/shared-name", new BigDecimal("1"), new BigDecimal("1")),
                    new AiProviderGateway.CatalogPrice("vendor-b/shared-name", new BigDecimal("9"), new BigDecimal("9"))),
                    at, "catalog:test");

            assertThat(service.priceAt("vendor-b/shared-name", at.plusSeconds(1)).orElseThrow().inputPerMillion())
                    .isEqualByComparingTo("9");
            assertThat(service.priceAt("vendor-a/shared-name", at.plusSeconds(1)).orElseThrow().inputPerMillion())
                    .isEqualByComparingTo("1");
        }
    }

    @Test
    void oneReplicaAtATimeHoldsARefreshAndAFailedRefreshKeepsTheLastGoodOne() throws Exception {
        try (ConfigurableApplicationContext context = startApplication("abada.ai.price-catalog.enabled=true",
                "abada.ai.price-catalog.url=http://127.0.0.1:9/no-catalog-here")) {
            AiRefreshLeases leases = context.getBean(AiRefreshLeases.class);
            context.getBean(AiRefreshStateRepository.class).deleteById(ModelCatalogService.LEASE_ID);

            // Many rounds, each on a lease nobody has seen yet: the first claim also
            // creates the row, the race CI caught (a merge overwrote another claim).
            ExecutorService pool = Executors.newFixedThreadPool(16);
            try {
                for (int round = 0; round < 60; round++) {
                    String lease = "test-lease-" + round;
                    CountDownLatch start = new CountDownLatch(1);
                    List<Future<Boolean>> claims = new ArrayList<>();
                    for (int i = 0; i < 16; i++) {
                        Callable<Boolean> claim = () -> {
                            start.await();
                            return leases.claim(lease, Duration.ofHours(24), false);
                        };
                        claims.add(pool.submit(claim));
                    }
                    start.countDown();
                    int won = 0;
                    for (Future<Boolean> claim : claims) if (claim.get(30, TimeUnit.SECONDS)) won++;
                    assertThat(won).as("exactly one replica claims " + lease).isEqualTo(1);
                }
            } finally {
                pool.shutdownNow();
            }

            ModelCatalogService.CatalogStatus status = context.getBean(ModelCatalogService.class).refresh(true);
            assertThat(status.status()).isEqualTo("FAILED");
            assertThat(status.refreshedAt()).isNull();
            assertThat(status.message()).isNotBlank();
        }
    }

    private static ConfigurableApplicationContext startApplication(String... extra) {
        List<String> properties = new ArrayList<>(List.of(
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
                "management.otlp.metrics.export.enabled=false"));
        properties.addAll(List.of(extra));
        return new SpringApplicationBuilder(AbadaEngineApplication.class)
                .web(WebApplicationType.SERVLET)
                .initializers(context -> TestPropertySourceUtils.addInlinedPropertiesToEnvironment(context,
                        properties.toArray(String[]::new)))
                .run("--spring.profiles.active=test");
    }
}
