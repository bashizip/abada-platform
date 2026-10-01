package com.abada.engine.llm;

import com.abada.engine.api.ApiErrorCode;
import com.abada.engine.api.ApiException;
import com.abada.engine.dto.AiConnectionTestRequest;
import com.abada.engine.dto.AiConnectionTestResult;
import com.abada.engine.dto.AiProviderDTO;
import com.abada.engine.dto.AiProviderRequest;
import com.abada.engine.dto.AiProvidersStatusDTO;
import com.abada.engine.dto.WorkerAiCredentialsDTO;
import com.abada.engine.persistence.entity.AiProviderEntity;
import com.abada.engine.persistence.repository.AiProviderRepository;
import com.abada.engine.security.AesEncryption;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Studio management of named AI providers, plus the views served to Studio and the agent worker. */
@Service
public class AiProviderService {
    private static final Pattern ID = Pattern.compile("^[a-z0-9][a-z0-9-]{0,63}$");
    private static final Duration TEST_TIMEOUT = Duration.ofSeconds(15);

    private final AiProviderRepository repository;
    private final AiProviderRegistry registry;
    private final AesEncryption encryption;
    private final OpenAiCompatibleLlmClient llmClient;

    public AiProviderService(AiProviderRepository repository, AiProviderRegistry registry, AesEncryption encryption,
            OpenAiCompatibleLlmClient llmClient) {
        this.repository = repository;
        this.registry = registry;
        this.encryption = encryption;
        this.llmClient = llmClient;
    }

    /** Saved Studio providers and environment-only providers, keys reduced to hints. */
    @Transactional(readOnly = true)
    public List<AiProviderDTO> list() {
        Map<String, ResolvedAiProvider> active = new LinkedHashMap<>();
        registry.activeProviders().forEach(provider -> active.put(provider.id(), provider));
        Map<String, AiProviderDTO> views = new LinkedHashMap<>();
        for (AiProviderEntity row : repository.findAll().stream()
                .sorted(Comparator.comparing(AiProviderEntity::getCreatedAt,
                        Comparator.nullsLast(Comparator.naturalOrder()))).toList()) {
            views.put(row.getId(), view(row, active.get(row.getId()), registry.environmentProvider(row.getId())));
        }
        for (ResolvedAiProvider environment : registry.environmentProviders()) {
            if (!views.containsKey(environment.id())) {
                views.put(environment.id(), environmentView(environment, active.get(environment.id())));
            }
        }
        return List.copyOf(views.values());
    }

    @Transactional
    public AiProviderDTO save(String id, AiProviderRequest request) {
        if (id == null || !ID.matcher(id).matches()) {
            throw invalid("Provider id must be lowercase letters, digits and dashes (max 64)");
        }
        AiProviderEntity row = repository.findById(id).orElseGet(() -> {
            AiProviderEntity created = new AiProviderEntity();
            created.setId(id);
            created.setCreatedAt(Instant.now());
            return created;
        });
        AiProviderType type = request.providerType() != null
                ? AiProviderType.fromId(request.providerType())
                        .orElseThrow(() -> invalid("Unknown provider type: " + request.providerType()))
                : AiProviderType.fromId(row.getProviderType())
                        .or(() -> AiProviderType.fromId(id))
                        .orElse(AiProviderType.OPENAI_COMPATIBLE);
        row.setProviderType(type.id());
        if (request.displayName() != null) row.setDisplayName(request.displayName().strip());
        if (row.getDisplayName() == null || row.getDisplayName().isBlank()) row.setDisplayName(type.displayName());
        if (request.baseUrl() != null) row.setBaseUrl(validateBaseUrl(request.baseUrl()));
        if (type == AiProviderType.OPENAI_COMPATIBLE && (row.getBaseUrl() == null || row.getBaseUrl().isBlank())) {
            throw invalid("A base URL is required for an OpenAI-compatible provider");
        }
        if (request.modelPatterns() != null) {
            List<String> patterns = AiProviderRegistry.splitPatterns(String.join(",", request.modelPatterns()));
            row.setModelPatterns(patterns.isEmpty() ? null : String.join(",", patterns));
        }
        if (request.defaultModel() != null) {
            row.setDefaultModel(request.defaultModel().isBlank() ? null : request.defaultModel().strip());
        }
        if (request.timeoutMs() != null) {
            if (request.timeoutMs() < 1_000 || request.timeoutMs() > 600_000) {
                throw invalid("timeoutMs must be between 1000 and 600000");
            }
            row.setTimeoutMs(request.timeoutMs());
        }
        if (request.enabled() != null) row.setEnabled(request.enabled());
        if (request.apiKey() != null && !request.apiKey().isBlank()) {
            row.setApiKeyEnc(encryption.encrypt(request.apiKey().strip()));
            row.setApiKeyHint(ResolvedAiProvider.hint(request.apiKey().strip()));
        }
        if (Boolean.TRUE.equals(request.insightDefault())) {
            for (AiProviderEntity other : repository.findAll()) {
                if (!other.getId().equals(id) && other.isInsightDefault()) {
                    other.setInsightDefault(false);
                    other.setUpdatedAt(Instant.now());
                    repository.save(other);
                }
            }
            row.setInsightDefault(true);
        } else if (Boolean.FALSE.equals(request.insightDefault())) {
            row.setInsightDefault(false);
        }
        row.setUpdatedAt(Instant.now());
        repository.saveAndFlush(row);
        return list().stream().filter(view -> view.id().equals(id)).findFirst().orElseThrow();
    }

