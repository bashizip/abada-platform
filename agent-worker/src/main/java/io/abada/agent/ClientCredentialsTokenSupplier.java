package io.abada.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.function.Supplier;

final class ClientCredentialsTokenSupplier implements Supplier<String> {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final WorkerConfig config;
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10)).build();
    private String token;
    private Instant refreshAt = Instant.EPOCH;

    ClientCredentialsTokenSupplier(WorkerConfig config) {
        this.config = config;
    }

    @Override
    public synchronized String get() {
        if (token != null && Instant.now().isBefore(refreshAt)) return token;
        try {
            String body = "grant_type=client_credentials&client_id=" + encode(config.oidcClientId())
                    + "&client_secret=" + encode(config.oidcClientSecret());
            HttpRequest request = HttpRequest.newBuilder(config.tokenUrl()).timeout(Duration.ofSeconds(20))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body)).build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                throw new IllegalStateException("OIDC token endpoint returned HTTP " + response.statusCode());
            }
            JsonNode json = JSON.readTree(response.body());
            token = json.path("access_token").asText();
            if (token.isBlank()) throw new IllegalStateException("OIDC response has no access token");
            long lifetime = Math.max(30, json.path("expires_in").asLong(300));
            refreshAt = Instant.now().plusSeconds(Math.max(1, lifetime - 30));
            return token;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("OIDC token request interrupted");
        } catch (Exception exception) {
            throw new IllegalStateException("Could not obtain OIDC worker token", exception);
        }
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
