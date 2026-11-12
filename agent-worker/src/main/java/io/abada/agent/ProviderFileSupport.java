package io.abada.agent;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Which file types each provider's {@code /chat/completions} API accepts, and in which
 * form (S15). Every gateway speaks the OpenAI-compatible API, but providers differ:
 *
 * <ul>
 *   <li>Gemini (OpenAI compatibility): images and PDF, both as base64 data URIs in an
 *       {@code image_url} part.</li>
 *   <li>OpenAI and OpenRouter: images as {@code image_url} data URIs; PDF as a
 *       {@code file} part with {@code file_data}.</li>
 *   <li>Anthropic (OpenAI SDK compatibility): images as {@code image_url}; PDF only on
 *       its native API, so not here.</li>
 *   <li>Other OpenAI-compatible endpoints (self-hosted models): images only, the one
 *       form they commonly share. DeepSeek: no files.</li>
 * </ul>
 *
 * A file type a provider cannot carry is never dropped: the worker skips that model in
 * the fallback chain, and fails the work with {@code AGENT_FILE_UNSUPPORTED} when no
 * model is left. Whether a given model can see is the provider's answer: a model
 * without vision rejects the call, which is reported as a configuration error.
 */
final class ProviderFileSupport {
    static final String PDF = "application/pdf";
    private static final Set<String> COMMON_IMAGES = Set.of("image/png", "image/jpeg", "image/webp");

    private static final Map<String, Set<String>> ACCEPTED = Map.of(
            "gemini", Set.of("image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", PDF),
            "google-gemini", Set.of("image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", PDF),
            "openai", Set.of("image/png", "image/jpeg", "image/webp", "image/gif", PDF),
            "openrouter", Set.of("image/png", "image/jpeg", "image/webp", "image/gif", PDF),
            "anthropic", Set.of("image/png", "image/jpeg", "image/webp", "image/gif"),
            "deepseek", Set.of(),
            "openai-compatible", COMMON_IMAGES);

    private ProviderFileSupport() {}

    static String normalize(String contentType) {
        if (contentType == null) return "";
        int parameters = contentType.indexOf(';');
        return (parameters < 0 ? contentType : contentType.substring(0, parameters)).strip()
                .toLowerCase(Locale.ROOT);
    }

    /** The content types a provider can carry; unknown provider families carry common images. */
    static Set<String> accepted(String provider) {
        return ACCEPTED.getOrDefault(provider == null ? "" : provider.toLowerCase(Locale.ROOT), COMMON_IMAGES);
    }

    static boolean acceptsAll(String provider, Set<String> contentTypes) {
        return accepted(provider).containsAll(contentTypes);
    }

    /**
     * The messages as the provider expects them: every {@link AgentFiles#PART_TYPE} part
     * becomes the provider's image or file part. Other messages are passed unchanged.
     */
    static List<Map<String, Object>> wire(String provider, List<Map<String, Object>> messages) {
        List<Map<String, Object>> wired = new ArrayList<>(messages.size());
        for (Map<String, Object> message : messages) {
            if (!(message.get("content") instanceof List<?> parts)
                    || parts.stream().noneMatch(ProviderFileSupport::isFilePart)) {
                wired.add(message);
                continue;
            }
            List<Object> content = new ArrayList<>(parts.size());
            for (Object part : parts) {
                content.add(isFilePart(part) ? wirePart(provider,
                        (AgentFiles.AgentFile) ((Map<?, ?>) part).get("file")) : part);
            }
            Map<String, Object> copy = new LinkedHashMap<>(message);
            copy.put("content", content);
            wired.add(copy);
        }
        return wired;
    }

    static boolean carriesFiles(List<Map<String, Object>> messages) {
        for (Map<String, Object> message : messages) {
            if (message.get("content") instanceof List<?> parts
                    && parts.stream().anyMatch(ProviderFileSupport::isFilePart)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isFilePart(Object part) {
        return part instanceof Map<?, ?> map && AgentFiles.PART_TYPE.equals(map.get("type"));
    }

    static Map<String, Object> wirePart(String provider, AgentFiles.AgentFile file) {
        String type = normalize(file.ref().contentType());
        if (!accepted(provider).contains(type)) {
            throw new AgentGateway.AgentConfigurationException(provider + " cannot read " + type + " files ('"
                    + file.ref().name() + "'); use a model of a provider that can, or convert the file");
        }
        Map<String, Object> part = new LinkedHashMap<>();
        boolean pdfAsFilePart = PDF.equals(type) && !provider.toLowerCase(Locale.ROOT).contains("gemini");
        if (pdfAsFilePart) {
            Map<String, Object> pdf = new LinkedHashMap<>();
            pdf.put("filename", file.ref().fileName() == null ? file.ref().fileId() + ".pdf" : file.ref().fileName());
            pdf.put("file_data", file.dataUri());
            part.put("type", "file");
            part.put("file", pdf);
        } else {
            part.put("type", "image_url");
            part.put("image_url", Map.of("url", file.dataUri()));
        }
        return part;
    }
}
