package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** The models a provider's own {@code /models} endpoint listed for its key (V39). */
@Entity
@Table(name = "ai_provider_models")
public class AiProviderModelsEntity {
    @Id
    @Column(name = "provider_id", length = 64)
    private String providerId;
    /** Newline-separated model ids. */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String models = "";
    @Column(name = "refreshed_at")
    private Instant refreshedAt;
    @Column(name = "last_attempt_at")
    private Instant lastAttemptAt;
    @Column(name = "last_error", length = 1000)
    private String lastError;

    public String getProviderId() { return providerId; }
    public void setProviderId(String value) { providerId = value; }
    public String getModels() { return models; }
    public void setModels(String value) { models = value; }
    public Instant getRefreshedAt() { return refreshedAt; }
    public void setRefreshedAt(Instant value) { refreshedAt = value; }
    public Instant getLastAttemptAt() { return lastAttemptAt; }
    public void setLastAttemptAt(Instant value) { lastAttemptAt = value; }
    public String getLastError() { return lastError; }
    public void setLastError(String value) { lastError = value; }
}
