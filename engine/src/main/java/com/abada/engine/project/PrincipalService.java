package com.abada.engine.project;

import com.abada.engine.persistence.entity.PrincipalEntity;
import com.abada.engine.persistence.repository.PrincipalRepository;
import java.time.Instant;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class PrincipalService {
    private final PrincipalRepository principals;
    private final TransactionTemplate transactions;

    public PrincipalService(PrincipalRepository principals, PlatformTransactionManager transactionManager) {
        this.principals = principals;
        this.transactions = new TransactionTemplate(transactionManager);
        this.transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Records that a principal was seen, creating it on first sight. A user's first
     * sign-in sends several requests at once; when two of them create the same
     * principal, the loser hits {@code uq_principal_issuer_subject} and retries in a
     * new transaction, where it finds the winner's row.
     */
    public PrincipalEntity observe(String issuer, String subject, String username,
            PrincipalEntity.Type type) {
        try {
            return transactions.execute(status -> upsert(issuer, subject, username, type));
        } catch (DataIntegrityViolationException concurrentFirstSight) {
            return transactions.execute(status -> upsert(issuer, subject, username, type));
        }
    }

    private PrincipalEntity upsert(String issuer, String subject, String username,
            PrincipalEntity.Type type) {
        Instant now = Instant.now();
        PrincipalEntity principal = principals.findByIssuerAndSubjectId(issuer, subject)
                .orElseGet(PrincipalEntity::new);
        if (principal.getFirstSeenAt() == null) principal.setFirstSeenAt(now);
        principal.setIssuer(issuer);
        principal.setSubjectId(subject);
        principal.setUsername(username);
        principal.setPrincipalType(type);
        principal.setLastSeenAt(now);
        return principals.saveAndFlush(principal);
    }
}
