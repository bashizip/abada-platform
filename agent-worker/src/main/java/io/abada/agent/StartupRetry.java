package io.abada.agent;

import io.abada.worker.WorkerProtocolException;
import java.time.Duration;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.DoubleSupplier;
import java.util.function.LongSupplier;

/**
 * Retries a startup call (capability registration and the OIDC token fetch it
 * triggers) while the engine or identity provider is not ready yet, for
 * example after a host reboot when Docker starts every container at once.
 *
 * <p>Only transient failures are retried: no connection, a timeout, HTTP 408,
 * 429 or 5xx from the engine or the token endpoint. Anything else, such as a
 * rejected client secret (401/403) or invalid capabilities (400), fails on the
 * first attempt. Delays grow exponentially from one second to 30 seconds with
 * equal jitter, and the whole sequence is bounded by
 * {@code ABADA_AGENT_STARTUP_RETRY_MS}; zero disables the retry.
 */
final class StartupRetry {
    private static final System.Logger LOG = System.getLogger(StartupRetry.class.getName());
    static final Duration INITIAL_DELAY = Duration.ofSeconds(1);
    static final Duration MAX_DELAY = Duration.ofSeconds(30);

    interface Sleeper {
        void sleep(Duration duration) throws InterruptedException;
    }

    private final Duration budget;
    private final LongSupplier clockMillis;
    private final Sleeper sleeper;
    private final DoubleSupplier random;

    StartupRetry(Duration budget) {
        this(budget, () -> System.nanoTime() / 1_000_000L, duration -> Thread.sleep(duration.toMillis()),
                () -> ThreadLocalRandom.current().nextDouble());
    }

    StartupRetry(Duration budget, LongSupplier clockMillis, Sleeper sleeper, DoubleSupplier random) {
        this.budget = budget;
        this.clockMillis = clockMillis;
        this.sleeper = sleeper;
        this.random = random;
    }

    /**
     * Runs {@code action} until it succeeds, a non-transient failure occurs or
     * the budget is spent; the last failure is rethrown.
     */
    void run(String operation, Runnable action) throws InterruptedException {
        long deadline = clockMillis.getAsLong() + budget.toMillis();
        for (int attempt = 1; ; attempt++) {
            try {
                action.run();
                if (attempt > 1) {
                    LOG.log(System.Logger.Level.INFO, "agent_startup_succeeded operation={0} attempt={1}",
                            operation, attempt);
                }
                return;
            } catch (RuntimeException failure) {
                if (!isTransient(failure)) throw failure;
                long remaining = deadline - clockMillis.getAsLong();
                if (remaining <= 0) {
                    LOG.log(System.Logger.Level.ERROR,
                            "agent_startup_gave_up operation={0} attempt={1} {2} budget_ms={3}",
                            operation, attempt, describe(failure), Long.toString(budget.toMillis()));
                    throw failure;
                }
                long delay = Math.min(remaining, delayMillis(attempt));
                LOG.log(System.Logger.Level.WARNING,
                        "agent_startup_retry operation={0} attempt={1} {2} retrying_in_ms={3} remaining_ms={4}",
                        operation, attempt, describe(failure), Long.toString(delay), Long.toString(remaining));
                sleeper.sleep(Duration.ofMillis(delay));
            }
        }
    }

    /** Equal jitter: half the capped exponential delay plus a random share of the other half. */
    long delayMillis(int attempt) {
        long exponential = INITIAL_DELAY.toMillis() << Math.min(attempt - 1, 20);
        long capped = Math.min(MAX_DELAY.toMillis(), exponential);
        long half = capped / 2;
        return half + (long) (random.getAsDouble() * (capped - half));
    }

    static boolean isTransient(Throwable failure) {
        if (failure instanceof TokenRequestException token) return token.transientFailure();
        if (failure instanceof WorkerProtocolException protocol) {
            int status = protocol.status();
            if (status == 0) return "NETWORK_ERROR".equals(protocol.code());
            return TokenRequestException.transientStatus(status);
        }
        return false;
    }

    /** Status and code only: engine and IdP messages may echo request details. */
    private static String describe(RuntimeException failure) {
        if (failure instanceof TokenRequestException token) {
            return "source=oidc status=" + token.status() + " reason=" + token.getMessage();
        }
        if (failure instanceof WorkerProtocolException protocol) {
            return "source=engine status=" + protocol.status() + " code=" + protocol.code();
        }
        return "source=unknown type=" + failure.getClass().getSimpleName();
    }
}
