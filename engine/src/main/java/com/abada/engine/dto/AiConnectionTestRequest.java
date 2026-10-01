package com.abada.engine.dto;

/** Optional overrides for a connection test, so a key can be tested before it is saved. */
public record AiConnectionTestRequest(String providerType, String baseUrl, String apiKey, String model) {

    @Override
    public String toString() {
        return "AiConnectionTestRequest[providerType=" + providerType + ", baseUrl=" + baseUrl + ", model=" + model
                + ", apiKey=" + (apiKey == null || apiKey.isBlank() ? "" : "****") + "]";
    }
}
