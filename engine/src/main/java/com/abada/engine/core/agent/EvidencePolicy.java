package com.abada.engine.core.agent;

import java.util.Locale;

/**
 * What the step journal keeps of agent payloads (model messages, tool
 * arguments and results) and for how long. Digests, tokens, cost, timings and
 * actors are always kept; this governs the payload columns only.
 *
 * <p>A node may only tighten its project's policy: fewer payloads (none is
 * stricter than redacted, which is stricter than full) and a shorter retention.
 */
public record EvidencePolicy(Mode payloads, int retentionDays) {
    public static final int MAX_RETENTION_DAYS = 3650;
    public static final EvidencePolicy DEFAULT = new EvidencePolicy(Mode.REDACTED, 30);

    public enum Mode {
        /** Strictest: no payload is stored. */
        NONE,
        /** Secrets and sensitive variables masked. */
        REDACTED,
        /** Stored as sent (still encrypted at rest). */
        FULL;

        public String wireName() {
            return name().toLowerCase(Locale.ROOT);
        }

        /** Parses {@code none}, {@code redacted} or {@code full}; null for anything else. */
        public static Mode fromWire(String value) {
            if (value == null) return null;
            for (Mode mode : values()) {
                if (mode.wireName().equals(value.strip().toLowerCase(Locale.ROOT))) return mode;
            }
            return null;
        }
    }

    public EvidencePolicy {
        if (payloads == null) payloads = Mode.REDACTED;
        if (retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS) {
            throw new IllegalArgumentException("retention_days must be between 1 and " + MAX_RETENTION_DAYS);
        }
    }

    /** This policy tightened by a node's override; an override can never loosen it. */
    public EvidencePolicy tightenedBy(Mode nodePayloads, Integer nodeRetentionDays) {
        Mode mode = nodePayloads == null || nodePayloads.ordinal() > payloads.ordinal() ? payloads : nodePayloads;
        int days = nodeRetentionDays == null ? retentionDays : Math.min(retentionDays, nodeRetentionDays);
        return new EvidencePolicy(mode, days);
    }
}
