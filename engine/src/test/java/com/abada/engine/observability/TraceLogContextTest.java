package com.abada.engine.observability;

import static org.assertj.core.api.Assertions.assertThat;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

class TraceLogContextTest {

    private static final String TRACE_ID = "0123456789abcdef0123456789abcdef";
    private static final String SPAN_ID = "0123456789abcdef";

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    @Test
    void exposesCurrentSpanInMdcAndRestoresPreviousValues() {
        MDC.put("traceId", "previous-trace");
        MDC.put("spanId", "previous-span");
        Span span = Span.wrap(SpanContext.create(TRACE_ID, SPAN_ID, TraceFlags.getSampled(), TraceState.getDefault()));

        try (TraceLogContext ignored = TraceLogContext.open(span)) {
            assertThat(Span.current().getSpanContext()).isEqualTo(span.getSpanContext());
            assertThat(MDC.get("traceId")).isEqualTo(TRACE_ID);
            assertThat(MDC.get("spanId")).isEqualTo(SPAN_ID);
        }

        assertThat(MDC.get("traceId")).isEqualTo("previous-trace");
        assertThat(MDC.get("spanId")).isEqualTo("previous-span");
    }

    @Test
    void acceptsMissingSpanAsSafeNoOpContext() {
        MDC.put("traceId", "previous-trace");
        MDC.put("spanId", "previous-span");

        try (TraceLogContext ignored = TraceLogContext.open(null)) {
            assertThat(Span.current().getSpanContext().isValid()).isFalse();
            assertThat(MDC.get("traceId")).isEqualTo("previous-trace");
            assertThat(MDC.get("spanId")).isEqualTo("previous-span");
        }

        assertThat(MDC.get("traceId")).isEqualTo("previous-trace");
        assertThat(MDC.get("spanId")).isEqualTo("previous-span");
    }
}
