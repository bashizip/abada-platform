package com.abada.engine.files;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Process file settings ({@code abada.files.*}). Credentials come from the
 * environment and are never logged or returned.
 */
@Component
public class FilesProperties {
    /** {@code s3} (RustFS) everywhere but tests; {@code memory} is refused under the prod profile. */
    @Value("${abada.files.store:s3}") private String store;
    @Value("${abada.files.endpoint:http://localhost:9000}") private String endpoint;
    @Value("${abada.files.region:us-east-1}") private String region;
    @Value("${abada.files.bucket:abada-files}") private String bucket;
    @Value("${abada.files.access-key:}") private String accessKey;
    @Value("${abada.files.secret-key:}") private String secretKey;
    @Value("${abada.files.create-bucket:true}") private boolean createBucket;
    @Value("${abada.files.server-side-encryption:true}") private boolean serverSideEncryption;
    /** When true, a plain-HTTP endpoint is refused at startup (production default). */
    @Value("${abada.files.require-tls:false}") private boolean requireTls;
    @Value("${abada.files.max-file-bytes:10485760}") private long maxFileBytes;
    @Value("${abada.files.max-task-bytes:52428800}") private long maxTaskBytes;
    @Value("${abada.files.pending-ttl:PT24H}") private Duration pendingTtl;
    @Value("${abada.files.orphan-grace:PT1H}") private Duration orphanGrace;
    @Value("${abada.files.orphan-interval:PT24H}") private Duration orphanInterval;
    @Value("${abada.files.lease:PT5M}") private Duration lease;
    @Value("${abada.files.connect-timeout:PT5S}") private Duration connectTimeout;
    @Value("${abada.files.read-timeout:PT60S}") private Duration readTimeout;

    public String store() { return store; }
    public String endpoint() { return endpoint; }
    public String region() { return region; }
    public String bucket() { return bucket; }
    public String accessKey() { return accessKey; }
    public String secretKey() { return secretKey; }
    public boolean createBucket() { return createBucket; }
    public boolean serverSideEncryption() { return serverSideEncryption; }
    public boolean requireTls() { return requireTls; }
    public long maxFileBytes() { return maxFileBytes; }
    public long maxTaskBytes() { return maxTaskBytes; }
    public Duration pendingTtl() { return pendingTtl; }
    public Duration orphanGrace() { return orphanGrace; }
    public Duration orphanInterval() { return orphanInterval; }
    public Duration lease() { return lease; }
    public Duration connectTimeout() { return connectTimeout; }
    public Duration readTimeout() { return readTimeout; }
}
