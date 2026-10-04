package com.abada.engine.tools;

import com.abada.engine.core.model.ToolPolicy;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.PathType;
import com.networknt.schema.SchemaValidatorsConfig;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * A {@code TOOL_SERVER} project resource: an MCP server and the policy of each
 * tool agents may use on it. Parsed from YAML and validated against
 * {@code classpath:apl/tool-server-v1.schema.json} plus the rules a schema
 * cannot express. A tool the document does not list is denied.
 */
public record ToolServerDocument(String name, String transport, String url, String credential,
        Map<String, Tool> tools) {

    public static final String SCHEMA_RESOURCE = "apl/tool-server-v1.schema.json";
    /** Tool server documents are small; anything larger is a mistake. */
    public static final int MAX_BYTES = 256 * 1024;

    public record Tool(ToolPolicy policy, String idempotency, List<String> approvers, Double approvalSlaHours) {
        public Tool {
            approvers = approvers == null ? List.of() : List.copyOf(approvers);
        }
    }

    /** One problem with its JSON Pointer inside the document. */
    public record Issue(String path, String message) {}

    public static final class InvalidToolServerException extends RuntimeException {
        private final List<Issue> issues;

        public InvalidToolServerException(List<Issue> issues) {
            super(issues.isEmpty() ? "Invalid tool server document"
                    : "Invalid tool server document: " + issues.get(0).path() + " " + issues.get(0).message());
            this.issues = List.copyOf(issues);
        }

        public List<Issue> issues() {
            return issues;
        }
    }

    private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());
    private static final JsonSchema SCHEMA = loadSchema();

    public ToolServerDocument {
        tools = tools == null ? Map.of() : Map.copyOf(tools);
    }

    /**
     * @param allowInsecureHttp accept plain {@code http://} for any host (development only);
     *        otherwise plain HTTP is accepted for loopback hosts only
     */
    public static ToolServerDocument parse(byte[] content, boolean allowInsecureHttp) {
        if (content == null || content.length == 0) {
            throw new InvalidToolServerException(List.of(new Issue("/", "tool server document is empty")));
        }
        if (content.length > MAX_BYTES) {
            throw new InvalidToolServerException(List.of(new Issue("/",
                    "tool server document exceeds " + MAX_BYTES / 1024 + " KiB")));
        }
        JsonNode root;
        try {
            root = YAML.readTree(content);
        } catch (IOException exception) {
            throw new InvalidToolServerException(List.of(new Issue("/", "not valid YAML: "
                    + (exception instanceof com.fasterxml.jackson.core.JsonProcessingException parse
                            ? parse.getOriginalMessage() : exception.getMessage()))));
        }
        if (root == null || !root.isObject()) {
            throw new InvalidToolServerException(List.of(new Issue("/", "must be a YAML mapping")));
        }
        List<Issue> issues = new ArrayList<>();
        for (ValidationMessage message : SCHEMA.validate(root)) {
            String path = message.getInstanceLocation().toString();
            issues.add(new Issue(path.isEmpty() ? "/" : path, message.getMessage()));
        }
        if (!issues.isEmpty()) {
            issues.sort(Comparator.comparing(Issue::path));
            throw new InvalidToolServerException(issues);
        }

        String url = root.path("url").asText();
        checkUrl(url, allowInsecureHttp, issues);
        Map<String, Tool> tools = new LinkedHashMap<>();
        root.path("tools").properties().forEach(entry -> {
            JsonNode tool = entry.getValue();
            ToolPolicy policy = ToolPolicy.fromWire(tool.path("policy").asText());
            String idempotency = tool.path("idempotency").asText(null);
            String pointer = "/tools/" + entry.getKey().replace("~", "~0").replace("/", "~1");
            if (policy != ToolPolicy.READ && idempotency == null) {
                issues.add(new Issue(pointer + "/idempotency", "a " + policy.wireName()
                        + " tool must declare idempotency: key or none"));
            }
            if (policy == ToolPolicy.READ && idempotency != null) {
                issues.add(new Issue(pointer + "/idempotency", "a read tool has no side effects to key"));
            }
            List<String> approvers = new ArrayList<>();
            tool.path("approvers").forEach(group -> approvers.add(group.asText().strip()));
            if (!approvers.isEmpty() && policy != ToolPolicy.APPROVAL_REQUIRED) {
                issues.add(new Issue(pointer + "/approvers", "approvers apply to approval_required tools only"));
            }
            Double sla = tool.hasNonNull("approval_sla_hours") ? tool.path("approval_sla_hours").asDouble() : null;
            if (sla != null && policy != ToolPolicy.APPROVAL_REQUIRED) {
                issues.add(new Issue(pointer + "/approval_sla_hours",
                        "approval_sla_hours applies to approval_required tools only"));
            }
            tools.put(entry.getKey(), new Tool(policy, policy == ToolPolicy.READ ? null : idempotency,
                    approvers, sla));
        });
        if (!issues.isEmpty()) throw new InvalidToolServerException(issues);
        return new ToolServerDocument(root.path("name").asText(), root.path("transport").asText(), url,
                root.path("credential").asText(null), tools);
    }

    private static void checkUrl(String url, boolean allowInsecureHttp, List<Issue> issues) {
        URI uri;
        try {
            uri = URI.create(url);
        } catch (IllegalArgumentException exception) {
            issues.add(new Issue("/url", "not a valid URL"));
            return;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (uri.getHost() == null || !(scheme.equals("https") || scheme.equals("http"))) {
            issues.add(new Issue("/url", "must be an absolute http(s) URL"));
            return;
        }
        if (uri.getUserInfo() != null) {
            issues.add(new Issue("/url", "must not embed credentials; use credential instead"));
        }
        if (scheme.equals("http") && !allowInsecureHttp && !isLoopback(uri.getHost())) {
            issues.add(new Issue("/url", "must use https (plain http is accepted for localhost only)"));
        }
    }

    private static boolean isLoopback(String host) {
        String value = host.toLowerCase(Locale.ROOT);
        return value.equals("localhost") || value.equals("127.0.0.1") || value.equals("[::1]")
                || value.equals("::1") || value.endsWith(".localhost");
    }

    private static JsonSchema loadSchema() {
        try (InputStream stream = ToolServerDocument.class.getClassLoader().getResourceAsStream(SCHEMA_RESOURCE)) {
            if (stream == null) throw new IllegalStateException("Missing " + SCHEMA_RESOURCE + " on the classpath");
            JsonNode document = new ObjectMapper().readTree(stream);
            return JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(document,
                    SchemaValidatorsConfig.builder().pathType(PathType.JSON_POINTER).build());
        } catch (IOException exception) {
            throw new UncheckedIOException("Cannot read " + SCHEMA_RESOURCE, exception);
        }
    }
}
