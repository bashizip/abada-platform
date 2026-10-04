package io.abada.worker;

public class WorkerProtocolException extends RuntimeException {
    private final int status;
    private final String code;
    private final String reason;

    public WorkerProtocolException(int status, String code, String message) {
        this(status, code, message, null);
    }

    public WorkerProtocolException(int status, String code, String message, String reason) {
        super(message);
        this.status = status;
        this.code = code;
        this.reason = reason;
    }

    public int status() { return status; }
    public String code() { return code; }

    /**
     * The engine's {@code details.reason} when it names the rule a request
     * broke (for example a refused agent step: {@code SEQUENCE},
     * {@code APPROVAL_REQUIRED}, {@code TOOL_NOT_BOUND}); null otherwise.
     */
    public String reason() { return reason; }
}
