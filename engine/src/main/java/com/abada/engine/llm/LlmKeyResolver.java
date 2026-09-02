package com.abada.engine.llm;

import com.abada.engine.insight.InsightProperties;
import com.abada.engine.persistence.entity.AiProviderSettingsEntity;
import com.abada.engine.persistence.repository.AiProviderSettingsRepository;
import com.abada.engine.security.AesEncryption;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Resolves the active LLM API key using a defined precedence:
 * <ol>
 *   <li>Workspace/GUI key stored encrypted in the database</li>
 *   <li>Environment variable ({@code ABADA_LLM_API_KEY})</li>
 * </ol>
 * Returns {@code null} when no source provides a key.
 */
@Component
public class LlmKeyResolver {

    private static final Logger log = LoggerFactory.getLogger(LlmKeyResolver.class);

    private final AiProviderSettingsRepository settingsRepository;
    private final AesEncryption encryption;
    private final InsightProperties insightProperties;

    public LlmKeyResolver(AiProviderSettingsRepository settingsRepository,
                          AesEncryption encryption,
                          InsightProperties insightProperties) {
        this.settingsRepository = settingsRepository;
        this.encryption = encryption;
        this.insightProperties = insightProperties;
    }

    /**
     * Resolves the API key using the precedence: DB key → env var.
     *
     * @return the resolved API key, or null if none is available
     */
    public String resolveKey() {
        Optional<AiProviderSettingsEntity> dbSettings = settingsRepository.findById("default");
        if (dbSettings.isPresent()) {
            AiProviderSettingsEntity settings = dbSettings.get();
            if (settings.isEnabled() && settings.getApiKeyEnc() != null && !settings.getApiKeyEnc().isBlank()) {
                log.debug("Using workspace AI key from database (hint: {})", settings.getApiKeyHint());
                return encryption.decrypt(settings.getApiKeyEnc());
            }
        }

        String envKey = insightProperties.getLlmApiKey();
        if (envKey != null && !envKey.isBlank()) {
            log.debug("Using AI key from environment variable");
            return envKey;
        }

        log.debug("No AI key configured in any source");
        return null;
    }

    /**
     * Returns true if any source provides a valid API key.
     */
    public boolean isConfigured() {
        return resolveKey() != null;
    }

    /**
     * Returns the resolved base URL, preferring the DB value when available.
     */
    public String resolveBaseUrl() {
        Optional<AiProviderSettingsEntity> dbSettings = settingsRepository.findById("default");
        if (dbSettings.isPresent()) {
            AiProviderSettingsEntity settings = dbSettings.get();
            if (settings.isEnabled() && settings.getBaseUrl() != null && !settings.getBaseUrl().isBlank()) {
                return settings.getBaseUrl();
            }
        }
        return insightProperties.getLlmBaseUrl();
    }

    /**
     * Returns the resolved model, preferring the DB value when available.
     */
    public String resolveModel() {
        Optional<AiProviderSettingsEntity> dbSettings = settingsRepository.findById("default");
        if (dbSettings.isPresent()) {
            AiProviderSettingsEntity settings = dbSettings.get();
            if (settings.isEnabled() && settings.getModel() != null && !settings.getModel().isBlank()) {
                return settings.getModel();
            }
        }
        return insightProperties.getLlmModel();
    }
}
