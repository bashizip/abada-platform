package com.abada.engine.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class InsightConfigControllerTest {

    @Autowired MockMvc mvc;

    @Test
    void returnsLlmConfigurationWithoutExposingSecrets() throws Exception {
        mvc.perform(get("/v1/insight/config/llm"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.providerType").isString())
                .andExpect(jsonPath("$.configured").isBoolean())
                .andExpect(jsonPath("$.model").isString())
                .andExpect(jsonPath("$.apiKey").doesNotExist());
    }

    @Test
    void testConnectionReturnsStatus() throws Exception {
        mvc.perform(post("/v1/insight/config/llm/test"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").isString())
                .andExpect(jsonPath("$.message").isString());
    }
}
