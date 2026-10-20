package com.abada.engine.files;

import java.util.Arrays;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * Chooses the object store. RustFS (S3 API) is required for self-hosted
 * installations; the in-memory store exists for tests and is refused under the
 * prod profile.
 */
@Configuration
public class ObjectStoreConfig {
    private static final Logger log = LoggerFactory.getLogger(ObjectStoreConfig.class);

    @Bean
    public ObjectStore objectStore(FilesProperties properties, Environment environment) {
        String store = properties.store();
        if ("memory".equalsIgnoreCase(store)) {
            if (Arrays.asList(environment.getActiveProfiles()).contains("prod")) {
                throw new IllegalStateException("abada.files.store=memory is for tests; production needs RustFS "
                        + "(abada.files.store=s3)");
            }
            log.warn("files_store kind=memory: file contents are lost on restart (tests only)");
            return new InMemoryObjectStore();
        }
        if (!"s3".equalsIgnoreCase(store)) {
            throw new IllegalStateException("abada.files.store must be s3 or memory");
        }
        S3ObjectStore s3 = new S3ObjectStore(properties);
        log.info("files_store {}", s3.describe());
        return s3;
    }
}
