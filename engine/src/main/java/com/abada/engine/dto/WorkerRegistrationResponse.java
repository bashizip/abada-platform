package com.abada.engine.dto;

import java.time.Instant;
import java.util.List;

/**
 * The calling worker's registered global capabilities: one entry per topic,
 * with the models the worker supports for that topic (empty means all).
 */
public record WorkerRegistrationResponse(
        String principalId,
        String principalUsername,
        List<RegisteredCapability> capabilities,
        Instant registeredAt) {

    public record RegisteredCapability(String topic, List<String> models) {
    }
}