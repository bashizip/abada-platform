package com.abada.engine.llm;

import com.abada.engine.persistence.entity.AiProviderEntity;
import com.abada.engine.persistence.repository.AiProviderRepository;
import com.abada.engine.security.AesEncryption;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Once {@code ABADA_ENCRYPTION_KEY} is configured, re-encrypts provider keys
 * that were saved under the built-in development key (every install before
 * the key was set). Idempotent; safe when several instances start together.
 */
@Component
public class AiProviderKeyReencryption {
    private static final Logger log = LoggerFactory.getLogger(AiProviderKeyReencryption.class);

    private final AiProviderRepository repository;
    private final AesEncryption encryption;
    private final TransactionTemplate transactions;

    public AiProviderKeyReencryption(AiProviderRepository repository, AesEncryption encryption,
            TransactionTemplate transactions) {
        this.repository = repository;
        this.encryption = encryption;
        this.transactions = transactions;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void reencryptLegacyKeys() {
        if (encryption.isUsingDevKey()) {
            if (!repository.findAll().stream().filter(AiProviderEntity::hasKey).toList().isEmpty()) {
                log.warn("ai_provider_keys_weakly_encrypted reason=ABADA_ENCRYPTION_KEY_not_set "
                        + "hint=set ABADA_ENCRYPTION_KEY (openssl rand -base64 32) and restart");
            }
            return;
        }
        int migrated = 0;
        for (AiProviderEntity row : repository.findAll()) {
            if (!row.hasKey() || !encryption.isLegacy(row.getApiKeyEnc())) continue;
            try {
                Boolean done = transactions.execute(status -> {
                    AiProviderEntity current = repository.findById(row.getId()).orElse(null);
                    if (current == null || !encryption.isLegacy(current.getApiKeyEnc())) return false;
                    current.setApiKeyEnc(encryption.encrypt(encryption.decrypt(current.getApiKeyEnc())));
                    current.setUpdatedAt(Instant.now());
                    repository.save(current);
                    return true;
                });
                if (Boolean.TRUE.equals(done)) migrated++;
            } catch (ObjectOptimisticLockingFailureException concurrent) {
                // another instance re-encrypted it first
            }
        }
        if (migrated > 0) log.info("ai_provider_keys_reencrypted count={}", migrated);
    }
}
