package com.abada.engine.observability;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Scope;
import org.slf4j.MDC;

/** Keeps OpenTelemetry context and structured-log correlation fields aligned. */
public final class TraceLogContext implements AutoCloseable {

    private final Scope scope;
    private final String previousTraceId;
    private final String previousSpanId;

    private TraceLogContext(Span span) {
        previousTraceId = MDC.get("traceId");
        previousSpanId = MDC.get("spanId");
        Span effectiveSpan = span == null ? Span.getInvalid() : span;
        var context = effectiveSpan.getSpanContext();
        if (context != null && context.isValid()) {
            scope = effectiveSpan.makeCurrent();
            MDC.put("traceId", context.getTraceId());
            MDC.put("spanId", context.getSpanId());
        } else {
            // Invalid/no-op spans must not replace existing log correlation
            // values with OpenTelemetry's all-zero identifiers.
            scope = () -> { };
        }
    }

    public static TraceLogContext open(Span span) {
        return new TraceLogContext(span);
    }

    @Override
    public void close() {
        try {
            scope.close();
        } finally {
            // Context listeners may update MDC while the scope closes, so restore
            // the command's previous correlation values afterwards.
            restore("traceId", previousTraceId);
            restore("spanId", previousSpanId);
        }
    }

    private static void restore(String key, String value) {
        if (value == null) {
            MDC.remove(key);
        } else {
            MDC.put(key, value);
        }
    }
}
