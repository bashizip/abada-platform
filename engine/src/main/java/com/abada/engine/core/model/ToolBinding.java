package com.abada.engine.core.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.io.Serializable;
import java.util.List;

/**
 * One tool an agent node may use, resolved at deployment against the project's
 * {@code TOOL_SERVER} resources and frozen with the definition version.
 *
 * <p>{@code credential} is the name of a project tool credential, never its
 * value. {@code idempotency} is {@code key} when the server accepts an
 * idempotency key and {@code none} otherwise; read tools carry null.
 */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record ToolBinding(
        String server,
        String tool,
        ToolPolicy policy,
        String idempotency,
        List<String> approvers,
        String url,
        String transport,
        String credential,
        String resourceId,
        Long resourceRevision,
        // SHA-256 of the canonical inputSchema the tool server document pins; null when not pinned.
        String inputSchemaSha256,
        // Hours an approval of this tool may wait before it is marked escalated; null for none.
        Double approvalSlaHours) implements Serializable {

    public ToolBinding {
        approvers = approvers == null ? List.of() : List.copyOf(approvers);
    }

    /** The reference APL uses: {@code <server>/<tool>}. */
    public String ref() {
        return server + "/" + tool;
    }
}
