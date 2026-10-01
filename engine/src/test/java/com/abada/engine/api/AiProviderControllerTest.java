package com.abada.engine.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.abada.engine.core.AbadaEngine;
import com.abada.engine.core.exception.ProcessEngineException;
import com.abada.engine.persistence.repository.AiProviderRepository;
import com.abada.engine.util.DatabaseTestHelper;
import java.io.InputStream;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AiProviderControllerTest {
    private static final String GEMINI_KEY = "AIza-test-gemini-key-7f3a";

    @Autowired MockMvc mvc;
    @Autowired AiProviderRepository providers;
    @Autowired AbadaEngine engine;
    @Autowired DatabaseTestHelper database;

    @BeforeEach
    @AfterEach
    void clean() {
        providers.deleteAll();
    }

    @Test
    void savesAProviderAndNeverReturnsItsKey() throws Exception {
        String saved = mvc.perform(put("/v1/ai-providers/gemini").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"providerType\":\"gemini\",\"apiKey\":\"" + GEMINI_KEY + "\","
                                + "\"insightDefault\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.apiKeyHint").value("****7f3a"))
                .andExpect(jsonPath("$.activeSource").value("STUDIO"))
                .andExpect(jsonPath("$.configured").value(true))
                .andExpect(jsonPath("$.baseUrl").value("https://generativelanguage.googleapis.com/v1beta/openai"))
                .andExpect(jsonPath("$.modelPatterns[0]").value("gemini"))
                .andReturn().getResponse().getContentAsString();
        String listed = mvc.perform(get("/v1/ai-providers")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("gemini"))
                .andReturn().getResponse().getContentAsString();

        assertThat(saved).doesNotContain(GEMINI_KEY);
        assertThat(listed).doesNotContain(GEMINI_KEY);
        assertThat(providers.findById("gemini").orElseThrow().getApiKeyEnc()).doesNotContain(GEMINI_KEY);
    }

    @Test
    void blankKeyOnUpdateKeepsTheStoredKey() throws Exception {
        save("gemini", "{\"providerType\":\"gemini\",\"apiKey\":\"" + GEMINI_KEY + "\"}");
        String before = providers.findById("gemini").orElseThrow().getApiKeyEnc();

        save("gemini", "{\"apiKey\":\"\",\"defaultModel\":\"gemini-3.7-flash\"}");

        assertThat(providers.findById("gemini").orElseThrow().getApiKeyEnc()).isEqualTo(before);
        assertThat(providers.findById("gemini").orElseThrow().getDefaultModel()).isEqualTo("gemini-3.7-flash");
    }

    @Test
    void onlyOneProviderIsTheInsightDefault() throws Exception {
        save("gemini", "{\"providerType\":\"gemini\",\"apiKey\":\"k1\",\"insightDefault\":true}");
        save("anthropic", "{\"providerType\":\"anthropic\",\"apiKey\":\"k2\",\"insightDefault\":true}");

        assertThat(providers.findById("gemini").orElseThrow().isInsightDefault()).isFalse();
        assertThat(providers.findById("anthropic").orElseThrow().isInsightDefault()).isTrue();
        mvc.perform(get("/v1/insight/config/ai"))
                .andExpect(jsonPath("$.configured").value(true))
                .andExpect(jsonPath("$.providerType").value("anthropic"))
                .andExpect(jsonPath("$.apiKey").doesNotExist());
    }

    @Test
    void theFirstProviderBecomesTheDefaultAndLaterOnesDoNot() throws Exception {
        save("gemini", "{\"providerType\":\"gemini\",\"apiKey\":\"k1\"}");
        save("anthropic", "{\"providerType\":\"anthropic\",\"apiKey\":\"k2\"}");

        assertThat(providers.findById("gemini").orElseThrow().isInsightDefault()).isTrue();
        assertThat(providers.findById("anthropic").orElseThrow().isInsightDefault()).isFalse();
        mvc.perform(get("/v1/ai-providers/status"))
                .andExpect(jsonPath("$.insightProviderId").value("gemini"))
                .andExpect(jsonPath("$.insightModel").value("gemini-3.6-flash"))
                .andExpect(jsonPath("$.insightFallback").value(false));
    }

    @Test
    void statusReportsWhenTheChosenDefaultCannotRun() throws Exception {
        save("anthropic", "{\"providerType\":\"anthropic\",\"apiKey\":\"k\",\"insightDefault\":false}");
        save("gemini", "{\"providerType\":\"gemini\",\"insightDefault\":true}");

        mvc.perform(get("/v1/ai-providers/status"))
                .andExpect(jsonPath("$.requestedInsightProviderId").value("gemini"))
                .andExpect(jsonPath("$.insightProviderId").value("anthropic"))
                .andExpect(jsonPath("$.insightFallback").value(true));
    }

    @Test
    void statusListsTheModelsNoProviderServes() throws Exception {
        save("anthropic", "{\"providerType\":\"anthropic\",\"apiKey\":\"k\",\"insightDefault\":false}");
        save("gemini", "{\"providerType\":\"gemini\",\"apiKey\":\"k\",\"enabled\":false}");

        mvc.perform(get("/v1/ai-providers/status").param("model", "claude-sonnet-5")
                        .param("model", "gpt-5-mini"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.configured").value(false))
                .andExpect(jsonPath("$.unconfiguredModels.length()").value(1))
                .andExpect(jsonPath("$.unconfiguredModels[0]").value("gpt-5-mini"))
                .andExpect(jsonPath("$.insightProviderId").value("anthropic"));
        mvc.perform(get("/v1/ai-providers/status").param("model", "claude-sonnet-5"))
                .andExpect(jsonPath("$.configured").value(true))
                .andExpect(jsonPath("$.unconfiguredModels").isEmpty());

        providers.deleteAll();
        mvc.perform(get("/v1/ai-providers/status").param("model", "gemini-3.6-flash"))
                .andExpect(jsonPath("$.configured").value(false))
                .andExpect(jsonPath("$.unconfiguredModels[0]").value("gemini-3.6-flash"));
    }

    @Test
    void rejectsInvalidProviders() throws Exception {
        mvc.perform(put("/v1/ai-providers/Bad_Id").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/v1/ai-providers/local-gateway").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"providerType\":\"openai-compatible\",\"apiKey\":\"k\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        mvc.perform(put("/v1/ai-providers/local-gateway").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"providerType\":\"openai-compatible\",\"baseUrl\":\"file:///etc/passwd\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/v1/ai-providers/x").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"providerType\":\"not-a-provider\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void deletingAStudioProviderRemovesIt() throws Exception {
        save("gemini", "{\"providerType\":\"gemini\",\"apiKey\":\"k\"}");

        mvc.perform(delete("/v1/ai-providers/gemini")).andExpect(status().isNoContent());
        mvc.perform(delete("/v1/ai-providers/gemini")).andExpect(status().isNotFound());
        assertThat(providers.count()).isZero();
    }

    @Test
    void startingAnAgentProcessRequiresAProviderForItsModel() throws Exception {
        database.cleanup();
        try (InputStream stream = getClass().getResourceAsStream("/apl/agent-contract.apl.yaml")) {
            engine.deploy(stream);
        }
        Map<String, Object> lead = Map.of("lead", Map.of("companyEmployees", 1200));

        assertThatThrownBy(() -> engine.startProcess("agent_contract", "alice", lead))
                .isInstanceOf(ProcessEngineException.class)
                .hasMessageContaining("gemini-3.6-flash")
                .hasMessageContaining("Studio Settings > AI Providers");

        save("anthropic", "{\"providerType\":\"anthropic\",\"apiKey\":\"k\",\"insightDefault\":true}");
        assertThatThrownBy(() -> engine.startProcess("agent_contract", "alice", lead))
                .as("a provider for another model family does not count")
                .hasMessageContaining("gemini-3.6-flash");

        save("gemini", "{\"providerType\":\"gemini\",\"apiKey\":\"" + GEMINI_KEY + "\"}");
        assertThat(engine.startProcess("agent_contract", "alice", lead).getId()).isNotBlank();
    }

    private void save(String id, String body) throws Exception {
        mvc.perform(put("/v1/ai-providers/" + id).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
    }
}
