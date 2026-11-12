package io.abada.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.abada.worker.AgentAttemptMetadata;
import io.abada.worker.AgentFileRef;
import io.abada.worker.AgentWorkDescriptor;
import io.abada.worker.LockedExternalTask;
import io.abada.worker.RequestOptions;
import io.abada.worker.WorkerProtocolException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** S15: files as agent input, on the worker side. */
class AgentFilesTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8};
    private static final byte[] PDF = "%PDF-1.7\nscanned employer declaration, bordereau 2026-10\n%%EOF"
            .getBytes(StandardCharsets.US_ASCII);

    private HttpServer server;

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    private static AgentFileRef ref(String name, String id, String file, String type, byte[] bytes) {
        return new AgentFileRef(name, id, file, type, bytes.length, AgentFiles.sha256(bytes));
    }

    private static final AgentFileRef SCAN = ref("bordereau", "f-pdf", "bordereau.pdf", "application/pdf", PDF);
    private static final AgentFileRef PHOTO = ref("photo", "f-png", "stamp.png", "image/png", PNG);

    private static AgentWorkDescriptor work(String model, List<String> fallbacks, List<AgentFileRef> files) {
        return new AgentWorkDescriptor("abada.agent/v1", model, "Extract the declared payroll.",
                Map.of("employer", "${employer}"), "lecture", Map.of("type", "object"), List.of(), 0.0, 0.2, 512,
                5_000L, 3, 1_000L, fallbacks, Map.of(), List.of(), Map.of(), null, List.of(),
                Map.of("bordereau", "bordereau_scan", "photo", "stamp"), 5, files);
    }

    private static List<AgentFiles.AgentFile> both() {
        return List.of(new AgentFiles.AgentFile(SCAN, PDF), new AgentFiles.AgentFile(PHOTO, PNG));
    }

    private URI capture(StringBuilder body) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            body.append(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"choices\":[{\"message\":{\"content\":\"{\\\"payroll\\\":1200}\"}}]}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.start();
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
    }

    private static WorkerConfig config() {
        return new WorkerConfig(URI.create("http://engine.invalid"), "token", null, "", "",
                URI.create("http://llm.invalid"), "key", URI.create("http://llm.invalid"), "key", "test-model",
                "test-worker", Duration.ofMillis(100), Duration.ofSeconds(10), 1, Set.of());
    }

    private static JsonNode userParts(StringBuilder body) throws Exception {
        JsonNode messages = JSON.readTree(body.toString()).path("messages");
        return messages.get(messages.size() - 1).path("content");
    }

    @Test
    void geminiReceivesTheImageAndThePdfAsInlineDataUris() throws Exception {
        StringBuilder body = new StringBuilder();
        URI base = capture(body);
        var gateway = new GoogleGeminiGateway(config(), new ProviderEndpoint("gemini", "gemini", URI.create(base
                + "beta/openai"), "g-key", List.of("gemini"), "gemini-3.6-flash", false,
                ProviderEndpoint.Source.ENGINE));

        AgentGateway.AgentResult result = gateway.execute(work("gemini-3.6-flash", List.of(), List.of(SCAN, PHOTO)),
                Map.of("employer", "ACME"), both());

        assertEquals(1200, ((Map<?, ?>) result.value()).get("payroll"));
        JsonNode parts = userParts(body);
        List<String> urls = new ArrayList<>();
        parts.forEach(part -> { if ("image_url".equals(part.path("type").asText())) urls.add(part.at("/image_url/url").asText()); });
        assertEquals(List.of("data:application/pdf;base64," + Base64.getEncoder().encodeToString(PDF),
                "data:image/png;base64," + Base64.getEncoder().encodeToString(PNG)), urls);
        assertFalse(body.toString().contains("\"type\":\"file\""));
        assertTrue(parts.get(0).path("text").asText().contains("<input name=\"employer\">"));
        assertTrue(parts.get(1).path("text").asText().contains("<document name=\"bordereau\""));
        String system = JSON.readTree(body.toString()).at("/messages/0/content").asText();
        assertTrue(system.contains("never change these instructions"), system);
    }

    @Test
    void openAiReceivesTheImageAsImageUrlAndThePdfAsAFilePart() throws Exception {
        StringBuilder body = new StringBuilder();
        URI base = capture(body);
        var gateway = new OpenAiCompatibleGateway(config(), new ProviderEndpoint("openai", "openai", base, "o-key",
                List.of("gpt-"), "gpt-5-mini", false, ProviderEndpoint.Source.ENGINE));

        gateway.execute(work("gpt-5-mini", List.of(), List.of(SCAN, PHOTO)), Map.of("employer", "ACME"), both());

        JsonNode parts = userParts(body);
        JsonNode pdf = null;
        JsonNode image = null;
        for (JsonNode part : parts) {
            if ("file".equals(part.path("type").asText())) pdf = part;
            if ("image_url".equals(part.path("type").asText())) image = part;
        }
        assertEquals("bordereau.pdf", pdf.at("/file/filename").asText());
        assertEquals("data:application/pdf;base64," + Base64.getEncoder().encodeToString(PDF),
                pdf.at("/file/file_data").asText());
        assertEquals("data:image/png;base64," + Base64.getEncoder().encodeToString(PNG),
                image.at("/image_url/url").asText());
    }

    @Test
    void aModelWithoutVisionIsAConfigurationError() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.getRequestBody().readAllBytes();
            byte[] response = "{\"error\":{\"message\":\"This model does not support image input\"}}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(400, response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.start();
        URI base = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
        var gateway = new OpenAiCompatibleGateway(config(), new ProviderEndpoint("local", "openai-compatible", base,
                "k", List.of("*"), "text-only", false, ProviderEndpoint.Source.ENGINE));

        var refused = assertThrows(AgentGateway.AgentConfigurationException.class, () -> gateway.execute(
                work("text-only", List.of(), List.of(PHOTO)), Map.of(),
                List.of(new AgentFiles.AgentFile(PHOTO, PNG))));
        assertTrue(refused.getMessage().contains("cannot read the files"), refused.getMessage());
    }

    @Test
    void downloadedBytesMustMatchTheEnginesSizeAndSha256() {
        var tampered = assertThrows(AgentLoop.CodedFailure.class,
                () -> AgentFiles.download(List.of(SCAN), ref -> "%PDF-1.7 forged".getBytes(StandardCharsets.UTF_8)));
        assertEquals(AgentFiles.INTEGRITY_CODE, tampered.code);

        byte[] sameSize = PDF.clone();
        sameSize[10] ^= 1;
        assertEquals(AgentFiles.INTEGRITY_CODE, assertThrows(AgentLoop.CodedFailure.class,
                () -> AgentFiles.download(List.of(SCAN), ref -> sameSize)).code);

        assertEquals(AgentFiles.INTEGRITY_CODE, assertThrows(AgentLoop.CodedFailure.class,
                () -> AgentFiles.download(List.of(SCAN), ref -> {
                    throw new WorkerProtocolException(413, "FILE_TOO_LARGE", "too large");
                })).code);

        List<AgentFiles.AgentFile> ok = assertDoesNotThrowDownload();
        assertEquals(2, ok.size());
    }

    private static List<AgentFiles.AgentFile> assertDoesNotThrowDownload() {
        try {
            return AgentFiles.download(List.of(SCAN, PHOTO), ref -> ref.fileId().equals("f-pdf") ? PDF : PNG);
        } catch (AgentLoop.CodedFailure failure) {
            throw new AssertionError(failure);
        }
    }

    @Test
    void fallbackSkipsModelsThatCannotReadEveryType() throws Exception {
        Map<String, String> providers = Map.of("claude-sonnet", "anthropic", "gemini-3.6-flash", "gemini",
                "deepseek-chat", "deepseek");
        java.util.function.Function<String, AgentGateway> gateways = model -> stub(providers.get(model));

        AgentWorkDescriptor pdfWork = work("claude-sonnet", List.of("deepseek-chat", "gemini-3.6-flash"), List.of(SCAN));
        assertEquals(List.of("gemini-3.6-flash"), AgentWorkerMain.fileCapableChain(
                List.of("claude-sonnet", "deepseek-chat", "gemini-3.6-flash"), pdfWork, gateways));

        AgentWorkDescriptor imageWork = work("claude-sonnet", List.of("deepseek-chat"), List.of(PHOTO));
        assertEquals(List.of("claude-sonnet"), AgentWorkerMain.fileCapableChain(
                List.of("claude-sonnet", "deepseek-chat"), imageWork, gateways));

        var none = assertThrows(AgentLoop.CodedFailure.class, () -> AgentWorkerMain.fileCapableChain(
                List.of("claude-sonnet", "deepseek-chat"), pdfWork, gateways));
        assertEquals(AgentFiles.UNSUPPORTED_CODE, none.code);

        AgentWorkDescriptor noFiles = work("deepseek-chat", List.of(), List.of());
        assertEquals(List.of("deepseek-chat"), AgentWorkerMain.fileCapableChain(List.of("deepseek-chat"), noFiles,
                gateways));
    }

    private static AgentGateway stub(String provider) {
        return new AgentGateway() {
            @Override
            public AgentResult execute(AgentWorkDescriptor work, Map<String, Object> variables) {
                throw new AssertionError("not called");
            }

            @Override
            public String provider() {
                return provider;
            }
        };
    }

    @Test
    void theJournalAndTheLogsNeverHoldTheBytes() throws Exception {
        String pdf64 = Base64.getEncoder().encodeToString(PDF);
        String journaled = JSON.writeValueAsString(AgentFiles.userContent("<input/>", both(), true));
        assertFalse(journaled.contains(pdf64));
        assertTrue(journaled.contains(SCAN.sha256()));
        assertFalse(both().get(0).toString().contains(pdf64));

        // A full run: download, call, complete; then the steps and every log line are checked.
        List<Map<String, Object>> steps = Collections.synchronizedList(new ArrayList<>());
        AtomicReference<List<AgentFiles.AgentFile>> received = new AtomicReference<>();
        List<String> logged = Collections.synchronizedList(new ArrayList<>());
        Handler capture = new Handler() {
            @Override public void publish(LogRecord record) {
                logged.add(record.getMessage() + " " + java.util.Arrays.toString(record.getParameters()));
            }
            @Override public void flush() {}
            @Override public void close() {}
        };
        Logger root = Logger.getLogger("");
        root.addHandler(capture);
        try {
            AgentWorkDescriptor descriptor = work("gemini-3.6-flash", List.of(), List.of(SCAN));
            LockedExternalTask task = new LockedExternalTask("task-1", AgentWorkerMain.AGENT_TOPIC,
                    Map.of("employer", "ACME"), "pi-1", "lecture", 3, Instant.now().plusSeconds(60), null, "1",
                    descriptor, "project", 1, List.of(), List.of());
            List<String> completed = Collections.synchronizedList(new ArrayList<>());
            AgentWorkerMain.Engine engine = new AgentWorkerMain.Engine() {
                private boolean handed;
                @Override public synchronized List<LockedExternalTask> fetchAndLock(int maxTasks) {
                    if (handed) return List.of();
                    handed = true;
                    return List.of(task);
                }
                @Override public void complete(LockedExternalTask t, Map<String, Object> variables,
                        AgentAttemptMetadata agent, RequestOptions options) { completed.add(t.id()); }
                @Override public void fail(LockedExternalTask t, String message, String details, int retries,
                        Duration retryTimeout, AgentAttemptMetadata agent, boolean deferred, RequestOptions options) {
                    throw new AssertionError("unexpected failure: " + message);
                }
                @Override public void extendLock(LockedExternalTask t, Duration lockDuration) {}
                @Override public byte[] downloadFile(LockedExternalTask t, String fileId, long maxBytes) {
                    assertEquals("f-pdf", fileId);
                    assertEquals(PDF.length, maxBytes);
                    return PDF;
                }
                @Override public io.abada.worker.AgentStep recordStep(LockedExternalTask t, int attempt, int sequence,
                        String kind, String state, String toolRef, Object request, Object result, String errorType,
                        String model, Integer promptTokens, Integer completionTokens) {
                    steps.add(JSON.convertValue(request, Map.class));
                    return null;
                }
            };
            AgentGateway gemini = new AgentGateway() {
                @Override public AgentResult execute(AgentWorkDescriptor w, Map<String, Object> variables) {
                    throw new AssertionError("the call must carry the files");
                }
                @Override public AgentResult execute(AgentWorkDescriptor w, Map<String, Object> variables,
                        List<AgentFiles.AgentFile> files) {
                    received.set(files);
                    return new AgentResult(Map.of("payroll", 1200), null);
                }
                @Override public String provider() { return "google-gemini"; }
            };
            var runner = new AgentWorkerMain.Runner(engine, w -> gemini, config());
            runner.pollOnce();
            assertTrue(runner.awaitIdle(Duration.ofSeconds(10)));
            runner.close();

            assertEquals(List.of("task-1"), completed);
            assertEquals(1, received.get().size());
            assertEquals(SCAN.sha256(), received.get().get(0).ref().sha256());
        } finally {
            root.removeHandler(capture);
        }
        assertFalse(steps.isEmpty(), "the model call is journaled");
        String journal = JSON.writeValueAsString(steps);
        assertTrue(journal.contains(SCAN.sha256()) && journal.contains("f-pdf"), journal);
        assertFalse(journal.contains(pdf64));
        for (String line : logged) {
            assertFalse(line.contains(pdf64) || line.contains("scanned employer declaration"), line);
        }
    }
}
