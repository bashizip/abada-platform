package com.abada.engine.core.model;

import java.io.Serializable;

/**
 * A file an agent call may read (S15), as the engine resolved it from the node's
 * {@code files} declaration: metadata from the {@code process_files} row, never the
 * bytes. The worker downloads the bytes through the engine with its lease and checks
 * the size and sha256 against this reference.
 *
 * @param name the declared name in {@code files} the reference came from
 */
public record AgentFileRef(String name, String fileId, String fileName, String contentType, long sizeBytes,
        String sha256) implements Serializable {
}
