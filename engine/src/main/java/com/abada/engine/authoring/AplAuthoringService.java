package com.abada.engine.authoring;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.llm.OpenAiCompatibleLlmClient;
import com.abada.engine.parser.AplParser;
import com.abada.engine.persistence.repository.ProjectProcessDocumentRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Generates review-only APL candidates; this service never persists workflow state. */
@Service
public class AplAuthoringService {
    public enum Mode { CREATE, REFINE }
    public enum Provider { LLM, LOCAL_FALLBACK }
    public record Candidate(String aplSource, Provider provider, String model,
                            int attempts, List<String> warnings) {}

    private static final Logger log = LoggerFactory.getLogger(AplAuthoringService.class);
    private static final int MAX_REPAIRS = 2;
    private static final String SYSTEM_PROMPT = """
            You are Abada Studio's APL authoring engine. Emit only one complete YAML document.
            The document must use version abada.io/v1 and compile without a BPMN/XML round-trip.
            Supported node types are webhook, agent, engine-task, decision-table, human-input
            (approval-gate is a deprecated alias), condition, and end. flow.entry must reference the single webhook node. Every next,
            condition target, and error target must reference an existing node. Use stable,
            descriptive node ids matching [a-zA-Z][a-zA-Z0-9_-]*. Never emit markdown fences or
            prose outside the YAML. Keep agents probabilistic and business rules deterministic.
            """;

    private final OpenAiCompatibleLlmClient llm;
    private final AplParser aplParser;
    private final ProjectProcessDocumentRepository documents;
    private final ObjectMapper objectMapper;
    private final String defaultAgentModel;

    public AplAuthoringService(OpenAiCompatibleLlmClient llm, AplParser aplParser,
            ProjectProcessDocumentRepository documents, ObjectMapper objectMapper,
            @Value("${abada.agent.allowed-models:" + AplParser.DEFAULT_ALLOWED_AGENT_MODELS + "}") String allowedAgentModels) {
        this.llm = llm;
        this.aplParser = aplParser;
        this.documents = documents;
        this.objectMapper = objectMapper;
        this.defaultAgentModel = allowedAgentModels.strip().split(",")[0].trim();
    }

    public Candidate generate(String projectId, Mode mode, String prompt, String baseAplSource) {
        String request = requirePrompt(prompt);
        String key;
        String name;
        if (mode == Mode.REFINE) {
            if (baseAplSource == null || baseAplSource.isBlank()) {
                throw new IllegalArgumentException("baseAplSource is required for REFINE");
            }
            var parsed = aplParser.parseDetailed(baseAplSource.getBytes(StandardCharsets.UTF_8)).definition();
            key = parsed.getId();
            name = parsed.getName();
        } else {
            name = processName(request);
            key = uniqueKey(projectId, slug(request));
        }

        List<String> warnings = new ArrayList<>();
        int attempts = 0;
        if (llm.isConfigured()) {
            String userPrompt = initialPrompt(mode, request, key, name, baseAplSource);
            for (int repair = 0; repair <= MAX_REPAIRS; repair++) {
                attempts++;
                try {
                    String candidate = llm.complete(SYSTEM_PROMPT, userPrompt);
                    String validationError = validationError(candidate, key);
                    if (validationError == null) {
                        log.info("Generated validated APL candidate for project {} key {} with {} attempt(s)",
                                projectId, key, attempts);
                        return new Candidate(candidate, Provider.LLM, llm.model(), attempts, List.copyOf(warnings));
                    }
                    warnings.add("LLM candidate " + attempts + " failed APL validation");
                    userPrompt = repairPrompt(request, key, validationError, candidate);
                } catch (Exception exception) {
                    warnings.add("LLM request " + attempts + " failed");
                    log.warn("APL authoring request failed for project {} key {} on attempt {}: {}",
                            projectId, key, attempts, exception.getMessage());
                }
            }
        } else {
            warnings.add("LLM provider is not configured");
        }

        String fallback = fallback(key, name, request);
        String fallbackError = validationError(fallback, key);
        if (fallbackError != null) throw new IllegalStateException("Local APL fallback is invalid: " + fallbackError);
        warnings.add("A deterministic local starter was generated and requires review");
        return new Candidate(fallback, Provider.LOCAL_FALLBACK, null, attempts, List.copyOf(warnings));
    }

    private String initialPrompt(Mode mode, String prompt, String key, String name, String source) {
        String requirements = "The metadata.key must be exactly \"" + key + "\" and metadata.name exactly "
                + quoted(name) + ".";
        if (mode == Mode.CREATE) {
            return "Create a complete process for this request:\n" + prompt + "\n\n" + requirements;
        }
        return "Refine the APL below according to this request:\n" + prompt + "\n\n" + requirements
                + " Preserve existing node ids unless adding or removing a requested step requires otherwise."
                + "\n\nCurrent APL:\n" + source;
    }

    private String repairPrompt(String prompt, String key, String error, String candidate) {
        return "Repair the candidate below. The user request remains:\n" + prompt
                + "\nThe metadata.key must remain exactly \"" + key + "\"."
                + "\nValidation error:\n" + error + "\n\nInvalid candidate:\n" + candidate;
    }

    private String validationError(String source, String expectedKey) {
        try {
            var parsed = aplParser.parseDetailed(source.getBytes(StandardCharsets.UTF_8));
            return expectedKey.equals(parsed.definition().getId()) ? null
                    : "metadata.key changed from " + expectedKey;
        } catch (BpmnValidationException exception) {
            return exception.getMessage();
        }
    }

    private String uniqueKey(String projectId, String seed) {
        String candidate = seed;
        int suffix = 2;
        while (documents.findByProjectIdAndProcessKey(projectId, candidate).isPresent()) {
            String tail = "_" + suffix++;
            candidate = seed.substring(0, Math.min(seed.length(), 128 - tail.length())) + tail;
        }
        return candidate;
    }

    private static String slug(String prompt) {
        String value = Normalizer.normalize(prompt, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "_").replaceAll("^_+|_+$", "");
        if (value.isBlank()) value = "generated_process";
        if (!Character.isLetter(value.charAt(0))) value = "process_" + value;
        return value.substring(0, Math.min(value.length(), 96));
    }

    private static String processName(String prompt) {
        String value = prompt.strip().replaceAll("\\s+", " ");
        return value.substring(0, Math.min(value.length(), 80));
    }

    private static String requirePrompt(String prompt) {
        String value = prompt == null ? "" : prompt.strip();
        if (value.isEmpty()) throw new IllegalArgumentException("prompt is required");
        if (value.length() > 8_000) throw new IllegalArgumentException("prompt must not exceed 8000 characters");
        return value;
    }

    private String fallback(String key, String name, String prompt) {
        return """
                version: abada.io/v1
                metadata:
                  key: %s
                  name: %s
                  owner: studio-user
                  category: custom
                flow:
                  entry: start
                  nodes:
                    - id: start
                      type: webhook
                      description: Receives the initial process payload.
                      next: analyze
                    - id: analyze
                      type: agent
                      profile: abada.agent/v1
                      model: %s
                      prompt: %s
                      confidence_threshold: 85
                      temperature: 0.2
                      result_variable: analysis_result
                      next: end
                    - id: end
                      type: end
                      description: Records the terminal outcome.
                """.formatted(key, quoted(name), defaultAgentModel, quoted(prompt));
    }

    private String quoted(String value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Text cannot be encoded", exception);
        }
    }
}
