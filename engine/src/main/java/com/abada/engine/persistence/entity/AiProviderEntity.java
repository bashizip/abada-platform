package com.abada.engine.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;

/** One AI provider saved in Studio; the key is stored AES-GCM encrypted. */
@Entity
@Table(name = "ai_providers")
public class AiProviderEntity {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Column(name = "provider_type", nullable = false)
    private String providerType;

    @Column(name = "base_url")
    private String baseUrl;

    @Column(name = "api_key_enc")
    private String apiKeyEnc;

    @Column(name = "api_key_hint")
    private String apiKeyHint;

    @Column(name = "model_patterns")
    private String modelPatterns;

    @Column(name = "default_model")
    private String defaultModel;

    @Column(name = "timeout_ms", nullable = false)
    private long timeoutMs = 30000;

    @Column(name = "enabled", nullable = false)
    private boolean enabled = true;

    @Column(name = "insight_default", nullable = false)
    private boolean insightDefault;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public String getId() { return id; }
    public void setId(String value) { id = value; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String value) { displayName = value; }
    public String getProviderType() { return providerType; }
    public void setProviderType(String value) { providerType = value; }
    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String value) { baseUrl = value; }
    public String getApiKeyEnc() { return apiKeyEnc; }
    public void setApiKeyEnc(String value) { apiKeyEnc = value; }
    public String getApiKeyHint() { return apiKeyHint; }
    public void setApiKeyHint(String value) { apiKeyHint = value; }
    public String getModelPatterns() { return modelPatterns; }
    public void setModelPatterns(String value) { modelPatterns = value; }
    public String getDefaultModel() { return defaultModel; }
    public void setDefaultModel(String value) { defaultModel = value; }
    public long getTimeoutMs() { return timeoutMs; }
    public void setTimeoutMs(long value) { timeoutMs = value; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean value) { enabled = value; }
    public boolean isInsightDefault() { return insightDefault; }
    public void setInsightDefault(boolean value) { insightDefault = value; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant value) { createdAt = value; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant value) { updatedAt = value; }

    public boolean hasKey() {
        return apiKeyEnc != null && !apiKeyEnc.isBlank();
    }
}
