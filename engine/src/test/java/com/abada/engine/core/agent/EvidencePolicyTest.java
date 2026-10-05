package com.abada.engine.core.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.abada.engine.core.agent.EvidencePolicy.Mode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EvidencePolicyTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void aNodeMayOnlyTightenItsProjectsPolicy() {
        EvidencePolicy project = new EvidencePolicy(Mode.REDACTED, 30);
        assertThat(project.tightenedBy(Mode.NONE, 7)).isEqualTo(new EvidencePolicy(Mode.NONE, 7));
        assertThat(project.tightenedBy(Mode.FULL, 90)).isEqualTo(project);
        assertThat(project.tightenedBy(null, null)).isEqualTo(project);
        assertThat(new EvidencePolicy(Mode.FULL, 30).tightenedBy(Mode.REDACTED, null))
                .isEqualTo(new EvidencePolicy(Mode.REDACTED, 30));
        assertThatThrownBy(() -> new EvidencePolicy(Mode.FULL, 0)).isInstanceOf(IllegalArgumentException.class);
        assertThat(Mode.fromWire("redacted")).isEqualTo(Mode.REDACTED);
        assertThat(Mode.fromWire("everything")).isNull();
    }

    @Test
    void redactionMasksCredentialsSensitiveFieldsAndSensitiveValuesEverywhere() throws Exception {
        EvidenceRedactor redactor = new EvidenceRedactor(Map.of("iban", "DE89370400440532013000", "pin", "12"));
        JsonNode payload = JSON.readTree("""
                {
                  "note": "Customer DE89370400440532013000 sent Authorization: Bearer abcdefghijklmnop",
                  "iban": "DE89370400440532013000",
                  "api_key": "sk-live-123456",
                  "nested": [{ "password": "hunter22" }, "token=abc&x=1 https://x?key=s3cr3t"],
                  "pin": "12",
                  "amount": 120.5
                }
                """);
        String redacted = redactor.redact(payload).toString();

        assertThat(redacted).doesNotContain("DE89370400440532013000", "abcdefghijklmnop", "sk-live-123456",
                "hunter22", "s3cr3t");
        assertThat(redacted).contains("\"amount\":120.5").contains("\"pin\":\"****\"");
        assertThat(payload.toString()).contains("DE89370400440532013000");
        // Values shorter than 4 characters are not searched for in text.
        assertThat(redactor.redactText("call 12 times")).isEqualTo("call 12 times");
    }
}
