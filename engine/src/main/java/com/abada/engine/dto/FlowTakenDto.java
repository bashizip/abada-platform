package com.abada.engine.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

/**
 * The sequence flow a token took when it left a node, as recorded in a
 * {@code FLOW_TAKEN} history event ({@code details.flow}). Since 1.2.
 *
 * @param id the flow id; null only for a loop's {@code on_exhausted} route
 * @param loopIteration the pass the token started at {@code to} when it is a loop step
 * @param condition the gateway rule that matched, when a conditional rule did
 * @param otherwise true when the gateway's {@code else} (default) branch was taken
 * @param route the route that sent the token: kind (OUTCOME, ROUTE, ERROR, TIMEOUT,
 *        LOW_CONFIDENCE, INVALID_OUTPUT, LOOP_EXHAUSTED) and, when it has one, code
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record FlowTakenDto(
        String id,
        String from,
        String to,
        String tokenId,
        Integer loopIteration,
        String condition,
        @JsonProperty("else") Boolean otherwise,
        Route route) {

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Route(String kind, String code) {}

    /** The flow of a {@code FLOW_TAKEN} event's details, or null for any other event. */
    static FlowTakenDto from(Map<String, Object> details) {
        if (!(details.get("flow") instanceof Map<?, ?> flow)) return null;
        Route route = flow.get("route") instanceof Map<?, ?> raw
                ? new Route(text(raw.get("kind")), text(raw.get("code"))) : null;
        return new FlowTakenDto(text(flow.get("id")), text(flow.get("from")), text(flow.get("to")),
                text(flow.get("tokenId")),
                flow.get("loopIteration") instanceof Number number ? number.intValue() : null,
                text(flow.get("condition")), Boolean.TRUE.equals(flow.get("else")) ? Boolean.TRUE : null, route);
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }
}
