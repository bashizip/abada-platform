package com.abada.engine.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.stereotype.Component;

/**
 * The only outbound calls the provider settings make: a liveness probe through
 * the provider's chat endpoint, the provider's own model list, and the public
 * price catalog. Every call is made outside any database transaction.
 */
@Component
public class AiProviderGateway {
    /** Ids that a {@code /models} list returns but that cannot answer a chat request. */
    private static final List<String> NOT_CHAT = List.of("embedding", "embed", "tts", "whisper", "dall-e",
            "moderation", "transcribe", "realtime", "audio", "image", "imagen", "veo", "search", "rerank", "aqa");

    private final OpenAiCompatibleLlmClient llmClient;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public AiProviderGateway(OpenAiCompatibleLlmClient llmClient, ObjectMapper objectMapper) {
        this.llmClient = llmClient;
        this.objectMapper = objectMapper;
    }

    /** One short chat completion; throws with the provider's reason when the key, URL or model is wrong. */
    public void probe(ResolvedAiProvider provider, String model, Duration timeout) throws Exception {
        llmClient.completeWith(provider, model, "You are a system liveness probe.", "Reply with READY", timeout);
    }

    /** The chat models the provider lists for this key, sorted; ids carry no {@code models/} prefix. */
    public List<String> listModels(ResolvedAiProvider provider, Duration timeout) throws Exception {
        String base = provider.baseUrl().replaceAll("/+$", "");
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(base + "/models")).timeout(timeout)
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + provider.apiKey());
        if (provider.type() == AiProviderType.ANTHROPIC) {
            // Anthropic's model list takes its native headers.
            request.header("x-api-key", provider.apiKey()).header("anthropic-version", "2023-06-01");
        }
        HttpResponse<String> response = httpClient.send(request.GET().build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException("The provider's model list returned HTTP " + response.statusCode());
        }
        Set<String> models = new TreeSet<>();
        for (JsonNode entry : objectMapper.readTree(response.body()).path("data")) {
            String id = entry.path("id").asText("");
            if (id.startsWith("models/")) id = id.substring("models/".length());
            if (!id.isBlank() && isChatModel(id)) models.add(id);
        }
        return List.copyOf(models);
    }

    /** One price read from the catalog, in USD per million tokens. */
    public record CatalogPrice(String model, java.math.BigDecimal inputPerMillion,
            java.math.BigDecimal outputPerMillion) {}

    /** The public catalog's text-model prices ({@code {data:[{id, pricing:{prompt, completion}}]}}, USD per token). */
    public List<CatalogPrice> fetchCatalog(String url, Duration timeout) throws Exception {
        HttpResponse<String> response = httpClient.send(HttpRequest.newBuilder(URI.create(url)).timeout(timeout)
                        .header("Accept", "application/json").GET().build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException("The price catalog returned HTTP " + response.statusCode());
        }
        return parseCatalog(objectMapper.readTree(response.body()));
    }

    /** Parses the catalog format; variants ({@code :batch}, {@code :free}) and unknown prices are left out. */
    public static List<CatalogPrice> parseCatalog(JsonNode root) {
        List<CatalogPrice> prices = new ArrayList<>();
        java.math.BigDecimal million = java.math.BigDecimal.valueOf(1_000_000L);
        for (JsonNode entry : root.path("data")) {
            String id = entry.path("id").asText("");
            if (id.isBlank() || id.contains(":")) continue;
            try {
                java.math.BigDecimal input = new java.math.BigDecimal(entry.path("pricing").path("prompt").asText(""));
                java.math.BigDecimal output = new java.math.BigDecimal(
                        entry.path("pricing").path("completion").asText(""));
                if (input.signum() < 0 || output.signum() < 0) continue;
                prices.add(new CatalogPrice(id, input.multiply(million).stripTrailingZeros(),
                        output.multiply(million).stripTrailingZeros()));
            } catch (NumberFormatException unknownPrice) {
                // A model without a numeric price stays out of the catalog.
            }
        }
        return prices;
    }

    static boolean isChatModel(String id) {
        String lower = id.toLowerCase(Locale.ROOT);
        return NOT_CHAT.stream().noneMatch(lower::contains);
    }
}
