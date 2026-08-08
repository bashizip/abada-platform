package com.abada.engine.insight;

import com.abada.engine.bpmn.compatibility.BpmnValidationException;
import com.abada.engine.insight.InsightAnalyzer.Finding;
import com.abada.engine.parser.AplParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Turns window findings into a concrete APL candidate. With no LLM endpoint
 * configured (or on any LLM/validation failure) it falls back to a safe,
 * semantics-preserving draft: the exact current source plus an annotated
 * header. Every candidate must parse and keep the target process id before
 * it is persisted — an invalid or non-compiling suggestion is discarded.
 */
@Component
public class InsightProposalGenerator {

    private static final Logger log = LoggerFactory.getLogger(InsightProposalGenerator.class);

    private final InsightProperties properties;
    private final AplParser aplParser;
    private final HttpClient httpClient;

    public InsightProposalGenerator(InsightProperties properties, AplParser aplParser) {
        this.properties = properties;
        this.aplParser = aplParser;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.getLlmTimeout())
                .build();
    }

    public record Proposal(String proposedSource, String rationale, String provider) {}

    public Proposal generate(String definitionKey, String targetSource, List<Finding> findings) {
        if (properties.isLlmConfigured()) {
            try {
                String suggested = requestLlm(definitionKey, targetSource, findings);
                if (isValidSuggestion(definitionKey, suggested)) {
                    return new Proposal(suggested,
                            rationale(findings) + " (suggested by LLM)", "llm");
                }
                log.warn("LLM proposal for '{}' was discarded: invalid or changed process id",
                        definitionKey);
            } catch (Exception exception) {
                log.warn("LLM proposal generation failed for '{}': {}", definitionKey,
                        exception.getMessage());
            }
        }
        String annotated = ruleBasedWithFindings(targetSource, findings);
        return new Proposal(annotated, rationale(findings) + " (rule-based fallback)", "rule-based");
    }

    private String rationale(List<Finding> findings) {
        return findings.stream()
                .map(f -> "%s on %s (signal %s, %.2f vs threshold %.2f, %d samples)"
                        .formatted(f.summary(), f.key().nodeId(), f.signal(),
                                f.observed(), f.threshold(), f.samples()))
                .collect(Collectors.joining("; "));
    }

    /** Explanatory draft: identical executable semantics, findings documented at the top. */
    private String ruleBasedWithFindings(String targetSource, List<Finding> findings) {
        String header = "# Insight engine working draft — review before adoption\n"
                + "# Findings addressed:\n"
                + findings.stream()
                        .map(f -> "#   - %s on %s (%s)\n"
                                .formatted(f.summary(), f.key().nodeId(), f.signal()))
                        .collect(Collectors.joining())
                + "# Semantics are unchanged; adoption review decides the real change.\n";
        return header + targetSource;
    }

    public static String extractLlmBlock(String completion) {
        if (completion == null || completion.isBlank()) {
            return null;
        }
        String content = completion;
        int fence = content.indexOf("```");
        if (fence >= 0) {
            int start = content.indexOf('\n', fence);
            int end = content.indexOf("```", start + 1);
            if (end > start) {
                content = content.substring(start + 1, end);
            }
        }
        return content.strip();
    }

    private boolean isValidSuggestion(String definitionKey, String suggested) {
        try {
            var parsed = aplParser.parseDetailed(suggested.getBytes(StandardCharsets.UTF_8));
            return definitionKey.equals(parsed.definition().getId());
        } catch (BpmnValidationException exception) {
            return false;
        }
    }

    private String requestLlm(String definitionKey, String targetSource, List<Finding> findings)
            throws Exception {
        String prompt = """
                Rewrite the abada.io/v1 APL definition below so that the following \\
                findings on the current running version are addressed:
                %s

                Requirements:
                - Keep the process id "%s" EXACTLY as it is.
                - Preserve all existing node ids unless the change requires adding nodes.
                - Output ONLY the complete YAML document (no commentary, no markdown fence).
                - Prefer minimal structural change; embed a "#" comment above each changed node
                  explaining the change.
                - Never introduce BPMN constructs outside the supported abada.io/v1 subset
                  (service tasks, decisions, user tasks, exclusive parallels, events, timer
                  candidates, external tasks).

                Definition to optimize:
                %s""".formatted(fullBlock(findings), definitionKey, targetSource);

        String body = ("{\"model\":\"%s\",\"temperature\":0.2,\"messages\":["
                + "{\"role\":\"system\",\"content\":\"You are the Abada Insight Engine, an APL "
                + "optimization specialist. You emit only valid abada.io/v1 YAML.\"},"
                + "{\"role\":\"user\",\"content\":\"%s\"}]}")
                .formatted(properties.getLlmModel(), jsonString(prompt));

        URI uri = URI.create(stripTrailingSlash(properties.getLlmBaseUrl()) + "/chat/completions");
        HttpRequest.Builder requestBuilder = HttpRequest.newBuilder(uri)
                .timeout(properties.getLlmTimeout())
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + properties.getLlmApiKey());

        // Inject OpenRouter identification headers when enabled
        if (properties.isOpenRouterEnabled()) {
            requestBuilder.header("HTTP-Referer", properties.getOpenRouterReferer());
            requestBuilder.header("X-Title", properties.getOpenRouterTitle());
        }

        HttpRequest request = requestBuilder
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();

        HttpResponse<String> response = httpClient.send(request,
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException("LLM endpoint returned HTTP " + response.statusCode());
        }
        String block = extractLlmBlock(extractContent(response.body()));
        if (block == null) {
            throw new IllegalStateException("LLM response contained no usable text");
        }
        return block;
    }

    private String fullBlock(List<Finding> findings) {
        return findings.stream()
                .map(f -> "- " + f.summary() + " (signal " + f.signal()
                        + ", observed " + f.observed() + " vs threshold " + f.threshold()
                        + ", " + f.samples() + " samples)")
                .collect(Collectors.joining("\n"));
    }

    private static String jsonString(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "");
    }

    /** Minimal OpenAI-compatible "content" extraction without a JSON library. */
    private static String extractContent(String body) {
        int idx = body.indexOf("\"content\"");
        if (idx < 0) {
            return "";
        }
        idx = body.indexOf(':', idx);
        if (idx < 0) {
            return "";
        }
        int start = body.indexOf('"', idx);
        if (start < 0) {
            return "";
        }
        start++;
        StringBuilder out = new StringBuilder();
        boolean escaped = false;
        for (int i = start; i < body.length(); i++) {
            char c = body.charAt(i);
            if (c == '"' && !escaped) {
                break;
            }
            if (c == '\\' && !escaped) {
                escaped = true;
                continue;
            }
            if (escaped) {
                if (c == 'n') {
                    out.append('\n');
                } else if (c == 't') {
                    out.append('\t');
                } else {
                    out.append(c);
                }
                escaped = false;
                continue;
            }
            out.append(c);
        }
        return out.toString();
    }

    private static String stripTrailingSlash(String url) {
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }
}