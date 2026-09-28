package io.abada.agent;

/**
 * An OIDC client-credentials token request failed. {@link #transientFailure()}
 * is true when a later attempt can succeed without a configuration change: the
 * identity provider was unreachable, timed out, throttled or answered 5xx.
 * A rejected client (400/401/403) is permanent. Messages never carry the
 * client secret or a token.
 */
final class TokenRequestException extends IllegalStateException {
    private final int status;
    private final boolean transientFailure;

    TokenRequestException(String message, int status, boolean transientFailure, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.transientFailure = transientFailure;
    }

    /** HTTP status of the token endpoint, or 0 when no response arrived. */
    int status() {
        return status;
    }

    boolean transientFailure() {
        return transientFailure;
    }

    static boolean transientStatus(int status) {
        return status == 408 || status == 429 || status >= 500;
    }
}
