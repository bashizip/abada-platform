package com.abada.engine.insight;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Drives the optimizer loop on its interval when ABADA_INSIGHT_ENABLED=true.
 * The run itself is lease-guarded, so this scheduler may run in every engine
 * replica; exactly one performs the work per interval.
 */
@Component
@ConditionalOnProperty(name = "abada.insight.enabled", havingValue = "true")
public class InsightScheduler {

    private static final Logger log = LoggerFactory.getLogger(InsightScheduler.class);

    private final InsightWorker worker;

    public InsightScheduler(InsightWorker worker) {
        this.worker = worker;
    }

    @Scheduled(fixedDelayString = "${abada.insight.interval-ms:600000}",
            initialDelayString = "${abada.insight.initial-delay-ms:15000}")
    public void runCycle() {
        try {
            InsightWorker.RunOutcome outcome = worker.runCycle();
            if (outcome != InsightWorker.RunOutcome.SKIPPED_NO_LEASE
                    && outcome != InsightWorker.RunOutcome.NOT_ENABLED) {
                log.info("Insight loop cycle finished: {}", outcome);
            }
        } catch (RuntimeException exception) {
            log.error("Insight loop cycle failed", exception);
            throw exception;
        }
    }
}