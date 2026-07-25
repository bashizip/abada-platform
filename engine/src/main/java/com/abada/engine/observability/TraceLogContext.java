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
        scope = span.makeCurrent();
        var context = span.getSpanContext();
        if (context.isValid()) {
            MDC.put("traceId", context.getTraceId());
            MDC.put("spanId", context.getSpanId());
        }
    }

    public static TraceLogContext open(Span span) {
        return new TraceLogContext(span);
    }

    @Override
    public void close() {
        restore("traceId", previousTraceId);
        restore("spanId", previousSpanId);
        scope.close();
    }

    private static void restore(String key, String value) {
        if (value == null) {
            MDC.remove(key);
        } else {
            MDC.put(key, value);
        }
    }
}
