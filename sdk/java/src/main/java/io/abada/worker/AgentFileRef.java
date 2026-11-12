package io.abada.worker;

/**
 * A file an agent call may read (S15), as the engine resolved it: metadata only.
 * Download the bytes with {@link AbadaWorkerClient#downloadFile} while holding the
 * lease, and check that their size and sha256 match before sending them anywhere.
 *
 * @param name the declared name in the node's {@code files} the reference came from
 */
public record AgentFileRef(String name, String fileId, String fileName, String contentType, long sizeBytes,
        String sha256) {
}
