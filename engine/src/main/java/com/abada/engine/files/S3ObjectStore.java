package com.abada.engine.files;

import java.io.InputStream;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.model.ServerSideEncryption;

/**
 * The object store on the S3 API, as served by RustFS (the only S3-compatible
 * store tested and supported). Path-style addressing; checksums only where the
 * API requires them, since the SDK's default CRC trailers are not served by
 * every S3-compatible store. Objects are written with server-side encryption
 * when it is enabled.
 */
public class S3ObjectStore implements ObjectStore {
    private final S3Client client;
    private final String bucket;
    private final boolean serverSideEncryption;
    private final String description;
    private final String misconfigured;

    public S3ObjectStore(FilesProperties properties) {
        URI endpoint = URI.create(properties.endpoint());
        if (properties.requireTls() && !"https".equalsIgnoreCase(endpoint.getScheme())) {
            throw new IllegalStateException("abada.files.endpoint must use https (abada.files.require-tls is on)");
        }
        // Missing credentials do not stop the engine: every call fails and readiness says why.
        this.misconfigured = properties.accessKey().isBlank() || properties.secretKey().isBlank()
                ? "credentials are not set (ABADA_FILES_ACCESS_KEY, ABADA_FILES_SECRET_KEY)" : null;
        this.bucket = properties.bucket();
        this.serverSideEncryption = properties.serverSideEncryption();
        this.description = "s3 " + endpoint.getScheme() + "://" + endpoint.getHost()
                + (endpoint.getPort() > 0 ? ":" + endpoint.getPort() : "") + "/" + bucket;
        this.client = S3Client.builder()
                .endpointOverride(endpoint)
                .region(Region.of(properties.region()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(misconfigured == null ? properties.accessKey() : "unset",
                                misconfigured == null ? properties.secretKey() : "unset")))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
                .httpClient(UrlConnectionHttpClient.builder()
                        .connectionTimeout(properties.connectTimeout())
                        .socketTimeout(properties.readTimeout())
                        .build())
                .build();
    }

    @Override
    public void put(String key, InputStream body, long length, String contentType) {
        requireConfigured();
        try {
            client.putObject(request -> {
                request.bucket(bucket).key(key).contentType(contentType).contentLength(length);
                if (serverSideEncryption) request.serverSideEncryption(ServerSideEncryption.AES256);
            }, RequestBody.fromInputStream(body, length));
        } catch (SdkException exception) {
            throw unavailable("store", exception);
        }
    }

    @Override
    public StoredObject open(String key) {
        requireConfigured();
        try {
            ResponseInputStream<GetObjectResponse> stream = client.getObject(request -> request.bucket(bucket).key(key));
            Long length = stream.response().contentLength();
            return new StoredObject(stream, length == null ? -1 : length);
        } catch (NoSuchKeyException exception) {
            throw new ObjectNotFoundException(key);
        } catch (S3Exception exception) {
            if (exception.statusCode() == 404) throw new ObjectNotFoundException(key);
            throw unavailable("read", exception);
        } catch (SdkException exception) {
            throw unavailable("read", exception);
        }
    }

    @Override
    public void delete(String key) {
        requireConfigured();
        try {
            client.deleteObject(request -> request.bucket(bucket).key(key));
        } catch (NoSuchKeyException exception) {
            // Absent already: the deletion is done.
        } catch (S3Exception exception) {
            if (exception.statusCode() != 404) throw unavailable("delete", exception);
        } catch (SdkException exception) {
            throw unavailable("delete", exception);
        }
    }

    @Override
    public Page list(String continuation, int max) {
        requireConfigured();
        try {
            ListObjectsV2Response response = client.listObjectsV2(request -> {
                request.bucket(bucket).maxKeys(max);
                if (continuation != null) request.continuationToken(continuation);
            });
            List<Listed> objects = new ArrayList<>();
            response.contents().forEach(object -> objects.add(new Listed(object.key(), object.lastModified())));
            return new Page(objects, Boolean.TRUE.equals(response.isTruncated()) ? response.nextContinuationToken() : null);
        } catch (SdkException exception) {
            throw unavailable("list", exception);
        }
    }

    @Override
    public void check() {
        requireConfigured();
        try {
            client.headBucket(request -> request.bucket(bucket));
        } catch (NoSuchBucketException exception) {
            throw new ObjectStoreUnavailableException("bucket '" + bucket + "' does not exist", null);
        } catch (S3Exception exception) {
            if (exception.statusCode() == 404) {
                throw new ObjectStoreUnavailableException("bucket '" + bucket + "' does not exist", null);
            }
            throw unavailable("check", exception);
        } catch (SdkException exception) {
            throw unavailable("check", exception);
        }
    }

    @Override
    public void ensureBucket() {
        requireConfigured();
        try {
            client.headBucket(request -> request.bucket(bucket));
        } catch (S3Exception exception) {
            if (exception.statusCode() != 404) throw unavailable("check", exception);
            try {
                client.createBucket(request -> request.bucket(bucket));
            } catch (S3Exception created) {
                // Another replica created it first.
                if (!"BucketAlreadyOwnedByYou".equals(code(created)) && !"BucketAlreadyExists".equals(code(created))) {
                    throw unavailable("create bucket", created);
                }
            } catch (SdkException created) {
                throw unavailable("create bucket", created);
            }
        } catch (SdkException exception) {
            throw unavailable("check", exception);
        }
    }

    @Override
    public String describe() {
        return description;
    }

    private void requireConfigured() {
        if (misconfigured != null) throw new ObjectStoreUnavailableException(misconfigured, null);
    }

    private static String code(S3Exception exception) {
        return exception.awsErrorDetails() == null ? null : exception.awsErrorDetails().errorCode();
    }

    /** The SDK's message names the operation and status, never the request's credentials. */
    private ObjectStoreUnavailableException unavailable(String operation, SdkException exception) {
        String status = "";
        if (exception instanceof S3Exception s3) {
            String detail = s3.awsErrorDetails() == null ? null : s3.awsErrorDetails().errorMessage();
            status = " (HTTP " + s3.statusCode() + (detail == null ? "" : ": " + detail) + ")";
        }
        return new ObjectStoreUnavailableException("object store " + operation + " failed" + status, exception);
    }
}
