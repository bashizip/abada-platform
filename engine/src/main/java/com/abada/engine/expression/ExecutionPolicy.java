package com.abada.engine.expression;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Operator policy for code that runs inside workflow transactions.
 *
 * <ul>
 *   <li>{@code abada.scripts.enabled} (env {@code ABADA_SCRIPTS_ENABLED}, default
 *       {@code false}): allows script tasks. When disabled, definitions with
 *       script tasks are rejected at deployment and never executed.</li>
 *   <li>{@code abada.delegates.allowed-classes} (env
 *       {@code ABADA_DELEGATES_ALLOWED_CLASSES}): comma-separated Java delegate
 *       classes a BPMN service task may instantiate. Empty means none.</li>
 * </ul>
 *
 * <p>Values are process-wide. Spring sets them at startup through
 * {@code ExecutionPolicyConfiguration}; outside Spring they default to the
 * JVM system properties of the same names.
 */
public final class ExecutionPolicy {
    public static final String SCRIPTS_ENABLED = "abada.scripts.enabled";
    public static final String ALLOWED_DELEGATES = "abada.delegates.allowed-classes";

    private static volatile boolean scriptsEnabled = Boolean.getBoolean(SCRIPTS_ENABLED);
    private static volatile Set<String> allowedDelegates = parse(System.getProperty(ALLOWED_DELEGATES, ""));

    private ExecutionPolicy() {}

    public static boolean scriptsEnabled() { return scriptsEnabled; }

    public static Set<String> allowedDelegates() { return allowedDelegates; }

    public static boolean delegateAllowed(String className) {
        return className != null && allowedDelegates.contains(className.strip());
    }

    public static void configure(boolean scripts, String delegatesCsv) {
        scriptsEnabled = scripts;
        allowedDelegates = parse(delegatesCsv);
    }

    static Set<String> parse(String csv) {
        if (csv == null || csv.isBlank()) return Set.of();
        return Arrays.stream(csv.split(",")).map(String::strip).filter(value -> !value.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }
}
