package com.abada.engine.security;

import com.abada.engine.persistence.entity.AgentStepEntity;
import com.abada.engine.persistence.entity.ToolCredentialEntity;
import com.abada.engine.persistence.repository.AgentStepRepository;
import com.abada.engine.persistence.repository.ToolCredentialRepository;
import java.util.List;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.PageRequest;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Re-encrypts values written with the development key once a real
 * {@code ABADA_ENCRYPTION_KEY} is configured, like AI provider keys
 * ({@code AiProviderKeyReencryption}): tool credentials at startup, and agent
 * step payloads in the background in batches (a journal can be large).
 */
@Component
public class LegacyCiphertextReencryption {
    private static final Logger log = LoggerFactory.getLogger(LegacyCiphertextReencryption.class);
    static final int BATCH = 200;

    private final AesEncryption encryption;
    private final ToolCredentialRepository credentials;
    private final AgentStepRepository steps;
    private final TransactionTemplate transactions;

    public LegacyCiphertextReencryption(AesEncryption encryption, ToolCredentialRepository credentials,
            AgentStepRepository steps, TransactionTemplate transactions) {
        this.encryption = encryption;
        this.credentials = credentials;
        this.steps = steps;
        this.transactions = transactions;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void reencryptLegacyValues() {
        if (encryption.isUsingDevKey()) return;
        int migrated = 0;
        for (ToolCredentialEntity row : credentials.findAll()) {
            if (!encryption.isLegacy(row.getSecretEnc())) continue;
            try {
                Boolean done = transactions.execute(status -> {
                    ToolCredentialEntity current = credentials.findById(
                            new com.abada.engine.persistence.entity.ToolCredentialId(row.getProjectId(), row.getName()))
                            .orElse(null);
                    if (current == null || !encryption.isLegacy(current.getSecretEnc())) return false;
                    current.setSecretEnc(encryption.encrypt(encryption.decrypt(current.getSecretEnc())));
                    credentials.save(current);
                    return true;
                });
                if (Boolean.TRUE.equals(done)) migrated++;
            } catch (ObjectOptimisticLockingFailureException concurrent) {
                // another instance re-encrypted it first
            }
        }
        if (migrated > 0) log.info("tool_credentials_reencrypted count={}", migrated);
        Thread.ofVirtual().name("abada-step-reencryption").start(this::reencryptSteps);
    }

    /** Re-encrypts every step payload column still under the development key; returns how many rows changed. */
    public int reencryptSteps() {
        int changed = 0;
        int page = 0;
        List<AgentStepEntity> batch;
        do {
            int index = page++;
            batch = steps.findAll(PageRequest.of(index, BATCH)).getContent();
            for (AgentStepEntity row : batch) {
                if (!hasLegacy(row)) continue;
                try {
                    Boolean done = transactions.execute(status -> {
                        AgentStepEntity current = steps.findById(row.getId()).orElse(null);
                        if (current == null || !hasLegacy(current)) return false;
                        rewrap(current::getRequestEnc, current::setRequestEnc);
                        rewrap(current::getResultEnc, current::setResultEnc);
                        rewrap(current::getEvidenceRequestEnc, current::setEvidenceRequestEnc);
                        rewrap(current::getEvidenceResultEnc, current::setEvidenceResultEnc);
                        steps.save(current);
                        return true;
                    });
                    if (Boolean.TRUE.equals(done)) changed++;
                } catch (ObjectOptimisticLockingFailureException concurrent) {
                    // another instance or a step update got there first; the next start retries it
                }
            }
        } while (batch.size() == BATCH);
        if (changed > 0) log.info("agent_step_payloads_reencrypted count={}", changed);
        return changed;
    }

    private boolean hasLegacy(AgentStepEntity row) {
        return encryption.isLegacy(row.getRequestEnc()) || encryption.isLegacy(row.getResultEnc())
                || encryption.isLegacy(row.getEvidenceRequestEnc()) || encryption.isLegacy(row.getEvidenceResultEnc());
    }

    private void rewrap(Supplier<String> getter, Consumer<String> setter) {
        String value = getter.get();
        if (value != null && encryption.isLegacy(value)) setter.accept(encryption.encrypt(encryption.decrypt(value)));
    }
}
