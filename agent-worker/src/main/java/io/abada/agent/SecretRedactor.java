package io.abada.agent;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Collection;
import java.util.List;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * Removes secrets from text the worker reports to the engine (error messages
 * and stack traces shown to operators in Studio): the provider keys and engine
 * credentials the worker knows, plus bearer tokens, Authorization headers and
 * key-like query or JSON fields.
 */
final class SecretRedactor {
    static final String MASK = "****";
    /** Upper bound for a reported stack trace. */
    static final int MAX_DETAILS_CHARS = 16_384;

    private static final List<Pattern> PATTERNS = List.of(
            Pattern.compile("(?i)(bearer\\s+)[A-Za-z0-9._~+/=-]{8,}"),
            Pattern.compile("(?i)(authorization[\"']?\\s*[:=]\\s*[\"']?)[^\\s\"',}]+(\\s+[^\\s\"',}]+)?"),
            Pattern.compile("(?i)((?:api[_-]?key|x-api-key|access[_-]?token|client[_-]?secret|password|secret)"
                    + "[\"']?\\s*[:=]\\s*[\"']?)[^\\s\"'&,}]+"),
            Pattern.compile("(?i)([?&](?:key|api_key|token)=)[^&\\s\"']+"));

    private final Supplier<Collection<String>> knownSecrets;

    SecretRedactor(Supplier<Collection<String>> knownSecrets) {
        this.knownSecrets = knownSecrets;
    }

    static SecretRedactor patternsOnly() {
        return new SecretRedactor(List::of);
    }

    String redact(String text) {
        if (text == null || text.isEmpty()) return text;
        String result = text;
        for (String secret : knownSecrets.get()) {
            if (secret != null && secret.length() >= 6) result = result.replace(secret, MASK);
        }
        for (Pattern pattern : PATTERNS) {
            result = pattern.matcher(result).replaceAll(match -> java.util.regex.Matcher.quoteReplacement(
                    match.group(1) + MASK));
        }
        return result;
    }

    /** The full stack trace with its cause chain, redacted and capped at {@link #MAX_DETAILS_CHARS}. */
    String stackTrace(Throwable failure) {
        StringWriter out = new StringWriter();
        failure.printStackTrace(new PrintWriter(out));
        String trace = redact(out.toString());
        if (trace.length() <= MAX_DETAILS_CHARS) return trace;
        String marker = "\n\t... (truncated to " + MAX_DETAILS_CHARS + " characters)";
        return trace.substring(0, MAX_DETAILS_CHARS - marker.length()) + marker;
    }
}
