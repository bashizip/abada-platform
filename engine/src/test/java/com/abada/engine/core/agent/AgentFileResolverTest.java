package com.abada.engine.core.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.AgentWorkDescriptor;
import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.repository.ProcessFileRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** S15: the resolver's limits and shapes, without a database. */
class AgentFileResolverTest {
    private final ProcessFileRepository files = mock(ProcessFileRepository.class);

    private ProcessFileEntity attached(String id, long size) {
        ProcessFileEntity row = new ProcessFileEntity();
        row.setId(id);
        row.setProjectId("p");
        row.setInstanceId("pi-1");
        row.setState(ProcessFileEntity.State.ATTACHED);
        row.setName(id + ".pdf");
        row.setContentType("application/pdf");
        row.setSizeBytes(size);
        row.setSha256("0".repeat(64));
        when(files.findById(id)).thenReturn(Optional.of(row));
        return row;
    }

    private static ProcessInstance instance(Map<String, Object> variables) {
        ProcessInstance instance = new ProcessInstance("pi-1", null, List.of(), Instant.now(), null);
        instance.setProjectId("p");
        variables.forEach(instance::setVariable);
        return instance;
    }

    private static AgentWorkDescriptor work(Map<String, String> declared, Integer maxFiles) {
        return new AgentWorkDescriptor("abada.agent/v1", "gemini-3.6-flash", "Read", Map.of(), "r", Map.of(),
                List.of(), 0.0, 0.2, 100, 1000L, 1, 0L, List.of(), Map.of(), List.of(), Map.of(), null, List.of(),
                declared, maxFiles, List.of());
    }

    @Test
    void theBytesOfOneCallAreCappedByTheInstallation() {
        attached("a", 600);
        attached("b", 600);
        AgentFileResolver resolver = new AgentFileResolver(files, 1000);
        var refused = org.assertj.core.api.Assertions.catchThrowableOfType(
                AgentFileResolver.AgentFileException.class,
                () -> resolver.resolve(work(Map.of("docs", "docs"), 5), instance(Map.of("docs", List.of(
                        Map.of("fileId", "a"), Map.of("fileId", "b"))))));
        assertThat(refused.code()).isEqualTo(AgentFileResolver.LIMIT);
        assertThat(refused.getMessage()).contains("1000 bytes");
    }

    @Test
    void anEmptyOptionalUploadIsNoFileAndADuplicateIsSentOnce() {
        attached("a", 10);
        AgentFileResolver resolver = new AgentFileResolver(files, AgentFileResolver.DEFAULT_MAX_BYTES);
        java.util.HashMap<String, Object> variables = new java.util.HashMap<>();
        variables.put("scan", Map.of("fileId", "a"));
        variables.put("again", Map.of("fileId", "a"));
        var resolved = resolver.resolve(work(new java.util.LinkedHashMap<>(Map.of("scan", "scan", "again", "again",
                "missing", "missing")), 1), instance(variables));
        assertThat(resolved).hasSize(1);
        assertThat(resolved.getFirst().fileId()).isEqualTo("a");
        assertThat(resolver.declares(work(Map.of("scan", "scan"), 1), instance(variables), "a")).isTrue();
        assertThat(resolver.declares(work(Map.of("scan", "scan"), 1), instance(variables), "other")).isFalse();
    }

    @Test
    void aBadExpressionIsATypedFailure() {
        AgentFileResolver resolver = new AgentFileResolver(files, AgentFileResolver.DEFAULT_MAX_BYTES);
        assertThatThrownBy(() -> resolver.resolve(work(Map.of("doc", "size(nothing.at.all) > 1"), 1),
                instance(Map.of())))
                .isInstanceOf(AgentFileResolver.AgentFileException.class)
                .hasMessageContaining("could not be evaluated");
    }
}
