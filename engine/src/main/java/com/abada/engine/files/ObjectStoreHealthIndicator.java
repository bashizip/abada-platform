package com.abada.engine.files;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * The object store is a readiness dependency: an engine that cannot keep a
 * file must not accept one, so an unreachable store or a missing bucket makes
 * readiness fail loudly. The engine still starts (liveness stays up) and
 * recovers by itself once the store answers. The bucket is created at startup
 * when {@code abada.files.create-bucket} is on, and again on a later probe if
 * that first attempt failed. Until one write has succeeded, a probe also
 * writes and removes a one-byte object with the upload options (server-side
 * encryption), so a store that would refuse every upload is not ready.
 * Probes are cached for a few seconds.
 */
@Component("objectStoreHealthIndicator")
public class ObjectStoreHealthIndicator implements HealthIndicator {
    private static final Logger log = LoggerFactory.getLogger(ObjectStoreHealthIndicator.class);

    private final ObjectStore store;
    private final FilesProperties properties;
    private final Duration cache;
    private volatile boolean bucketEnsured;
    private volatile boolean writeVerified;
    private volatile Health last;
    private volatile Instant lastAt = Instant.EPOCH;

    public ObjectStoreHealthIndicator(ObjectStore store, FilesProperties properties,
            @org.springframework.beans.factory.annotation.Value("${abada.files.health-cache:PT5S}") Duration cache) {
        this.cache = cache;
        this.store = store;
        this.properties = properties;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        Health health = probe();
        if ("UP".equals(health.getStatus().getCode())) {
            log.info("files_store_ready {}", store.describe());
        } else {
            log.error("files_store_unavailable {} reason={}: readiness fails until it answers", store.describe(),
                    health.getDetails().get("reason"));
        }
    }

    @Override
    public Health health() {
        Health cached = last;
        if (cached != null && Instant.now().isBefore(lastAt.plus(cache))) return cached;
        return probe();
    }

    private synchronized Health probe() {
        Health result;
        try {
            if (properties.createBucket() && !bucketEnsured) {
                store.ensureBucket();
                bucketEnsured = true;
            }
            store.check();
            if (!writeVerified) {
                store.verifyWrite();
                writeVerified = true;
            }
            result = Health.up().withDetail("store", store.describe()).withDetail("readinessDependency", true).build();
        } catch (RuntimeException exception) {
            result = Health.down().withDetail("store", store.describe()).withDetail("readinessDependency", true)
                    .withDetail("reason", exception.getMessage()).build();
        }
        last = result;
        lastAt = Instant.now();
        return result;
    }
}
