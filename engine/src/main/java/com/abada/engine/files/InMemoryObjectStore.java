package com.abada.engine.files;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Objects kept in memory, for tests on H2 only: the engine refuses it under the
 * prod profile. {@link #setAvailable} simulates an unreachable store.
 */
public class InMemoryObjectStore implements ObjectStore {
    private final Map<String, Entry> objects = new ConcurrentSkipListMap<>();
    private final AtomicBoolean available = new AtomicBoolean(true);

    private record Entry(byte[] bytes, String contentType, Instant lastModified) {
    }

    public void setAvailable(boolean value) {
        available.set(value);
    }

    public boolean contains(String key) {
        return objects.containsKey(key);
    }

    public int size() {
        return objects.size();
    }

    /** Puts an object directly, with a chosen age (orphan tests). */
    public void putRaw(String key, byte[] bytes, Instant lastModified) {
        objects.put(key, new Entry(bytes, "application/octet-stream", lastModified));
    }

    public void clear() {
        objects.clear();
    }

    @Override
    public void put(String key, InputStream body, long length, String contentType) {
        requireAvailable();
        try {
            byte[] bytes = body.readNBytes((int) length);
            if (bytes.length != length) throw new ObjectStoreUnavailableException("short body", null);
            objects.put(key, new Entry(bytes, contentType, Instant.now()));
        } catch (IOException exception) {
            throw new ObjectStoreUnavailableException("object store store failed", exception);
        }
    }

    @Override
    public StoredObject open(String key) {
        requireAvailable();
        Entry entry = objects.get(key);
        if (entry == null) throw new ObjectNotFoundException(key);
        return new StoredObject(new ByteArrayInputStream(entry.bytes()), entry.bytes().length);
    }

    @Override
    public void delete(String key) {
        requireAvailable();
        objects.remove(key);
    }

    @Override
    public Page list(String continuation, int max) {
        requireAvailable();
        List<Listed> page = new ArrayList<>();
        String next = null;
        for (Map.Entry<String, Entry> entry : objects.entrySet()) {
            if (continuation != null && entry.getKey().compareTo(continuation) <= 0) continue;
            if (page.size() == max) {
                next = page.get(page.size() - 1).key();
                break;
            }
            page.add(new Listed(entry.getKey(), entry.getValue().lastModified()));
        }
        return new Page(page, next);
    }

    @Override
    public void check() {
        requireAvailable();
    }

    @Override
    public void ensureBucket() {
        requireAvailable();
    }

    @Override
    public String describe() {
        return "memory";
    }

    private void requireAvailable() {
        if (!available.get()) throw new ObjectStoreUnavailableException("object store unreachable (simulated)", null);
    }
}
