package com.abada.engine.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
class InfoControllerTest {

    @Autowired MockMvc mvc;

    @Test
    void returnsStablePublicServiceMetadataWithoutHostInternals() throws Exception {
        mvc.perform(get("/v1/info"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Abada Engine"))
                .andExpect(jsonPath("$.service").value("abada-engine"))
                .andExpect(jsonPath("$.description")
                        .value("Open-source, self-hosted BPMN 2.0 workflow orchestration engine"))
                .andExpect(jsonPath("$.version").value("1.0.0-rc.5"))
                .andExpect(jsonPath("$.api.version").value("v1"))
                .andExpect(jsonPath("$.api.openApi").value("/api/v3/api-docs"))
                .andExpect(jsonPath("$.api.swaggerUi").value("/api/swagger-ui.html"))
                .andExpect(jsonPath("$.engine.standard").value("BPMN 2.0"))
                .andExpect(jsonPath("$.engine.supportLevel").value("documented-subset"))
                .andExpect(jsonPath("$.engine.persistence").value("PostgreSQL"))
                .andExpect(jsonPath("$.health.liveness").value("/api/actuator/health/liveness"))
                .andExpect(jsonPath("$.health.readiness").value("/api/actuator/health/readiness"))
                .andExpect(jsonPath("$.status").doesNotExist())
                .andExpect(jsonPath("$.profile").doesNotExist())
                .andExpect(jsonPath("$.runtime").doesNotExist())
                .andExpect(jsonPath("$.capabilities").doesNotExist());
    }
}
