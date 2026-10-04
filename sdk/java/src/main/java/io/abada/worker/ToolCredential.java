package io.abada.worker;

/**
 * The credential of a tool server, issued only to the worker holding the
 * task's lease. {@link #toString()} never prints the secret; callers must
 * never log it.
 */
public record ToolCredential(String server, String credential, String secret) {
    @Override
    public String toString() {
        return "ToolCredential[server=" + server + ", credential=" + credential + "]";
    }
}
