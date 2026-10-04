package com.abada.engine.dto;

import java.util.Map;

/**
 * A reviewer's decision on a human task that declares outcomes.
 *
 * @param outcome one of the task's declared outcomes
 * @param comment the reviewer's comment; required by outcomes that say so,
 *        at most 4 000 characters, written to {@code <task>_comment}
 * @param variables optional extra process variables (not the engine-written
 *        {@code <task>_outcome} / {@code <task>_comment})
 */
public record TaskDecisionRequest(String outcome, String comment, Map<String, Object> variables) {

    public Map<String, Object> variablesOrEmpty() {
        return variables == null ? Map.of() : variables;
    }

    /**
     * What identifies this request for idempotency: the outcome and a digest of
     * the comment, never the comment text itself.
     */
    public Map<String, Object> fingerprint(String taskId, String user) {
        return Map.of("taskId", taskId, "user", user == null ? "" : user,
                "outcome", outcome == null ? "" : outcome,
                "comment", comment == null ? "" : sha256(comment),
                "variables", variablesOrEmpty());
    }

    private static String sha256(String value) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
