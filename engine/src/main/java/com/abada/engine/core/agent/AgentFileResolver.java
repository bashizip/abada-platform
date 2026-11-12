package com.abada.engine.core.agent;

import com.abada.engine.core.ProcessInstance;
import com.abada.engine.core.model.AgentFileRef;
import com.abada.engine.core.model.AgentWorkDescriptor;
import com.abada.engine.expression.ExpressionSyntax;
import com.abada.engine.expression.WorkflowExpressions;
import com.abada.engine.persistence.entity.ProcessFileEntity;
import com.abada.engine.persistence.repository.ProcessFileRepository;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Resolves an agent node's {@code files} (S15) into the references one call may read.
 * Runs in the transaction that locks the work, like input resolution: database reads
 * only, never the object store. Every reference must name a file that exists in the
 * instance's project, is {@code ATTACHED} to this very instance and is not being
 * deleted; the metadata sent on comes from the {@code process_files} row, not from the
 * variable. A breach is a typed, final failure of the work, never a call without the
 * file or with a different one.
 */
@Component
public class AgentFileResolver {
    /** A reference that is not a file of this instance, or an expression that cannot be read. */
    public static final String INVALID = "AGENT_FILE_INVALID";
    /** More files or bytes than the node or the installation allows. */
    public static final String LIMIT = "AGENT_FILE_LIMIT";
    /** Default {@code abada.agent.files.max-bytes}: 20 MB per call. */
    public static final long DEFAULT_MAX_BYTES = 20L * 1024 * 1024;

    private static final Pattern SIMPLE_PATH =
            Pattern.compile("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*");

    /** A resolution that broke the contract; {@link #code} is the failure code the work ends with. */
    public static final class AgentFileException extends RuntimeException {
        private final String code;

        public AgentFileException(String code, String message) {
            super(message);
            this.code = code;
        }

        public String code() { return code; }
    }

    private final ProcessFileRepository files;
    private final long maxBytes;

    public AgentFileResolver(ProcessFileRepository files,
            @Value("${abada.agent.files.max-bytes:" + DEFAULT_MAX_BYTES + "}") long maxBytes) {
        this.files = files;
        this.maxBytes = maxBytes;
    }

    public long maxBytes() { return maxBytes; }

    /** The files this work may send to a model, in declaration order, each once. Empty when it declares none. */
    public List<AgentFileRef> resolve(AgentWorkDescriptor work, ProcessInstance instance) {
        if (work == null || work.files().isEmpty()) return List.of();
        Map<String, AgentFileRef> resolved = new LinkedHashMap<>();
        long total = 0;
        for (Map.Entry<String, String> declared : work.files().entrySet()) {
            String name = declared.getKey();
            for (Object reference : references(name, evaluate(name, declared.getValue(), instance.getVariables()))) {
                String fileId = fileId(name, reference);
                if (resolved.containsKey(fileId)) continue;
                ProcessFileEntity row = files.findById(fileId).orElse(null);
                if (row == null || !row.getProjectId().equals(instance.getProjectId())
                        || row.getState() == ProcessFileEntity.State.DELETING) {
                    throw new AgentFileException(INVALID, "File '" + name + "' (" + fileId + ") no longer exists");
                }
                if (row.getState() != ProcessFileEntity.State.ATTACHED) {
                    throw new AgentFileException(INVALID, "File '" + name + "' (" + fileId
                            + ") is not attached to a completed task yet");
                }
                if (!row.getInstanceId().equals(instance.getId())) {
                    throw new AgentFileException(INVALID, "File '" + name + "' (" + fileId
                            + ") belongs to another process instance");
                }
                resolved.put(fileId, new AgentFileRef(name, row.getId(), row.getName(), row.getContentType(),
                        row.getSizeBytes(), row.getSha256()));
                total += row.getSizeBytes();
                if (resolved.size() > work.effectiveMaxFiles()) {
                    throw new AgentFileException(LIMIT, "The agent would read more than max_files ("
                            + work.effectiveMaxFiles() + ") files");
                }
                if (total > maxBytes) {
                    throw new AgentFileException(LIMIT, "The files of one call exceed " + maxBytes
                            + " bytes (abada.agent.files.max-bytes)");
                }
            }
        }
        return List.copyOf(resolved.values());
    }

    /** Whether {@code fileId} is one of the files {@code work} may read in {@code instance} now. */
    public boolean declares(AgentWorkDescriptor work, ProcessInstance instance, String fileId) {
        try {
            return resolve(work, instance).stream().anyMatch(file -> file.fileId().equals(fileId));
        } catch (AgentFileException refused) {
            return false;
        }
    }

    private static Object evaluate(String name, String expression, Map<String, Object> variables) {
        String normalized = ExpressionSyntax.normalize(expression);
        if (SIMPLE_PATH.matcher(normalized).matches()) {
            Object current = variables;
            for (String segment : normalized.split("\\.")) {
                if (!(current instanceof Map<?, ?> map)) return null;
                current = map.get(segment);
            }
            return current;
        }
        try {
            return WorkflowExpressions.compile(expression).evaluate(variables);
        } catch (RuntimeException exception) {
            throw new AgentFileException(INVALID, "File '" + name + "' expression could not be evaluated ("
                    + exception.getClass().getSimpleName() + ")");
        }
    }

    /** A missing value is no file (an optional upload left empty); one reference or a list of them. */
    private static List<Object> references(String name, Object value) {
        if (value == null) return List.of();
        if (value instanceof Collection<?> list) {
            List<Object> items = new ArrayList<>();
            for (Object item : list) if (item != null) items.add(item);
            return items;
        }
        return List.of(value);
    }

    private static String fileId(String name, Object reference) {
        if (reference instanceof Map<?, ?> map && map.get("fileId") instanceof String id && !id.isBlank()) {
            return id;
        }
        throw new AgentFileException(INVALID, "File '" + name + "' is not a file reference ({ fileId, ... })");
    }
}
