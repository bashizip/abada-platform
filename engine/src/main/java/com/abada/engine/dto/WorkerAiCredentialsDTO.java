package com.abada.engine.dto;

import java.util.List;

/**
 * Resolved AI provider credentials for the first-party agent worker, after the
 * Studio-over-environment merge. Served only to worker principals holding the
 * {@code abada:agent} capability, with {@code Cache-Control: no-store}.
 * {@code revision} changes whenever a provider, endpoint or key changes.
 */
public record WorkerAiCredentialsDTO(String revision, List<Provider> providers) {

    /**
     * {@code fallback} marks the provider for models no pattern matches. The
     * record's {@link #toString()} never prints the key.
     */
    public record Provider(
            String id,
            String type,
            String baseUrl,
            String apiKey,
            List<String> modelPatterns,
            String defaultModel,
            long timeoutMs,
            boolean fallback) {

        @Override
        public String toString() {
            return "Provider[id=" + id + ", type=" + type + ", baseUrl=" + baseUrl + ", apiKey=****]";
        }
    }
}
