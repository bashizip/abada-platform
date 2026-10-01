package com.abada.engine.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.abada.engine.insight.InsightProperties;
import com.abada.engine.persistence.entity.AiProviderEntity;
import com.abada.engine.persistence.repository.AiProviderRepository;
import com.abada.engine.security.AesEncryption;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class AiProviderRegistryTest {
    private final AesEncryption encryption = new AesEncryption("");
    private final AiProviderRepository repository = mock(AiProviderRepository.class);
    private final InsightProperties insight = mock(InsightProperties.class);
    private final MockEnvironment environment = new MockEnvironment();
    private final List<AiProviderEntity> rows = new ArrayList<>();
    private AiProviderRegistry registry;

    @BeforeEach
    void setUp() {
        when(repository.findAll()).thenReturn(rows);
        when(insight.getLlmTimeout()).thenReturn(Duration.ofSeconds(90));
        when(insight.getLlmModel()).thenReturn("gemini-3.6-flash");
        registry = new AiProviderRegistry(repository, encryption, insight, environment);
    }

    @Test
    void nothingConfiguredResolvesNothing() {
        assertThat(registry.activeProviders()).isEmpty();
        assertThat(registry.resolveForModel("gemini-3.6-flash")).isEmpty();
        assertThat(registry.isConfigured()).isFalse();
    }

    @Test
    void studioKeyWinsOverTheEnvironmentKeyOfTheSameProvider() {
        environment.setProperty("ABADA_LLM_GEMINI_API_KEY", "env-gemini-key");
        rows.add(row("gemini", "gemini", "studio-gemini-key", null, true));

        ResolvedAiProvider gemini = registry.resolveForModel("gemini-3.6-flash").orElseThrow();

        assertThat(gemini.apiKey()).isEqualTo("studio-gemini-key");
        assertThat(gemini.source()).isEqualTo(ResolvedAiProvider.Source.STUDIO);
        assertThat(gemini.baseUrl()).isEqualTo("https://generativelanguage.googleapis.com/v1beta/openai");
    }

    @Test
    void aStudioProviderWithoutItsOwnKeyUsesTheEnvironmentKeyAndKeepsItsSettings() {
        environment.setProperty("ABADA_LLM_GEMINI_API_KEY", "env-gemini-key");
        AiProviderEntity gemini = row("gemini", "gemini", null, null, true);
        gemini.setDefaultModel("gemini-3.8-flash");
        rows.add(gemini);
        AiProviderEntity placeholder = row("openai-compatible", "openai-compatible", "placeholder-key", "*", false);
        placeholder.setBaseUrl("http://mock-llm:8000/v1");
        placeholder.setDefaultModel("gpt-5-mini");
        rows.add(placeholder);

        ResolvedAiProvider insight = registry.insightProvider().orElseThrow();

        assertThat(insight.id()).as("the provider chosen in Studio, not the first one with a key").isEqualTo("gemini");
        assertThat(insight.apiKey()).isEqualTo("env-gemini-key");
        assertThat(insight.source()).isEqualTo(ResolvedAiProvider.Source.ENVIRONMENT);
        assertThat(registry.insightModel()).isEqualTo("gemini-3.8-flash");
        assertThat(registry.insightSelection().fallback()).isFalse();
    }

    @Test
    void aProviderDisabledInStudioIsNotUsedEvenWithAnEnvironmentKey() {
        environment.setProperty("ABADA_LLM_GEMINI_API_KEY", "env-gemini-key");
        AiProviderEntity disabled = row("gemini", "gemini", "studio-gemini-key", null, false);
        disabled.setEnabled(false);
        rows.add(disabled);

        assertThat(registry.resolveForModel("gemini-3.6-flash")).isEmpty();
    }

    @Test
    void aChosenDefaultWithoutAnyKeyIsReportedAsAFallback() {
        rows.add(row("gemini", "gemini", null, null, true));
        rows.add(row("anthropic", "anthropic", "anthropic-key", null, false));

        AiProviderRegistry.InsightSelection selection = registry.insightSelection();

        assertThat(selection.requestedId()).isEqualTo("gemini");
        assertThat(selection.provider().orElseThrow().id()).isEqualTo("anthropic");
        assertThat(selection.fallback()).isTrue();
    }

    @Test
    void aKeylessStudioProviderWithoutAnEnvironmentKeyIsNotUsable() {
        rows.add(row("gemini", "gemini", null, null, true));

        assertThat(registry.activeProviders()).isEmpty();
        assertThat(registry.insightSelection().fallback()).isFalse();
    }

    @Test
    void routesEachModelToTheLongestMatchingPatternAndFallsBackToTheInsightProvider() {
        rows.add(row("gemini", "gemini", "gemini-key", null, true));
        rows.add(row("anthropic", "anthropic", "anthropic-key", null, false));
        rows.add(row("openrouter", "openrouter", "openrouter-key", "deepseek/,google/gemini-exp", false));

        assertThat(registry.resolveForModel("claude-sonnet-5").orElseThrow().id()).isEqualTo("anthropic");
        assertThat(registry.resolveForModel("deepseek/deepseek-v4-flash-free").orElseThrow().id())
                .isEqualTo("openrouter");
        assertThat(registry.resolveForModel("google/gemini-exp-1").orElseThrow().id())
                .as("longer prefix beats gemini's google/").isEqualTo("openrouter");
        assertThat(registry.resolveForModel("google/gemini-3.6-flash").orElseThrow().id()).isEqualTo("gemini");
        assertThat(registry.resolveForModel("unrouted-model")).as("never guessed").isEmpty();
        assertThat(registry.resolveForModel(null).orElseThrow().id()).as("no model: Insight provider")
                .isEqualTo("gemini");
    }

    @Test
    void aCatchAllGatewayServesModelsNoOtherPatternMatches() {
        rows.add(row("gemini", "gemini", "gemini-key", null, true));
        AiProviderEntity gateway = row("local-gateway", "openai-compatible", "gateway-key", null, false);
        gateway.setBaseUrl("http://llm-gateway.internal/v1/");
        rows.add(gateway);

        assertThat(registry.resolveForModel("gemini-3.6-flash").orElseThrow().id()).isEqualTo("gemini");
        ResolvedAiProvider local = registry.resolveForModel("llama-4").orElseThrow();
        assertThat(local.id()).isEqualTo("local-gateway");
        assertThat(local.baseUrl()).isEqualTo("http://llm-gateway.internal/v1");
    }

    @Test
    void legacyEnvironmentKeysStillWorkAndInferTheirProvider() {
        when(insight.getLlmApiKey()).thenReturn("legacy-key");
        when(insight.getLlmBaseUrl()).thenReturn("https://generativelanguage.googleapis.com/v1beta");

        ResolvedAiProvider provider = registry.insightProvider().orElseThrow();

        assertThat(provider.type()).isEqualTo(AiProviderType.GEMINI);
        assertThat(provider.baseUrl()).isEqualTo("https://generativelanguage.googleapis.com/v1beta/openai");
        assertThat(provider.insightDefault()).isTrue();
        assertThat(registry.insightModel()).isEqualTo("gemini-3.6-flash");
    }

    @Test
    void deprecatedWorkerOnlyVariablesAreStillHonoured() {
        environment.setProperty("ABADA_AGENT_LLM_API_KEY", "worker-key");
        environment.setProperty("ABADA_AGENT_LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta");
        environment.setProperty("ABADA_AGENT_OPENAI_API_KEY", "worker-key");
        environment.setProperty("ABADA_AGENT_OPENAI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta");

        assertThat(registry.activeProviders()).extracting(ResolvedAiProvider::id).containsExactly("gemini");
        assertThat(registry.resolveForModel("gemini-3.6-flash").orElseThrow().apiKey()).isEqualTo("worker-key");
    }

    @Test
    void studioInsightDefaultWinsOverTheEnvironmentDefault() {
        when(insight.getLlmApiKey()).thenReturn("env-key");
        when(insight.getLlmBaseUrl()).thenReturn("https://openrouter.ai/api/v1");
        AiProviderEntity anthropic = row("anthropic", "anthropic", "anthropic-key", null, true);
        anthropic.setDefaultModel("claude-sonnet-5");
        rows.add(anthropic);

        assertThat(registry.insightProvider().orElseThrow().id()).isEqualTo("anthropic");
        assertThat(registry.insightModel()).isEqualTo("claude-sonnet-5");
    }

    @Test
    void revisionChangesWhenAKeyRotatesAndNeverContainsTheKey() {
        AiProviderEntity gemini = row("gemini", "gemini", "first-key", null, true);
        rows.add(gemini);
        String before = registry.revision();

        gemini.setApiKeyEnc(encryption.encrypt("second-key"));
        rows.set(0, gemini);
        String after = registry.revision();

        assertThat(after).isNotEqualTo(before).doesNotContain("second-key").hasSize(16);
    }

    @Test
    void anUndecryptableStudioKeyIsIgnoredNotThrown() {
        AiProviderEntity broken = row("gemini", "gemini", "key", null, true);
        broken.setApiKeyEnc("bm90LWEtdmFsaWQtY2lwaGVydGV4dA==");
        rows.add(broken);

        assertThat(registry.activeProviders()).isEmpty();
    }

    @Test
    void toStringNeverPrintsTheKey() {
        rows.add(row("gemini", "gemini", "super-secret-key", null, true));

        assertThat(registry.activeProviders().get(0).toString()).doesNotContain("super-secret-key")
                .contains("****-key");
    }

    @Test
    void upstreamModelStripsTheProviderNamespace() {
        assertThat(AiProviderType.GEMINI.upstreamModel("google/gemini-3.6-flash")).isEqualTo("gemini-3.6-flash");
        assertThat(AiProviderType.ANTHROPIC.upstreamModel("anthropic/claude-sonnet-5")).isEqualTo("claude-sonnet-5");
        assertThat(AiProviderType.OPENROUTER.upstreamModel("deepseek/deepseek-v4")).isEqualTo("deepseek/deepseek-v4");
    }

    private AiProviderEntity row(String id, String type, String key, String patterns, boolean insightDefault) {
        AiProviderEntity row = new AiProviderEntity();
        row.setId(id);
        row.setDisplayName(id);
        row.setProviderType(type);
        if (key != null) {
            row.setApiKeyEnc(encryption.encrypt(key));
            row.setApiKeyHint(ResolvedAiProvider.hint(key));
        }
        row.setModelPatterns(patterns);
        row.setInsightDefault(insightDefault);
        row.setCreatedAt(Instant.now());
        row.setUpdatedAt(Instant.now());
        return row;
    }
}