    /** Removes a Studio provider; an environment provider with the same id then applies again. */
    @Transactional
    public void delete(String id) {
        AiProviderEntity row = repository.findById(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,
                ApiErrorCode.RESOURCE_NOT_FOUND, "AI provider not found: " + id));
        repository.delete(row);
    }

    /** Which of {@code models} no provider serves; with no models, whether any provider is configured. */
    public AiProvidersStatusDTO status(List<String> models) {
        List<String> missing = new ArrayList<>();
        List<String> requested = models == null ? List.of() : models;
        for (String model : new LinkedHashSet<>(requested)) {
            if (model != null && !model.isBlank() && registry.resolveForModel(model).isEmpty()) missing.add(model);
        }
        Optional<ResolvedAiProvider> insight = registry.insightProvider();
        return new AiProvidersStatusDTO(insight.isPresent() && missing.isEmpty(), missing,
                insight.map(ResolvedAiProvider::id).orElse(null), insight.map(p -> registry.insightModel()).orElse(null));
    }

    /**
     * Tests a provider: the saved (or environment) one merged with the request's
     * overrides, so an unsaved key can be tried first. Runs outside any transaction.
     */
    public AiConnectionTestResult test(String id, AiConnectionTestRequest request) {
        AiConnectionTestRequest overrides = request == null ? new AiConnectionTestRequest(null, null, null, null) : request;
        Optional<ResolvedAiProvider> current = id == null ? registry.insightProvider()
                : registry.activeProviders().stream().filter(provider -> provider.id().equals(id)).findFirst()
                        .or(() -> repository.findById(id).flatMap(this::unvalidatedStudioProvider));
        AiProviderType type = AiProviderType.fromId(overrides.providerType())
                .or(() -> current.map(ResolvedAiProvider::type))
                .or(() -> AiProviderType.fromId(id))
                .orElse(AiProviderType.OPENAI_COMPATIBLE);
        String key = AiProviderRegistry.firstNonBlank(overrides.apiKey(),
                current.map(ResolvedAiProvider::apiKey).orElse(null));
        String baseUrl = AiProviderRegistry.normalizeBaseUrl(type, AiProviderRegistry.firstNonBlank(
                overrides.baseUrl(), current.map(ResolvedAiProvider::baseUrl).orElse(null), type.defaultBaseUrl()));
        String model = AiProviderRegistry.firstNonBlank(overrides.model(),
                current.map(ResolvedAiProvider::defaultModel).orElse(null), type.defaultModel());
        if (key == null) return new AiConnectionTestResult(false, "NOT_CONFIGURED", null, model,
                "No API key saved or supplied for this provider");
        if (baseUrl == null) return new AiConnectionTestResult(false, "NOT_CONFIGURED", null, model,
                "No base URL configured for this provider");
        if (model == null) return new AiConnectionTestResult(false, "NOT_CONFIGURED", null, null,
                "No model to test with; set a default model");
        ResolvedAiProvider probe = new ResolvedAiProvider(id == null ? type.id() : id, type, type.displayName(),
                baseUrl, key, List.of(), model, TEST_TIMEOUT.toMillis(), ResolvedAiProvider.Source.STUDIO, false, "");
        long start = System.currentTimeMillis();
        try {
            llmClient.completeWith(probe, model, "You are a system liveness probe.", "Reply with READY", TEST_TIMEOUT);
            return new AiConnectionTestResult(true, "READY", System.currentTimeMillis() - start, model,
                    "Connection successful");
        } catch (Exception exception) {
            String message = exception.getMessage() == null ? exception.getClass().getSimpleName()
                    : exception.getMessage();
            return new AiConnectionTestResult(false, "ERROR", System.currentTimeMillis() - start, model,
                    message.replace(key, "****"));
        }
    }

    /** Credentials for the agent worker: every usable provider after the Studio-over-environment merge. */
    public WorkerAiCredentialsDTO workerCredentials() {
        List<ResolvedAiProvider> providers = registry.activeProviders();
        String fallbackId = registry.insightProvider().map(ResolvedAiProvider::id).orElse(null);
        return new WorkerAiCredentialsDTO(registry.revision(), providers.stream()
                .map(provider -> new WorkerAiCredentialsDTO.Provider(provider.id(), provider.type().id(),
                        provider.baseUrl(), provider.apiKey(), provider.modelPatterns(), provider.defaultModel(),
                        provider.timeoutMs(), provider.id().equals(fallbackId)))
                .toList());
    }

    /** A saved but disabled provider can still be tested before it is switched on. */
    private Optional<ResolvedAiProvider> unvalidatedStudioProvider(AiProviderEntity row) {
        if (!row.hasKey()) return Optional.empty();
        AiProviderEntity copy = new AiProviderEntity();
        copy.setId(row.getId());
        copy.setDisplayName(row.getDisplayName());
        copy.setProviderType(row.getProviderType());
        copy.setBaseUrl(row.getBaseUrl());
        copy.setApiKeyEnc(row.getApiKeyEnc());
        copy.setModelPatterns(row.getModelPatterns());
        copy.setDefaultModel(row.getDefaultModel());
        copy.setTimeoutMs(row.getTimeoutMs());
        copy.setEnabled(true);
        return registry.studioProvider(copy);
    }

    private AiProviderDTO view(AiProviderEntity row, ResolvedAiProvider active,
            Optional<ResolvedAiProvider> environment) {
        AiProviderType type = AiProviderType.fromId(row.getProviderType()).orElse(AiProviderType.OPENAI_COMPATIBLE);
        List<String> patterns = AiProviderRegistry.splitPatterns(row.getModelPatterns());
        return new AiProviderDTO(row.getId(), row.getDisplayName(), type.id(),
                AiProviderRegistry.firstNonBlank(row.getBaseUrl(), type.defaultBaseUrl()),
                row.hasKey() ? row.getApiKeyHint() : "",
                patterns.isEmpty() ? type.defaultModelPatterns() : patterns,
                AiProviderRegistry.firstNonBlank(row.getDefaultModel(), type.defaultModel()), row.getTimeoutMs(),
                row.isEnabled(), row.isInsightDefault(), true, active != null,
                active == null ? null : active.source().name(), environment.isPresent(),
                environment.map(ResolvedAiProvider::apiKeyHint).orElse(null));
    }

    private static AiProviderDTO environmentView(ResolvedAiProvider provider, ResolvedAiProvider active) {
        return new AiProviderDTO(provider.id(), provider.displayName(), provider.type().id(), provider.baseUrl(),
                "", provider.modelPatterns(), provider.defaultModel(), provider.timeoutMs(), true,
                provider.insightDefault(), false, active != null, active == null ? null : active.source().name(),
                true, provider.apiKeyHint());
    }

    private static String validateBaseUrl(String value) {
        if (value.isBlank()) return null;
        try {
            URI uri = URI.create(value.strip());
            if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())
                    || uri.getHost() == null) {
                throw invalid("Base URL must be an absolute http(s) URL");
            }
            return value.strip().replaceAll("/+$", "");
        } catch (IllegalArgumentException exception) {
            throw invalid("Base URL must be an absolute http(s) URL");
        }
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ApiErrorCode.INVALID_REQUEST, message);
    }
}
