package com.abada.engine.files;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.List;

/**
 * Where the bytes of process files live (S9). PostgreSQL keeps the metadata
 * and decides what a process may see; the store only keeps objects under the
 * keys the engine chooses ({@code <project>/<fileId>}, never a file name).
 *
 * <p>Every call is remote and may fail with {@link ObjectStoreUnavailableException};
 * none is made inside a workflow-state transaction. {@link #delete} of an absent
 * key succeeds, so deletions can be retried (at-least-once, idempotent).
 * Self-hosted installations use RustFS through the S3 API ({@link S3ObjectStore});
 * managed cloud stores plug in behind this interface later.
 */
public interface ObjectStore {

    /** Stores exactly {@code length} bytes read from {@code body} under {@code key}. */
    void put(String key, InputStream body, long length, String contentType);

    /** Opens an object for reading; throws {@link ObjectNotFoundException} when it is absent. */
    StoredObject open(String key);

    /** Removes an object; an absent key is a success. */
    void delete(String key);

    /** One page of keys in key order, starting after {@code continuation} (null for the first page). */
    Page list(String continuation, int max);

    /** Throws when the store cannot be reached or its bucket is missing; used by readiness. */
    void check();

    /** Key of the object readiness writes and removes once, to prove the store accepts writes. */
    String PROBE_KEY = "_abada/readiness-probe";

    /**
     * Writes and removes a one-byte probe object with the store's write options
     * (server-side encryption included), so a store that would refuse every
     * upload fails readiness instead.
     */
    default void verifyWrite() {
        put(PROBE_KEY, new java.io.ByteArrayInputStream(new byte[] {1}), 1, "application/octet-stream");
        delete(PROBE_KEY);
    }

    /** Creates the bucket when it is missing (idempotent). */
    void ensureBucket();

    /** Where the store is, for health details: kind, host and bucket, never a credential. */
    String describe();

    record StoredObject(InputStream body, long length) implements Closeable {
        @Override
        public void close() throws IOException {
            body.close();
        }
    }

    record Listed(String key, Instant lastModified) {
    }

    record Page(List<Listed> objects, String next) {
    }

    final class ObjectNotFoundException extends RuntimeException {
        public ObjectNotFoundException(String key) {
            super("Object not found: " + key);
        }
    }
}
