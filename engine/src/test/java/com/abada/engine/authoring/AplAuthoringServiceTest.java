package com.abada.engine.authoring;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.abada.engine.llm.OpenAiCompatibleLlmClient;
import com.abada.engine.parser.AplParser;
import com.abada.engine.persistence.repository.ProjectProcessDocumentRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AplAuthoringServiceTest {
    private final OpenAiCompatibleLlmClient llm = mock(OpenAiCompatibleLlmClient.class);
    private final ProjectProcessDocumentRepository documents = mock(ProjectProcessDocumentRepository.class);
    private AplAuthoringService service;

    @BeforeEach
    void setUp() {
        when(documents.findByProjectIdAndProcessKey(anyString(), anyString())).thenReturn(Optional.empty());
        service = new AplAuthoringService(llm, new AplParser(), documents, new ObjectMapper(),
                AplParser.DEFAULT_ALLOWED_AGENT_MODELS);
    }

    @Test
    void generatesValidatedLocalFallbackWhenLlmIsNotConfigured() {
        when(llm.isConfigured()).thenReturn(false);

        var candidate = service.generate("project-1", AplAuthoringService.Mode.CREATE,
                "Review invoice fraud with a human approver", null);

        assertThat(candidate.provider()).isEqualTo(AplAuthoringService.Provider.LOCAL_FALLBACK);
        assertThat(candidate.attempts()).isZero();
        assertThat(candidate.aplSource()).contains("version: abada.io/v1", "type: webhook", "type: agent");
        assertThat(new AplParser().parse(candidate.aplSource().getBytes()).getId())
                .startsWith("review_invoice_fraud");
    }

    @Test
    void repairsInvalidLlmCandidateBeforeReturningIt() throws Exception {
        when(llm.isConfigured()).thenReturn(true);
        when(llm.model()).thenReturn("test-model");
        when(llm.complete(anyString(), anyString())).thenReturn("not apl", apl("generated_flow", "Generated"));

        var candidate = service.generate("project-1", AplAuthoringService.Mode.CREATE,
                "Generated flow", null);

        assertThat(candidate.provider()).isEqualTo(AplAuthoringService.Provider.LLM);
        assertThat(candidate.model()).isEqualTo("test-model");
        assertThat(candidate.attempts()).isEqualTo(2);
        assertThat(candidate.warnings()).anySatisfy(warning ->
                assertThat(warning).contains("failed APL validation"));
    }

    @Test
    void refineRejectsChangedKeyAndKeepsTheExistingIdentity() throws Exception {
        when(llm.isConfigured()).thenReturn(true);
        when(llm.model()).thenReturn("test-model");
        when(llm.complete(anyString(), anyString()))
                .thenReturn(apl("changed_key", "Changed"), apl("stable_key", "Stable"));

        var candidate = service.generate("project-1", AplAuthoringService.Mode.REFINE,
                "Add a review", apl("stable_key", "Stable"));

        assertThat(candidate.provider()).isEqualTo(AplAuthoringService.Provider.LLM);
        assertThat(candidate.attempts()).isEqualTo(2);
        assertThat(new AplParser().parse(candidate.aplSource().getBytes()).getId()).isEqualTo("stable_key");
    }

    private String apl(String key, String name) {
        return """
                version: abada.io/v1
                metadata:
                  key: %s
                  name: %s
                flow:
                  entry: start
                  nodes:
                    - id: start
                      type: webhook
                      next: end
                    - id: end
                      type: end
                """.formatted(key, name);
    }
}
