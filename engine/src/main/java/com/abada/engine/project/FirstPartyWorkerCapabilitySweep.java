package com.abada.engine.project;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Registers global capabilities for configured first-party workers whose
 * principal has been observed. Idempotent and safe on multi-replica startups:
 * a concurrent engine that already inserted the capability makes the insert
 * collide with the unique (principal, topic) constraint, which is swallowed
 * and retried on the next startup.
 */
@Component
public class FirstPartyWorkerCapabilitySweep implements ApplicationRunner {

    private static final Logger LOG = LoggerFactory.getLogger(FirstPartyWorkerCapabilitySweep.class);

    private final WorkerCapabilityService capabilities;

    public FirstPartyWorkerCapabilitySweep(WorkerCapabilityService capabilities) {
        this.capabilities = capabilities;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        try {
            capabilities.ensureFirstPartyCapabilities();
        } catch (DataIntegrityViolationException exception) {
            LOG.warn("first_party_capability_conflict message={}", exception.getMessage());
        }
    }
}