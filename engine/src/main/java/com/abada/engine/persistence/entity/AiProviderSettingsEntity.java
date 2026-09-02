package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;

@Entity
@Table(name = "ai_provider_settings")
public class AiProviderSettingsEntity {

    @Id
    @Column(name = "id")
    private String id = "default";

    @Column(name = "provider_type", nullable = false)
    private String providerType = "openai-compatible";

    @Column(name = "base_url")
    private String baseUrl;

    @Column(name = "api_key_enc")
    private String apiKeyEnc;

    @Column(name = "api_key_hint")
    private String apiKeyHint;

    @Column(name = "model")
    private String model;

    @Column(name = "timeout_ms", nullable = false)
    private long timeoutMs = 30000;

    @Column(name = "enabled", nullable = false)
    private boolean enabled = true;

    @Version
    @Column(name = "updated_at")
    private Instant updatedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getProviderType() { return providerType; }
    public void setProviderType(String value) { providerType = value; }
    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String value) { baseUrl = value; }
    public String getApiKeyEnc() { return apiKeyEnc; }
    public void setApiKeyEnc(String value) { apiKeyEnc = value; }
    public String getApiKeyHint() { return apiKeyHint; }
    public void setApiKeyHint(String value) { apiKeyHint = value; }
    public String getModel() { return model; }
    public void setModel(String value) { model = value; }
    public long getTimeoutMs() { return timeoutMs; }
    public void setTimeoutMs(long value) { timeoutMs = value; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean value) { enabled = value; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant value) { updatedAt = value; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
}
