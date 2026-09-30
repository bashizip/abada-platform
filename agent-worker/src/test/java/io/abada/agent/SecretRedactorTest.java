package io.abada.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class SecretRedactorTest {
    private final SecretRedactor redactor = new SecretRedactor(() -> List.of("AIzaKnownProviderKey123"));

    @Test
    void removesKnownKeysAndCredentialShapedValues() {
        String redacted = redactor.redact("key AIzaKnownProviderKey123 at https://api.example/v1?key=abc123&x=1 "
                + "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig {\"api_key\":\"sk-other-9999\"} "
                + "client_secret=hunter2hunter2");

        assertFalse(redacted.contains("AIzaKnownProviderKey123"), redacted);
        assertFalse(redacted.contains("abc123"), redacted);
        assertFalse(redacted.contains("eyJhbGciOiJSUzI1NiJ9"), redacted);
        assertFalse(redacted.contains("sk-other-9999"), redacted);
        assertFalse(redacted.contains("hunter2hunter2"), redacted);
        assertTrue(redacted.contains("x=1"), "unrelated query parameters stay");
    }

    @Test
    void leavesOrdinaryErrorsReadable() {
        String message = "anthropic model or endpoint not found: 'claude-sonnet-5' (HTTP 404: model not found)";
        assertEquals(message, redactor.redact(message));
    }

    @Test
    void capsVeryLongStackTraces() {
        RuntimeException deep = new RuntimeException("x".repeat(40_000));
        String trace = redactor.stackTrace(deep);
        assertEquals(SecretRedactor.MAX_DETAILS_CHARS, trace.length());
        assertTrue(trace.endsWith("characters)"));
    }
}
