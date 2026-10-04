package io.abada.worker;

import java.util.List;

/**
 * One tool an agent node may use, resolved by the engine at deployment and
 * frozen with the definition version (external-worker protocol v1, 1.1).
 *
 * @param policy {@code read}, {@code write} or {@code approval_required}
 * @param idempotency {@code key} when the server accepts an idempotency key,
 *        {@code none} when it does not; null for read tools
 * @param credential the name of the project tool credential to fetch with
 *        {@link AbadaWorkerClient#toolCredential}; null when the server needs none
 */
public record ToolBinding(
        String server,
        String tool,
        String policy,
        String idempotency,
        List<String> approvers,
        String url,
        String transport,
        String credential,
        String resourceId,
        Long resourceRevision) {

    public ToolBinding {
        approvers = approvers == null ? List.of() : List.copyOf(approvers);
    }

    /** The reference APL uses: {@code <server>/<tool>}. */
    public String ref() {
        return server + "/" + tool;
    }
}
